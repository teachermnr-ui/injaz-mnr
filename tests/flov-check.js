const { chromium } = require('playwright');
const fs=require('fs'); const MOCK=fs.readFileSync(__dirname+'/mock-firebase.js','utf8'); const DB=JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:780}});
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({status:200,contentType:'application/javascript',body:MOCK}));
  const S={ userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  await ctx.addInitScript(([s,db])=>{ window.__mockUid='U_u1'; localStorage.setItem('cls_session',JSON.stringify(s)); localStorage.setItem('__mockdb',JSON.stringify(db)); window.alert=()=>{}; },[S,DB]);
  const p=await ctx.newPage(); p.on('pageerror',e=>console.log('ERR',e.message));
  await p.goto('http://127.0.0.1:8765/omr.html'); await p.waitForTimeout(2500);
  await p.evaluate(()=>{ document.body.classList.add('alt-theme'); switchStuView('follow'); const s=document.getElementById('followClass'); if(s && s.options.length>1){ s.selectedIndex=1; const c=parseVKey(s.value).classCode; for(let i=0;i<14;i++) state.students.push({seat:'9'+i, name:'طالب تجربة '+(i+2), classCode:c}); renderFollowView(); } });
  await p.waitForTimeout(500);
  const r=await p.evaluate(()=>{ const body=document.getElementById('followBody'); body.scrollTop=body.scrollHeight; const items=body.querySelectorAll('.nm'); const last=items[items.length-1].parentElement; const bar=document.getElementById('flCard');
    return { n:items.length, lastBottom: last?last.getBoundingClientRect().bottom:null, barTop: bar?bar.getBoundingClientRect().top:null, pad:getComputedStyle(body).paddingBottom }; });
  console.log(JSON.stringify(r), 'visible =', r.lastBottom!=null && r.barTop!=null && r.lastBottom<=r.barTop);
  await p.screenshot({path:__dirname+'/shots/64-follow-last.png'}); await b.close();
})();
