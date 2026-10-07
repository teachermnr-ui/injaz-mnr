const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
const SH = __dirname+'/shots/';
let ERRS = 0;
async function open(browser, uid, session, db, page){
  const ctx = await browser.newContext({ viewport:{ width:1200, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid,s,db])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{};
    window.open=()=>({ document:{ write:h=>{ window.__printed=(window.__printed||'')+h; }, close(){} } });
  }, [uid,session,db]);
  const p = await ctx.newPage(); p.on('pageerror', e=>{ ERRS++; out('PAGE ERROR:', e.message); });
  await p.goto('http://127.0.0.1:8765/'+(page||'index.html')); await p.waitForTimeout(1800);
  return p;
}
const go = (p,tab)=>p.evaluate(t=>{ activeTab=t; renderTabs(); renderPanel(); }, tab).then(()=>p.waitForTimeout(900));
const dk = d=>{ const x=new Date(); x.setDate(x.getDate()-d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
const nextSunday = ()=>{ const x=new Date(); x.setDate(x.getDate()+((7-x.getDay())%7||7)); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
(async()=>{
  const browser = await chromium.launch();
  const DB = JSON.parse(JSON.stringify(DB0));
  // طالب 111: ٥ أيام غياب (بثلاثة مسجّلين) · طالب 222: ٣ أيام · طالب 333: تأخر ٦ أيام (لا يُحتسب)
  const markers = ['u1','u2','sa1','u1','u2'];
  for(let i=0;i<5;i++){ const d=dk(i); DB['attendance/att_S2_first_111_'+d] = { schoolId:'S2', period:'first', seat:'111', name:'طالب أول', classCode:'م1أ', className:'أول متوسط', date:d, status:'absent', markedBy:markers[i], markedByName:markers[i] }; }
  for(let i=0;i<3;i++){ const d=dk(i); DB['attendance/att_S2_first_222_'+d] = { schoolId:'S2', period:'first', seat:'222', name:'طالب ثان', classCode:'م1أ', className:'أول متوسط', date:d, status:'absent', markedBy:'u1' }; }
  for(let i=0;i<6;i++){ const d=dk(i); DB['attendance/att_S2_first_333_'+d] = { schoolId:'S2', period:'first', seat:'333', name:'طالب متأخر', classCode:'م1أ', className:'أول متوسط', date:d, status:'late', source:'index', markedBy:'u1' }; }
  DB['leaves/lv1'] = { schoolId:'S2', period:'first', seat:'444', name:'مستأذن', classCode:'م1أ', className:'أول متوسط', date:dk(0), time:'10:00', reason:'مرض', byUserId:'u4', byName:'الوكيل' };
  for(let i=0;i<3;i++) DB['notes/n_d'+i] = { schoolId:'S2', period:'first', fromUserId:'u1', fromName:'معلم', recipients:['u4'], recipientsInfo:[], scope:'student', studentSeat:'111', studentName:'طالب', classCode:'م1أ', text:'ملاحظة', referralReason: i<2?'سلوك داخل الفصل':'', createdAt:Date.now()-i*1000, replies:[], readAt:{}, closed:false };
  DB['guidanceCases/c1'] = { schoolId:'S2', period:'first', seat:'111', name:'طالب', type:'سلوكية', status:'open', openedBy:'ag1' };
  DB['users/u4'].schools.S2.permissions = Object.assign({}, DB['users/u4'].schools.S2.permissions||{}, { 'index.absence':{access:true,edit:true,del:false} });

  // ===== ١) الوكيل: تراكم الغياب =====
  const AGT = { userId:'u4', username:'منير النمري', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pa = await open(browser, 'U_u4', AGT, DB);
  await go(pa,'absence');
  const card = await pa.$eval('#absAccCard', e=>e.innerText.replace(/\s+/g,' '));
  out('1. agent card: header =', /طلاب تجاوزوا حد الغياب \(1\)/.test(card), ' has 111 =', card.includes('طالب أول'), ' no 222 =', !card.includes('طالب ثان'), ' no late 333 =', !card.includes('طالب متأخر'), ' threshold 5 =', card.includes('5 أيام'));
  out('   dashboard tab for agent =', await pa.evaluate(()=>visibleTabs().some(t=>t.key==='dashboard')), '(expect false)');
  const txt = await pa.evaluate(()=>absNoticeText(absAccAll().find(s=>s.seat==='111')));
  out('   notice text ok =', txt.includes('تغيّب 5 أيام') && txt.includes('ولي أمر الطالب: طالب أول'));
  await pa.screenshot({ path: SH+'60-abs-acc.png' });
  await pa.click('#absAccCard button:has-text("تم الإشعار")'); await pa.waitForTimeout(400);
  const nt = await pa.evaluate(()=>Object.entries(__mockDB()).find(([k,v])=>k.startsWith('absNotices/') && v.kind==='notice'));
  out('   notice saved =', !!nt, nt && nt[0], ' by =', nt && nt[1].byName);
  const card2 = await pa.$eval('#absAccCard', e=>e.innerText.replace(/\s+/g,' '));
  out('   after notify: none pending =', card2.includes('لا يوجد طلاب تجاوزوا'), ' done list =', card2.includes('تم إشعارهم (1)'));
  await pa.click('#absAccCard button:has-text("تعديل الحد")'); await pa.waitForSelector('#aaOk');
  await pa.fill('#aaThr','3'); await pa.click('#aaOk'); await pa.waitForTimeout(400);
  const card3 = await pa.$eval('#absAccCard', e=>e.innerText.replace(/\s+/g,' '));
  out('   threshold 3: 222 appears =', card3.includes('طالب ثان'), ' settings doc =', await pa.evaluate(()=>(__mockDB()['absNotices/settings_S2']||{}).threshold));
  // إعادة التحميل: الحد والإشعار يبقيان
  await go(pa,'absence');
  out('   reload keeps: threshold =', await pa.evaluate(()=>ABS_ACC.threshold), ' notices =', await pa.evaluate(()=>Object.keys(ABS_ACC.notices).length));
  // أدوات إدارية: الوكيل يرى الزيارات بالدور
  out('   agent tools =', JSON.stringify(await pa.evaluate(()=>visibleTools().map(t=>t.key))));
  const DBa = await pa.evaluate(()=>__mockDB());

  // ===== ٢) مدير المدرسة: المؤشرات =====
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const ps = await open(browser, 'U_SA1', SA, DBa);
  out('2. principal tabs =', JSON.stringify(await ps.evaluate(()=>visibleTabs().map(t=>t.key))));
  await go(ps,'dashboard'); await ps.waitForTimeout(600);
  const dash = await ps.$eval('#dashRoot', e=>e.innerText.replace(/\s+/g,' '));
  out('   KPIs: absent today 2 =', /غياب اليوم 2/.test(dash), ' late today 1 =', /متأخرون اليوم 1/.test(dash), ' leaves 1 =', /مستأذنون اليوم 1/.test(dash));
  out('   referrals 3 =', /التحويلات 3/.test(dash), ' reason =', dash.includes('سلوك داخل الفصل'), ' guidance open 1 =', /حالات إرشادية مفتوحة 1/.test(dash), ' type chip =', dash.includes('سلوكية 1'));
  out('   top classes =', dash.includes('الفصول الأعلى غيابًا'), ' print button absent =', !(await ps.$('#dashRoot button')));
  await ps.screenshot({ path: SH+'61-dashboard.png', fullPage:true });
  await ps.selectOption('#dashRange','all'); await ps.waitForTimeout(200);
  out('   range all ok =', await ps.evaluate(()=>DASH.range));
  out('   principal tools =', JSON.stringify(await ps.evaluate(()=>visibleTools().map(t=>t.key))));

  // ===== ٣) الزيارات الصفية =====
  const pv = await open(browser, 'U_SA1', SA, DBa, 'visits.html');
  const rowsN = await pv.$$eval('table.v tbody tr', r=>r.length);
  out('3. visits page rows =', rowsN, ' header =', (await pv.$eval('#main', e=>e.innerText)).includes('رمز النموذج'));
  await pv.click('#btnNew'); await pv.waitForSelector('#edSave');
  await pv.click('#edSave'); await pv.waitForTimeout(100);
  out('   validation =', await pv.$eval('#edAlert', e=>e.innerText.trim()));
  await pv.selectOption('#edT','u1');
  out('   spec prefilled =', await pv.$eval('#edSpec', e=>e.value));
  const sun = nextSunday();
  await pv.fill('#edDate', sun); await pv.dispatchEvent('#edDate','change'); await pv.waitForTimeout(100);
  const chips = await pv.$$eval('#edLsn button', b=>b.map(x=>x.innerText));
  out('   lessons on Sunday =', chips.length, chips[0]);
  await pv.click('#edLsn button >> nth=1'); await pv.waitForTimeout(100);
  out('   class auto-filled =', await pv.$eval('#edCls', e=>e.value));
  await pv.fill('#edUnit','الوحدة الثانية'); await pv.fill('#edAct','تلاوة');
  await pv.click('#edSeg button[data-w="v2"]'); await pv.waitForTimeout(100);
  await pv.fill('#edDate', dk(1)); await pv.dispatchEvent('#edDate','change');
  await pv.click('#edSave'); await pv.waitForTimeout(100);
  out('   v2 before v1 rejected =', (await pv.$eval('#edAlert', e=>e.innerText)).includes('بعد الأولى'));
  await pv.click('#edClear'); await pv.click('#edSave'); await pv.waitForTimeout(500);
  const plan = await pv.evaluate(()=>__mockDB()['classVisits/S2_first_u1']);
  out('   plan saved: v1 =', plan && JSON.stringify(plan.v1), ' v2 =', plan && plan.v2);
  const rowTxt = await pv.$eval('table.v tbody tr[data-t="u1"]', e=>e.innerText.replace(/\s+/g,' '));
  out('   row shows hijri =', /هـ/.test(rowTxt), ' unit =', rowTxt.includes('الوحدة الثانية'));
  // التنفيذ
  await pv.click('table.v tbody tr[data-t="u1"]'); await pv.waitForSelector('#edExec');
  await pv.selectOption('#edExec','ok'); await pv.click('#edSave'); await pv.waitForTimeout(400);
  out('   exec saved =', await pv.evaluate(()=>__mockDB()['classVisits/S2_first_u1'].exec), ' v1 kept =', await pv.evaluate(()=>!!__mockDB()['classVisits/S2_first_u1'].v1.unit));
  await pv.fill('#sgAgent','منير النمري'); await pv.fill('#sgPrin','ياسر الجميعي'); await pv.click('#sgSave'); await pv.waitForTimeout(300);
  await pv.click('#btnPrint'); await pv.waitForTimeout(200);
  const pr = await pv.evaluate(()=>window.__printed||'');
  out('   print: form no =', pr.includes('نموذج رقم (٤٩)'), ' code =', pr.includes('م.م.ع.ن'), ' ☑ =', pr.includes('☑ في الموعد'), ' names =', pr.includes('منير النمري') && pr.includes('ياسر الجميعي'));
  await pv.screenshot({ path: SH+'62-visits.png', fullPage:true });
  const DBv = await pv.evaluate(()=>__mockDB());

  // الوكيل يفتح الصفحة ويعدّل
  const pva = await open(browser, 'U_u4', AGT, DBv, 'visits.html');
  out('   agent can edit =', !!(await pva.$('#btnNew')));
  // المعلم لا يدخلها
  const T1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pvt = await open(browser, 'U_u1', T1, DBv, 'visits.html');
  out('   teacher blocked =', (await pvt.$eval('#bootView', e=>e.innerText)).includes('لمدير المدرسة والوكيل'));

  // ===== ٤) المعلم: لوحتي ← زياراتي =====
  const pt = await open(browser, 'U_u1', T1, DBv);
  await pt.evaluate(()=>refreshMyBoardAlerts()); await pt.waitForTimeout(400);
  out('4. teacher visits =', await pt.evaluate(()=>MYBOARD.visits.length), ' dot =', await pt.evaluate(()=>MYBOARD.visitsChanged));
  await pt.evaluate(()=>window.scrollTo(0,0));
  await pt.click('#myBoardToggle'); await pt.waitForTimeout(200);
  out('   لوحتي items =', JSON.stringify(await pt.$$eval('#myBoardMenu .tools-item', b=>b.map(x=>x.dataset.key))));
  await pt.click('#myBoardMenu [data-key="visits"]'); await pt.waitForTimeout(300);
  const mv = await pt.$eval('.modal', e=>e.innerText.replace(/\s+/g,' ')).catch(()=> '');
  out('   modal: =', mv.includes('الزيارة الأولى') && mv.includes('الزائر: مدير المدرسة') && mv.includes('الحصة 2'));
  await pt.screenshot({ path: SH+'63-myvisits.png' });
  out('   dot cleared =', await pt.evaluate(()=>!MYBOARD.visitsChanged));
  await pt.evaluate(()=>{ closeModal(); return refreshMyBoardAlerts(); }); await pt.waitForTimeout(300);
  out('   still cleared after refresh =', await pt.evaluate(()=>!MYBOARD.visitsChanged));
  // معلم بلا زيارة: لا يظهر البند
  const T2 = { userId:'u2', username:'سامي خان', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pt2 = await open(browser, 'U_u2', T2, DBv);
  await pt2.evaluate(()=>refreshMyBoardAlerts()); await pt2.waitForTimeout(300);
  out('   other teacher visits item =', await pt2.evaluate(()=>MYBOARD_ITEMS.find(t=>t.key==='visits').when()), '(expect false)');
  out('   teacher no dashboard/absence card =', await pt2.evaluate(()=>!visibleTabs().some(t=>t.key==='dashboard')));
  // أدمن النظام: لا مؤشرات ولا زيارات
  const AD = { userId:'adm', username:'أدمن النظام', role:'admin', schoolId:null, ctxKey:'admin', period:'first' };
  const pad = await open(browser, 'U_ADM', AD, DBv);
  out('5. admin: dashboard =', await pad.evaluate(()=>visibleTabs().some(t=>t.key==='dashboard')), ' visits tool =', await pad.evaluate(()=>visibleTools().some(t=>t.key==='visits')));
  out('PAGE ERRORS:', ERRS);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
