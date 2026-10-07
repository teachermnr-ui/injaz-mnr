const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8765/';
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const out=(...a)=>console.log(...a);

function seedDB(){
  const DB = {};
  const perms = (extra)=>Object.assign({ 'omr.classes':{access:true,edit:true,del:true} }, extra||{});
  DB['users/sa1'] = { role:'schoolAdmin', username:'ياسر الجميعي', authUid:'U_SA1', adminSchools:['S2'], active:true };
  DB['schoolData/S2'] = { name:'مدرسة الاختبار', code:'1234', _isSchool:true, active:true };
  const classes = [
    ['أول ابتدائي','1أ','ابتدائية'],
    ['رابع ابتدائي','4أ','ابتدائية'],
    ['أول متوسط','م1أ','متوسطة'],
    ['ثاني متوسط','م2أ','متوسطة','تحفيظ'],
    ['أول ثانوي','101','ثانوية'],
    ['ثاني ثانوي','201','ثانوية','عام'],
    ['ثاني ثانوي','ح201','ثانوية','علوم الحاسب والهندسة'],
  ].map(([name,code,stage,track])=>Object.assign({ name, code, stage, loginCode:'x' }, track?{track}:{}));
  DB['schoolData/roster_S2'] = { value: JSON.stringify({ classes, students:[], customSubjects:[], loginCodeCounters:{}, teacherAdd:true }), schoolId:'S2', base:'roster' };
  return DB;
}

(async()=>{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{ width:1440, height:900 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic/, r=>r.fulfill({ status:200, body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  const seed = seedDB();
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  await ctx.addInitScript(([uid, session, seed])=>{
    window.__mockUid = uid;
    localStorage.setItem('cls_session', JSON.stringify(session));
    localStorage.setItem('__mockdb', JSON.stringify(seed));
  }, ['U_SA1', SA, seed]);
  const page = await ctx.newPage();
  page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  page.on('console', m=>{ if(m.type()==='error') out('CONSOLE:', m.text()); });
  await page.goto(BASE+'timetable.html');
  await page.waitForSelector('#app:not(.hidden)', { timeout:10000 });

  // enable all stages
  await page.evaluate(()=>{ ['p','m','h'].forEach(k=>stageCfg(k).enabled=true); markDirty(docIds.config()); });

  await page.evaluate(()=>{ TT.ui.planStage='p'; show('plan'); });
  const p1 = await page.evaluate(()=>{
    const pk = stagePlanKeys('p').find(k=>k.startsWith('p|أول ابتدائي'));
    return { pk, plan: (cfg().plans[pk]||[]).map(s=>s.name+'|'+s.code+':'+s.weekly) };
  });
  out('primary(أول ابتدائي) plan:', JSON.stringify(p1));

  const p4 = await page.evaluate(()=>{
    const pk = stagePlanKeys('p').find(k=>k.startsWith('p|رابع ابتدائي'));
    return { pk, plan: (cfg().plans[pk]||[]).map(s=>s.name+'|'+s.code+':'+s.weekly) };
  });
  out('primary(رابع ابتدائي) plan:', JSON.stringify(p4));

  await page.evaluate(()=>{ TT.ui.planStage='m'; show('plan'); });
  const m1 = await page.evaluate(()=>({ pk: stagePlanKeys('m')[0], plan:(cfg().plans[stagePlanKeys('m')[0]]||[]).map(s=>s.name+'|'+s.code+':'+s.weekly) }));
  out('middle(أول متوسط، عام) plan:', JSON.stringify(m1));
  const mT = await page.evaluate(()=>{ const pk = stagePlanKeys('m').find(k=>k.includes('تحفيظ')); return { pk, plan:(cfg().plans[pk]||[]).map(s=>s.name+'|'+s.code+':'+s.weekly) }; });
  out('middle(ثاني متوسط، تحفيظ) plan:', JSON.stringify(mT));

  await page.evaluate(()=>{ TT.ui.planStage='h'; show('plan'); });
  const hAll = await page.evaluate(()=>{
    const pks = stagePlanKeys('h');
    const out={};
    pks.forEach(pk=>{ out[pk] = (cfg().plans[pk]||[]).map(s=>s.name+'|'+s.code+':'+s.weekly); });
    return out;
  });
  out('secondary period1 plans:', JSON.stringify(hAll, null, 0));

  // الفترة الثانية: صفحة جديدة بجلسة period=second (الفصلان مستقلان تمامًا للثانوي)
  const SA2 = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'second', ctxKey:'school:S2' };
  const ctx2 = await browser.newContext({ viewport:{ width:1440, height:900 } });
  await ctx2.route(/jsdelivr|cdnjs|googleapis|gstatic/, r=>r.fulfill({ status:200, body:'' }));
  await ctx2.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx2.addInitScript(([uid, session, seed])=>{
    window.__mockUid = uid;
    localStorage.setItem('cls_session', JSON.stringify(session));
    localStorage.setItem('__mockdb', JSON.stringify(seed));
  }, ['U_SA1', SA2, seed]);
  const page2 = await ctx2.newPage();
  page2.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await page2.goto(BASE+'timetable.html');
  await page2.waitForSelector('#app:not(.hidden)', { timeout:10000 });
  await page2.evaluate(()=>{ ['p','m','h'].forEach(k=>stageCfg(k).enabled=true); TT.ui.planStage='h'; show('plan'); });
  const hAll2 = await page2.evaluate(()=>{
    const pks = stagePlanKeys('h');
    const out={};
    pks.forEach(pk=>{ out[pk] = (cfg().plans[pk]||[]).map(s=>s.name+'|'+s.code+':'+s.weekly); });
    return out;
  });
  out('secondary period2 plans:', JSON.stringify(hAll2, null, 0));

  // custom addition still works (+ مادة)
  await page.evaluate(()=>{ TT.ui.planStage='h'; show('plan'); });
  const pkAny = await page.evaluate(()=>stagePlanKeys('h')[0]);
  await page.click(`#pc_${await page.evaluate((pk)=>pk.replace(/[^a-zA-Z0-9؀-ۿ]/g,'_'),pkAny)} [data-add]`);
  const afterAdd = await page.evaluate((pk)=>cfg().plans[pk].length, pkAny);
  out('after manual + مادة, count for first h plan =', afterAdd);

  await browser.close();
})();
