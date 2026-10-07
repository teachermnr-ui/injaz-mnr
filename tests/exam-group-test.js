// اختبار تجميع «إعداد نموذج اختبار / التصحيح / النتائج» تحت تبويب «تصميم الاختبار»
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0, ERRS=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:420,height:820}});
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ if(/firebase-app-compat/.test(r.request().url())) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK}); r.fulfill({status:200,contentType:'application/javascript',body:''}); });
  await ctx.addInitScript(()=>{ window.__mockUid='U_sa1'; localStorage.setItem('cls_session',JSON.stringify({userId:'sa1',username:'مدير',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'})); localStorage.setItem('__mockdb',JSON.stringify({'schools/S2':{name:'م'},'users/sa1':{authUid:'U_sa1',active:true,role:'schoolAdmin',username:'مدير',schools:{S2:{role:'teacher'}}}})); });
  const p=await ctx.newPage(); p.on('pageerror',e=>{ ERRS++; console.log('PAGEERR',e.message); });
  await p.goto('http://127.0.0.1:8765/omr.html'); await p.waitForTimeout(2200);
  const vis=id=>p.isVisible(id);
  console.log('1. الشريط العلوي');
  ok(!(await vis('#tab-grade')) && !(await vis('#tab-results')),'لا تبويب «التصحيح» ولا «النتائج» في الشريط العلوي');
  ok(await vis('#tab-design'),'«تصميم الاختبار» ظاهر');
  console.log('2. الافتراضي: لا تبويب فرعي مفعّل');
  await p.click('#tab-design'); await p.waitForTimeout(200);
  ok(await vis('#examSubNav'),'الأزرار الثلاثة ظاهرة');
  ok((await p.locator('#examSubNav button').count())===3,'ثلاثة أزرار');
  ok(!(await vis('#panel-design')) && !(await vis('#panel-grade')) && !(await vis('#panel-results')),'لا محتوى مفعّل');
  ok((await p.locator('#examSubNav button.primary').count())===0,'لا زر مفعّل');
  console.log('3. التنقل');
  for(const [k,sel] of [['design','#panel-design'],['grade','#panel-grade'],['results','#panel-results']]){
    await p.click('#examSub-'+k); await p.waitForTimeout(150);
    ok(await vis(sel) && await vis('#examSubNav') && (await p.locator('#examSubNav button.primary').count())===1 && await p.evaluate(k=>document.getElementById('examSub-'+k).classList.contains('primary'),k),'تبويب '+k+' يعمل ومفعّل وحده');
  }
  ok(await p.evaluate(()=>document.getElementById('tab-design').classList.contains('active')),'«تصميم الاختبار» مضاء في الشريط العلوي');
  console.log('4. تبويبات أخرى لا تتأثر');
  await p.evaluate(()=>showTab('cloud')); ok(!(await vis('#examSubNav')) && await vis('#panel-cloud'),'سجل الأعمال بلا شريط الاختبار');
  await p.evaluate(()=>showTab('students')); ok(!(await vis('#examSubNav')),'الطلاب بلا شريط الاختبار');
  console.log('5. الصلاحيات');
  await p.evaluate(()=>{ CLS_SEC_PERM.grade={access:false,edit:false,del:false}; CLS_SEC_PERM.results={access:false,edit:false,del:false}; clsApplySectionPerms(); showTab('exam'); });
  ok(await vis('#examSub-design') && !(await vis('#examSub-grade')) && !(await vis('#examSub-results')),'من لا يملك التصحيح والنتائج لا يرى زريهما');
  await p.evaluate(()=>{ CLS_SEC_PERM.design={access:false,edit:false,del:false}; clsApplySectionPerms(); });
  ok(!(await vis('#tab-design')),'بلا صلاحية للثلاثة يختفي «تصميم الاختبار»');
  await b.close(); console.log(FAIL||ERRS?`✗ فشل ${FAIL}/${ERRS}`:'✓ كل الاختبارات نجحت'); process.exit(FAIL||ERRS?1:0);
})();
