const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const MOD = fs.readFileSync(__dirname+'/mock-modular.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);

async function openOmr(browser, uid, session, db){
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
  await page.goto('http://127.0.0.1:8765/omr.html');
  await page.waitForTimeout(2500);
  return page;
}

(async()=>{
  // u4: role='agent', assignedClasses:['__all__'] (manual role-track), ttAssignedClasses: ['م1أ','م1ب','م2أ','م2ب','م3أ','101','102'] (from publish)
  const A = { userId:'u4', username:'منير', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const browser = await chromium.launch();

  // 1) omr.html: agent with tt classes should now get IN (not bounced), with teacher-baseline access
  let p = await openOmr(browser, 'U_u4', A, DB);
  const alerts1 = await p.evaluate(()=>window.__alerts||[]);
  const bounced = alerts1.some(m=>m.includes('ليس لديك صلاحية الوصول إلى أي قسم')) || p.url().includes('index.html');
  out('agent (tt-managed) bounced from omr.html =', bounced, '(expect false)');
  out('CLS_USER_ROLE =', await p.evaluate(()=>CLS_USER_ROLE));
  out('CLS_SEC_PERM.classes.access =', await p.evaluate(()=>CLS_SEC_PERM.classes.access));
  out('CLS_USER_ASSIGNED includes تلك الفصول =', await p.evaluate(()=>CLS_USER_ASSIGNED.slice().sort().join(',')));
  await p.close();

  // 2) control: a counselor with NO ttAssignedClasses and NO omr perms should still be bounced
  // (the bounce does alert() + location.replace('index.html'), so by the time we check, the page has
  // already navigated away — detect it via the alert text and/or the final URL, not the omr.html body text)
  const DB2 = JSON.parse(JSON.stringify(DB));
  const C = { userId:'ag1', username:'مستشار', role:'counselor', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  let q = await openOmr(browser, 'U_ag1', C, DB2);
  const alerts2 = await q.evaluate(()=>window.__alerts||[]);
  const bounced2 = alerts2.some(m=>m.includes('ليس لديك صلاحية الوصول إلى أي قسم')) || q.url().includes('index.html');
  out('counselor (not tt-managed, no omr perms) still bounced =', bounced2, '(expect true)', JSON.stringify(alerts2));
  await q.close();

  // 1b) cleaner "Sami Khan" scenario: a non-teacher user with EMPTY manual assignedClasses, NO omr perms
  // at all, and ONLY ttAssignedClasses (so a pass here can't be explained by a pre-existing '__all__' grant)
  const DB3 = JSON.parse(JSON.stringify(DB));
  DB3['users/sami'] = { username:'سامي خان', loginId:'9001', authUid:'U_sami', active:true,
    schools:{ S2:{ role:'counselor', permissions:{}, assignedClasses:[], ttAssignedClasses:['101'], active:true } } };
  const S = { userId:'sami', username:'سامي خان', role:'counselor', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  let r = await openOmr(browser, 'U_sami', S, DB3);
  const alerts3 = await r.evaluate(()=>window.__alerts||[]);
  const bounced3 = alerts3.some(m=>m.includes('ليس لديك صلاحية الوصول إلى أي قسم')) || r.url().includes('index.html');
  out('sami (counselor, empty assignedClasses, ONLY ttAssignedClasses:[101]) bounced =', bounced3, '(expect false)');
  out('   sami CLS_USER_ASSIGNED =', await r.evaluate(()=>CLS_USER_ASSIGNED.slice().sort().join(',')), '(expect exactly 101)');
  out('   sami CLS_SEC_PERM.classes.access =', await r.evaluate(()=>CLS_SEC_PERM.classes.access), '(expect true)');
  await r.close();

  await browser.close();

  // 3) worksheets.html access gate for u4 (agent, tt-managed) — worksheets.html uses the MODULAR SDK
  const b2 = await chromium.launch();
  const ctx = await b2.newContext({ viewport:{ width:1280, height:900 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*\.js/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOD }));
  await ctx.addInitScript(([uid, s, db])=>{
    window.__mockUid=uid;
    localStorage.setItem('cls_session', JSON.stringify(s));
    if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); }
    window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); };
    window.confirm=()=>true; window.prompt=()=>null;
  }, ['U_u4', A, DB]);
  const wp = await ctx.newPage();
  wp.on('pageerror', e=>out('WS PAGE ERROR:', e.message));
  await wp.goto('http://127.0.0.1:8765/worksheets.html');
  await wp.waitForTimeout(2500);
  const wsBodyText = await wp.evaluate(()=>document.body.innerText);
  const wsBlocked = wsBodyText.includes('ليست لديك صلاحية الوصول إلى الأنشطة الرقمية') || wsBodyText.includes('ليست لديك صلاحية');
  out('agent (tt-managed) blocked from worksheets.html =', wsBlocked, '(expect false)');
  if(wsBlocked) out('   page text sample:', wsBodyText.slice(0,300));
  await b2.close();

  // 4) worksheets.html for the clean "sami" scenario (no omr/worksheets perms at all, only ttAssignedClasses)
  const b3 = await chromium.launch();
  const ctx3 = await b3.newContext({ viewport:{ width:1280, height:900 } });
  await ctx3.route(/jsdelivr|cdnjs|googleapis/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx3.route(/gstatic\.com\/firebasejs\/.*\.js/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOD }));
  await ctx3.addInitScript(([uid, s, db])=>{
    window.__mockUid=uid;
    localStorage.setItem('cls_session', JSON.stringify(s));
    if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); }
    window.alert=(m)=>{ (window.__alerts=window.__alerts||[]).push(m); };
    window.confirm=()=>true; window.prompt=()=>null;
  }, ['U_sami', S, DB3]);
  const wp3 = await ctx3.newPage();
  wp3.on('pageerror', e=>out('WS SAMI PAGE ERROR:', e.message));
  await wp3.goto('http://127.0.0.1:8765/worksheets.html');
  await wp3.waitForTimeout(2500);
  const wsBodyText3 = await wp3.evaluate(()=>document.body.innerText);
  const wsBlocked3 = wsBodyText3.includes('ليست لديك صلاحية الوصول إلى الأنشطة الرقمية') || wsBodyText3.includes('ليست لديك صلاحية');
  out('sami (counselor, ONLY ttAssignedClasses:[101], no worksheets perm) blocked from worksheets.html =', wsBlocked3, '(expect false)');
  if(wsBlocked3) out('   page text sample:', wsBodyText3.slice(0,300));
  await b3.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
