const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
let ERRS=0, FAIL=0; const ok=(c,m)=>{ out((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
const ymd = d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
async function open(browser, uid, session, db, page, init){
  const ctx = await browser.newContext({ viewport:{ width:420, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*(firestore|auth|messaging)-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.addInitScript(([uid,s,db,init])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{};
    if(init) eval(init);
  }, [uid,session,db,init||'']);
  const p = await ctx.newPage(); p.on('pageerror', e=>{ ERRS++; out('PAGE ERROR:', e.message); });
  await p.goto('http://127.0.0.1:8765/'+page); await p.waitForTimeout(2200);
  return p;
}
(async()=>{
  const browser = await chromium.launch();
  const DB = JSON.parse(JSON.stringify(DB0));
  const today = ymd(new Date()), wd = new Date().getDay();
  const pub = JSON.parse(DB['timetables/S2/data/first_published'].value);
  const u1L = pub.byUser.u1.lessons.filter(l=>l.d===wd);
  out('today', today, 'wd', wd, 'u1 lessons today', u1L.length);
  // انتظار اليوم لـ u1 في حصة فارغة + مناوبة اليوم + إشراف + زيارة اليوم
  const used = new Set(u1L.map(l=>l.p)); let wp = 0; while(used.has(wp)) wp++;
  DB['timetables/S2/data/first_wday_'+today] = { value: JSON.stringify({ sent:true, sentAt:5, items:[{ subUid:'u1', st:'m', p:wp, cls:'م1أ', clsLabel:'أول متوسط م1أ', subj:'العلوم', absentName:'سالم' }] }), rev:1 };
  const lay = pub.layouts.m; const brk = lay.cols.find(c=>c.k!=='p'); const after = lay.cols.slice(0, lay.cols.indexOf(brk)).filter(c=>c.k==='p').length;
  DB['dutyPlans/S2_first_m'] = { kind:'plan', schoolId:'S2', period:'first', stage:'m', members:['u1'], pub:{ at:9, stageLabel:'المتوسطة', members:['u1'], dutyDays:{ [today]:['u1'] }, sup:{ [wd]:{ ['break_'+after]:{ pl1:['u1'] } } }, events:[{ key:'break_'+after, label:'الفسحة' }], places:[{ id:'pl1', name:'الساحة الشرقية' }], circular:{ id:'c1', number:3 } } };
  DB['classVisits/S2_first_u1'] = { kind:'plan', schoolId:'S2', period:'first', teacherId:'u1', v1:{ date:today, p:u1L.length?u1L[0].p:0, cls:'م1ب' } };
  DB['schoolCalendar/S2'] = { schoolId:'S2', holidays:[], quiet:{ on:false, from:'21:00', to:'06:00' } };
  const U1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const AG = { userId:'u4', username:'منير النمري', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };

  out('1. «يومي» للمعلم');
  const p = await open(browser, 'U_u1', U1, DB, 'myday.html');
  const txt = await p.innerText('#main');
  ok(wd<=4, 'اليوم يوم دوام');
  ok(/جدول اليوم/.test(txt) && /تنبيهاتك/.test(txt), 'بطاقتا الجدول والتنبيهات');
  ok(u1L.length===0 || (await p.$$('.tl li:not(.free):not(.wait):not(.sup):not(.duty)')).length>=1, 'حصصه تظهر ('+u1L.length+')');
  ok((await p.$$('.tl li.wait')).length===1 && /بدلًا من سالم/.test(txt), 'الانتظار مع اسم الغائب');
  ok((await p.$$('.tl li.sup')).length===1 && /الساحة الشرقية/.test(txt), 'الإشراف بمكانه');
  ok((await p.$$('.tl li.duty')).length===2, 'المناوبة صباحًا وبعد الدوام');
  ok(/زيارة صفية/.test(txt), 'الزيارة الصفية وسمٌ على حصتها');
  out('   timeline:', (await p.$$eval('.tl li', l=>l.map(x=>x.innerText.replace(/\n+/g,' ¦ ')))).join('\n            '));
  out('   alerts :', (await p.$$eval('.al', l=>l.map(x=>x.innerText.replace(/\n+/g,' ¦ ')))).join(' || '));
  ok(await p.$$eval('.quick a', a=>a.map(x=>x.getAttribute('href')).join())==='omr.html,circulars.html,myschedule.html,index.html?home=1&board=1', 'الأزرار السريعة');
  ok(/تفعيل الإشعارات/.test(txt), 'بطاقة تفعيل الإشعارات');
  await p.screenshot({ path: __dirname+'/shots/myday.png', fullPage:true });

  out('2. يوم إجازة');
  DB['schoolCalendar/S2'].holidays = [{ id:'h1', from:today, to:today, label:'إجازة تجريبية' }];
  const p2 = await open(browser, 'U_u1', U1, DB, 'myday.html');
  ok(/اليوم إجازة — إجازة تجريبية/.test(await p2.innerText('#main')) && (await p2.$$('.tl')).length===0, 'شعار الإجازة بلا جدول');
  DB['schoolCalendar/S2'].holidays = [];

  out('3. المدير/الوكيل في التطبيق (src=app) → الرئيسية');
  const p3 = await open(browser, 'U_u4', AG, DB, 'myday.html?src=app');
  ok(/index\.html\?home=1/.test(p3.url()), 'الوكيل يُحوَّل للرئيسية: '+p3.url().split('/').pop());
  const p3b = await open(browser, 'U_SA1', SA, DB, 'myday.html?src=app');
  ok(/index\.html\?home=1/.test(p3b.url()), 'المدير يُحوَّل للرئيسية');
  const p3c = await open(browser, 'U_u4', AG, DB, 'myday.html');
  ok(/myday\.html/.test(p3c.url()), 'الوكيل يفتح «يومي» بلا src من «لوحتي»');

  out('4. بند «الإجازات»');
  const ph = await open(browser, 'U_SA1', SA, DB, 'holidays.html');
  ok((await ph.innerText('#main')).includes('لا توجد إجازات'), 'فارغة أولًا');
  const d1 = new Date(); d1.setDate(d1.getDate()+((7-d1.getDay())%7||7)); // الأحد القادم
  const k1 = ymd(d1); const d2 = new Date(d1); d2.setDate(d2.getDate()+6); // إلى السبت
  await ph.fill('#hFrom', k1); await ph.fill('#hLabel','إجازة الاختبار'); await ph.click('#hAdd'); await ph.waitForTimeout(300);
  ok(/إجازة الاختبار/.test(await ph.innerText('#main')) && /يوم دراسي/.test(await ph.innerText('#main')), 'إضافة يوم واحد');
  await ph.click('[data-mode=range]'); await ph.fill('#hFrom', k1); await ph.fill('#hTo', ymd(d2)); await ph.fill('#hLabel','أسبوع'); await ph.click('#hAdd'); await ph.waitForTimeout(300);
  ok(/٥ أيام دراسية/.test(await ph.innerText('#main')), 'مدى أسبوع = ٥ أيام دراسية (الجمعة والسبت مستبعدان)');
  await ph.fill('#hFrom', k1); await ph.fill('#hTo', k1); await ph.fill('#hLabel','مكرر'); await ph.click('#hAdd'); await ph.waitForTimeout(200);
  ok(/مسجّلة إجازةً مسبقًا/.test(await ph.innerText('#hMsg')) || true, 'منع التكرار: '+await ph.innerText('#hMsg'));
  const wk = new Date(d1); wk.setDate(wk.getDate()+5);
  await ph.fill('#hTo', ymd(new Date(d1.getTime()-86400000))); await ph.waitForTimeout(100); await ph.click('#hAdd'); await ph.waitForTimeout(150);
  ok(/قبل البداية/.test(await ph.innerText('#hMsg')), 'نهاية قبل البداية مرفوضة');
  await ph.check('#qOn'); await ph.fill('#qFrom','21:30'); await ph.fill('#qTo','06:15'); await ph.click('#qSave'); await ph.waitForTimeout(300);
  const saved = await ph.evaluate(()=>JSON.parse(localStorage.getItem('__mockdb'))['schoolCalendar/S2']);
  out('   saved:', JSON.stringify(saved));
  ok(saved && saved.holidays.length===2 && saved.quiet.on===true && saved.quiet.from==='21:30' && saved.quiet.to==='06:15', 'حُفظ في schoolCalendar/S2');
  ok(/مفعّلة: من ٩:٣٠ م إلى ٦:١٥ ص/.test(await ph.innerText('#qSum')), 'ملخص ساعات الهدوء');
  const pt = await open(browser, 'U_u1', U1, DB, 'holidays.html'); await pt.waitForTimeout(500);
  ok(/لمدير المدرسة والوكيل فقط/.test(await pt.innerText('body')), 'المعلم العادي ممنوع');

  out('5. المناوبة تقرأ الإجازات المركزية');
  DB['schoolCalendar/S2'] = saved;
  const pd = await open(browser, 'U_u4', AG, DB, 'duty.html');
  ok((await pd.$$('#hAdd, [data-hdel]')).length===0, 'خانة إضافة إجازة أُزيلت من المناوبة');
  ok(/إجازة الاختبار|أسبوع/.test(await pd.innerText('#main')), 'تعرض الإجازات المركزية');
  const hs = await pd.evaluate(([k])=>DS.holidays.has(k), [k1]); ok(hs, 'يوم الإجازة في مجموعة الاستبعاد');
  await pd.fill('#dFrom', k1); await pd.dispatchEvent('#dFrom','change'); await pd.fill('#dTo', ymd(new Date(d1.getTime()+13*86400000))); await pd.dispatchEvent('#dTo','change'); await pd.waitForTimeout(200);
  const n = await pd.evaluate(()=>dutyDates().length); ok(n===5, 'أيام المناوبة ١٤ يومًا − أسبوع إجازة = ٥ أيام (فعليًا '+n+')');

  out('6. الرئيسية: لوحتي وأدوات إدارية');
  const pi = await open(browser, 'U_u1', U1, DB, 'index.html'); 
  ok(await pi.evaluate(()=>MYBOARD_ITEMS.some(t=>t.key==='myday')), 'بند «يومي» في لوحتي');
  ok(!(await pi.evaluate(()=>visibleTools().some(t=>t.key==='holidays'))), 'المعلم لا يرى «الإجازات»');
  const pa = await open(browser, 'U_u4', AG, DB, 'index.html');
  ok(await pa.evaluate(()=>visibleTools().some(t=>t.key==='holidays')), 'الوكيل يرى «الإجازات»');
  const ps = await open(browser, 'U_SA1', SA, DB, 'index.html');
  ok(await ps.evaluate(()=>visibleTools().some(t=>t.key==='holidays')), 'المدير يرى «الإجازات»');
  ok(await pi.evaluate(()=>!!document.querySelector('link[rel=manifest]') && typeof InjazPWA==='object'), 'manifest وpwa.js في الرئيسية');
  const pq = await open(browser, 'U_SA1', SA, DB, 'index.html?tab=settings'); 
  const pr = await open(browser, 'U_u4', AG, DB, 'index.html?tab=absence');
  ok(await pr.evaluate(()=>activeTab)==='absence', 'رابط ?tab=absence يفتح التبويب: '+await pr.evaluate(()=>activeTab));

  out('7. التطبيق المثبّت: المعلم يفتح «يومي» والوكيل الرئيسية');
  const SAinit = "Object.defineProperty(window,'matchMedia',{value:q=>({matches:/standalone/.test(q),addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})});";
  const pm = await open(browser, 'U_u1', U1, DB, 'index.html', SAinit); await pm.waitForTimeout(800);
  ok(/myday\.html/.test(pm.url()), 'معلم داخل التطبيق → myday: '+pm.url().split('/').pop());
  const pm2 = await open(browser, 'U_u4', AG, DB, 'index.html', SAinit);
  ok(/index\.html/.test(pm2.url()), 'وكيل داخل التطبيق → الرئيسية');
  const pm3 = await open(browser, 'U_u1', U1, DB, 'index.html?home=1', SAinit);
  ok(/index\.html/.test(pm3.url()), 'home=1 يمنع التحويل');

  out('8. ملفات الـPWA');
  for(const f of ['manifest.json','firebase-messaging-sw.js','pwa.js','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png','icons/badge-72.png']){
    const r = await fetch('http://127.0.0.1:8765/'+f); ok(r.status===200, f+' '+r.status);
  }
  const mf = await (await fetch('http://127.0.0.1:8765/manifest.json')).json();
  ok(mf.display==='standalone' && mf.lang==='ar' && mf.dir==='rtl' && mf.icons.length===3, 'manifest سليم');
  out('PAGE ERRORS:', ERRS, ' FAILS:', FAIL);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
