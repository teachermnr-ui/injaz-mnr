const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);

async function open(browser, uid, session, db){
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid, s, db])=>{
    window.__mockUid=uid;
    localStorage.setItem('cls_session', JSON.stringify(s));
    localStorage.setItem('__mockdb', JSON.stringify(db));
    window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); };
    window.confirm=()=>true;
  }, [uid, session, db]);
  const page = await ctx.newPage();
  page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await page.goto('http://127.0.0.1:8765/index.html');
  await page.waitForTimeout(1800);
  return { ctx, page };
}

(async()=>{
  const browser = await chromium.launch();

  // قاعدة فيها: تعميم إلزامي على u1 بدون توقيع + جدول معتمد لمادة u1 في فصل ١م1 يوم الأحد الحصة ١
  const DB1 = JSON.parse(JSON.stringify(DB));
  DB1['circulars/S2/items/c1'] = { number:1, title:'تعميم اختبار', mandatory:true, recipients:['u1'], createdByName:'ياسر', createdAt: Date.now() };
  // النسخة المنشورة («جدولي» يقرأ منها فقط) — u1 له حصة، u4 له حصة، ag1 لا شيء
  const pubDoc = (u1sig, u4sig)=>({ value: JSON.stringify({ publishedAt: Date.now(), by:'sa1', period:'first', byUser: {
    u1: { sig:u1sig, lessons:[ { st:'m', sl:'المرحلة المتوسطة', d:0, p:0, n:1, c:'١م1', cl:'أول متوسط ١م1', s:'الرياضيات' } ] },
    u4: { sig:u4sig, lessons:[ { st:'m', sl:'المرحلة المتوسطة', d:1, p:2, n:1, c:'١م2', cl:'أول متوسط ١م2', s:'العلوم' } ] } } }) });
  DB1['timetables/S2/data/first_published'] = pubDoc('s1', 'x1');
  if(DB1['users/u1'].schools.S2.schedSeenSig) delete DB1['users/u1'].schools.S2.schedSeenSig;

  const U1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const { page: p1 } = await open(browser, 'U_u1', U1, DB1);

  // زر «لوحتي» ظاهر وفيه نقطة حمراء (تعميم معلّق + جدول جديد لم يُشاهَد)
  const btnVisible = await p1.evaluate(()=>{ const b=document.getElementById('myBoardToggle'); return b && getComputedStyle(b).display!=='none'; });
  const dotVisible = await p1.evaluate(()=>{ const d=document.getElementById('myBoardDot'); return d && getComputedStyle(d).display!=='none'; });
  out('زر «لوحتي» ظاهر =', btnVisible, '(expect true)');
  out('علامة التنبيه ظاهرة على «لوحتي» =', dotVisible, '(expect true)');

  // الضغط عليه يفتح قائمة منسدلة (لا يبدّل المحتوى داخل نفس الصفحة)
  await p1.click('#myBoardToggle');
  await p1.waitForTimeout(300);
  const menuItems = await p1.evaluate(()=> [...document.querySelectorAll('#myBoardMenu .tools-item')].filter(b=>b.dataset.key!=='myday').map(b=>({ key:b.dataset.key, href:b.dataset.href, text:b.textContent.trim() })));
  out('القائمة فيها بندان بالترتيب الصحيح =', JSON.stringify(menuItems.map(m=>m.key)) === JSON.stringify(['circulars','schedule']));
  out('البند الأول: التعاميم، href صحيح =', menuItems[0].text.includes('التعاميم') && menuItems[0].href==='circulars.html');
  out('البند الثاني: جدولي، href صحيح =', menuItems[1].text.includes('جدولي') && menuItems[1].href==='myschedule.html');
  const dotsVisible = await p1.evaluate(()=> [...document.querySelectorAll('#myBoardMenu .tools-item')].filter(b=>b.dataset.key!=='myday').map(b=>{
    const d=b.querySelector('.tab-dot'); return d && getComputedStyle(d).display!=='none';
  }));
  out('نقطة حمراء على بند «التعاميم» =', dotsVisible[0], '(expect true)');
  out('نقطة حمراء على بند «جدولي» =', dotsVisible[1], '(expect true)');

  // النقر خارج القائمة يغلقها
  await p1.click('body', { position:{x:5,y:5} });
  await p1.waitForTimeout(150);
  out('النقر خارج القائمة يغلقها =', await p1.evaluate(()=>!document.getElementById('myBoardMenu')));

  // الضغط على بند «جدولي» ينقل فعليًا لصفحة myschedule.html (لا يبقى داخل index.html)
  await p1.click('#myBoardToggle');
  await p1.waitForTimeout(200);
  await p1.click('#myBoardMenu [data-key="schedule"]');
  await p1.waitForTimeout(1000);
  out('التنقل الفعلي إلى myschedule.html =', p1.url().includes('myschedule.html'));
  const schedText = await p1.evaluate(()=>document.body.innerText);
  out('صفحة جدولي تعرض اليوم والمادة والفصل =', schedText.includes('الأحد') && schedText.includes('الرياضيات') && schedText.includes('١م1'));
  out('سُجّل توقيع الاطّلاع في مستند u1 =', await p1.evaluate(()=>JSON.stringify(__mockDB()['users/u1'].schools.S2.schedSeenSig)), '(expect {"first":"s1"})');

  // بعد عرض الجدول مرة، يُسجَّل الاطّلاع — رجوعه لاحقًا لـ«لوحتي» تختفي علامة «جدولي»
  const DBafterView = await p1.evaluate(()=>__mockDB());
  const { page: p1b } = await open(browser, 'U_u1', U1, DBafterView);
  await p1b.click('#myBoardToggle');
  await p1b.waitForTimeout(300);
  const dotsVisible2 = await p1b.evaluate(()=> [...document.querySelectorAll('#myBoardMenu .tools-item')].filter(b=>b.dataset.key!=='myday').map(b=>{
    const d=b.querySelector('.tab-dot'); return d && getComputedStyle(d).display!=='none';
  }));
  out('بعد الاطّلاع: نقطة «جدولي» اختفت =', !dotsVisible2[1], '(expect true)');
  out('نقطة «التعاميم» باقية (لم يوقّع بعد) =', dotsVisible2[0], '(expect true)');

  // نشر جديد غيّر جدول u4 فقط ← u1 لا يصله إشعار
  const dotOf = async (db)=>{ const { page } = await open(browser, 'U_u1', U1, db); await page.click('#myBoardToggle'); await page.waitForTimeout(250);
    return page.evaluate(()=>{ const d=document.querySelector('#myBoardMenu [data-key="schedule"] .tab-dot'); return d && getComputedStyle(d).display!=='none'; }); };
  const DBotherChanged = JSON.parse(JSON.stringify(DBafterView)); DBotherChanged['timetables/S2/data/first_published'] = pubDoc('s1', 'x2');
  out('نشر غيّر جدول غيره فقط: لا نقطة لـu1 =', !(await dotOf(DBotherChanged)), '(expect true)');
  const DBmineChanged = JSON.parse(JSON.stringify(DBafterView)); DBmineChanged['timetables/S2/data/first_published'] = pubDoc('s2', 'x2');
  out('نشر غيّر جدوله هو: نقطة لـu1 =', await dotOf(DBmineChanged), '(expect true)');
  // اعتماد بلا نشر: لا شيء يظهر في «جدولي»
  const DBnoPub = JSON.parse(JSON.stringify(DB1)); delete DBnoPub['timetables/S2/data/first_published'];
  out('بلا نشر: لا نقطة =', !(await dotOf(DBnoPub)), '(expect true)');
  { const { page } = await open(browser, 'U_u1', U1, DBnoPub); await page.goto('http://127.0.0.1:8765/myschedule.html'); await page.waitForTimeout(1200);
    out('بلا نشر: «جدولي» يقول لم يُنشر =', (await page.evaluate(()=>document.body.innerText)).includes('لم يُنشر الجدول بعد'), '(expect true)'); }

  // موظف ما له ولا تعميم ولا جدول (ag1، مستشار): الزر ظاهر (دائم) لكن بدون أي نقطة
  const AG1 = { userId:'ag1', username:'مستشار', role:'counselor', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const { page: p2 } = await open(browser, 'U_ag1', AG1, DB1);
  const btnVisible2 = await p2.evaluate(()=>{ const b=document.getElementById('myBoardToggle'); return b && getComputedStyle(b).display!=='none'; });
  const dotVisible2b = await p2.evaluate(()=>{ const d=document.getElementById('myBoardDot'); return d && getComputedStyle(d).display!=='none'; });
  out('الزر دائم الظهور حتى بلا تعاميم/جدول =', btnVisible2, '(expect true)');
  out('بلا أي نقطة تنبيه له =', !dotVisible2b, '(expect true)');

  // الأدمن العام: لا يظهر له الزر إطلاقًا
  const DBadmin = JSON.parse(JSON.stringify(DB1));
  const ADM = { userId:'admin1', username:'الأدمن', role:'admin', schoolId:null, ctxKey:'admin' };
  if(!DBadmin['users/admin1']) DBadmin['users/admin1'] = { role:'admin', username:'الأدمن', authUid:'U_admin1', active:true };
  const { page: p3 } = await open(browser, 'U_admin1', ADM, DBadmin);
  const btnVisible3 = await p3.evaluate(()=>{ const b=document.getElementById('myBoardToggle'); return b && getComputedStyle(b).display!=='none'; });
  out('الأدمن العام لا يرى زر «لوحتي» =', !btnVisible3, '(expect true)');

  await browser.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
