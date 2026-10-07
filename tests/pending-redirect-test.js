const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);

(async()=>{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic\.com\/(?!firebasejs)/, r=>r.fulfill({ status:200, body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  // جلسة سابقة محفوظة صالحة (مسار استرجاع الجلسة بـboot()) + تعميم معلَّق بانتظار الدخول — بنفس مدرسة الجلسة S2
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', ctxKey:'school:S2' };
  await ctx.addInitScript(([uid, s, db])=>{
    window.__mockUid=uid;
    // addInitScript يُعاد تنفيذه بكل تنقّل بنفس السياق (حتى التحويل لـcirculars.html) — نزرع مرة وحدة فقط
    if(!sessionStorage.getItem('__seeded')){
      localStorage.setItem('cls_session', JSON.stringify(s));
      localStorage.setItem('cls_pending_circular', JSON.stringify({ sid:'S2', cid:'TESTCID123' }));
      localStorage.setItem('__mockdb', JSON.stringify(db));
      sessionStorage.setItem('__seeded','1');
    }
    window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); };
    window.confirm=()=>true;
  }, ['U_SA1', SA, DB]);
  const page = await ctx.newPage();
  page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await page.goto('http://127.0.0.1:8765/index.html');
  await page.waitForTimeout(2000);
  out('redirected to circulars.html after resumed session =', page.url());
  out('pending marker cleared after use =', await page.evaluate(()=>localStorage.getItem('cls_pending_circular')));

  // سياق ثان: تعميم معلَّق لمدرسة مختلفة عن مدرسة جلسة المستخدم -> يُتجاهَل ويدخل التطبيق عادي
  const ctx2 = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await ctx2.route(/jsdelivr|cdnjs|googleapis|gstatic\.com\/(?!firebasejs)/, r=>r.fulfill({ status:200, body:'' }));
  await ctx2.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx2.addInitScript(([uid, s, db])=>{
    window.__mockUid=uid;
    localStorage.setItem('cls_session', JSON.stringify(s));
    localStorage.setItem('cls_pending_circular', JSON.stringify({ sid:'OTHER_SCHOOL', cid:'X' }));
    localStorage.setItem('__mockdb', JSON.stringify(db));
    window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); };
    window.confirm=()=>true;
  }, ['U_SA1', SA, DB]);
  const page2 = await ctx2.newPage();
  page2.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await page2.goto('http://127.0.0.1:8765/index.html');
  await page2.waitForTimeout(2000);
  out('mismatched-school pending circular ignored, stays on index.html =', page2.url());
  out('mismatched marker cleared too =', await page2.evaluate(()=>localStorage.getItem('cls_pending_circular')));

  await browser.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
