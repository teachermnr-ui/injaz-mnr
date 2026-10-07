const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
const SH = __dirname+'/shots/';
let ERRS = 0;
async function open(browser, uid, session, db, page, w){
  const ctx = await browser.newContext({ viewport:{ width:w||1300, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid,s,db])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{};
    window.open=()=>({ document:{ write:h=>{ window.__printed=(window.__printed||'')+h; }, close(){} } });
  }, [uid,session,db]);
  const p = await ctx.newPage(); p.on('pageerror', e=>{ if(!/pdfjsLib|XLSX/.test(e.message)){ ERRS++; out('PAGE ERROR:', e.message); } });
  await p.goto('http://127.0.0.1:8765/'+(page||'index.html')); await p.waitForTimeout(2200);
  return p;
}
const ymd = d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
(async()=>{
  const browser = await chromium.launch();
  const DB = JSON.parse(JSON.stringify(DB0));
  // ربط بقية معلمي الجدول بحسابات (لاختبار «جدولي» و«لوحتي»)
  const TD = JSON.parse(DB['timetables/S2/data/teachers'].value);
  let n = 1010;
  TD.teachers.forEach(t=>{ if(!t.nid){ const id='ux'+n; t.nid=String(n); DB['users/'+id] = { username:t.name, loginId:String(n), authUid:'U_'+id, active:true, schools:{ S2:{ role:'teacher', active:true, permissions:{} } } }; n++; } });
  DB['timetables/S2/data/teachers'].value = JSON.stringify(TD);
  const AGT = { userId:'u4', username:'منير النمري', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pi = await open(browser, 'U_u4', AGT, DB);
  out('1. agent tools =', JSON.stringify(await pi.evaluate(()=>visibleTools().map(t=>t.key))));
  const pa = await open(browser, 'U_u4', AGT, DB, 'timetable.html?sec=waiting');
  out('   waitOnly =', await pa.evaluate(()=>TT.waitOnly), ' canWait =', await pa.evaluate(()=>TT.canWait), ' canEdit =', await pa.evaluate(()=>TT.canEdit), ' sec =', await pa.evaluate(()=>TT.sec));
  out('   visible nav =', JSON.stringify(await pa.$$eval('#sideNav button[data-sec]:not(.hidden)', b=>b.map(x=>x.dataset.sec))));
  out('   stages =', JSON.stringify(await pa.evaluate(()=>wStages().map(s=>s.key))), ' teachers rows =', await pa.$$eval('[data-cap]', x=>x.length));
  await pa.click('#wAuto'); await pa.waitForTimeout(800);
  const chk = await pa.evaluate(()=>{
    const W = wdoc(), A = {}; let over4 = 0, busy = 0, dup = 0, overCap = 0, golden = 0, total = 0;
    Object.entries(W.grid).forEach(([sk,g])=>Object.entries(g).forEach(([k,list])=>{ const [d,p]=k.split('|').map(Number); if(list.length>4) over4++;
      list.forEach(tid=>{ total++; if(wBusy(tid,sk,d,p)) busy++; const a = A[tid] = A[tid] || {days:{}, n:0}; a.n++; a.days[d]=(a.days[d]||0)+1; if(wGolden(tid,sk)===d) golden++; }); }));
    Object.entries(A).forEach(([tid,a])=>{ if(Object.values(a.days).some(v=>v>1)) dup++; if(wLoad(tid)+a.n > wCap(tid)) overCap++; });
    let empty = 0, slots = 0; wStages().forEach(s=>{ const sc=stageCfg(s.key); sc.days.forEach(d=>{ for(let p=0;p<(+sc.ppd[d]||0);p++){ slots++; if(!wCell(s.key,d,p).length) empty++; } }); });
    return { total, over4, busy, dup, overCap, golden, empty, slots, per: Object.entries(A).map(([t,a])=>teacherName(t)+':'+wLoad(t)+'+'+a.n).join(' | ') };
  });
  out('2. auto:', JSON.stringify(chk));
  await pa.screenshot({ path: SH+'80-wait-setup.png', fullPage:true });
  // تعديل الحد لمعلم ثم الاستثناء
  // نشر
  await pa.click('#wPub'); await pa.waitForSelector('#cbOk'); await pa.click('#cbOk'); await pa.waitForTimeout(1200);
  const DBa = await pa.evaluate(()=>__mockDB());
  const wp = DBa['timetables/S2/data/first_waitpub']; const wpv = wp && JSON.parse(wp.value);
  out('3. waitpub users =', wpv && Object.keys(wpv.byUser).length, ' sample u1 =', wpv && JSON.stringify((wpv.byUser.u1||[]).slice(0,3)));
  out('   waiting doc saved =', !!DBa['timetables/S2/data/first_waiting'], ' publishedAt =', !!(DBa['timetables/S2/data/first_waiting'] && JSON.parse(DBa['timetables/S2/data/first_waiting'].value).publishedAt));
  // جدولي للمعلم
  const T1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const wu = Object.keys(wpv.byUser)[0];
  const pm = await open(browser, DBa['users/'+wu].authUid, { userId:wu, username:'x', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' }, DBa, 'myschedule.html');
  const waitCells = await pm.$$eval('td.cell.wait', x=>x.length);
  out('   myschedule', wu, 'wait cells =', waitCells, ' expected =', (wpv.byUser[wu]||[]).length, ' text =', await pm.$eval('#main', e=>e.innerText.includes('انتظار')), ' no rank =', !(await pm.$eval('#main', e=>/انتظار\s*[١-٤1-4]/.test(e.innerText))));
  await pm.screenshot({ path: SH+'81-myschedule-wait.png', fullPage:true });
  // ===== التحديد اليومي =====
  await pa.click('[data-ws="daily"]'); await pa.waitForTimeout(800);
  // اختيار يوم دراسي (الأحد القادم)
  const sun = new Date(); sun.setDate(sun.getDate()+((7-sun.getDay())%7||7));
  await pa.fill('#wdDate', ymd(sun)); await pa.dispatchEvent('#wdDate','change'); await pa.waitForTimeout(800);
  const absTid = await pa.evaluate(()=>{ const t = teachers().find(t=>t.nid && wLessonMap()[t.id] && wLessonMap()[t.id].m && wLessonMap()[t.id].m[0]); return t && t.id; });
  out('4. absent teacher =', await pa.evaluate(id=>teacherName(id), absTid));
  await pa.click(`[data-abs="${absTid}"]`); await pa.waitForTimeout(800);
  const items = await pa.evaluate(d=>TT.wdayCache[d].items.map(it=>it.p+':'+(it.subName||'—')), ymd(sun));
  out('   items =', JSON.stringify(items));
  const firstEmpty = await pa.evaluate(d=>TT.wdayCache[d].items.findIndex(it=>!it.subTid), ymd(sun));
  const target = firstEmpty>=0 ? firstEmpty : 0;
  await pa.click(`[data-it="${target}"]`); await pa.waitForSelector('#modalRoot [data-sub]', { state:'attached' });
  const modalTxt = await pa.$eval('#modalRoot', e=>e.textContent.replace(/\s+/g,' '));
  out('   pick modal: weekly count shown =', modalTxt.includes('حُدِّد له هذا الأسبوع'), ' + section =', modalTxt.includes('معلم آخر فارغ'));
  await pa.click('#modalRoot details summary').catch(()=>{});
  const btn = await pa.$('#modalRoot [data-sub]:not([disabled])');
  if(btn) await btn.click(); await pa.waitForTimeout(500);
  await pa.screenshot({ path: SH+'82-wait-daily.png', fullPage:true });
  await pa.click('#wdSend'); await pa.waitForSelector('#cbOk'); await pa.click('#cbOk'); await pa.waitForTimeout(1200);
  const DBb = await pa.evaluate(()=>__mockDB());
  const wd = DBb['timetables/S2/data/first_wday_'+ymd(sun)]; const wdv = wd && JSON.parse(wd.value);
  out('   wday saved: sent =', wdv && wdv.sent, ' items =', wdv && wdv.items.length, ' with sub =', wdv && wdv.items.filter(i=>i.subTid).length, ' subUids =', wdv && JSON.stringify(wdv.items.map(i=>i.subUid)));
  await pa.click('#wdPrint'); await pa.waitForTimeout(200);
  const pr = await pa.evaluate(()=>window.__printed||'');
  out('   print: title =', pr.includes('سجل توزيع حصص الانتظار'), ' form7 =', pr.includes('نموذج رقم (7)'), ' absent line =', pr.includes('نظراً لغياب الزميل'), ' columns =', pr.includes('ما تم تنفيذه في حصة الانتظار'));
  await pa.click('#wdWa'); await pa.waitForTimeout(800);
  out('   whatsapp (CDN blocked in test) toast =', await pa.$eval('#toast', e=>e.innerText));
  // المعلم البديل: «لوحتي ← انتظاري» — نجعل التاريخ «اليوم» بنسخ المستند
  const subUid = wdv.items.find(i=>i.subUid) && wdv.items.find(i=>i.subUid).subUid;
  if(subUid){
    const today = ymd(new Date());
    DBb['timetables/S2/data/first_wday_'+today] = wd;
    const pt = await open(browser, DBb['users/'+subUid].authUid, { userId:subUid, username:'x', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' }, DBb);
    await pt.evaluate(()=>refreshMyBoardAlerts()); await pt.waitForTimeout(500);
    out('5. sub', subUid, 'wait items =', await pt.evaluate(()=>MYBOARD.wait.length), ' dot =', await pt.evaluate(()=>MYBOARD.waitChanged));
    await pt.evaluate(()=>window.scrollTo(0,0)); await pt.click('#myBoardToggle'); await pt.waitForTimeout(200);
    out('   لوحتي items =', JSON.stringify(await pt.$$eval('#myBoardMenu .tools-item', b=>b.map(x=>x.dataset.key))));
    await pt.click('#myBoardMenu [data-key="wait"]'); await pt.waitForTimeout(300);
    out('   modal =', (await pt.$eval('.modal', e=>e.innerText.replace(/\s+/g,' '))).slice(0,140));
    await pt.screenshot({ path: SH+'83-mywait.png' });
  } else out('5. (no linked sub)');
  // المعلم لا يدخل أداة الجدول
  const pb = await open(browser, 'U_u1', T1, DBb, 'timetable.html?sec=waiting');
  out('6. teacher blocked =', (await pb.$eval('#bootView', e=>e.innerText)).includes('ليست لديك صلاحية'));
  // المدير: كامل
  const SA = { userId:'sa1', username:'ياسر', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const ps = await open(browser, 'U_SA1', SA, DBb, 'timetable.html?sec=waiting');
  out('   principal canEdit/canWait =', await ps.evaluate(()=>TT.canEdit+'/'+TT.canWait), ' all nav =', await ps.$$eval('#sideNav button[data-sec]:not(.hidden)', b=>b.length));
  out('PAGE ERRORS:', ERRS);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
