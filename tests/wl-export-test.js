// حذف «فترة الرصد» + تسمية «تصدير نموذج ١/٢»
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0, ERRS=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:420,height:820}});
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ if(/firebase-app-compat/.test(r.request().url())) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK}); r.fulfill({status:200,contentType:'application/javascript',body:''}); });
  await ctx.addInitScript(()=>{ window.__mockUid='U_sa1'; localStorage.setItem('cls_session',JSON.stringify({userId:'sa1',username:'مدير',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'})); localStorage.setItem('__mockdb',JSON.stringify({'schools/S2':{name:'م'},'users/sa1':{authUid:'U_sa1',active:true,role:'schoolAdmin',username:'مدير',schools:{S2:{role:'teacher'}}}})); });
  const p=await ctx.newPage(); p.on('pageerror',e=>{ ERRS++; console.log('PAGEERR',e.message); });
  await p.goto('http://127.0.0.1:8765/omr.html'); await p.waitForTimeout(2000);
  await p.evaluate(()=>{ const st=[1,2].map(i=>({seat:'10'+i,name:'ط'+i,classCode:'7'})); state.students=st; state.fullStudents=st; state.classes=[{name:'الأول 7',code:'7'}]; state.fullClasses=state.classes; showTab('cloud'); });
  const t=await p.textContent('#cloudLogWrap');
  ok(!(await p.locator('#wlActivePeriod').count()) && !/فترة الرصد/.test(t),'«فترة الرصد» محذوفة');
  ok(/تصدير نموذج ١/.test(t) && /تصدير نموذج ٢/.test(t) && !/تصدير مفصّل|تصدير السجل PDF/.test(t),'الزران: تصدير نموذج ١ / ٢');
  await p.evaluate(()=>{ const s=document.getElementById('wlViewClass'); s.innerHTML='<option value="7">الأول 7</option>'; s.value='7'; });
  await p.evaluate(()=>openExportDialog('full')); ok(/تصدير نموذج ١/.test(await p.textContent('#exportTitle')),'عنوان نافذة ١');
  await p.evaluate(()=>closeExportDialog()); await p.evaluate(()=>openExportDialog('detailed')); ok(/تصدير نموذج ٢/.test(await p.textContent('#exportTitle')) && await p.locator('#exPeriod').count()===1,'عنوان نافذة ٢ مع اختيار الفترة');
  await p.evaluate(()=>closeExportDialog());
  await p.evaluate(()=>{ renderWorkLog(); gradeTypeStep('root'); }).catch(()=>{});
  await b.close(); console.log(FAIL||ERRS?`✗ فشل ${FAIL}/${ERRS}`:'✓ كل الاختبارات نجحت'); process.exit(FAIL||ERRS?1:0);
})();
