// اختبار الدخول الموحَّد (ص-١٨): التشغيل  python3 -m http.server 8765  ثم  node tests/login-unified-test.js
const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0, ERRS=0; const out=(...a)=>console.log(...a);
const ok=(c,m)=>{ out((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
const FUT = Date.now()+20*86400e3, PAST = Date.now()-2*86400e3;
function seed(extra){ return Object.assign({
  'schoolData/S2':{name:'متوسطة الأنموذجية',active:true,code:'S2'},
  'users/adm':{role:'admin',username:'أدمن النظام',authUid:'U_ADM',active:true},
  'users/U_SCH':{username:'معلم مدرسة',authUid:'U_SCH',email:'sch@x.com',loginId:'1111111111',active:true,schools:{S2:{role:'teacher',permissions:{},assignedClasses:[],active:true}}},
  'users/U_SOLO':{username:'معلم فردي',authUid:'U_SOLO',email:'solo@x.com',isSolo:true,teacherCode:'T1',solo:{active:true,subscribedAt:Date.now(),subscriptionEnds:FUT}},
  'users/U_BOTH':{username:'معلم الاثنين',authUid:'U_BOTH',email:'both@x.com',loginId:'2222222222',active:true,isSolo:true,solo:{active:true,subscribedAt:Date.now(),subscriptionEnds:FUT},schools:{S2:{role:'teacher',permissions:{},assignedClasses:[],active:true}}},
  'users/U_EXP':{username:'فردي منتهٍ',authUid:'U_EXP',email:'exp@x.com',isSolo:true,solo:{active:true,subscribedAt:PAST-86400e3,subscriptionEnds:PAST}},
  'users/PEND1':{username:'موظف معلَّق',loginId:'3333333333',password:'Tmp123',schoolId:'S2',role:'teacher',permissions:{},assignedClasses:[],active:true}
},extra||{}); }
async function open(b, db, signed){
  const ctx=await b.newContext({viewport:{width:390,height:844}});
  await ctx.route(/cdnjs|jsdelivr|fonts\.g/, r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await ctx.route(/gstatic\.com\/firebasejs\//, r=>r.fulfill({status:200,contentType:'application/javascript',body:/app-compat/.test(r.request().url())?MOCK:''}));
  await ctx.addInitScript(([db])=>{ if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb',JSON.stringify(db)); sessionStorage.setItem('__s','1'); } window.alert=()=>{}; window.confirm=()=>true; },[db]);
  const p=await ctx.newPage(); p.__navs=[]; p.on('framenavigated',f=>{ if(f===p.mainFrame()) p.__navs.push(f.url()); }); p.on('pageerror',e=>{ ERRS++; out('  PAGE ERROR:', e.message); });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForTimeout(1500);
  // امتداد المصادقة الوهمية: Google / بريد / إنشاء / طرق الدخول / استعادة
  await p.evaluate(()=>{
    const a=firebase.auth(); window.__calls=[];
    const mk=(uid,email,ver=true,prov='google.com')=>({uid,email,displayName:email.split('@')[0],emailVerified:ver,providerData:[{providerId:prov}],reload:async()=>{},delete:async()=>{window.__calls.push('delete')},sendEmailVerification:async()=>{window.__calls.push('verify')}});
    firebase.firestore.FieldValue={ delete:()=>null, serverTimestamp:()=>Date.now() };
    firebase.auth.GoogleAuthProvider=function(){ this.setCustomParameters=()=>{}; };
    a.signInWithPopup=async()=>{ const u=mk(window.__gUid,window.__gEmail); a.currentUser=u; return {user:u,additionalUserInfo:{isNewUser:!!window.__gNew}}; };
    a.signInWithEmailAndPassword=async(em,p)=>{ const e=new Error('bad'); e.code='auth/invalid-credential'; throw e; };
    a.createUserWithEmailAndPassword=async()=>{ const e=new Error('used'); e.code='auth/email-already-in-use'; throw e; };
    a.fetchSignInMethodsForEmail=async()=>window.__methods||[];
    a.sendPasswordResetEmail=async(em)=>{ window.__calls.push('reset:'+em); };
  });
  return p;
}
const google=async(p,uid,email,isNew)=>{ await p.evaluate(([u,e,n])=>{window.__gUid=u;window.__gEmail=e;window.__gNew=n;},[uid,email,!!isNew]); await p.click('#staffGoogleBtn'); await p.waitForTimeout(900); };
const vis=(p,s)=>p.isVisible(s);
const wentOmr=p=>p.__navs.some(u=>/omr\.html/.test(u));
const usersWrites=p=>p.evaluate(()=>window.__mockWrites.filter(w=>/^users\//.test(w.path)).length);
(async()=>{
  const b=await chromium.launch();
  out('1. الشاشة الأولى موحَّدة');
  { const p=await open(b,seed());
    ok(await vis(p,'#staffLoginCard') && await vis(p,'#staffGoogleBtn') && await vis(p,'#staffEmailToggle'), 'بطاقة واحدة: Google + بريد');
    ok(await vis(p,'#roleStudentBtn'), 'زر «دخول الطالب» داخلها');
    ok((await p.textContent('#staffLoginCard')).includes('منجز المدرسي'), 'اسم التطبيق ظاهر');
    ok(!(await p.evaluate(()=>!!document.getElementById('roleSoloBtn')||!!document.getElementById('roleStaffBtn'))), 'لا بوابات «مدرسية/فردية» منفصلة');
    await p.click('#roleStudentBtn'); ok(await vis(p,'#studentLoginCard') && !(await vis(p,'#staffLoginCard')), 'الطالب يفتح بطاقته');
    await p.click('#backFromStudentBtn'); ok(await vis(p,'#staffLoginCard'), 'الرجوع من الطالب');
    await p.context().close(); }
  out('2. موظف مدرسة مفعَّل (سياق واحد) ← يدخل مباشرة');
  { const p=await open(b,seed()); await google(p,'U_SCH','sch@x.com');
    ok(await vis(p,'#appView'), 'دخل التطبيق'); ok(!(await vis(p,'#staffNewBox')), 'لا سؤال طريقة الاستخدام');
    ok(await usersWrites(p)===0, 'لا كتابة على users');
    const s=await p.evaluate(()=>JSON.parse(localStorage.getItem('cls_session')||'{}')); ok(s.role==='teacher'&&s.schoolId==='S2','الجلسة معلم/S2 ('+s.role+')');
    await p.context().close(); }
  out('3. معلم فردي ← يدخل مباشرة');
  { const p=await open(b,seed()); await google(p,'U_SOLO','solo@x.com');
    ok(wentOmr(p),'حوّله إلى omr.html (مسار الفردي المعتاد)'); ok(await usersWrites(p)===0,'لا كتابة');
    await p.context().close(); }
  out('4. حساب فيه سياقان ← شاشة الاختيار الحالية');
  { const p=await open(b,seed()); await google(p,'U_BOTH','both@x.com');
    ok(await vis(p,'#staffMultiAccountBox'),'شاشة اختيار الحساب'); ok(await p.locator('#macOptions button').count()===2,'خياران (فردي + مدرسة)');
    ok(!(await vis(p,'#staffNewBox')),'لا سؤال الحساب الجديد');
    await p.locator('#macOptions button').first().click(); await p.waitForTimeout(900); ok(wentOmr(p),'اختيار «حساب مستقل» ← omr.html');
    await p.context().close(); }
  out('5. فردي منتهي الاشتراك ← يُمنع ولا تُنشأ كتابة');
  { const p=await open(b,seed()); await google(p,'U_EXP','exp@x.com');
    ok(!(await vis(p,'#appView')),'لم يدخل'); ok(/انتهى اشتراكك/.test(await p.textContent('#loginAlert')),'رسالة انتهاء الاشتراك'); ok(await usersWrites(p)===0,'لا كتابة');
    await p.context().close(); }
  out('6. حساب جديد كليًا ← سؤال طريقة الاستخدام، ولا شيء يُنشأ قبل الاختيار');
  { const p=await open(b,seed()); await google(p,'U_NEW','new@x.com',true);
    ok(await vis(p,'#staffNewBox'),'ظهر السؤال'); ok(/منجز المدرسي/.test(await p.textContent('#nbSchoolBtn')) && /لدي بيانات تفعيل/.test(await p.textContent('#nbSchoolBtn')),'نص الخيار: '+(await p.textContent('#nbSchoolBtn')).trim());
    ok(await usersWrites(p)===0,'لم يُكتب مستند بعد'); ok(!(await vis(p,'#appView')),'لم يدخل');
    await p.click('#nbSchoolBtn'); ok(await vis(p,'#staffActivateBox') && !(await vis(p,'#staffNewBox')),'«بيانات تفعيل» ← شاشة التفعيل');
    ok(await usersWrites(p)===0,'ما زال بلا كتابة');
    await p.click('#acBackBtn'); ok(await vis(p,'#staffNewBox'),'رجوع إلى السؤال');
    await p.click('#nbCancelBtn'); await p.waitForTimeout(300); ok(await vis(p,'#staffSignInBox') && !(await vis(p,'#staffNewBox')),'إلغاء ← شاشة الدخول');
    ok((await p.evaluate(()=>window.__calls)).includes('delete'),'حذف حساب المصادقة المُنشأ للتو عند الإلغاء');
    await p.context().close(); }
  out('7. حساب جديد يختار «فردي» ← مستند فردي بتجربة ٣٠ يومًا ويدخل');
  { const p=await open(b,seed()); await google(p,'U_NEW2','n2@x.com',true);
    await p.click('#nbSoloBtn'); await p.waitForTimeout(1200);
    const d=await p.evaluate(()=>window.__mockDB()['users/U_NEW2']);
    ok(d && d.isSolo===true && d.solo && d.solo.active===true,'أُنشئ مستند فردي'); ok(d && !d.schools,'بلا سياق مدرسة');
    const days=d&&d.solo?Math.round((d.solo.subscriptionEnds-d.solo.subscribedAt)/86400e3):0; ok(days===30,'التجربة '+days+' يومًا');
    ok(wentOmr(p),'حوّله إلى omr.html');
    await p.context().close(); }
  out('8. حساب جديد يختار «مدرسة» ويفعّل بالبيانات ← سياق مدرسة فقط');
  { const p=await open(b,seed()); await google(p,'U_NEW3','n3@x.com',true);
    await p.click('#nbSchoolBtn'); await p.fill('#acSeat','3333333333'); await p.fill('#acTemp','Tmp123'); await p.click('#acDoBtn'); await p.waitForTimeout(2500);
    const d=await p.evaluate(()=>window.__mockDB()['users/U_NEW3']);
    ok(d && d.schools && d.schools.S2 && !d.solo,'مستند بسياق مدرسة بلا solo'); ok(d && d.loginId==='3333333333','رقم الهوية رُبط');
    ok(await vis(p,'#appView'),'دخل التطبيق');
    // كلمة مرور أولية خاطئة
    const p2=await open(b,seed()); await google(p2,'U_NEW4','n4@x.com',true); await p2.click('#nbSchoolBtn');
    await p2.fill('#acSeat','3333333333'); await p2.fill('#acTemp','WRONG'); await p2.click('#acDoBtn'); await p2.waitForTimeout(800);
    ok(/غير صحيحة/.test(await p2.textContent('#loginAlert')),'كلمة أولية خاطئة ← رفض'); ok(await p2.evaluate(()=>!window.__mockDB()['users/U_NEW4']),'لا مستند أُنشئ');
    await p.context().close(); await p2.context().close(); }
  out('9. الأدمن بلا تغيير');
  { const p=await open(b,seed()); await google(p,'U_ADM','adm@x.com'); ok(await vis(p,'#appView'),'الأدمن يدخل'); await p.context().close(); }
  out('10. رسالة كلمة المرور الخاطئة و«نسيت كلمة المرور»');
  { const p=await open(b,seed()); await p.click('#staffEmailToggle'); await p.fill('#liEmail','sch@x.com'); await p.fill('#liPass','badpass1');
    await p.evaluate(()=>{window.__methods=['password'];}); await p.click('#liBtn'); await p.waitForTimeout(600);
    ok(/كلمة المرور غير صحيحة/.test(await p.textContent('#loginAlert')) && !/مسجَّل مسبقاً/.test(await p.textContent('#loginAlert')),'بريد بكلمة مرور ← «كلمة المرور غير صحيحة»');
    await p.evaluate(()=>{window.__methods=['google.com'];}); await p.click('#liBtn'); await p.waitForTimeout(600);
    ok(/مسجَّل عبر Google/.test(await p.textContent('#loginAlert')),'بريد Google ← توجيه لزر Google');
    await p.evaluate(()=>{window.__methods=[];}); await p.click('#liBtn'); await p.waitForTimeout(600);
    ok(/نسيت كلمة المرور/.test(await p.textContent('#loginAlert')),'طرق غير معروفة ← رسالة جامعة');
    await p.fill('#liEmail',''); await p.click('#liForgot'); ok(/اكتب بريدك/.test(await p.textContent('#loginAlert')),'نسيت بلا بريد ← تنبيه');
    await p.fill('#liEmail','sch@x.com'); await p.click('#liForgot'); await p.waitForTimeout(300);
    ok((await p.evaluate(()=>window.__calls)).includes('reset:sch@x.com'),'أُرسل طلب إعادة التعيين'); ok(/رابط إعادة التعيين/.test(await p.textContent('#loginAlert')),'رسالة محايدة');
    await p.context().close(); }
  out('13. دخول الطالب: بريد مسجَّل بالنظام يُمنع، وبريد طالب جديد يمرّ');
  const stuG=async(p,uid,email)=>{ await p.click('#roleStudentBtn'); await p.evaluate(([u,e])=>{window.__gUid=u;window.__gEmail=e;window.__gNew=true;},[uid,email]); await p.click('#stuGoogleBtn'); await p.waitForTimeout(900); };
  const stuWrites=p=>p.evaluate(()=>window.__mockWrites.filter(w=>/^studentAccounts\//.test(w.path)).length);
  for(const [lbl,uid,em] of [['معلم مدرسة بالـ UID','U_SCH','sch@x.com'],['فردي بالـ UID','U_SOLO','solo@x.com'],['معلم ببريده لكن UID مختلف','U_OTHER','sch@x.com'],['موظف معلَّق ببريده','U_P2','pend@x.com']]){
    const p=await open(b,seed({'users/PEND2':{username:'معلَّق',email:'pend@x.com',schoolId:'S2',role:'teacher',active:true}})); await stuG(p,uid,em);
    ok(/لا يمكن استخدامه في دخول الطالب/.test(await p.textContent('#studentLoginAlert')),lbl+' ← رسالة المنع');
    ok(!(await vis(p,'#stuVerifyBox')),lbl+' ← لا تظهر خانات الهوية'); ok(await stuWrites(p)===0,lbl+' ← لا كتابة studentAccounts');
    await p.context().close(); }
  { const p=await open(b,seed()); await stuG(p,'U_STU','kid@gmail.com');
    ok(await vis(p,'#stuVerifyBox'),'بريد طالب غير مسجَّل ← خانات الهوية ورمز الفصل'); await p.context().close(); }
  await b.close();
  out(FAIL? ('\nفشل '+FAIL+' فحص') : '\nالنتيجة: كل الفحوص نجحت', '· أخطاء صفحات:', ERRS);
  process.exit(FAIL||ERRS?1:0);
})();
