// ثبات التبويبات والمعاينة والمظهر (جوال ٣٩٠px)
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
const roster = { classes:[{code:'1A',name:'أول/أ'}], students:[{seat:'101',name:'سعد',classCode:'1A'}] };
const DB = { 'schoolData/S1':{name:'مدرسة التجربة',eduDept:'إدارة تعليم مكة',year:'1447'}, 'schoolData/roster_S1':{value:JSON.stringify(roster)},
  'users/P1':{authUid:'U_x',active:true,role:'schoolAdmin',username:'قائد المدرسة',adminSchools:['S1']},
  'users/C1':{authUid:'U_x',active:true,role:'teacher',username:'رائد النشاط',schools:{S1:{role:'teacher',active:true,permissions:{}}}},
  'activityCouncil/S1_first':{schoolId:'S1',period:'first',chairId:'P1',chairName:'قائد المدرسة',secretaryId:'C1',secretaryName:'رائد النشاط',members:[]} };
const vis = async (p,sel)=>p.evaluate(s=>{ const b=document.querySelector(s.bar), t=[...b.querySelectorAll('.ac-tab')].find(x=>x.textContent.includes(s.txt)); if(!t) return null; const br=b.getBoundingClientRect(), tr=t.getBoundingClientRect(); return { inside: tr.left>=br.left-1 && tr.right<=br.right+1, center: Math.abs((tr.left+tr.width/2)-(br.left+br.width/2)), sl:b.scrollLeft }; }, sel);
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic/, r=>{ const u=r.request().url(); r.fulfill({status:200,contentType:'application/javascript',body:/firebase-app-compat/.test(u)?MOCK:(/firebase-storage-compat/.test(u)?"window.firebase.storage=function(){return {ref:function(){return {}}}};":(/qrcode/.test(u)?"window.qrcode=function(){return {addData(){},make(){},createDataURL(){return 'data:,'}}};":''))}); });
  await ctx.addInitScript(([D])=>{ window.__mockUid='U_x'; localStorage.setItem('cls_session',JSON.stringify({userId:'C1',username:'x',role:'teacher',schoolId:'S1',period:'first',ctxKey:'school:S1'})); if(!localStorage.getItem('__mockdb')) localStorage.setItem('__mockdb',JSON.stringify(D)); },[DB]);
  const p=await ctx.newPage(); let ERR=0; p.on('pageerror',e=>{ERR++;console.log('PAGEERR',e.message)});
  await p.goto('http://127.0.0.1:8765/activity.html'); await p.waitForTimeout(1500);
  await p.click('[data-a="activate"]'); await p.waitForSelector('#mnDlgOv .mnOk'); await p.click('#mnDlgOv .mnOk'); await p.waitForTimeout(1200);
  ok(await p.evaluate(()=>document.body.classList.contains('act-skin')),'طبقة المظهر مفعّلة');
  ok(await p.evaluate(()=>getComputedStyle(document.querySelector('.dh-top')).backgroundColor)==='rgb(26, 107, 74)','لون الشريط العلوي أخضر النموذج');
  console.log('A. ثبات الشريط الرئيسي');
  const bar='#acMainBar';
  await p.click('.ac-tab:has-text("التوثيقات")'); await p.waitForTimeout(700);
  let v=await vis(p,{bar,txt:'التوثيقات'}); ok(v.inside && v.center<40,'التبويب المختار ظاهر وفي الوسط (الإزاحة '+Math.round(v.center)+'px)');
  const nx=await vis(p,{bar,txt:'الإذاعة'}); ok(nx.inside,'التبويب التالي «الإذاعة» ظاهر دون سحب');
  const pv=await vis(p,{bar,txt:'الخطة العامة'}); ok(pv.inside,'التبويب السابق «الخطة العامة» ظاهر');
  await p.screenshot({path:'/home/claude/out/skin-assign.png'});
  await p.click('.ac-tab:has-text("التقارير")'); await p.waitForTimeout(700);
  v=await vis(p,{bar,txt:'التقارير'}); ok(v.inside && v.sl!==0,'«التقارير» (الأخير) ظاهر والشريط لم يرجع للبداية (scrollLeft='+Math.round(v.sl)+')');
  const sameBar = await p.evaluate(()=>{ const a=document.getElementById('acMainBar'); a.dataset.k='1'; return true; });
  await p.click('.ac-tab:has-text("الإذاعة")'); await p.waitForTimeout(500);
  ok(await p.evaluate(()=>document.getElementById('acMainBar').dataset.k==='1'),'عنصر الشريط نفسه لم يُعد إنشاؤه عند التنقل');
  console.log('B. حفظ آخر موضع');
  await p.click('.ac-tab:has-text("التكليفات والأندية")'); await p.waitForTimeout(400);
  await p.click('.ac-club:not([data-asg-card]) [data-a="club-open"]'); await p.waitForTimeout(400);
  await p.click('.ac-tabs.sub .ac-tab:has-text("الحضور")'); await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(1800);
  ok((await p.innerText('#acMainBar .ac-tab.on')).includes('التكليفات والأندية'),'بعد التحديث: تبويب «الأندية» هو المفتوح');
  ok((await p.innerText('.ac-tabs.sub .ac-tab.on')).includes('الحضور'),'بعد التحديث: التبويب الفرعي «الحضور» والنادي نفسه مفتوحان');
  v=await vis(p,{bar,txt:'التكليفات والأندية'}); ok(v.inside,'«الأندية» ظاهر في الشريط بعد التحديث');
  await p.click('.ac-tab:has-text("التقارير")'); await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(1800);
  v=await vis(p,{bar,txt:'التقارير'}); ok((await p.innerText('#acMainBar .ac-tab.on')).includes('التقارير') && v.inside,'«التقارير» مفتوح وظاهر بعد التحديث');
  console.log('C. المعاينة وزر الرجوع');
  await p.click('[data-a="print-genreport"]'); await p.waitForSelector('.ac-pvf'); await p.waitForTimeout(800);
  await p.screenshot({path:'/home/claude/out/skin-preview.png'});
  await p.goBack(); await p.waitForTimeout(600);
  ok((await p.$('.ac-pv'))===null && p.url().includes('activity.html'),'زر الرجوع بالجوال يغلق المعاينة ويبقيك بالمنصة');
  ok((await p.innerText('#acMainBar .ac-tab.on')).includes('التقارير'),'بقي تبويب «التقارير» مفتوحًا بعد إغلاق المعاينة');
  await p.click('[data-a="print-genreport"]'); await p.waitForSelector('.ac-pvf'); await p.click('.ac-pvbar [data-x]'); await p.waitForTimeout(600);
  ok((await p.$('.ac-pv'))===null && p.url().includes('activity.html'),'زر «رجوع» داخل المعاينة يعيدك للمنصة نفسها');
  for(const t of ['الملخص','مجلس النشاط','التكليفات والأندية','الأنشطة والمسار العام','الخطة العامة','التوثيقات','الإذاعة','التقارير']){ await p.click('.ac-tab:has-text("'+t+'")'); await p.waitForTimeout(450); await p.screenshot({path:'/home/claude/out/skin-'+t.replace(/ /g,'_')+'.png'}); }
  console.log(ERR?'ERRS '+ERR:''); console.log(FAIL?'FAILED '+FAIL:'ALL PASS'); await b.close();
})().catch(e=>{console.log('CRASH',e.message);process.exit(1)});
