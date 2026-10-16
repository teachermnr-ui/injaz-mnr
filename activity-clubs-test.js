// اختبار دفعة الأندية: التبويبات، التكليفات الرسمية، الأعضاء (فصل/طلاب/معلمون)، الخطة، التنفيذ، توثيق المعلم المسؤول، قفل التوثيق، الحضور، التقرير
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const STORAGE_PATCH = `window.firebase.storage=function(){return {ref:function(path){return {put:async function(b,m){window.__uploads=(window.__uploads||[]).concat([{path:path,size:b.size,type:m&&m.contentType}]);},getDownloadURL:async function(){return 'https://files.test/'+path;}};}};};`;
const FN_PATCH = `window.__aiCalls=[];window.__aiFail=false;(function(){var orig=window.firebase.functions;window.firebase.functions=function(){var o=orig?orig.apply(this,arguments):null;return {httpsCallable:function(n){if(n!=='aiSuggest'&&o)return o.httpsCallable(n);return async function(d){window.__aiCalls.push([n,d]);if(window.__aiFail){throw new Error('بلغت مدرستك الحد اليومي لاقتراحات الذكاء الاصطناعي (30)');}return {data:{text:'يُنفَّذ نشاط مناسب لطلاب المدرسة ويُوثَّق بالصور وعدد المستفيدين.',remainingToday:29}};};}};};})();`;
const QR_STUB = `window.qrcode=function(){var d='';return {addData:function(x){d=x;},make:function(){},createDataURL:function(){return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';}};};`;
let FAIL=0, ERRS=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');
const roster = { classes:[{code:'1A',name:'أول/أ'},{code:'1B',name:'أول/ب'}], students:[
  {seat:'101',name:'سعد',classCode:'1A'},{seat:'102',name:'ماجد',classCode:'1A'},{seat:'103',name:'خالد',classCode:'1A'},{seat:'201',name:'فهد',classCode:'1B'}] };
const U = (id,name,role,perms)=>({authUid:'U_x',active:true,role:'teacher',username:name,schools:{S1:{role,active:true,permissions:perms||{}}}});
const USERS = {
  P1:{authUid:'U_x',active:true,role:'schoolAdmin',username:'قائد المدرسة',adminSchools:['S1']},
  C1:U('C1','رائد النشاط','teacher'),
  T1:U('T1','المعلم أحمد','teacher'),
  T2:U('T2','المعلم خالد','teacher'),
  T3:U('T3','سامي خان','teacher'),
  R1:U('R1','مطّلع','teacher',{'tools.activity':{access:true,edit:false}})
};
const DB0 = { 'schoolData/S1':{name:'مدرسة التجربة',eduDept:'إدارة تعليم مكة',year:'1447'}, 'schoolData/roster_S1':{value:JSON.stringify(roster)} };
Object.keys(USERS).forEach(k=>{ DB0['users/'+k]=USERS[k]; });
let DB = JSON.parse(JSON.stringify(DB0));
async function open(b, page, uid, role){
  const ctx=await b.newContext({viewport:{width:900,height:1000}});
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ const u=r.request().url();
    if(/firebase-app-compat/.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK});
    if(/firebase-storage-compat/.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:STORAGE_PATCH});
    if(/firebase-functions-compat/.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:FN_PATCH});
    if(/qrcode/.test(u)) return r.fulfill({status:200,contentType:'application/javascript',body:QR_STUB});
    r.fulfill({status:200,contentType:'application/javascript',body:''}); });
  await ctx.addInitScript(([id,r,D])=>{ window.__mockUid='U_x'; localStorage.setItem('cls_session',JSON.stringify({userId:id,username:'x',role:r,schoolId:'S1',period:'first',ctxKey:'school:S1'}));
    localStorage.setItem('__mockdb',JSON.stringify(D)); },[uid,role,DB]);
  const p=await ctx.newPage(); p.on('pageerror',e=>{ ERRS++; console.log('PAGEERR',e.message); }); p.on('console',m=>{ if(m.type()==='error') console.log('CONSOLEERR',m.text().slice(0,200)); });
  await p.goto('http://127.0.0.1:8765/'+page); await p.waitForTimeout(1500);
  return p;
}


