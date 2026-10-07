const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);

async function open(browser, uid, session, db, url){
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  // نكتفي بتعويض pdfjsLib بكائن وهمي (الاختبار يرفع صورة لا PDF، فما يحتاج محرك pdf.js حقيقي)
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'window.pdfjsLib={GlobalWorkerOptions:{}};' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid, s, db])=>{
    window.__mockUid=uid;
    localStorage.setItem('cls_session', JSON.stringify(s));
    if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); }
    window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); };
    window.confirm=()=>true; window.prompt=()=>null;
  }, [uid, session, db]);
  const page = await ctx.newPage();
  page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await page.goto(url || 'http://127.0.0.1:8765/circulars.html');
  await page.waitForTimeout(1500);
  return { ctx, page };
}

(async()=>{
  const browser = await chromium.launch();
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', ctxKey:'school:S2' };

  // 1) admin الخاص بالنظام: ما له صلاحية إطلاقًا حتى لو جرّب يفتح الأداة مباشرة
  const DBadmin = JSON.parse(JSON.stringify(DB));
  const ADM = { userId:'admin1', username:'الأدمن', role:'admin', schoolId:null, ctxKey:'admin' };
  if(!DBadmin['users/admin1']) DBadmin['users/admin1'] = { role:'admin', username:'الأدمن', authUid:'U_admin1', active:true };
  let { page: pAdm } = await open(browser, 'U_admin1', ADM, DBadmin);
  const admText = await pAdm.evaluate(()=>document.body.innerText);
  out('admin denied (no access at all) =', admText.includes('لا صلاحية لأدمن النظام'), '(expect true)');

  // 2) مدير المدرسة: ينشئ تعميمًا جديدًا بمستلمين محددين
  let { page: p } = await open(browser, 'U_SA1', SA, DB);
  out('manager dashboard loaded, has "تعميم جديد" =', await p.evaluate(()=>!!document.getElementById('newCircBtn')));
  await p.click('#newCircBtn');
  await p.waitForTimeout(300);
  // نرفق صورة بسيطة (1x1 px) كملف
  const tinyPngPath = __dirname+'/tiny.png';
  const tinyPngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(tinyPngPath, tinyPngBuf);
  await p.setInputFiles('#ncFile', tinyPngPath);
  await p.waitForTimeout(500);
  await p.fill('#ncTitle', 'تعميم اختبار');
  await p.check('#ncMandatory');
  // اختيار مستلمَين: u1 (معلم) و u4 (وكيل tt-managed)
  await p.evaluate(()=>{
    document.querySelectorAll('#ncRecipPick input[type=checkbox]').forEach(cb=>{
      if(cb.value==='u1' || cb.value==='u4') cb.checked = true;
    });
  });
  await p.click('#ncSave');
  await p.waitForTimeout(800);
  const viewText = await p.evaluate(()=>document.body.innerText);
  out('after create, circular detail view shows "تعميم رقم" =', viewText.includes('تعميم رقم'));
  out('shows "المشاركة" (manager share controls) =', viewText.includes('المشاركة'));
  const link = await p.evaluate(()=>circularLink(CR.cid));
  out('generated link looks right =', /circulars\.html\?sid=S2&cid=/.test(link), link);
  const cid = await p.evaluate(()=>CR.cid);
  // التقاط حالة القاعدة بعد الإنشاء — كل سياق/متصفح جديد له localStorage مستقل، فلازم نغذّيه بنفس الحالة
  const DB2 = await p.evaluate(()=>__mockDB());

  // 3) مستلم (u1، معلم) يفتح رابط التعميم مباشرة بدون جلسة مسبقة -> يُحوَّل لتسجيل الدخول ويخزَّن المسار المعلَّق
  const browser2 = await chromium.launch();
  const ctx3 = await browser2.newContext();
  await ctx3.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'window.pdfjsLib={GlobalWorkerOptions:{}};' }));
  await ctx3.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx3.addInitScript((db)=>{ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); }, DB2);
  const page3 = await ctx3.newPage();
  await page3.goto(`http://127.0.0.1:8765/circulars.html?sid=S2&cid=${cid}`);
  await page3.waitForTimeout(800);
  out('no-session link redirects to index.html =', page3.url().includes('index.html'));
  const pending = await page3.evaluate(()=>{ try{ return JSON.parse(localStorage.getItem('cls_pending_circular')||'null'); }catch(e){ return null; } });
  out('pending circular stored for post-login resume =', JSON.stringify(pending));
  await browser2.close();

  // 4) المستلم u1 (معلم) يفتح الرابط وهو مسجّل دخول فعلًا بنفس المدرسة -> يوقّع
  const U1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  let { page: p1 } = await open(browser, 'U_u1', U1, DB2, `http://127.0.0.1:8765/circulars.html?sid=S2&cid=${cid}`);
  const p1Text = await p1.evaluate(()=>document.body.innerText);
  out('recipient (u1) sees mandatory sign prompt =', p1Text.includes('يتطلّب توقيعك'));
  out('recipient (u1) does NOT see management controls =', !p1Text.includes('متابعة التوقيعات'));
  await p1.click('#goSignBtn');
  await p1.waitForTimeout(300);
  // رسم خط بسيط على لوحة التوقيع
  const canvas = await p1.$('#sigCanvas');
  const box = await canvas.boundingBox();
  await p1.mouse.move(box.x+20, box.y+20);
  await p1.mouse.down();
  await p1.mouse.move(box.x+200, box.y+100, {steps:10});
  await p1.mouse.up();
  await p1.click('#sigSave');
  await p1.waitForTimeout(500);
  const afterSignText = await p1.evaluate(()=>document.body.innerText);
  out('after signing, shows confirmation =', afterSignText.includes('تم توقيعك'));
  // p1 وقّع داخل سياق/localStorage منفصل عن سياق المدير p — ننقل الحالة المحدَّثة قبل ما المدير يرجع يفتح نفس التعميم
  const DBafterSign = await p1.evaluate(()=>__mockDB());

  // 5) رجوع المدير لنفس التعميم: يشوف توقيع u1 أخضر، وu4 أحمر، ويحدده يدويًا
  await p.evaluate((db)=>{ localStorage.setItem('__mockdb', JSON.stringify(db)); }, DBafterSign);
  await p.goto(`http://127.0.0.1:8765/circulars.html?sid=S2&cid=${cid}`);
  await p.waitForTimeout(1200);
  const sigTable1 = await p.evaluate(()=>document.getElementById('sigTable').innerText.replace(/\s+/g,' '));
  out('manager sig table after u1 signed:', sigTable1);
  // تحديد u4 كموقَّع يدويًا (يفتح نافذة تأكيد confirmBox لازم نضغط موافقة فيها)
  await p.evaluate(()=>{
    const btn = [...document.querySelectorAll('[data-mark]')][0];
    if(btn) btn.click();
  });
  await p.waitForTimeout(300);
  await p.click('#cbOk');
  await p.waitForTimeout(600);
  const sigTable2 = await p.evaluate(()=>document.getElementById('sigTable').innerText.replace(/\s+/g,' '));
  out('manager sig table after manual mark:', sigTable2);

  // 6) زر الطباعة يبني #printArea بشكل عمودين
  await p.click('#printSigBtn');
  await p.waitForTimeout(300);
  const printHtml = await p.evaluate(()=>document.getElementById('printArea').innerHTML);
  out('print sheet has two parallel columns (pcols) =', printHtml.includes('pcols'));
  out('print sheet has school name + تعميم رقم =', printHtml.includes('تعميم رقم'));

  // 7) غير مستلم ولا صاحب صلاحية (ag1، مستشار) يحاول فتح نفس التعميم -> يُرفض
  const AG1 = { userId:'ag1', username:'مستشار', role:'counselor', schoolId:'S2', ctxKey:'school:S2' };
  const DB3 = await p.evaluate(()=>__mockDB());
  let { page: pAg } = await open(browser, 'U_ag1', AG1, DB3, `http://127.0.0.1:8765/circulars.html?sid=S2&cid=${cid}`);
  const agText = await pAg.evaluate(()=>document.body.innerText);
  out('non-recipient, non-manager denied this circular =', agText.includes('ليست لديك صلاحية الوصول لهذا التعميم'));

  await browser.close();
  fs.unlinkSync(tinyPngPath);
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
