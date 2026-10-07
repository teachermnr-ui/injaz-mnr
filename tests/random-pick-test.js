// اختيار طالب عشوائي في «المتابعة»
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0, ERRS=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844}});
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ if(/firebase-app-compat/.test(r.request().url())) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK}); r.fulfill({status:200,contentType:'application/javascript',body:''}); });
  await ctx.addInitScript(()=>{ window.__mockUid='U_sa1'; localStorage.setItem('cls_session',JSON.stringify({userId:'sa1',username:'مدير',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'})); localStorage.setItem('__mockdb',JSON.stringify({'schools/S2':{name:'م'},'users/sa1':{authUid:'U_sa1',active:true,role:'schoolAdmin',username:'مدير',schools:{S2:{role:'teacher'}}}})); });
  const p=await ctx.newPage(); p.on('pageerror',e=>{ ERRS++; console.log('PAGEERR',e.message); });
  await p.goto('http://127.0.0.1:8765/omr.html'); await p.waitForTimeout(2000);
  await p.evaluate(()=>{ window.alert=m=>{ window.__al=(window.__al||[]).concat(m); };
    const st=[1,2,3,4].map(i=>({seat:'10'+i,name:'طالب '+i,classCode:'7'})); state.students=st; state.fullStudents=st; state.classes=[{name:'الأول 7',code:'7'}]; state.fullClasses=state.classes;
    state.attendance={'104':{status:'absent'}};
    document.getElementById('followOv').classList.add('show'); flFillClasses('followClass'); document.getElementById('followClass').value='7'; renderFollowView(); });
  ok(await p.isVisible('#followOv button[title="اختيار طالب عشوائيًا"]'),'زر النرد ظاهر في رأس المتابعة');
  ok(/غائب اليوم/.test(await p.textContent('#followBody')),'وسم «غائب اليوم» للطالب الغائب');
  const picked=[];
  for(let r=1;r<=3;r++){
    if(r===1) await p.click('#followOv button[title="اختيار طالب عشوائيًا"]'); else if(await p.locator('#rndOv button:has-text("اختيار طالب آخر")').count()) await p.click('#rndOv button:has-text("اختيار طالب آخر")');
    await p.waitForSelector('#rndShown',{timeout:3000}).catch(()=>{});
    if(r===1){ await p.waitForTimeout(600); ok(await p.isVisible('#rndShown'),'حركة التشويق تعمل (الأسماء تتبدّل)'); const a=await p.textContent('#rndShown'); await p.waitForTimeout(250); }
    await p.waitForSelector('#rndOv .rnd-pop',{timeout:7000}).catch(()=>{});
    if(!(await p.locator('#rndOv .rnd-pop').count())) break;
    picked.push((await p.textContent('#rndOv .rnd-pop')).trim());
  }
  ok(picked.length===3 && new Set(picked).size===3,'٣ اختيارات بلا تكرار: '+picked.join(' | '));
  await p.screenshot({path:'/home/claude/injaz/out/random-result.png'});
  ok(!picked.includes('طالب 4'),'الغائب لا يدخل القرعة');
  ok(/اكتملت الدورة/.test(await p.textContent('#rndOv')),'بعد آخر طالب يعرض «اكتملت الدورة — ابدأ دورة جديدة»');
  const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem(rndStoreKey())));
  ok(stored.length===3,'تُحفظ الدورة في الجهاز لليوم ('+stored.length+')');
  await p.click('#rndOv button:has-text("إغلاق")').catch(()=>p.evaluate(()=>rndClose()));
  ok(!(await p.locator('#rndOv').count()),'تُغلق النافذة');
  await p.screenshot({path:'/home/claude/injaz/out/random-follow.png'});
  ok((await p.locator('.rndchip.done').count())===3 && /اختير ٣ من ٣/.test(await p.textContent('#followBody')),'وسوم «اختير» وعدّاد ٣ من ٣ في القائمة');
  // استمرار الدورة بعد «إعادة فتح» الشاشة
  await p.evaluate(()=>openRandomPick()); await p.waitForTimeout(500);
  ok(/اكتملت الدورة/.test(await p.textContent('#rndOv')),'الدورة المكتملة تبقى محفوظة عند الفتح ثانية');
  await p.click('#rndOv button:has-text("ابدأ دورة جديدة")'); await p.waitForSelector('#rndOv .rnd-pop',{timeout:7000});
  ok((await p.evaluate(()=>JSON.parse(localStorage.getItem(rndStoreKey())).length))===1,'دورة جديدة: اختيار واحد فقط');
  // ملصق
  await p.click('#rndOv button:has-text("إعطاء ملصق")'); await p.waitForTimeout(300);
  ok(!(await p.locator('#rndOv').count()) && await p.locator('#omrModalOv').count()===1,'«إعطاء ملصق» يغلق القرعة ويفتح لوحة ملصقات الطالب');
  await b.close(); console.log(FAIL||ERRS?`✗ فشل ${FAIL}/${ERRS}`:'✓ كل الاختبارات نجحت'); process.exit(FAIL||ERRS?1:0);
})();
