// اختبار الهوية الموحّدة (2026-10-05): المظهران + الوضع + الترويسة الموحّدة + «يومي» + التقاط الصور بالفاتح
// التشغيل: python3 -m http.server 8765 (من مجلد الموقع) ثم  node tests/theme-test.js
const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const out=(...a)=>console.log(...a);
let FAIL=0, ERRS=0; const ok=(c,m)=>{ out((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const now=new Date(), wd=now.getDay(), today=ymd(now);
const hm=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
const t0=new Date(now.getTime()-100*60000), t=m=>hm(new Date(t0.getTime()+m*60000));
const cols=[{k:'p',p:0,t:t(0)},{k:'p',p:1,t:t(45)},{k:'p',p:2,t:t(90)},{k:'b',type:'break',t:t(135)},{k:'p',p:3,t:t(160)}];
function seed(theme){ const DB={
  'users/u1':{username:'محمد نجيب',authUid:'U_u1',active:true,schools:{S2:{role:'teacher',permissions:{'omr.classes':{access:true,edit:true}},assignedClasses:['__all__'],active:true}}},
  'users/u4':{username:'منير النمري',authUid:'U_u4',active:true,schools:{S2:{role:'agent',permissions:{'index.absence':{access:true,edit:true},'omr.classes':{access:true}},assignedClasses:['__all__'],active:true}}},
  'users/adm':{role:'admin',username:'أدمن النظام',authUid:'U_ADM',active:true},
  'schoolData/S2':{name:'متوسطة الأنموذجية',active:true,code:'S2'},
  'timetables/S2/data/first_published':{value:JSON.stringify({layouts:{m:{label:'المتوسطة',cols,ppd:{0:5,1:5,2:5,3:5,4:5,5:5,6:5}}},byUser:{u1:{lessons:[{d:wd,p:0,s:'العلوم',cl:'م1أ',st:'m'},{d:wd,p:2,s:'العلوم',cl:'م2ب',st:'m'}],sig:'x'}}})},
  'schoolCalendar/S2':{holidays:[],quiet:{on:false}} };
  if(theme!==undefined) DB['settings/appearance']={theme};
  return DB; }
const T={userId:'u1',username:'محمد نجيب',role:'teacher',schoolId:'S2',period:'first',ctxKey:'school:S2'};
const A={userId:'u4',username:'منير النمري',role:'agent',schoolId:'S2',period:'first',ctxKey:'school:S2'};
const AD={userId:'adm',username:'أدمن النظام',role:'admin',schoolId:null,ctxKey:'admin',period:'first'};
async function open(b, uid, s, db, page, opt){
  opt=opt||{};
  const ctx=await b.newContext({ viewport:{width:390,height:844}, colorScheme:opt.scheme||'light' });
  await ctx.route(/cdnjs|jsdelivr|fonts\.g/, r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await ctx.route(/gstatic\.com\/firebasejs\//, r=>r.fulfill({status:200,contentType:'application/javascript',body:/app-compat/.test(r.request().url())?MOCK:''}));
  await ctx.addInitScript(([uid,s,db,mode])=>{ window.__mockUid=uid; if(s) localStorage.setItem('cls_session',JSON.stringify(s));
    if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb',JSON.stringify(db)); sessionStorage.setItem('__s','1'); if(mode) localStorage.setItem('injaz_mode',mode); }
    window.alert=()=>{}; window.confirm=()=>true; }, [uid,s,db,opt.mode||'']);
  const p=await ctx.newPage(); p.on('pageerror',e=>{ ERRS++; out('  PAGE ERROR:', e.message); });
  await p.goto('http://127.0.0.1:8765/'+page); await p.waitForTimeout(2300);
  return p;
}
(async()=>{
  const b=await chromium.launch();
  out('1. المظهر العام من الإعدادات');
  for(const [th, want] of [[undefined,'t-jasmine'],['','t-jasmine'],['theme-jasmine','t-jasmine'],['theme-base','t-base'],['theme-dawn','t-jasmine'],['theme-glass','t-jasmine']]){
    const p=await open(b,'U_u4',A,seed(th),'index.html?home=1');
    const c=await p.evaluate(()=>[document.documentElement.className, document.body.className]);
    ok(c[0].includes(want), 'settings='+JSON.stringify(th)+' ← '+want+'  ('+c[0]+')');
    if(want==='t-jasmine') ok(/theme-jasmine/.test(c[1]) && /alt-theme/.test(c[1]), '   body: theme-jasmine + alt-theme');
    else ok(!/theme-jasmine|alt-theme/.test(c[1]), '   body بلا أصناف الياسمين');
    await p.context().close();
  }
  out('2. الوضع لكل مستخدم: تلقائي/فاتح/داكن');
  { const p=await open(b,'U_u4',A,seed(),'index.html?home=1',{scheme:'dark'});
    ok(await p.evaluate(()=>document.documentElement.classList.contains('dark')), 'تلقائي + جوال داكن ← داكن');
    await p.click('#tbAccBtn'); await p.waitForTimeout(200);
    ok(await p.isVisible('#tbAccMenu'), 'قائمة الحساب تنفتح');
    await p.click('#tbModeSlot [data-mode=light]'); await p.waitForTimeout(100);
    ok(await p.evaluate(()=>!document.documentElement.classList.contains('dark') && localStorage.getItem('injaz_mode')==='light'), 'اختيار «فاتح» يلغي الداكن ويُحفظ');
    await p.click('#tbModeSlot [data-mode=dark]'); await p.waitForTimeout(100);
    ok(await p.evaluate(()=>document.documentElement.classList.contains('dark')), 'اختيار «داكن»');
    const meta=await p.evaluate(()=>document.querySelector('meta[name=theme-color]').content);
    ok(meta==='#1f2e27', 'لون شريط الجوال للياسمين الداكن ('+meta+')');
    // التقاط الصور بالفاتح دائمًا
    const cap=await p.evaluate(async()=>{ window.html2canvas = async()=>document.documentElement.classList.contains('dark'); const during=await window.html2canvas(); return [during, document.documentElement.classList.contains('dark')]; });
    ok(cap[0]===false && cap[1]===true, 'html2canvas يلتقط بالفاتح ثم يعيد الداكن');
    await p.keyboard.press('Escape');
    await p.context().close(); }
  out('3. ترويسة الرئيسية: الأزرار القديمة بمعرّفاتها تعمل');
  { const p=await open(b,'U_u4',A,seed(),'index.html?home=1');
    const ids=await p.evaluate(()=>['tbTitle','tbDate','tbPeriod','tbCtxSwitchWrap','tbOmr','tbMyAcc','tbPw','tbOut','tbAva'].filter(i=>!document.getElementById(i)));
    ok(!ids.length, 'كل المعرّفات موجودة '+(ids.length?ids.join(','):''));
    ok((await p.textContent('#tbAva')).trim()==='م ن', 'الحروف الأولى: '+(await p.textContent('#tbAva')));
    ok(/الفترة الأولى/.test(await p.textContent('#tbPeriod')), 'شارة الفترة');
    ok(await p.evaluate(()=>!/<br>/.test(document.getElementById('tbDate').innerHTML) && !!document.querySelector('#tbDate .d-h')), 'التاريخ بسطر واحد');
    await p.click('#tbAccBtn'); await p.click('#tbPw'); await p.waitForTimeout(200);
    ok(await p.isVisible('#pwView'), 'تغيير كلمة المرور يفتح');
    ok((await p.textContent('#pwSkip')).trim()==='إلغاء', 'زر «إلغاء» ظاهر عند الفتح الاختياري');
    await p.click('#pwSkip'); await p.waitForTimeout(300);
    ok(await p.isVisible('#appView'), '«إلغاء» يعيد للرئيسية');
    await p.click('#tbAccBtn'); await p.click('#tbMyAcc'); await p.waitForTimeout(500);
    ok(await p.evaluate(()=>document.getElementById('modalRoot').innerHTML.length>20), '«حساباتي» تفتح نافذتها');
    await p.context().close(); }
  { const p=await open(b,'U_u4',A,seed(),'index.html?home=1&pw=1');
    ok(await p.isVisible('#pwView'), 'index.html?home=1&pw=1 يفتح تغيير كلمة المرور مباشرة');
    await p.context().close(); }
  { const p=await open(b,'U_u4',A,seed(),'index.html?home=1');
    await p.click('#tbAccBtn'); await p.click('#tbOut'); await p.waitForTimeout(600);
    ok(await p.isVisible('#loginView'), 'تسجيل الخروج من القائمة');
    await p.context().close(); }
  out('4. إدارة الصف: الترويسة الموحّدة + الشريط السفلي للياسمين فقط');
  for(const th of ['theme-jasmine','theme-base']){
    const p=await open(b,'U_u1',T,seed(th),'omr.html');
    const r=await p.evaluate(()=>({ first: document.body.firstElementChild && document.body.firstElementChild.className,
      ids:['omrAccBtn','omrAccMenu','myAccountsBtn','omrLogoutBtn','ctxSwitchWrap','omrPwLink'].filter(i=>!document.getElementById(i)),
      alt: document.body.classList.contains('alt-theme'), font: getComputedStyle(document.body).fontFamily }));
    ok(r.first==='ijh', th+': الترويسة أول عنصر في الصفحة');
    ok(!r.ids.length, th+': المعرّفات موجودة '+r.ids.join(','));
    ok(r.alt === (th==='theme-jasmine'), th+': الشريط السفلي '+(r.alt?'ظاهر':'غير ظاهر'));
    ok(/Tajawal/.test(r.font), th+': خط Tajawal');
    ok((await p.getAttribute('#omrPwLink','href'))==='index.html?home=1&pw=1', th+': رابط تغيير كلمة المرور');
    await p.context().close();
  }
  out('5. «يومي»');
  { const p=await open(b,'U_u1',T,seed('theme-base'),'myday.html');
    const r=await p.evaluate(()=>({ cls:document.documentElement.className, nav:document.querySelectorAll('#bnav a').length,
      now:!!document.querySelector('.card.now'), rows:document.querySelectorAll('.tl li').length, splash:document.getElementById('bootView').classList.contains('hidden') }));
    ok(r.cls.includes('t-base'), '«يومي» تتبع المظهر المختار (الأساسي)');
    ok(r.nav===5, 'الشريط السفلي ٥ عناصر');
    ok(r.now, 'بطاقة «الآن» ظاهرة أثناء الحصة');
    ok(r.rows>=3, 'خط اليوم ('+r.rows+' صفوف)');
    ok(r.splash, 'شاشة البداية تختفي بعد التحميل');
    await p.context().close(); }
  out('6. إعداد المظهر عند الأدمن');
  { const p=await open(b,'U_ADM',AD,seed(),'index.html');
    await p.evaluate(()=>{ const t=document.querySelector('#tabbar .tab[data-key=settings]'); if(t) t.click(); }); await p.waitForTimeout(800);
    const has=await p.evaluate(()=>!!document.getElementById('appearanceSelect'));
    if(has){
      const opts=await p.evaluate(()=>[...document.querySelectorAll('#appearanceSelect option')].map(o=>o.value));
      ok(JSON.stringify(opts)==='["theme-jasmine","theme-base"]', 'خياران فقط: '+opts.join(','));
      await p.evaluate(()=>{ document.getElementById('appearanceSelect').value='theme-base'; document.getElementById('appearanceSaveBtn').click(); });
      await p.waitForTimeout(500);
      ok(await p.evaluate(()=>(__mockDB()['settings/appearance']||{}).theme==='theme-base'), 'الحفظ يكتب theme-base');
      ok(await p.evaluate(()=>document.documentElement.classList.contains('t-base')), 'يُطبَّق فورًا');
    } else ok(false, 'قائمة المظهر غير موجودة في صفحة الأدمن');
    await p.context().close(); }
  out(`\nالنتيجة: ${FAIL? FAIL+' فشل' : 'كل الفحوص نجحت'} · أخطاء صفحات: ${ERRS}`);
  await b.close();
  process.exit(FAIL||ERRS?1:0);
})();
