const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);

async function open(browser, uid, session, db){
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic\.com\/(?!firebasejs)/, r=>r.fulfill({ status:200, body:'' }));
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
  await page.goto('http://127.0.0.1:8765/index.html');
  await page.waitForTimeout(2500);
  return page;
}

(async()=>{
  const browser = await chromium.launch();
  const SA = { userId:'sa1', username:'ياسر', role:'schoolAdmin', schoolId:'S2', ctxKey:'school:S2' };

  // u4: role='agent', assignedClasses:['__all__'], ttAssignedClasses: populated (non-teacher, tt-managed)
  let p = await open(browser, 'U_SA1', SA, DB);
  await p.evaluate(()=>jumpToPermsEditor('u4','S2'));
  await p.waitForTimeout(900);
  out('--- u4 (agent, tt-managed) ---');
  out('lock notice (full-list lock) shown for agent =', await p.evaluate(()=>!!document.getElementById('upBody').innerHTML.includes('تُدار من «بناء الجدول المدرسي»')), '(expect false — only teacher role gets the full-list lock)');
  out('classes host checkboxes disabled =', await p.evaluate(()=>{
    const boxes = [...document.querySelectorAll('#upClassesHost input[type=checkbox]')];
    return boxes.length ? boxes.every(b=>b.disabled) : 'NO_CHECKBOXES_FOUND';
  }), '(expect false — role-track stays editable)');
  out('ttExtra locked-chips section present =', await p.evaluate(()=>document.getElementById('upClassesHost').innerHTML.includes('مُسندة له أيضًا')), '(expect true)');
  out('ttExtra chips text sample =', await p.evaluate(()=>{
    const el = [...document.querySelectorAll('#upClassesHost div')].find(d=>d.textContent.includes('مُسندة له أيضًا'));
    return el ? el.parentElement.innerText.slice(0,200) : null;
  }));

  // u1: role='teacher', tt-managed -> should show the classic full-list lock, and NOT the ttExtra chips
  await p.evaluate(()=>jumpToPermsEditor('u1','S2'));
  await p.waitForTimeout(900);
  out('--- u1 (teacher, tt-managed) ---');
  out('lock notice shown for teacher =', await p.evaluate(()=>!!document.getElementById('upBody').innerHTML.includes('تُدار من «بناء الجدول المدرسي»')), '(expect true)');
  out('classes host checkboxes disabled =', await p.evaluate(()=>{
    const boxes = [...document.querySelectorAll('#upClassesHost input[type=checkbox]')];
    return boxes.length ? boxes.every(b=>b.disabled) : 'NO_CHECKBOXES_FOUND';
  }), '(expect true)');
  out('ttExtra locked-chips section present for teacher =', await p.evaluate(()=>document.getElementById('upClassesHost').innerHTML.includes('مُسندة له أيضًا')), '(expect false — teacher track already fully locked above)');

  // ag1: counselor, NOT tt-managed (no ttAssignedClasses) -> plain editable, no lock, no chips
  await p.evaluate(()=>jumpToPermsEditor('ag1','S2'));
  await p.waitForTimeout(900);
  out('--- ag1 (counselor, not tt-managed) ---');
  out('lock notice shown =', await p.evaluate(()=>!!document.getElementById('upBody').innerHTML.includes('تُدار من «بناء الجدول المدرسي»')), '(expect false)');
  out('ttExtra locked-chips section present =', await p.evaluate(()=>document.getElementById('upClassesHost').innerHTML.includes('مُسندة له أيضًا')), '(expect false)');

  await browser.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
