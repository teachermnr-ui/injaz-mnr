const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
async function open(browser, uid, session){
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv|docs\.opencv/, r=>r.fulfill({ status:200, body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid, s, db])=>{ window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); } window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); }; window.confirm=()=>true; window.prompt=()=>null; }, [uid, session, DB]);
  const page = await ctx.newPage();
  page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await page.goto('http://127.0.0.1:8765/omr.html');
  await page.waitForTimeout(2500);
  return page;
}
(async()=>{
  const browser = await chromium.launch();
  // 1) teacher u1 (published in first period): per-period assignments & visible classes
  const T1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  let p = await open(browser, 'U_u1', T1);
  out('teacher first: managed =', await p.evaluate(()=>typeof clsTtManaged==='function'?clsTtManaged():undefined), ' mySubj =', await p.evaluate(()=>state.mySubjectAssignments.length), ' visible classes =', await p.evaluate(()=>state.classes.map(c=>c.code).join(',')));
  const T2 = Object.assign({}, T1, { period:'second' });
  p = await open(browser, 'U_u1', T2);
  out('teacher second (not published yet): mySubj =', await p.evaluate(()=>state.mySubjectAssignments.length), ' visible =', await p.evaluate(()=>state.classes.map(c=>c.code).join(',')||'(none)'));

  // 2) schoolAdmin: add-class form with track + default code; duplicate grade name allowed
  const SA = { userId:'sa1', username:'ياسر', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  p = await open(browser, 'U_SA1', SA);
  await p.evaluate(()=>{ document.getElementById('secAddAll') && (document.getElementById('secAddAll').style.display='block'); const c=document.getElementById('addClassesSecCard'); if(c) c.style.display='block'; });
  await p.selectOption('#clStage', 'متوسطة'); await p.waitForTimeout(50);
  await p.selectOption('#clName', 'أول متوسط'); await p.waitForTimeout(50);
  out('default code (middle, 1st) =', await p.inputValue('#clCode'), ' track row visible =', await p.isVisible('#clTrackRow'));
  await p.evaluate(()=>addClass()); await p.waitForTimeout(300);
  out('after add: classes with name أول متوسط =', await p.evaluate(()=>state.fullClasses.filter(c=>c.name==='أول متوسط').map(c=>c.code).join(',')), ' alerts =', JSON.stringify(await p.evaluate(()=>window.__alerts||[])));
  await p.selectOption('#clStage', 'ثانوية'); await p.waitForTimeout(50);
  await p.selectOption('#clName', 'ثاني ثانوي'); await p.waitForTimeout(50);
  out('secondary 2nd: track options =', await p.$$eval('#clTrack option', o=>o.map(x=>x.value).join('|')), ' code =', await p.inputValue('#clCode'));
  await p.selectOption('#clTrack', 'الصحة والحياة'); await p.waitForTimeout(50);
  out('after track=الصحة code =', await p.inputValue('#clCode'));
  await p.evaluate(()=>addClass()); await p.waitForTimeout(300);
  out('saved class:', await p.evaluate(()=>JSON.stringify(state.fullClasses.find(c=>c.code==='ص201')||null)));
  await p.selectOption('#clStage', 'ثانوية'); await p.selectOption('#clName', 'أول ثانوي'); await p.waitForTimeout(50);
  out('secondary 1st: track options =', await p.$$eval('#clTrack option', o=>o.map(x=>x.value).join('|')), ' code =', await p.inputValue('#clCode'));
  await p.fill('#clCode', '150'); await p.selectOption('#clTrack', 'مشترك'); await p.waitForTimeout(50);
  out('manual code kept =', await p.inputValue('#clCode'));
  // class table track column
  await p.evaluate(()=>renderClasses());
  out('track selects in table =', await p.$$eval('#classesHost select', s=>s.length), ' header has المسار =', await p.$eval('#classesHost thead', t=>t.innerText.includes('المسار')));
  await p.evaluate(()=>clsSetTrack('201','الشرعي')); await p.waitForTimeout(200);
  out('track changed 201 =', await p.evaluate(()=>state.fullClasses.find(c=>c.code==='201').track));
  // edit class: duplicate name allowed now (rename م2أ to أول متوسط)
  await p.evaluate(()=>{ let n=0; window.prompt=(q,d)=>{ n++; return n===1 ? 'أول متوسط' : d; }; });
  await p.evaluate(()=>ciEditClass('م2أ')); await p.waitForTimeout(300);
  out('rename to duplicate name ok =', await p.evaluate(()=>state.fullClasses.find(c=>c.code==='م2أ').name));
  // cascade code rename updates byPeriod lists of users
  await p.evaluate(()=>{ let n=0; window.prompt=(q,d)=>{ n++; return n===1 ? d : (n===2 ? 'م1د' : d); }; });
  await p.evaluate(()=>ciEditClass('م1ب')); await p.waitForTimeout(600);
  const u1 = await p.evaluate(()=>__mockDB()['users/u1'].schools.S2);
  out('cascade: byPeriod has م1ج =', (u1.subjectAssignmentsByPeriod.first||[]).some(a=>a.classCode==='م1د'), ' old gone =', !(u1.subjectAssignmentsByPeriod.first||[]).some(a=>a.classCode==='م1ب'));
  // 3) delegate lock: agent u4 has omr.classes.subjects? give it and check lock
  const A = { userId:'u4', username:'منير', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const db2 = await p.evaluate(()=>__mockDB());
  db2['users/u4'].schools.S2.permissions['omr.classes.subjects'] = { access:true, edit:true };
  fs.writeFileSync(__dirname+'/db-after.json', JSON.stringify(db2));
  await browser.close();
  const b2 = await chromium.launch();
  const DB2 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
  const ctx = await b2.newContext();
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic/, r=>r.fulfill({ status:200, body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([s, db])=>{ window.__mockUid='U_u4'; localStorage.setItem('cls_session', JSON.stringify(s)); if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); } window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); }; }, [A, DB2]);
  const q = await ctx.newPage(); q.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await q.goto('http://127.0.0.1:8765/omr.html'); await q.waitForTimeout(2500);
  await q.evaluate(()=>initSubjectDelegate()); await q.waitForTimeout(300);
  await q.evaluate(()=>{ const s=document.getElementById('subjUserSel'); s.value='u1'; onSubjUserChange(); }); await q.waitForTimeout(100);
  await q.evaluate(()=>{ const s=document.getElementById('subjSelect'); s.value = s.options[1].value; onSubjectSelectChange(); });
  // school-wide toolActive lock: with timetables/S2/data/meta.toolActive=true (from e2e.js run),
  // ALL users' manual subject-assignment is locked, not just published ones.
  out('school-wide lock active =', await q.evaluate(()=>typeof clsTtManaged==='function'?clsTtManaged():undefined));
  out('delegate view for u1 while tool active:', await q.$eval('#subjClassesHost', e=>e.innerText.trim().slice(0,80)), ' save btn hidden =', await q.$eval('#subjSaveBtn', b=>b.style.display==='none'));
  await q.evaluate(()=>saveSubjectAssignment());
  out('save blocked alert =', JSON.stringify(await q.evaluate(()=>window.__alerts||[])));
  await q.evaluate(()=>{ const s=document.getElementById('subjUserSel'); s.value='u5'; onSubjUserChange(); }); await q.waitForTimeout(100);
  await q.evaluate(()=>{ const s=document.getElementById('subjSelect'); s.value = s.options[1].value; onSubjectSelectChange(); });
  out('u5 also locked while tool active (checkboxes should be 0) =', await q.$$eval('.subjClsChk', e=>e.length));

  // now deactivate the tool (toolActive:false) and confirm manual editing is restored for both
  await q.evaluate(()=>{ const m = __mockDB()['timetables/S2/data/meta']; const d = JSON.parse(m.value); d.toolActive=false; __mockSet('timetables/S2/data/meta', Object.assign({}, m, { value: JSON.stringify(d) })); });
  await q.reload(); await q.waitForTimeout(2500);
  await q.evaluate(()=>initSubjectDelegate()); await q.waitForTimeout(300);
  out('school-wide lock after deactivate =', await q.evaluate(()=>typeof clsTtManaged==='function'?clsTtManaged():undefined));
  await q.evaluate(()=>{ const s=document.getElementById('subjUserSel'); s.value='u5'; onSubjUserChange(); }); await q.waitForTimeout(100);
  await q.evaluate(()=>{ const s=document.getElementById('subjSelect'); s.value = s.options[1].value; onSubjectSelectChange(); });
  out('u5 editable after deactivate (checkboxes) =', await q.$$eval('.subjClsChk', e=>e.length));
  await b2.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
