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

  // 1) tool active (from db-after.json produced by e2e.js: toolActive:true)
  let p = await open(browser, 'U_SA1', SA, DB);
  out('booted view:', await p.evaluate(()=>document.getElementById('appView') && !document.getElementById('appView').classList.contains('hidden')));
  out('checkTtToolActive(S2) while active =', await p.evaluate(()=>checkTtToolActive('S2')));
  await p.evaluate(()=>jumpToPermsEditor('u1','S2'));
  await p.waitForTimeout(900);
  out('lock notice shown while active =', await p.evaluate(()=>!!document.getElementById('upBody').innerHTML.includes('تُدار من «بناء الجدول المدرسي»')));
  out('classes host readOnly (checkboxes disabled) while active =', await p.evaluate(()=>{
    const boxes = [...document.querySelectorAll('#upClassesHost input[type=checkbox]')];
    return boxes.length ? boxes.every(b=>b.disabled) : 'NO_CHECKBOXES_FOUND';
  }));

  // 2) deactivate the tool and re-check
  await p.evaluate(()=>{ const m = __mockDB()['timetables/S2/data/meta']; const d = JSON.parse(m.value); d.toolActive=false; __mockSet('timetables/S2/data/meta', Object.assign({}, m, { value: JSON.stringify(d) })); });
  out('checkTtToolActive(S2) after deactivate =', await p.evaluate(()=>checkTtToolActive('S2')));
  await p.evaluate(()=>jumpToPermsEditor('u1','S2'));
  await p.waitForTimeout(900);
  out('lock notice shown after deactivate =', await p.evaluate(()=>!!document.getElementById('upBody').innerHTML.includes('تُدار من «بناء الجدول المدرسي»')));
  out('classes host editable (not disabled) after deactivate =', await p.evaluate(()=>{
    const boxes = [...document.querySelectorAll('#upClassesHost input[type=checkbox]')];
    return boxes.length ? boxes.every(b=>!b.disabled) : 'NO_CHECKBOXES_FOUND';
  }));

  // 3) never-used tool (no meta doc at all) -> should behave as not managed
  const DB3 = JSON.parse(JSON.stringify(DB));
  delete DB3['timetables/S2/data/meta'];
  await browser.close();
  const b2 = await chromium.launch();
  let q = await open(b2, 'U_SA1', SA, DB3);
  out('checkTtToolActive(S2) with no meta doc at all =', await q.evaluate(()=>checkTtToolActive('S2')));

  // 4) new ADMIN_TOOLS entry: tools.classes -> href omr.html, appears before timetable
  const keys = await q.evaluate(()=>ADMIN_TOOLS.map(t=>t.key));
  const hrefFor = await q.evaluate(()=>{ const t = ADMIN_TOOLS.find(x=>x.key==='classes'); return t ? {label:t.label, href:t.href, perm:t.perm} : null; });
  out('ADMIN_TOOLS order (classes before timetable) =', keys.indexOf('classes') >= 0 && keys.indexOf('classes') < keys.indexOf('timetable'));
  out('classes tool entry =', JSON.stringify(hrefFor));
  await b2.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