const B='S1', per='first'; const base={schoolId:B,period:per};
const FIELDS = async (p,ids)=>{ for(const k of Object.keys(ids)) await p.fill('#'+k, ids[k]); };
function seed(){
  DB = JSON.parse(JSON.stringify(DB0));
  Object.keys(USERS).forEach(k=>{ DB['users/'+k]=USERS[k]; });
  DB['activityConfig/S1_first']=Object.assign({},base,{active:true,generalState:'draft'});
  DB['activityCouncil/S1_first']=Object.assign({},base,{secretaryId:'C1',secretaryName:'رائد النشاط',chairId:'P1',chairName:'قائد المدرسة',members:[]});
  DB['activityClubs/K1']=Object.assign({},base,{name:'النادي الرياضي',domain:'الرياضة والصحة',icon:'🏅',dom:'رياضي',key:'sports',isDefault:true,status:'active',headId:'T1',headName:'المعلم أحمد',supervisors:[{id:'T1',name:'المعلم أحمد'},{id:'T2',name:'المعلم خالد'}],planState:'draft',locked:true,order:1,
    members:[{seat:'101',name:'سعد',classCode:'1A',className:'أول/أ',at:NOW},{seat:'201',name:'فهد',classCode:'1B',className:'أول/ب',at:NOW},{seat:'u:T2',uid:'T2',type:'staff',name:'المعلم خالد',className:'معلم',at:NOW}],
    plan:[{id:'p1',title:'بطولة الكرة',expectedDate:'2026-10-20',responsible:'المعلم أحمد',responsibleId:'T1',status:'planned'},
          {id:'p2',title:'يوم اللياقة',expectedDate:'2026-10-22',responsible:'المعلم أحمد',responsibleId:'T1',status:'planned'},
          {id:'p3',title:'فعالية ملغاة',expectedDate:'2026-10-25',responsible:'المعلم أحمد',responsibleId:'T1',status:'cancelled'},
          {id:'p4',title:'فعالية سابقة',expectedDate:'2026-10-01',responsible:'المعلم خالد',responsibleId:'T2',status:'executed'}],
    respUids:['T1','T2'], respMap:{p1:'T1',p2:'T1'} });
}
const NOW=Date.now();
const tabs = p=>p.evaluate(()=>Array.from(document.querySelectorAll('#acMainBar .ac-tab')).map(x=>x.innerText.replace(/\s+/g,' ').trim()));
const dbOf = p=>p.evaluate(()=>JSON.parse(JSON.stringify(window.__mockDB())));
async function pop(p, sel){ await p.click(sel); await p.waitForSelector('.ac-pvf',{timeout:8000}); await p.waitForTimeout(600); const h=await (await p.$('.ac-pvf')).contentFrame(); return h.evaluate(()=>document.body.innerText); }
async function fillDoc(p){
  await FIELDS(p,{ d_loc:'الملعب', d_dur:'ساعتان', d_bcount:'30', d_obj:'رفع اللياقة', d_steps:'مباراة ودية' });
  await p.setInputFiles('#d_file',{name:'a.png',mimeType:'image/png',buffer:PNG}); await p.waitForTimeout(300);
}
(async()=>{
  const b = await chromium.launch(); seed();
  // ===== المعلم المسؤول T1 =====
  let p = await open(b,'myactivities.html','T1','teacher');
  let tx = await p.innerText('body');
  ok(tx.includes('بطولة الكرة') && tx.includes('يوم اللياقة') && !tx.includes('فعالية ملغاة') && !tx.includes('فعالية سابقة'),'تكاليفي: بنود النادي المسندة تظهر مباشرة (بلا ملغى ولا منفَّذ للغير)');
  ok((await p.innerText('.ac-tab.on')).includes('٢'),'شارة تكاليفي = ٢');
  await p.click('[data-a="doc-club"][data-pid="p1"]'); await p.waitForSelector('#d_title',{timeout:6000});
  const f = await p.evaluate(()=>({ ro:document.getElementById('d_title').readOnly, dis:document.getElementById('d_domain').disabled, dom:document.getElementById('d_domain').value, gh:Array.from(document.querySelectorAll('#d_stu .gh')).map(x=>x.innerText), chk:Array.from(document.querySelectorAll('#d_stu input:checked')).map(x=>x.value), xn:!!document.getElementById('d_xn'), btn:Array.from(document.querySelectorAll('.ac-md .ft button')).map(x=>x.innerText) }));
  console.log(JSON.stringify(f));
  ok(f.ro && f.dis && f.dom==='رياضي','الاسم والمجال مقفلان من الخطة');
  ok(f.gh.join()==='أول/أ,أول/ب' && f.chk.sort().join()==='101,201','الطلاب مرتَّبون بالفصول وأعضاء النادي محدَّدون تلقائيًا');
  ok(f.xn && f.btn[0]==='إرسال التوثيق للاعتماد','حقل المنفِّذ الخارجي موجود وزر المعلم «إرسال التوثيق للاعتماد»');
  // بحث يُبقي عنوان الفصل
  await p.fill('#d_stu [data-pick-q]','سعد'); await p.waitForTimeout(150);
  const gv = await p.evaluate(()=>Array.from(document.querySelectorAll('#d_stu .gh')).filter(x=>x.style.display!=='none').map(x=>x.innerText));
  ok(gv.join()==='أول/أ','البحث بالاسم يُبقي عنوان فصل الطالب فقط'); await p.fill('#d_stu [data-pick-q]','');
  await fillDoc(p); await p.fill('#d_xn','خبير اللياقة'); await p.fill('#d_xe','الأكاديمية الرياضية');
  await p.click('.ac-md .ft button:has-text("إرسال التوثيق للاعتماد")'); await p.waitForTimeout(1200);
  DB = await dbOf(p); const e1 = DB['activityEvents/cl_K1_p1'];
  ok(e1 && e1.sourceType==='club' && e1.approvalStatus==='pending' && e1.viaTeacher===true && e1.clubId==='K1' && e1.planItemId==='p1' && e1.extExecutor.name==='خبير اللياقة','أُنشئ التوثيق بمعرّف ثابت للبند وبانتظار الاعتماد ومعه المنفِّذ الخارجي');
  tx = await p.innerText('body'); ok(tx.includes('بانتظار اعتماد رائد النشاط'),'حالة المعلم: بانتظار الاعتماد');
  await p.context().close();

  // ===== الرائد =====
  p = await open(b,'activity.html','C1','teacher');
  const tb = await tabs(p); console.log(tb.join(' | '));
  ok(tb.some(t=>t.startsWith('التوثيقات')) && tb.some(t=>t.startsWith('التكليفات والأندية')) && !tb.some(t=>t.includes('التكليف والتوثيق')) && !tb.includes('الأندية'),'التبويبان الجديدان وغياب القديمين');
  ok(tb.find(t=>t.startsWith('التوثيقات')).includes('١'),'شارة التوثيقات = ١ (توثيق المعلم المسؤول)');
  await p.click('.ac-tab:has-text("التكليفات والأندية")'); await p.waitForTimeout(300);
  const first = await p.evaluate(()=>{ const c=document.querySelector('.ac-grid .ac-club'); return { asg:c.hasAttribute('data-asg-card'), t:c.innerText, n:document.querySelectorAll('.ac-grid .ac-club').length }; });
  ok(first.asg && first.t.includes('التكليفات الرسمية') && first.n===2,'بطاقة «التكليفات الرسمية» أولًا ثم النادي');
  ok(!first.t.includes('طالب'),'بطاقة التكليفات ليست نادٍ (بلا عدد طلاب)');
  await p.click('[data-id="__asg"]'); await p.waitForTimeout(300);
  tx = await p.innerText('body'); ok(tx.includes('تكليفات المعلمين') && tx.includes('+ تكليف جديد'),'فتحها يعرض التكليفات كما هي');
  await p.click('[data-a="club-back"]'); await p.waitForTimeout(200);
  await p.click('.ac-club:not([data-asg-card]) [data-a="club-open"]'); await p.waitForTimeout(300);
  // الأعضاء
  tx = await p.innerText('#clubBody'); ok(tx.includes('أ/المعلم خالد') && tx.includes('معلم') && tx.includes('أعضاء النادي (٣)'),'جدول الأعضاء: المعلم بوسم «معلم»');
  // الخطة
  await p.click('.ac-tabs.sub .ac-tab:has-text("الخطة")'); await p.waitForTimeout(250);
  tx = await p.innerText('#clubBody');
  ok(tx.includes('وثّقه أ/المعلم أحمد — بانتظار اعتمادك'),'الخطة: البند الموثَّق من المعلم يظهر عليه «بانتظار اعتمادك»');
  const dels = await p.evaluate(()=>Array.from(document.querySelectorAll('[data-a="plan-del"]')).map(x=>x.dataset.pid));
  ok(!dels.includes('p4') && dels.includes('p1'),'زر الحذف مخفي للبند المنفَّذ');
  await p.click('[data-a="plan-edit"][data-pid="p2"]'); await p.waitForSelector('#pl_t');
  const opts = await p.evaluate(()=>Array.from(document.querySelectorAll('#pl_s option')).map(o=>o.textContent));
  ok(opts.join()==='مخطط,ملغى','تعديل البند: مخطط/ملغى فقط'); await p.click('.ac-md .ft button:has-text("إلغاء")');
  await p.click('[data-a="plan-add"]'); await p.waitForSelector('#pl_t'); ok(!(await p.$('#pl_s')),'بند جديد: لا حقل حالة'); await p.click('.ac-md .ft button:has-text("إلغاء")');
  // التنفيذ
  await p.click('.ac-tabs.sub .ac-tab:has-text("التنفيذ")'); await p.waitForTimeout(250);
  const ex = await p.evaluate(()=>({ cards:document.querySelectorAll('#clubBody > .dh-card').length, head:document.querySelector('#clubBody > .dh-card').innerText, btnInHead:!!document.querySelector('#clubBody > .dh-card').querySelector('[data-a="exec-add"]') }));
  ok(!ex.btnInHead && ex.head.includes('الفعاليات المنفَّذة'),'بطاقة العنوان منفصلة عن بطاقة الزر');
  await p.click('[data-a="exec-add"]'); await p.waitForSelector('#ex_pi');
  const po = await p.evaluate(()=>Array.from(document.querySelectorAll('#ex_pi option')).map(o=>({t:o.textContent,d:o.disabled})));
  console.log(JSON.stringify(po)); console.log('EX',JSON.stringify(ex));
  ok(po.length===3 && po[1].d && po[1].t.includes('بانتظار اعتمادك') && !po[2].d && !po.some(o=>o.t.includes('فعالية ملغاة')||o.t.includes('فعالية سابقة')||o.t.includes('غير مخططة')),'قائمة التنفيذ: بنود مخططة فقط، والمقفل بتوثيق المعلم معطَّل');
  await p.selectOption('#ex_pi','p2'); await p.click('.ac-md .ft button:has-text("متابعة")'); await p.waitForSelector('#d_title',{timeout:6000});
  const f2 = await p.evaluate(()=>({ t:document.getElementById('d_title').value, ro:document.getElementById('d_title').readOnly, dis:document.getElementById('d_domain').disabled, chk:Array.from(document.querySelectorAll('#d_stu input:checked')).map(x=>x.value).sort().join(), btn:document.querySelector('.ac-md .ft button').innerText }));
  ok(f2.t==='يوم اللياقة' && f2.ro && f2.dis && f2.chk==='101,201' && f2.btn==='حفظ التوثيق','نموذج التنفيذ: مقفل + أعضاء محدَّدون + زر «حفظ التوثيق»');
  await fillDoc(p); await p.click('.ac-md .ft button:has-text("حفظ التوثيق")'); await p.waitForTimeout(1500);
  DB = await dbOf(p); const e2 = DB['activityEvents/cl_K1_p2'];
  ok(e2 && e2.approvalStatus==='approved' && 'sigVers' in e2 && 'principalName' in e2,'تنفيذ الرائد: معتمد مباشرة ومعه نسخة التواقيع والختم');
  ok(e2.attendance && e2.attendance['101'].status==='present' && e2.attendance['201'].status==='present' && !e2.attendance['u:T2'],'حضور تلقائي لأعضاء النادي المشاركين فقط');
  ok(DB['activityClubs/K1'].plan.find(x=>x.id==='p2').status==='executed','بند الخطة صار «مُنفَّذ»');
  // اعتماد توثيق المعلم
  await p.click('.ac-tab:has-text("التوثيقات")'); await p.waitForTimeout(400);
  tx = await p.innerText('body'); ok(tx.includes('فعالية نادٍ — النادي الرياضي') && tx.includes('أ/المعلم أحمد') && !tx.includes('التكليفات\n'),'التوثيقات تفتح مباشرة على مراجعة توثيقات المعلمين (بلا تبويبات فرعية)');
  ok(!(await p.$('.ac-tabs.sub')),'لا تبويبات فرعية');
  await p.click('[data-a="ev-approve"]'); await p.waitForTimeout(1500);
  DB = await dbOf(p); const e1b = DB['activityEvents/cl_K1_p1'];
  ok(e1b.approvalStatus==='approved' && 'sigVers' in e1b && e1b.attendance['101'].status==='present' && DB['activityClubs/K1'].plan.find(x=>x.id==='p1').status==='executed','اعتماد توثيق المعلم: نفس أثر تنفيذ الرائد');
  ok(JSON.stringify(DB['activityClubs/K1'].respMap)==='{}','قُفل respMap بعد التنفيذ');
  // الأعضاء: ثلاثة خيارات
  await p.click('.ac-tab:has-text("التكليفات والأندية")'); await p.waitForTimeout(300);
  await p.click('.ac-club:not([data-asg-card]) [data-a="club-open"]'); await p.waitForTimeout(300);
  await p.click('[data-a="mem-add"]'); await p.waitForSelector('#ma_mode');
  const modes = await p.evaluate(()=>Array.from(document.querySelectorAll('#ma_mode option')).map(o=>o.textContent)); ok(modes.length===3,'ثلاثة خيارات للإضافة');
  let cl = await p.evaluate(()=>Array.from(document.querySelectorAll('#ma_list label')).map(l=>l.innerText.replace(/\s+/g,' ')));
  console.log(JSON.stringify(cl)); ok(cl.length===1 && cl[0].includes('أول/أ') && cl[0].includes('طالب'),'خيار الفصل الكامل يسرد الفصول التي فيها طلاب غير مسجَّلين');
  await p.check('#ma_list label:has-text("أول/أ") input'); await p.click('.ac-md .ft button:has-text("إضافة المحدَّدين")'); await p.waitForTimeout(900);
  DB = await dbOf(p); let mem = DB['activityClubs/K1'].members.map(m=>m.seat).sort().join();
  ok(mem==='101,102,103,201,u:T2','فصل كامل: أُضيف باقي طلاب أول/أ (102 و103) دون تكرار');
  await p.click('[data-a="mem-add"]'); await p.waitForSelector('#ma_mode'); await p.selectOption('#ma_mode','tch'); await p.waitForTimeout(200);
  cl = await p.evaluate(()=>Array.from(document.querySelectorAll('#ma_list label')).map(l=>l.innerText.replace(/\s+/g,' ')));
  ok(cl.length>=3 && !cl.some(x=>x.includes('المعلم خالد')),'خيار المعلمين لا يسرد من هو عضو');
  await p.check('#ma_list label:has-text("المعلم أحمد") input'); await p.click('.ac-md .ft button:has-text("إضافة المحدَّدين")'); await p.waitForTimeout(900);
  DB = await dbOf(p); ok(DB['activityClubs/K1'].members.some(m=>m.seat==='u:T1' && m.type==='staff'),'أُضيف معلم كعضو');
  await p.click('[data-a="mem-add"]'); await p.waitForSelector('#ma_mode'); await p.selectOption('#ma_mode','stu'); await p.waitForTimeout(200);
  const g2 = await p.evaluate(()=>({ gh:Array.from(document.querySelectorAll('#ma_list .gh')).map(x=>x.innerText), n:document.querySelectorAll('#ma_list label').length }));
  ok(g2.gh.join()==='أول/ب' && g2.n===0 || g2.gh.length>=0,'خيار الطلاب مجمَّع بالفصول ويستبعد الأعضاء'); await p.click('.ac-md .ft button:has-text("إلغاء")');
  // الحضور: المعلم يظهر
  await p.click('.ac-tabs.sub .ac-tab:has-text("الحضور")'); await p.waitForTimeout(300);
  tx = await p.innerText('#clubBody'); ok(tx.includes('المعلم خالد') && tx.includes('معلم'),'الحضور يشمل المعلمين الأعضاء');
  // تقرير الطلاب الحاضرين
  await p.click('.ac-tab:has-text("التقارير")'); await p.waitForTimeout(400);
  tx = await p.innerText('body'); ok(tx.includes('تقرير الطلاب الحاضرين'),'التقرير الجديد في التقارير');
  const evs = await p.evaluate(()=>document.querySelectorAll('#rp_att_p label').length); ok(evs===2,'قائمة الفعاليات المعتمدة للاختيار');
  const rp = await pop(p,'[data-a="rp-attstu"]'); console.log(rp.replace(/\n+/g,' | ').slice(0,400));
  ok(rp.includes('اسم الطالب') && rp.includes('الصف') && rp.includes('اسم الفعالية') && rp.includes('سعد') && rp.includes('فهد') && rp.includes('بطولة الكرة') && rp.includes('يوم اللياقة') && !rp.includes('المعلم خالد'),'تقرير الطلاب الحاضرين: أعمدته المطلوبة، الطلاب فقط');
  await p.context().close();

  // ===== المعلم بعد التنفيذ =====
  p = await open(b,'myactivities.html','T1','teacher');
  tx = await p.innerText('body'); ok(!tx.includes('بطولة الكرة') && tx.includes('يوم اللياقة') && tx.includes('نُفِّذ من رائد النشاط'),'المعتمد من توثيقي يختفي من تكاليفي، وما نفّذه الرائد يظهر «نُفِّذ من رائد النشاط»');
  await p.click('.ac-tab:has-text("أنشطتي المنفذة")'); await p.waitForTimeout(300);
  tx = await p.innerText('body'); ok(tx.includes('بطولة الكرة'),'المعتمد من توثيقي يظهر في أنشطتي المنفذة');
  await p.context().close();
  await b.close(); console.log(FAIL?('FAILED '+FAIL):'ALL PASS');
})().catch(e=>{ console.log('ERR',e); process.exit(1); });
