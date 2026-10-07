const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
(async()=>{
 const b=await chromium.launch(); const ctx=await b.newContext();
 await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
 await ctx.route(/gstatic|jsdelivr|googleapis/, r=>r.fulfill({ status:200, body:'' }));
 await ctx.addInitScript(()=>{ window.__mockUid='U_SA1'; localStorage.setItem('cls_session', JSON.stringify({userId:'sa1',role:'schoolAdmin',schoolId:'S2',period:'first'})); });
 const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message)); p.on('console',m=>console.log('C',m.type(),m.text()));
 p.on('requestfailed', r=>console.log('FAIL', r.url()));
 await p.goto('http://127.0.0.1:8765/timetable.html'); await p.waitForTimeout(2000);
 console.log(await p.evaluate(()=>document.getElementById('bootView').innerText+' | fb='+typeof firebase));
 await b.close();
})();
