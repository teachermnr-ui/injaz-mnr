const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
(async()=>{
  const browser = await chromium.launch();
  const go = async (uid, s, url, vw)=>{
    const ctx = await browser.newContext({ viewport: vw || { width:1000, height:900 } });
    await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
    await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
    await ctx.addInitScript(([uid,s,db])=>{ window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db)); }, [uid,s,DB]);
    const p = await ctx.newPage(); p.on('pageerror', e=>console.log('PAGE ERROR:', e.message));
    await p.goto('http://127.0.0.1:8765/'+url); await p.waitForTimeout(1500); return p;
  };
  const p = await go('U_u1', { userId:'u1', username:'u1', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' }, 'myschedule.html');
  const expected = JSON.parse(DB['timetables/S2/data/first_published'].value).byUser.u1.lessons.length;
  const L = JSON.parse(DB['timetables/S2/data/first_published'].value).byUser.u1.lessons;
  console.log('grids (one per stage) =', await p.$$eval('table.tt', e=>e.length), 'stages =', new Set(L.map(l=>l.st)).size);
  console.log('lesson cells =', await p.$$eval('td.cell.lesson', e=>e.length), 'expected (sum of lengths) =', L.reduce((a,l)=>a+(l.n||1),0));
  console.log('break columns per grid =', await p.$$eval('table.tt', t=>t.map(x=>x.querySelectorAll('thead th.brk').length)), ' days rows =', await p.$$eval('table.tt', t=>t.map(x=>x.querySelectorAll('tbody tr').length)));
  console.log('first cell =', await p.$eval('td.cell.lesson', e=>e.innerText.replace(/\s+/g,' ')));
  await p.screenshot({ path: __dirname+'/shots/30-jadwali-real.png', fullPage:true });
  const pm = await go('U_u1', { userId:'u1', username:'u1', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' }, 'myschedule.html', { width:390, height:844 });
  await pm.screenshot({ path: __dirname+'/shots/31-jadwali-mobile.png', fullPage:false });
  console.log('mobile: page has no horizontal overflow =', await pm.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1), ' table scrolls inside box =', await pm.$eval('.tt-wrap', e=>e.scrollWidth>e.clientWidth));
  const sa = DB['users/sa1'];
  console.log('sa1 exists =', !!sa, sa && sa.role);
  if(sa){
    const p2 = await go('U_SA1', { userId:'sa1', username:'sa', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' }, 'myschedule.html');
    console.log('schoolAdmin page text =', (await p2.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(0,120));
    console.log('schoolAdmin seen stored locally =', await p2.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('injaz_schedSeen_'))));
  }
  await browser.close();
})();
