const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
// rename class code م1ب -> م9ز in roster (as omr would)
const r = JSON.parse(DB['schoolData/roster_S2'].value); r.classes.forEach(c=>{ if(c.code==='م1ب') c.code='م9ز'; }); DB['schoolData/roster_S2'].value = JSON.stringify(r);
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1400,height:900}});
  await ctx.route(/gstatic|jsdelivr|googleapis/, r=>r.fulfill({ status:200, body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([db])=>{ window.__mockUid='U_SA1'; localStorage.setItem('cls_session', JSON.stringify({userId:'sa1',role:'schoolAdmin',schoolId:'S2',period:'first'})); localStorage.setItem('__mockdb', JSON.stringify(db)); }, [DB]);
  const p=await ctx.newPage(); p.on('pageerror', e=>console.log('ERR', e.message));
  await p.goto('http://127.0.0.1:8765/timetable.html'); await p.waitForSelector('#app:not(.hidden)');
  await p.click('#sideNav button[data-sec="classes"]');
  console.log('orphans:', await p.evaluate(()=>findOrphanCodes().join(',')), ' remap button =', !!(await p.$('#remapBtn')));
  await p.click('#remapBtn'); await p.selectOption('#modalRoot select[data-old="م1ب"]', 'م9ز'); await p.click('#remapOk'); await p.waitForTimeout(1500);
  console.log('after remap orphans:', await p.evaluate(()=>findOrphanCodes().join(',')||'(none)'), ' assign has م9ز =', await p.evaluate(()=>!!amap()['م9ز']), ' lessons use م9ز =', await p.evaluate(()=>tableDoc('m','draft').lessons.some(l=>l.c==='م9ز' && l.id.startsWith('م9ز|'))));
  await p.click('#sideNav button[data-sec="table"]'); await p.waitForTimeout(300);
  console.log('table alerts:', (await p.$$eval('#tbBody .alert', e=>e.map(x=>x.innerText.slice(0,80)))).join(' | ') || '(none)');
  await b.close();
})();
