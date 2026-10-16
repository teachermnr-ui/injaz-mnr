// اختبار منصة النشاط المدرسي: التفعيل، المجلس، الأندية، الخطط، المسار العام، التكليف والتوثيق، الإذاعة، التقارير، لوحة المعلم، وضع الاطلاع
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
const save = async p=>{ DB = await p.evaluate(()=>window.__mockDB()); };
const okDlg = async p=>{ await p.waitForSelector('#mnDlgOv .mnOk',{timeout:3000}); await p.click('#mnDlgOv .mnOk'); await p.waitForTimeout(500); };
const tab = async (p,name)=>{ await p.click('.ac-tab:has-text("'+name+'")'); await p.waitForTimeout(250); };
const mbtn = async (p,label)=>{ await p.click('.ac-ov .ft .ac-btn:has-text("'+label+'")'); await p.waitForTimeout(700); };
const body = async p=>{ await p.evaluate(()=>document.querySelectorAll('.ac-fold details').forEach(d=>d.open=true)); return p.innerText('body'); };
async function popupText(p, sel){
  /* المعاينة صارت طبقة داخل الصفحة (iframe) لا نافذة جديدة: نقرأ محتواها ثم نغلقها بزر «رجوع» ونتحقق أننا بقينا بالصفحة نفسها */
  const urlBefore = p.url();
  await p.click(sel);
  const h = await p.waitForSelector('.ac-pvf',{timeout:8000});
  let fr = await h.contentFrame(); await p.waitForTimeout(1200);
  fr = await (await p.$('.ac-pvf')).contentFrame();
  const text = await fr.innerText('body'), html = await fr.content();
  if(p.__shot){ await h.screenshot({path:p.__shot,timeout:8000}).catch(()=>{}); p.__shot=null; }
  await p.click('.ac-pvbar [data-x]'); await p.waitForTimeout(400);
  const gone = (await p.$('.ac-pv'))===null;
  ok(gone && p.url().split('#')[0]===urlBefore.split('#')[0],'إغلاق المعاينة يبقيك في الصفحة نفسها');
  return { close: async()=>{}, innerText: async()=>text, content: async()=>html, screenshot: async()=>{}, waitForTimeout: async()=>{} };
}
(async()=>{
  const b=await chromium.launch();
  const dbAll=p=>p.evaluate(()=>window.__mockDB());
  const idOf=async(p,col,f)=>p.evaluate(([c,fn])=>{ const d=window.__mockDB(); const k=Object.keys(d).find(k=>k.startsWith(c+'/') && new Function('x','return '+fn)(d[k])); return k?k.split('/')[1]:null; },[col,f]);
  /* ---- ١) قبل التفعيل: القائد يشكّل المجلس فقط ---- */
  console.log('1. القائد: تشكيل المجلس قبل التفعيل');
  let p=await open(b,'activity.html','P1','schoolAdmin');
  let t=await body(p);
  ok(t.includes('شكّل مجلس النشاط') && (await p.$$('[data-a="council-form"]')).length===1 && (await p.$$('[data-a="activate"]')).length===0,'القائد يرى تشكيل المجلس ولا يرى زر التفعيل');
  await p.click('[data-a="council-form"]'); await p.waitForSelector('#cn_sec');
  ok(!(await p.innerHTML('#cn_sec')).includes('قائد المدرسة'),'القائد ليس بين خيارات رائد النشاط');
  await p.selectOption('#cn_sec','C1'); await p.click('#cn_add'); await p.selectOption('[data-f="id"]','T1'); await p.fill('[data-f="role"]','رئيس النادي الرياضي');
  await mbtn(p,'حفظ التشكيل'); t=await body(p);
  ok(t.includes('مُشكَّل') && t.includes('رائد النشاط (المقرر): رائد النشاط'),'المجلس مُشكَّل ويظهر الرائد');
  const dbc=await dbAll(p); ok(!dbc['activityConfig/S1_first'] && dbc['activityCouncil/S1_first'].secretaryId==='C1','المجلس محفوظ ولا يُنشأ إعداد للمنصة');
  await save(p); await p.context().close();

  /* ---- ٢) الرائد (معلم بلا صلاحية) يفعّل ---- */
  console.log('2. الرائد يدخل تلقائيًا ويفعّل');
  p=await open(b,'activity.html','T2','teacher'); ok((await body(p)).includes('ليست لديك صلاحية'),'معلم عادي ليس رائدًا: ممنوع'); await p.context().close();
  p=await open(b,'activity.html','C1','teacher'); t=await body(p);
  ok(t.includes('تفعيل منصة النشاط المدرسي') && !t.includes('وضع الاطلاع'),'الرائد يدخل ويرى التفعيل بلا صلاحية خاصة');
  await p.click('[data-a="activate"]'); await okDlg(p); await p.waitForTimeout(800);
  t=await body(p);
  const tabNames=await p.$$eval('#acMainBar .ac-tab',e=>e.map(x=>x.innerText.replace(/\d|[٠-٩]/g,'').trim()));
  ok(t.includes('نادٍ مفعّل') && tabNames.length===8,'٨ تبويبات بعد التفعيل');
  ok(tabNames.indexOf('الأنشطة والمسار العام')===tabNames.indexOf('التكليفات والأندية')+1,'«الأنشطة والمسار العام» بعد «التكليفات والأندية» مباشرة: '+tabNames.join('، '));
  let dbx=await dbAll(p); const clubs=Object.keys(dbx).filter(k=>/^activityClubs\//.test(k));
  ok(clubs.length===7 && clubs.every(k=>dbx[k].planState==='draft') && dbx['activityConfig/S1_first'].generalState==='draft' && !('planStatus' in dbx['activityConfig/S1_first']) && !('manual' in dbx['activityConfig/S1_first']),'سبعة أندية بحالة خطة مسودة وإعداد نظيف');
  await save(p); await p.context().close();

  /* ---- ٣) المحاضر والأندية والخطط والتنفيذ ---- */
  console.log('3. المحاضر والأندية والخطط والتنفيذ والحضور');
  p=await open(b,'activity.html','C1','teacher');
  await tab(p,'مجلس النشاط');
  await p.click('[data-a="meeting-add"]'); await p.waitForSelector('#mt_sum');
  ok((await p.$$('.ai-fill-ico')).length===2,'نافذة المحضر: أيقونتان (الملخص والقرارات)');
  await p.evaluate(()=>{ window.__aiCalls=[]; });
  await p.click('#mt_dec >> xpath=../.. >> .ai-fill-ico'); await p.waitForTimeout(300);
  ok((await p.innerText('#acToast')).includes('اكتب ملخص الاجتماع أولًا') && (await p.evaluate(()=>window.__aiCalls.length))===0,'القرارات بلا ملخص: رسالة ولا استدعاء');
  ok((await p.$('#mt_title'))!==null && (await p.$eval('#mt_title',e=>e.compareDocumentPosition(document.querySelector('#mt_no')) & 4))>0,'حقل «عنوان الاجتماع» فوق رقم الاجتماع');
  await p.click('#mt_sum >> xpath=.. >> .ai-fill-ico'); await p.waitForTimeout(300);
  ok((await p.innerText('#acToast')).includes('اكتب عنوان الاجتماع أولًا') && (await p.evaluate(()=>window.__aiCalls.length))===0,'ملخص بلا عنوان: رسالة ولا استدعاء');
  await p.fill('#mt_title','متابعة الخطة');
  await p.click('#mt_sum >> xpath=.. >> .ai-fill-ico'); await p.waitForTimeout(500);
  { const c=await p.evaluate(()=>window.__aiCalls); ok(c.length===1 && c[0][1].kind==='meeting_summary' && Object.keys(c[0][1]).sort().join()==='kind,number,schoolId,title' && c[0][1].title==='متابعة الخطة','اقتراح الملخص يرسل رقم الاجتماع وعنوانه فقط'); }
  ok((await p.inputValue('#mt_sum')).length>10,'يُملأ حقل الملخص');
  await p.click('#mt_dec >> xpath=.. >> .ai-fill-ico'); await p.waitForTimeout(500);
  { const c=await p.evaluate(()=>window.__aiCalls); ok(c.length===2 && c[1][1].kind==='meeting_decisions' && c[1][1].summary.length>10,'اقتراح القرارات يستند إلى نص الملخص'); }
  await p.fill('#mt_sum','مناقشة الخطة'); await p.fill('#mt_dec','اعتماد الأندية\nتحديد موعد اليوم الوطني'); await p.fill('#mt_title','');
  await mbtn(p,'حفظ'); ok((await p.innerText('#acToast')).includes('أكمل العنوان'),'العنوان إلزامي عند الحفظ'); await p.fill('#mt_title','متابعة الخطة'); await mbtn(p,'حفظ');
  t=await body(p); ok(t.includes('الاجتماع ١') && t.includes('اعتماد الأندية'),'محضر اجتماع بقرارين');
  await p.click('[data-a="meeting-add"]'); await p.waitForSelector('#mt_sum');
  ok((await p.$$('#mt_titles option')).length===1 && (await p.getAttribute('#mt_titles option','value'))==='متابعة الخطة','العناوين السابقة تُقترح في القائمة');
  await p.fill('#mt_title','متابعة الخطة'); await p.fill('#mt_sum','متابعة التنفيذ'); await p.fill('#mt_dec','رفع التقارير'); await mbtn(p,'حفظ');
  { const tt=await body(p); ok((tt.match(/متابعة الخطة \(/g)||[]).length===1 && tt.includes('٢ اجتماع') && tt.includes('الاجتماع ١') && tt.includes('الاجتماع ٢'),'عنوان واحد يضم اجتماعين مجمَّعين تحت عنوانه'); }
  ok((await p.$$('[data-a="meeting-print"]')).length===2,'زر طباعة لكل محضر على حدة');
  let pop=await popupText(p,'[data-a="meeting-print"] >> nth=0'); let mt=await pop.innerText('body');
  ok(mt.includes('محضر اجتماع مجلس النشاط الطلابي') && mt.includes('العنوان: متابعة الخطة') && mt.includes('مناقشة الخطة') && mt.includes('اعتماد الأندية') && mt.includes('المعلم أحمد') && !mt.includes('متابعة التنفيذ'),'طباعة محضر واحد فقط بملخصه وقراراته والحضور');
  pop=await popupText(p,'[data-a="print-council"]'); const pt=await pop.innerText('body');
  ok(pt.includes('قرار تشكيل مجلس النشاط الطلابي') && pt.includes('رئيس النادي الرياضي') && pt.includes('إدارة تعليم مكة'),'قرار تشكيل المجلس مطبوع بالترويسة الموحدة');
  await tab(p,'الأندية');
  await p.click('[data-a="club-add"]'); await p.waitForSelector('#cl_name'); await p.fill('#cl_name','نادي الروبوت'); await mbtn(p,'حفظ');
  t=await body(p); ok(t.includes('نادي الروبوت'),'إضافة نادٍ مخصص');
  let robot=await p.evaluate(()=>{ const d=window.__mockDB(); return Object.keys(d).find(k=>/^activityClubs\//.test(k)&&d[k].name==='نادي الروبوت'); });
  await p.click('[data-a="club-open"][data-id="'+robot.split('/')[1]+'"]'); await p.waitForTimeout(300);
  ok((await body(p)).includes('حذف النادي'),'نادٍ غير مستعمل: زر «حذف»');
  await p.click('[data-a="club-del"]'); await okDlg(p); t=await body(p);
  ok(!t.includes('نادي الروبوت') && !(await p.evaluate(k=>!!window.__mockDB()[k],robot)),'النادي غير المستعمل حُذف نهائيًا');
  const sportsId=await idOf(p,'activityClubs',"x.key==='sports'");
  await p.click('[data-a="club-open"][data-id="'+sportsId+'"]'); await p.waitForTimeout(300);
  await p.click('[data-a="club-edit"]'); await p.waitForSelector('#cl_head'); await p.selectOption('#cl_head','T1');
  await p.check('#cl_sup input[value="T2"]'); await mbtn(p,'حفظ'); t=await body(p);
  ok(t.includes('المشرف: المعلم أحمد') && t.includes('المعلم خالد'),'رئيس ومناوب للنادي');
  await p.click('[data-a="mem-add"]'); await p.waitForSelector('#ma_mode'); await p.selectOption('#ma_mode','stu'); await p.waitForSelector('#ma_p input[value="101"]');
  await p.check('#ma_p input[value="101"]'); await p.check('#ma_p input[value="102"]'); await mbtn(p,'إضافة المحدَّدين'); t=await body(p);
  ok(t.includes('أعضاء النادي (٢)') && t.includes('سعد') && t.includes('ماجد'),'تسجيل طالبين');
  const sci=await idOf(p,'activityClubs',"x.key==='science'");
  await p.click('[data-a="club-back"]'); await p.click('[data-a="club-open"][data-id="'+sci+'"]'); await p.click('[data-a="mem-add"]'); await p.waitForSelector('#ma_mode'); await p.selectOption('#ma_mode','stu'); await p.waitForSelector('#ma_p input[value="101"]');
  ok((await p.innerText('#ma_p')).includes('مسجَّل في النادي الرياضي'),'تحذير الطالب المسجَّل بنادٍ آخر'); await mbtn(p,'إلغاء');
  await p.click('[data-a="club-back"]'); await p.click('[data-a="club-open"][data-id="'+sportsId+'"]');
  await p.click('[data-a="club-tab"][data-v="plan"]'); await p.click('[data-a="plan-add"]'); await p.waitForSelector('#pl_t');
  await p.fill('#pl_t','الدوري الرياضي'); await p.fill('#pl_d','2026-10-20'); await p.selectOption('#pl_r','T1'); await mbtn(p,'حفظ');
  await p.click('[data-a="plan-add"]'); await p.waitForSelector('#pl_t'); await p.fill('#pl_t','تدريب الفرق'); await p.fill('#pl_d','2026-11-05'); await p.selectOption('#pl_r','T2'); await mbtn(p,'حفظ');
  t=await body(p); ok(t.includes('الدوري الرياضي') && t.includes('تدريب الفرق') && t.includes('مخطط') && t.includes('مسودة'),'بندان في الخطة وحالتها «مسودة»');
  pop=await popupText(p,'[data-a="print-clubplan"]'); ok((await pop.innerText('body')).includes('خطة النادي الرياضي'),'طباعة خطة النادي');
  await p.click('[data-a="club-tab"][data-v="exec"]'); await p.click('[data-a="exec-add"]'); await p.waitForSelector('#ex_pi');
  await p.selectOption('#ex_pi',{index:1}); await mbtn(p,'متابعة'); await p.waitForSelector('#d_title',{timeout:4000});
  ok((await p.inputValue('#d_title'))==='الدوري الرياضي','نموذج التوثيق يُملأ تلقائيًا من بند الخطة');
  await p.fill('#d_loc','الفناء'); await p.fill('#d_dur','يوم واحد'); await p.fill('#d_bcount','40');
  await p.check('#d_exec input[value="T1"]'); await p.fill('#d_obj','تعزيز اللياقة'); await p.fill('#d_steps','تقسيم الفرق');
  await mbtn(p,'حفظ التوثيق'); ok((await p.innerText('#acToast')).includes('صورة الشاهد الأول'),'منع الحفظ بلا صورة شاهد');
  await p.setInputFiles('#d_file',{name:'a.png',mimeType:'image/png',buffer:PNG}); await p.waitForTimeout(300);
  await mbtn(p,'حفظ التوثيق'); await p.waitForTimeout(1200);
  const up=await p.evaluate(()=>window.__uploads||[]); ok(up.length===1 && up[0].type==='image/jpeg' && /^activities\/S1\/first\/[^/]+\/.+\.jpg$/.test(up[0].path),'رُفعت صورة JPEG مضغوطة بالمسار الصحيح');
  const evs=await p.evaluate(()=>{ const d=window.__mockDB(); return Object.keys(d).filter(k=>/^activityEvents\//.test(k)).map(k=>Object.assign({id:k.split('/')[1]},d[k])); });
  ok(evs.length===1 && evs[0].approvalStatus==='approved' && evs[0].sourceType==='club' && evs[0].planItemId,'فعالية معتمدة مباشرة من الرائد');
  const sc=await p.evaluate(id=>window.__mockDB()['activityClubs/'+id],sportsId); ok(sc.plan.filter(x=>x.status==='executed').length===1 && sc.locked===true,'بند الخطة صار «مُنفَّذ»');
  await p.click('[data-a="club-tab"][data-v="att"]'); await p.waitForSelector('#attSel');
  ok((await p.isChecked('#clubBody input[data-seat="101"]')) && (await p.isChecked('#clubBody input[data-seat="102"]')),'الحضور التلقائي: أعضاء النادي المشاركون محضَّرون');
  await p.uncheck('#clubBody input[data-seat="102"]'); await p.click('[data-a="att-save"]'); await p.waitForTimeout(700);
  const att=await p.evaluate(id=>window.__mockDB()['activityEvents/'+id].attendance,evs[0].id); ok(att['101'].status==='present' && att['102'].status==='absent','حفظ الحضور');
  await p.click('[data-a="club-tab"][data-v="exec"]');
  p.__shot='/home/claude/out/activity-docform.png'; pop=await popupText(p,'[data-a="ev-print"]'); const dt=await pop.innerText('body'); const dh=await pop.content();
  ok(dt.includes('نموذج توثيق تنفيذ برنامج / مبادرة') && dt.includes('الدوري الرياضي') && dt.includes('هـ') && dt.includes('رائد النشاط') && dt.includes('قائد المدرسة'),'نموذج التوثيق المطبوع: عنوان وتاريخ هجري وتواقيع');
  ok(dh.includes('files.test/activities/S1/first/'),'صورة الشاهد في النموذج');
  ok(!dh.includes('crossorigin'),'الصور بلا crossorigin (تظهر بلا حاجة لإعداد CORS)');
  ok(!dh.includes('window.print()'),'زر طباعة واحد فقط (زر شريط المعاينة) وليس داخل النموذج');
  await save(p);

  /* ---- ٤) الأنشطة والمسار العام ---- */
  console.log('4. الأنشطة والمسار العام: القالب والنشر');
  await tab(p,'الأنشطة والمسار العام');
  ok((await p.$$('.ac-tabs.sub .ac-tab')).length===2 && (await body(p)).includes('فعاليات المسار العام') && (await body(p)).includes('الأنشطة المتاحة'),'تبويبان فرعيان');
  await p.click('[data-a="gen-tpl"]'); await okDlg(p); await p.waitForTimeout(900);
  const gen=await p.evaluate(()=>{ const d=window.__mockDB(); return Object.keys(d).filter(k=>/^activityGeneralEvents\//.test(k)).map(k=>Object.assign({id:k.split('/')[1]},d[k])); });
  ok(gen.length===14 && !gen.some(g=>g.templateId==='school_broadcast') && gen.find(g=>g.templateId==='national_day').responsibleClubName==='النادي الاجتماعي','القالب الوزاري: ١٤ فعالية بدون «الإذاعة المدرسية»');
  await p.click('[data-a="gen-tpl"]'); await p.waitForTimeout(500); ok((await p.innerText('#acToast')).includes('محمَّل بالكامل'),'لا تكرار للقالب');
  t=await body(p); ok(!t.includes('تسجيل التنفيذ') && (await p.$$('[data-a="gen-pub"]')).length===14,'بدل «تسجيل التنفيذ» زر «نشر نشاط متاح» لكل فعالية');
  const nat=gen.find(g=>g.templateId==='national_day'), fnd=gen.find(g=>g.templateId==='founding_day');
  await p.click('[data-a="gen-pub"][data-id="'+nat.id+'"]'); await p.waitForSelector('#pb_d');
  ok((await p.innerText('.ac-ov')).includes('الاحتفاء باليوم الوطني') && !(await p.$('#pb_m')),'نافذة النشر: الاسم والمجال معبّآن مسبقًا ولا تُطلب إلا الوصف وآخر موعد');
  await mbtn(p,'نشر للمعلمين'); ok((await p.innerText('#acToast')).includes('أكمل'),'يلزم الوصف والموعد');
  await p.evaluate(()=>{ window.__aiCalls=[]; });
  /* زر «اقترح وصفًا» بالذكاء الاصطناعي */
  ok((await p.$$('.ai-fill-ico')).length===1 && (await p.innerText('.ai-fill-ico'))==='✨' && (await p.$$('.ai-fill-bar')).length===0,'تظهر أيقونة ✨ صغيرة في زاوية حقل الوصف (لا زر نصي)');
  await p.click('.ai-fill-ico'); await p.waitForTimeout(600);
  { const calls = await p.evaluate(()=>window.__aiCalls);
    ok(calls.length===1 && calls[0][0]==='aiSuggest' && calls[0][1].kind==='open_activity_description' && calls[0][1].schoolId==='S1' && calls[0][1].title.includes('الاحتفاء باليوم الوطني') && calls[0][1].domain==='اجتماعي','يرسل العنوان والمجال فقط لدالة aiSuggest');
    ok(Object.keys(calls[0][1]).sort().join()==='domain,kind,schoolId,title','لا يُرسل أي حقل آخر (لا أسماء ولا بيانات شخصية)'); }
  ok((await p.inputValue('#pb_d')).includes('يُنفَّذ نشاط مناسب') && (await p.innerText('.ai-fill-note')).includes('راجعه') && (await p.innerText('.ai-fill-note')).includes('29'),'يُملأ الحقل بالاقتراح مع تنبيه المراجعة والمتبقي');
  await p.evaluate(()=>{ window.__aiFail=true; }); await p.fill('#pb_d','نص قديم');
  p.once('dialog',d=>d.accept()); await p.click('.ai-fill-ico'); await p.waitForTimeout(700);
  await okDlg(p).catch(()=>{});
  ok((await p.innerText('#acToast')).includes('الحد اليومي') && (await p.inputValue('#pb_d'))==='نص قديم','عند بلوغ الحد: رسالة واضحة والنص الحالي لا يُمسّ');
  await p.evaluate(()=>{ window.__aiFail=false; });
  await p.fill('#pb_d','نفّذ فقرة احتفالية في الطابور الصباحي'); await p.fill('#pb_dl','2099-01-01'); await mbtn(p,'نشر للمعلمين');
  t=await body(p); ok(t.includes('الاحتفاء باليوم الوطني') && t.includes('نفّذ فقرة احتفالية') && (await p.innerText('.ac-tabs.sub .ac-tab.on')).includes('الأنشطة المتاحة'),'بعد النشر ينتقل للتبويب الآخر «الأنشطة المتاحة»');
  ok((await p.$$('[data-a="open-add"]')).length===0,'لا زر «نشر نشاط متاح» داخل تبويب الأنشطة المتاحة');
  const oev=await p.evaluate(()=>{ const d=window.__mockDB(); const k=Object.keys(d).find(k=>/^actOpenEvents\//.test(k)); return Object.assign({id:k.split('/')[1]},d[k]); });
  ok(oev.deadlineMs>Date.now() && oev.generalEventId===nat.id && oev.domain==='اجتماعي' && oev.status==='open','النشاط المتاح: موعد بالميلي ثانية + ربط بفعالية المسار + المجال');
  await p.click('[data-a="gen-tab"][data-v="events"]');
  t=await body(p); ok(t.includes('منشور للتوثيق') && (await p.$$('[data-a="gen-pub"]')).length===13,'الفعالية المنشورة تظهر «منشور للتوثيق» ولا يتكرر زر النشر');
  // نشاط ثانٍ سينتهي موعده
  await p.click('[data-a="gen-pub"][data-id="'+fnd.id+'"]'); await p.waitForSelector('#pb_d'); await p.fill('#pb_d','فقرة عن التأسيس'); await p.fill('#pb_dl','2099-02-01'); await mbtn(p,'نشر للمعلمين');
  await save(p);

  console.log('4ب. الخطة العامة: اعتماد انتقائي');
  await tab(p,'الخطة العامة');
  let rows=await p.$$('[data-psel]'); ok(rows.length===2,'خانتا اختيار فقط للخطط ذات البنود (النادي الرياضي + المسار العام) من أصل ٨');
  ok((await p.$$('[data-a="plan-approve-sel"]')).length===0 && (await p.$$('[data-a="plan-submit-sel"]')).length===1,'الرائد يقدّم ولا يعتمد');
  pop=await popupText(p,'[data-a="print-genplan"]').catch(()=>null);
  ok((await p.innerText('#acToast')).includes('لا توجد خطط معتمدة'),'لا طباعة قبل اعتماد أي خطة');
  await p.check('[data-psel="c:'+sportsId+'"]'); await p.click('[data-a="plan-submit-sel"]'); await okDlg(p); await p.waitForTimeout(600);
  dbx=await dbAll(p); ok(dbx['activityClubs/'+sportsId].planState==='submitted' && dbx['activityConfig/S1_first'].generalState==='draft','قُدِّم النادي الرياضي فقط، والمسار العام بقي مسودة');
  await save(p); await p.context().close();
  p=await open(b,'activity.html','P1','schoolAdmin');
  ok((await p.innerText('.ac-tab:has-text("الخطة العامة")')).includes('١'),'شارة خطة بانتظار الاعتماد عند القائد');
  await tab(p,'الخطة العامة'); ok((await p.$$('[data-a="plan-approve-sel"]')).length===1 && (await p.$$('[data-psel]')).length===1,'القائد يرى المُقدَّم وحده');
  await p.check('[data-psel="c:'+sportsId+'"]'); await p.click('[data-a="plan-return-sel"]'); await p.waitForSelector('#mnDlgOv .mnI'); await p.fill('#mnDlgOv .mnI','أضيفوا بنودًا'); await p.click('#mnDlgOv .mnOk'); await p.waitForTimeout(700);
  dbx=await dbAll(p); ok(dbx['activityClubs/'+sportsId].planState==='draft' && dbx['activityClubs/'+sportsId].planReturnNote==='أضيفوا بنودًا' && (await body(p)).includes('أُعيدت للتعديل'),'إعادة للتعديل بسبب');
  await save(p); await p.context().close();
  p=await open(b,'activity.html','C1','teacher'); await tab(p,'الخطة العامة'); ok((await body(p)).includes('أضيفوا بنودًا'),'الرائد يرى سبب الإعادة');
  await p.check('[data-psel="c:'+sportsId+'"]'); await p.check('[data-psel="gen"]'); await p.click('[data-a="plan-submit-sel"]'); await okDlg(p); await p.waitForTimeout(600);
  await save(p); await p.context().close();
  p=await open(b,'activity.html','P1','schoolAdmin'); await tab(p,'الخطة العامة');
  await p.check('[data-psel="c:'+sportsId+'"]'); await p.click('[data-a="plan-approve-sel"]'); await okDlg(p); await p.waitForTimeout(600);
  dbx=await dbAll(p); ok(dbx['activityClubs/'+sportsId].planState==='approved' && dbx['activityClubs/'+sportsId].planApprovedByName==='قائد المدرسة' && dbx['activityConfig/S1_first'].generalState==='submitted','اعتُمد النادي الرياضي فقط وبقي المسار العام مُقدَّمًا');
  await save(p);
  pop=await popupText(p,'[data-a="print-genplan"]'); const gp=await pop.innerText('body');
  ok(gp.includes('الدوري الرياضي') && !gp.includes('الاحتفاء باليوم الوطني'),'الطباعة تتضمن المعتمد فقط');
  await p.check('[data-psel="gen"]'); await p.click('[data-a="plan-approve-sel"]'); await okDlg(p); await p.waitForTimeout(600);
  pop=await popupText(p,'[data-a="print-genplan"]'); ok((await pop.innerText('body')).includes('الاحتفاء باليوم الوطني'),'بعد اعتماد المسار العام يظهر في الطباعة');
  await save(p);
  // القائد للاطلاع إلا ما يخصه
  await tab(p,'الأندية'); ok((await p.$$('[data-a="club-add"]')).length===0,'القائد: لا إضافة نادٍ');
  await tab(p,'مجلس النشاط'); ok((await p.$$('[data-a="meeting-add"]')).length===0 && (await p.$$('[data-a="council-form"]')).length===1 && (await p.$$('[data-a="meeting-print"]')).length===2,'القائد: لا محاضر جديدة، ويبقى تشكيل المجلس والطباعة');
  await tab(p,'الأنشطة والمسار العام'); ok((await p.$$('[data-a="gen-add"]')).length===0 && (await p.$$('[data-a="gen-pub"]')).length===0,'القائد: لا إضافة ولا نشر');
  await p.context().close();

  /* ---- ٥) التكليف ---- */
  console.log('5. التكليف والتوثيق');
  p=await open(b,'activity.html','C1','teacher'); await tab(p,'التكليفات والأندية'); await p.click('[data-a="club-open"][data-id="__asg"]');
  ok((await p.$$('[data-a="as-tab"]')).length===0 && (await p.$$('[data-a="asg-add"]')).length===1,'التكليفات داخل بطاقة «التكليفات الرسمية» بلا تبويبات فرعية');
  await p.click('[data-a="asg-add"]'); await p.waitForSelector('#as_t'); await p.selectOption('#as_t','T1'); await p.selectOption('#as_c',{index:1});
  await p.fill('[data-f="name"]','يوم اللياقة البدنية'); await p.fill('[data-f="target"]','المتوسطة'); await p.fill('[data-f="kpi"]','مشاركة ١٠٠ طالب'); await p.fill('[data-f="timeline"]','الأسبوع الثامن');
  await p.click('#as_add'); await p.locator('[data-f="name"]').nth(1).fill('بطولة السباحة');
  await mbtn(p,'حفظ'); t=await body(p); ok(t.includes('بانتظار اعتماد قائد المدرسة') && t.includes('بطولة السباحة'),'تكليف بحالة «بانتظار الاعتماد»');
  ok((await p.$$('[data-a="asg-approve"]')).length===0,'الرائد لا يعتمد التكليف');
  await save(p); await p.context().close();
  p=await open(b,'myactivities.html','T1','teacher'); t=await body(p); ok(!t.includes('يوم اللياقة البدنية') && !t.includes('بطولة السباحة'),'المعلم لا يرى التكليف قبل اعتماد القائد (وبنود الخطة تصله مباشرة)'); await p.context().close();
  p=await open(b,'activity.html','P1','schoolAdmin'); ok((await p.innerText('.ac-tab:has-text("التكليفات والأندية")')).includes('١'),'شارة التكليفات المعلقة عند القائد على تبويب التكليفات والأندية'); await tab(p,'التكليفات والأندية'); await p.click('[data-a="club-open"][data-id="__asg"]');
  ok((await p.$$('[data-a="asg-add"]')).length===0 && (await p.$$('[data-a="asg-edit"]')).length===0,'القائد لا ينشئ ولا يعدّل التكليف');
  await p.click('[data-a="asg-approve"]'); await p.waitForTimeout(700); ok((await body(p)).includes('معتمد'),'اعتماد التكليف'); await save(p); await p.context().close();
  // جعل النشاط الثاني منتهي الموعد
  const fo=Object.keys(DB).find(k=>/^actOpenEvents\//.test(k)&&DB[k].title.includes('التأسيس')); DB[fo].deadlineMs=1000; DB[fo].deadline='2020-01-01';

  /* ---- المعلم ---- */
  p=await open(b,'myactivities.html','T1','teacher'); t=await body(p);
  ok(t.includes('يوم اللياقة البدنية') && t.includes('بطولة السباحة') && t.includes('القائد اعتمد'),'المعلم يرى التكليف المعتمد وشريط سير العمل');
  ok((await p.innerText('.ac-tab:has-text("تكاليفي")')).includes('٢'),'شارة ٢ برنامجان بلا توثيق');
  await p.click('[data-a="doc-asg"][data-i="0"]'); await p.waitForSelector('#d_title');
  ok((await p.inputValue('#d_title'))==='يوم اللياقة البدنية','العنوان من التكليف');
  await p.selectOption('#d_domain','رياضي'); await p.fill('#d_loc','الفناء'); await p.fill('#d_dur','يوم'); await p.fill('#d_bcount','120'); await p.fill('#d_obj','لياقة'); await p.fill('#d_steps','فرق');
  await p.check('#d_stu input[value="101"]').catch(()=>{}); await p.check('#d_stf input[value="T2"]'); await p.fill('#d_url','https://drive.test/x');
  await p.setInputFiles('#d_file',[{name:'a.png',mimeType:'image/png',buffer:PNG},{name:'b.png',mimeType:'image/png',buffer:PNG},{name:'c.png',mimeType:'image/png',buffer:PNG}]); await p.waitForTimeout(400);
  ok((await p.$$('#d_ph .p')).length===2,'حد أقصى صورتان لكل توثيق');
  await mbtn(p,'إرسال التوثيق للاعتماد'); await p.waitForTimeout(1200);
  t=await body(p); ok(t.includes('بانتظار اعتماد رائد النشاط'),'التوثيق بانتظار الاعتماد');
  // الأنشطة المتاحة
  await tab(p,'أنشطة متاحة');
  { const st = await p.evaluate(()=>({ n:document.querySelectorAll('.ac-fold').length, open:document.querySelectorAll('.ac-fold details[open]').length, tones:Array.from(document.querySelectorAll('.ac-fold')).map(x=>x.className), vis:Array.from(document.querySelectorAll('.ac-fold .ac-fin')).filter(x=>x.checkVisibility && x.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true})).length, stat:document.querySelectorAll('.ac-fold .ac-fst').length, btns:document.querySelectorAll('.ac-fold .ac-fact .ac-btn').length }));
    ok(st.n>=2 && st.open===0 && st.vis===0 && st.stat===st.n,'البطاقات مطويّة افتراضيًا: الوصف مخفي والحالة ظاهرة');
    ok(st.tones.some(c=>c.includes('t-info')) && st.tones.some(c=>c.includes('t-bad')),'لون البطاقة المطويّة بحسب حالتها (متاح/منتهي)');
    ok(st.btns>=1,'الأزرار ظاهرة والبطاقة مطويّة'); }
  t=await body(p);
  ok(t.includes('الاحتفاء باليوم الوطني') && t.includes('نفّذ فقرة احتفالية') && t.includes('آخر موعد للتوثيق'),'المعلم يرى وصف النشاط المتاح وموعده');
  ok(t.includes('انتهى موعد التوثيق') && (await p.$$('[data-a="doc-open"]')).length===1,'النشاط منتهي الموعد: «انتهى موعد التوثيق» ولا زر توثيق');
  ok((await p.innerText('.ac-tab:has-text("أنشطة متاحة")')).includes('١'),'الشارة تحتسب المتاح غير المنتهي فقط');
  await p.click('[data-a="doc-open"]'); await p.waitForSelector('#d_title');
  ok((await p.getAttribute('#d_title','readonly'))!==null && (await p.getAttribute('#d_domain','disabled'))!==null,'اسم النشاط والمجال مقفلان للمعلم');
  ok((await p.innerText('.ac-ov')).includes('نفّذ فقرة احتفالية') && (await p.inputValue('#d_domain'))==='اجتماعي','بيانات الرائد معروضة للاطلاع فقط');
  { const ovt = await p.innerText('.ac-ov');
    ok((await p.$('#d_exec'))===null && ovt.includes('للاطلاع فقط') && ovt.includes('لم يوثّق') && !ovt.includes('المعلم أحمد'),'المنفِّذون قائمة حالة للاطلاع فقط بلا اسم المعلم الحالي');
    ok(ovt.includes('اختر الصور التي تثبت وجود الموثَّقين'),'تنبيه صور الشواهد ظاهر');
    ok((await p.$$('#d_stf input')).length>0 && (await p.$('#d_stf input[value="T1"]'))===null,'قائمة المشاركين لا تحوي المعلم الحالي'); }
  await p.fill('#d_loc','المسرح'); await p.fill('#d_dur','يوم'); await p.fill('#d_bcount','300'); await p.fill('#d_obj','ترسيخ الانتماء'); await p.fill('#d_steps','فقرات احتفالية');
  await p.check('#d_stf input[value="T2"]');
  await p.setInputFiles('#d_file',{name:'a.png',mimeType:'image/png',buffer:PNG});
  { const mn=await p.getAttribute('#d_date','min'), mx=await p.getAttribute('#d_date','max'), td=await p.evaluate(()=>ACT.today());
    ok(mn===td && mx==='2099-01-01','تاريخ التنفيذ محصور بين يوم نشر النشاط وآخر موعد للتوثيق');
    await p.fill('#d_date','2000-01-01'); await mbtn(p,'إرسال التوثيق للاعتماد');
    ok((await p.innerText('#acToast')).includes('يوم نشر النشاط') && (await p.$('#d_title'))!==null,'تاريخ قبل يوم النشر: مرفوض');
    await p.fill('#d_date','2099-06-01'); await mbtn(p,'إرسال التوثيق للاعتماد');
    ok((await p.innerText('#acToast')).includes('آخر موعد للتوثيق') && (await p.$('#d_title'))!==null,'تاريخ بعد آخر موعد: مرفوض');
    await p.fill('#d_date',td); }
  await mbtn(p,'إرسال التوثيق للاعتماد'); await p.waitForTimeout(1500);
  dbx=await dbAll(p); ok(dbx['actOpenMarks/'+oev.id+'_T1'] && dbx['actOpenMarks/'+oev.id+'_T1'].state==='pending' && dbx['actOpenMarks/'+oev.id+'_T1'].name==='المعلم أحمد','سُجّلت علامة «وثّق» باسم المعلم');
  ok(dbx['actOpenMarks/'+oev.id+'_T2'] && dbx['actOpenMarks/'+oev.id+'_T2'].role==='participant' && dbx['actOpenMarks/'+oev.id+'_T2'].confirm==='invited' && dbx['actOpenMarks/'+oev.id+'_T2'].ownerId==='T1','دُعي المعلم المختار مشاركًا (بانتظار التأكيد)');
  t=await body(p); ok(!t.includes('من وثّق ومن لم يوثّق'),'حُذف مربع «من وثّق ومن لم يوثّق» من بطاقة المعلم');
  await save(p); await tab(p,'أنشطتي المنفذة'); t=await body(p); ok(t.includes('لا توجد أنشطة معتمدة') && !t.includes('الاحتفاء باليوم الوطني'),'أنشطتي المنفذة لا تعرض إلا المعتمد (المعلّق غير ظاهر)');
  await p.context().close();
  // الزميل المختار: دعوة، عرض الملف، اعتذار ثم تأكيد لاحق
  p=await open(b,'myactivities.html','T2','teacher'); await tab(p,'أنشطة متاحة'); t=await body(p);
  ok(t.includes('اختارك') && t.includes('أ/المعلم أحمد') && t.includes('بانتظار ردّك') && t.includes('أؤكد مشاركتي') && !t.includes('من وثّق ومن لم يوثّق'),'المختار يرى إشعار الاختيار داخل الصفحة');
  ok((await p.innerText('.ac-tab:has-text("أنشطة متاحة")')).includes('١'),'شارة الدعوة على تبويب الأنشطة المتاحة');
  ok((await p.$$('[data-a="doc-open"]')).length===0,'المدعو لا يقدر يوثّق النشاط بنفسه');
  { const pv = await popupText(p,'[data-a="part-view"]'); const pt = await pv.innerText('body');
    const prow = (pt.match(/المشاركون[^\n]*/)||[''])[0], erow = (pt.match(/المنفِّذ[^\n]*/)||[''])[0];
    ok(pt.includes('ترسيخ الانتماء') && erow.includes('أ/المعلم أحمد') && prow.includes('أ/المعلم خالد') && !prow.includes('المعلم أحمد'),'ملف التوثيق عند المشارك مطابق لما عند الموثِّق: المنفِّذ أحمد والمشارك خالد (بأ/) بلا خلط'); }
  await p.click('[data-a="part-decline"]'); await okDlg(p); await p.waitForTimeout(600);
  dbx=await dbAll(p); ok(dbx['actOpenMarks/'+oev.id+'_T2'].confirm==='declined','الاعتذار يرفع الاختيار');
  t=await body(p); ok((await p.$$('[data-a="doc-open"]')).length===1 && !t.includes('اختارك'),'بعد الاعتذار يقدر يوثّق بنفسه');
  await save(p); await p.context().close();

  /* ---- الرائد يراجع ---- */
  p=await open(b,'activity.html','C1','teacher');
  ok((await p.innerText('.ac-tab:has-text("التوثيقات")')).includes('٢'),'شارة التوثيقات المعلقة عند الرائد');
  await tab(p,'التوثيقات');
  const asgEv=await idOf(p,'activityEvents',"x.sourceType==='assignment'"), openEv=await idOf(p,'activityEvents',"x.sourceType==='open'");
  await p.click('[data-a="ev-return"][data-id="'+openEv+'"]'); await p.waitForSelector('#mnDlgOv .mnI'); await p.fill('#mnDlgOv .mnI','أضف صورة أوضح'); await p.click('#mnDlgOv .mnOk'); await p.waitForTimeout(800);
  dbx=await dbAll(p); ok((await body(p)).includes('أُعيد للتعديل') && dbx['actOpenMarks/'+oev.id+'_T1'].state==='returned' && dbx['activityGeneralEvents/'+nat.id].status==='planned','إعادة التوثيق تغيّر العلامة ولا تُنفِّذ الفعالية');
  await p.click('[data-a="ev-approve"][data-id="'+asgEv+'"]'); await p.waitForTimeout(700);
  await save(p); await p.context().close();
  p=await open(b,'myactivities.html','T1','teacher'); await tab(p,'أنشطة متاحة'); t=await body(p);
  ok(t.includes('أعاده رائد النشاط للتعديل') && t.includes('أضف صورة أوضح'),'المعلم يرى سبب الإعادة'); 
  await p.click('[data-a="doc-open"]'); await p.waitForSelector('#d_title');
  ok(!(await p.isChecked('#d_stf input[value="T2"]')),'من اعتذر لا يبقى محدّدًا تلقائيًا عند إعادة الإرسال');
  await p.check('#d_stf input[value="T2"]'); await mbtn(p,'حفظ التعديل'); await p.waitForTimeout(1200);
  dbx=await dbAll(p); ok(dbx['actOpenMarks/'+oev.id+'_T1'].state==='pending' && dbx['activityEvents/'+openEv].approvalStatus==='pending','إعادة الإرسال تعيد العلامة «بانتظار الاعتماد»');
  ok(dbx['actOpenMarks/'+oev.id+'_T2'].confirm==='invited' && dbx['actOpenMarks/'+oev.id+'_T2'].ownerId==='T1','أُعيدت دعوة من اعتذر');
  await save(p); await p.context().close();
  /* بوابة الاعتماد: لا يتفعّل والمشارك لم يرد */
  p=await open(b,'activity.html','C1','teacher'); await tab(p,'التوثيقات');
  ok((await p.$('[data-a="ev-approve"][data-id="'+openEv+'"]'))===null && (await p.$('button[disabled]:has-text("اعتماد")'))!==null && (await body(p)).includes('بانتظار: المعلم خالد'),'الاعتماد معطّل وبانتظار المشارك الذي لم يؤكد');
  await p.context().close();
  { const SNAP = JSON.parse(JSON.stringify(DB)), eKey='actOpenEvents/'+oev.id;
    // انتهى آخر موعد: يتفعّل الاعتماد ويُحذف من لم يؤكد
    DB[eKey].deadline='2020-01-01'; DB[eKey].deadlineMs=1000;
    p=await open(b,'activity.html','C1','teacher'); await tab(p,'التوثيقات');
    ok((await p.$('[data-a="ev-approve"][data-id="'+openEv+'"]'))!==null,'بعد انتهاء آخر موعد يتفعّل الاعتماد');
    await p.click('[data-a="ev-approve"][data-id="'+openEv+'"]'); await p.waitForTimeout(900); dbx=await dbAll(p);
    ok(dbx['activityEvents/'+openEv].approvalStatus==='approved' && !(dbx['activityEvents/'+openEv].participants||[]).some(x=>x.uid==='T2') && (dbx['activityEvents/'+openEv].partUids||[]).length===0 && dbx['actOpenMarks/'+oev.id+'_T2'].confirm==='released','بعد الموعد: يُحذف غير المؤكد من النموذج وتُرفع دعوته');
    await p.context().close();
    // اعتذار المشارك الوحيد: يتفعّل الاعتماد ويُحذف المعتذر
    DB = JSON.parse(JSON.stringify(SNAP)); DB['actOpenMarks/'+oev.id+'_T2'].confirm='declined';
    p=await open(b,'activity.html','C1','teacher'); await tab(p,'التوثيقات');
    ok((await p.$('[data-a="ev-approve"][data-id="'+openEv+'"]'))!==null,'إذا اعتذر الجميع (لا يوجد «لم يؤكد») يتفعّل الاعتماد');
    await p.click('[data-a="ev-approve"][data-id="'+openEv+'"]'); await p.waitForTimeout(900); dbx=await dbAll(p);
    ok(!(dbx['activityEvents/'+openEv].participants||[]).some(x=>x.uid==='T2') && dbx['actOpenMarks/'+oev.id+'_T2'].confirm==='declined','المعتذر يُحذف من النموذج');
    await p.context().close();
    DB = SNAP; }
  /* الختم والتوقيعان: القائد يرفع الختم (صورة) وتوقيعه (رسم)، والرائد يرفع توقيعه (صورة) */
  p=await open(b,'activity.html','P1','schoolAdmin'); await tab(p,'مجلس النشاط'); t=await body(p);
  ok(t.includes('الختم والتوقيعان') && (await p.$('[data-a="sig-set"][data-k="coord"]'))===null && (await p.$('[data-a="sig-set"][data-k="principal"]'))!==null && (await p.$('[data-a="sig-set"][data-k="stamp"]'))!==null,'القائد يرى خانتيه (الختم والتوقيع) ولا يرفع توقيع الرائد');
  await p.click('[data-a="sig-set"][data-k="stamp"]'); await p.waitForSelector('#sg_file');
  ok((await p.$('input[name="sg_m"]'))===null,'الختم صورة فقط (بلا خيار الرسم)');
  await p.setInputFiles('#sg_file',{name:'s.png',mimeType:'image/png',buffer:PNG}); await p.waitForTimeout(500);
  await mbtn(p,'حفظ');
  await p.click('[data-a="sig-set"][data-k="principal"]'); await p.waitForSelector('#sg_cv', {state:'attached'}); await p.check('input[name="sg_m"][value="draw"]');
  { const bx=await p.locator('#sg_cv').boundingBox(); await p.mouse.move(bx.x+20,bx.y+40); await p.mouse.down(); await p.mouse.move(bx.x+120,bx.y+90,{steps:6}); await p.mouse.move(bx.x+220,bx.y+30,{steps:6}); await p.mouse.up(); }
  ok(await p.isVisible('#sg_prev'),'الرسم باليد يظهر في المعاينة');
  await mbtn(p,'حفظ'); dbx=await dbAll(p);
  ok(dbx['activitySigns/S1_stamp'] && dbx['activitySigns/S1_stamp'].mode==='image' && dbx['activitySigns/S1_principal'] && dbx['activitySigns/S1_principal'].mode==='draw' && dbx['activitySigns/S1_principal'].uid==='P1','حُفظ الختم (صورة) وتوقيع القائد (رسم) بمؤشر ونسخة ثابتة');
  ok(Object.keys(dbx).filter(k=>/^activitySignVers\//.test(k)).length===2 && /^data:image\/png/.test(dbx[dbx['activitySigns/S1_principal'].verId ? 'activitySignVers/'+dbx['activitySigns/S1_principal'].verId : 'x'].data),'النسخ الثابتة PNG');
  await save(p); await p.context().close();
  p=await open(b,'activity.html','C1','teacher'); await tab(p,'مجلس النشاط'); t=await body(p);
  ok((await p.$('[data-a="sig-set"][data-k="coord"]'))!==null && (await p.$('[data-a="sig-set"][data-k="stamp"]'))===null && t.includes('مرفوع'),'الرائد يرفع توقيعه فقط ويرى الختم وتوقيع القائد مرفوعين');
  await p.click('[data-a="sig-set"][data-k="coord"]'); await p.waitForSelector('#sg_file');
  await p.setInputFiles('#sg_file',{name:'c.png',mimeType:'image/png',buffer:PNG}); await p.waitForTimeout(500); await mbtn(p,'حفظ'); dbx=await dbAll(p);
  ok(dbx['activitySigns/S1_first_coord'] && dbx['activitySigns/S1_first_coord'].uid==='C1','توقيع الرائد مرتبط بالرائد الحالي ولهذا الفصل');
  await save(p); await p.context().close();

  p=await open(b,'myactivities.html','T2','teacher'); await tab(p,'أنشطة متاحة'); await p.click('[data-a="part-confirm"]'); await p.waitForTimeout(700);
  dbx=await dbAll(p); ok(dbx['actOpenMarks/'+oev.id+'_T2'].confirm==='confirmed','تأكيد المشاركة');
  t=await body(p); ok(t.includes('أكّدت مشاركتك') && (await p.$$('[data-a="doc-open"]')).length===0,'بعد التأكيد: لا زر توثيق وتظهر حالة المشاركة');
  await save(p); await p.context().close();
  p=await open(b,'activity.html','C1','teacher'); await tab(p,'التوثيقات');
  await p.click('[data-a="ev-approve"][data-id="'+openEv+'"]'); await p.waitForTimeout(900);
  ok((await body(p)).includes('المعلم خالد') && (await body(p)).includes('أكّد'),'الرائد يرى حالة تأكيد المشارك في التوثيق');
  dbx=await dbAll(p); const gn=dbx['activityGeneralEvents/'+nat.id];
  ok(dbx['actOpenMarks/'+oev.id+'_T2'].state==='approved','اعتماد التوثيق يعتمد علامة المشارك المؤكِّد');
  ok(dbx['actOpenMarks/'+oev.id+'_T1'].state==='approved' && gn.status==='executed' && gn.executionEventId===openEv,'أول توثيق معتمد يجعل فعالية المسار العام «مُنفَّذة» تلقائيًا ومرتبطة');
  { const evd=dbx['activityEvents/'+openEv];
    ok(evd.sigVers && evd.sigVers.coord && evd.sigVers.principal && evd.sigVers.stamp,'عند الاعتماد نُسخت إشارات التوقيعين والختم داخل التوثيق');
    ok((evd.participants||[]).some(x=>x.uid==='T2'),'المشارك المؤكِّد يبقى في النموذج'); }
  await tab(p,'التوثيقات');
  { const pv=await popupText(p,'[data-a="ev-print"][data-id="'+openEv+'"]'); const h=await pv.content();
    ok((h.match(/data:image\/png/g)||[]).length>=3,'النموذج المعتمد يطبع توقيع الرائد وتوقيع القائد والختم');
    const pa=await popupText(p,'[data-a="ev-print"][data-id="'+asgEv+'"]'); const ha=await pa.content();
    ok(ha.includes('data:image/gif') && !ha.includes('drive.test') && !ha.includes('رابط الشواهد'),'رابط الشواهد لا يظهر في المعاينة ويبقى رمز QR فقط'); }
  await tab(p,'الأنشطة والمسار العام'); t=await body(p); ok(t.includes('✅ مُنفَّذ') && t.includes('عرض التفاصيل'),'تظهر الفعالية منفَّذة في تبويب الفعاليات');
  await p.click('[data-a="gen-tab"][data-v="open"]'); await p.evaluate(()=>document.querySelectorAll('.ac-fold details').forEach(d=>d.open=true)); await p.click('details.ac-acc summary >> nth=0'); t=await body(p);
  ok(t.includes('من وثّق') && t.includes('المعلم أحمد') && t.includes('مشارك مع أ/المعلم أحمد') && t.includes('انتهى الموعد'),'الرائد يرى من وثّق في الأنشطة المتاحة وحالة المنتهي');
  await p.click('[data-a="open-edit"] >> nth=0'); await p.waitForSelector('#op_d'); ok((await p.$$('.ai-fill-ico')).length===1,'تعديل النشاط المتاح: أيقونة الاقتراح موجودة'); ok((await p.$('#op_t'))===null,'تعديل النشاط المتاح: لا تعديل للاسم'); await mbtn(p,'إلغاء');
  await save(p); await p.context().close();

  /* ---- ٦) الإذاعة والتقارير ---- */
  console.log('6. الإذاعة والتقارير والملخص');
  p=await open(b,'activity.html','C1','teacher'); await tab(p,'الإذاعة'); await p.click('[data-a="bc-add"]'); await p.waitForSelector('#bc_s'); await p.fill('#bc_s','2026-10-18'); await mbtn(p,'إضافة');
  t=await body(p); ok(t.includes('الأسبوع ١') && t.includes('الخميس'),'أسبوع بخمسة أيام');
  await p.locator('[data-a="bc-edit"]').first().click(); await p.waitForSelector('#bc_r'); await p.selectOption('#bc_r',{label:'النادي الثقافي'}); await p.fill('#bc_t','استقبال الفصل'); await p.selectOption('#bc_a','T2'); await mbtn(p,'حفظ');
  t=await body(p); ok(t.includes('النادي الثقافي') && t.includes('استقبال الفصل'),'تعديل يوم الإذاعة');
  await tab(p,'التقارير'); await p.click('details.ac-acc >> nth=0 >> summary'); t=await body(p);
  ok(t.includes('المعلم أحمد') && t.includes('موثّق') && t.includes('تكليف غير موثّق') && !t.includes('غير منفّذ'),'شريط المعلم: موثّق / تكليف غير موثّق');
  ok(t.includes('بطولة السباحة') && t.includes('❌') && t.includes('✅'),'يظهر الموثّق ✅ وغير الموثّق ❌');
  pop=await popupText(p,'[data-a="print-genreport"]'); const rt=await pop.innerText('body');
  ok(rt.includes('التقرير العام للنشاط الطلابي') && rt.includes('ملخص رقمي') && rt.includes('نسبة تنفيذ خطط الأندية') && !rt.includes('بطاقة أداء'),'التقرير العام بملخص رقمي وبلا بطاقة الأداء');
  pop=await popupText(p,'[data-a="print-clubsdec"]'); ok((await pop.innerText('body')).includes('قرار تشكيل الأندية'),'قرار الأندية');
  await tab(p,'الملخص'); t=await body(p);
  ok(t.includes('نسبة تنفيذ الخطة') && t.includes('٥٠٪') && !t.includes('بطاقة أداء') && !t.includes('٥٥٠') && (await p.$$('[data-man]')).length===0,'الملخص: نسبة التنفيذ ٥٠٪ وبلا بطاقة الأداء ولا مؤشرات يدوية');
  ok(t.includes('الاحتفاء باليوم الوطني') && /وثّقه [١٢٣] معلم/.test(t),'الملخص بالنشاط وعدد المعلمين');
  await p.screenshot({path:'/home/claude/out/activity-summary.png',fullPage:true});
  await p.context().close();

  /* ---- ٧) وضع الاطلاع ---- */
  console.log('7. وضع الاطلاع');
  p=await open(b,'activity.html','R1','teacher'); t=await body(p);
  ok(t.includes('وضع الاطلاع'),'تنبيه وضع الاطلاع');
  await tab(p,'التكليفات والأندية'); ok((await p.$$('[data-a="club-add"]')).length===0,'لا زر إضافة نادٍ'); await p.click('[data-a="club-open"][data-id="__asg"]'); ok((await p.$$('[data-a="asg-add"]')).length===0,'لا زر تكليف');
  await tab(p,'مجلس النشاط'); ok((await p.$$('[data-a="council-form"]')).length===0 && (await p.$$('[data-a="meeting-add"]')).length===0,'لا تشكيل ولا اجتماع'); await p.context().close();

  console.log('8. لوحتي في index.html');
  const idx=fs.readFileSync(__dirname+'/../index.html','utf8');
  ok(/key:'activities', href:'myactivities.html'/.test(idx) && /key:'actcoord', href:'activity.html'/.test(idx) && /activityCouncil/.test(idx) && /deadlineMs/.test(idx),'لوحتي: بند الأنشطة اللاصفية + بند رائد النشاط + الموعد بالميلي ثانية');

  await b.close(); console.log(FAIL||ERRS?'FAILED '+FAIL+' / pageerrors '+ERRS:'ALL PASS'); process.exit(FAIL||ERRS?1:0);
})().catch(e=>{ console.error('CRASH',e); process.exit(2); });
