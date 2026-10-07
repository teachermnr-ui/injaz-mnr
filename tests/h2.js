const { chromium, devices } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = { 'users/sa1':{username:'ي',role:'schoolAdmin',authUid:'U_sa1',active:true,adminSchools:['S2']}, 'schoolData/S2':{name:'مدرسة'} };
(async()=>{ const b=await chromium.launch(); const ctx=await b.newContext({...devices['Pixel 5']});
 await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
 await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({status:200,contentType:'application/javascript',body:MOCK}));
 await ctx.route(/gstatic\.com\/firebasejs\/.*(firestore|auth)-compat/, r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
 await ctx.addInitScript(([s,db])=>{window.__mockUid='U_sa1';localStorage.setItem('cls_session',JSON.stringify(s));localStorage.setItem('__mockdb',JSON.stringify(db));},[{userId:'sa1',username:'ي',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'},DB]);
 const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
 await p.goto('http://127.0.0.1:8765/holidays.html'); await p.waitForTimeout(1500);
 for(const sel of ['#qOn','#hFrom','#hAdd','[data-mode=range]']){ const r=await p.evaluate(s=>{const e=document.querySelector(s);e.scrollIntoView();const q=e.getBoundingClientRect();const t=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return t===e||e.contains(t)||t.contains(e)?'ok':'COVERED by '+t.tagName+'.'+t.className+'#'+t.id},sel); console.log(sel,r);}
 await p.screenshot({path:'shots/hol.png',fullPage:true}); await b.close();})();
