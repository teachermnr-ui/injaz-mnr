// اختبار منطق دوال الإشعارات (index.js) بمحاكاة firebase-admin وfirebase-functions في الذاكرة
const Module = require('module'); const path = require('path');
const STORE = {}; const SENT = []; let NOW = Date.parse('2026-10-05T03:50:00Z'); // 06:50 الرياض، الاثنين
const realNow = Date.now; Date.now = ()=>NOW;
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a){ if(!a.length) super(NOW); else super(...a); } static now(){ return NOW; } };
function FieldPath(...p){ this.p = p; }
const getF = (o, f)=>{ const parts = f instanceof FieldPath ? f.p : String(f).split('.'); return parts.reduce((x,k)=>x==null?undefined:x[k], o); };
function coll(name){
  const q = { name, filters:[], lim:null };
  const api = {
    doc(id){ id = id || ('auto'+Math.random().toString(36).slice(2)); const key = name+'/'+id;
      return { id, get: async()=>snap(key, id), set: async(v,o)=>{ const c=JSON.parse(JSON.stringify(v)); STORE[key]= (o&&o.merge&&STORE[key]) ? Object.assign({},STORE[key],c) : c; }, delete: async()=>{ delete STORE[key]; }, collection:(c)=>coll(key+'/'+c),
        ref:null }; },
    where(f, op, v){ const n = Object.assign({}, q); n.filters = q.filters.concat([[f,op,v]]); return mk(n); },
    limit(n){ const c = Object.assign({}, q); c.lim = n; return mk(c); },
    add: async(v)=>{ const id='auto'+Math.random().toString(36).slice(2); STORE[name+'/'+id]=JSON.parse(JSON.stringify(v)); return { id }; },
    get: async()=>run(q),
  };
  return api;
  function mk(qq){ const a = coll(name); a.where=(f,op,v)=>{ const n=Object.assign({},qq); n.filters=qq.filters.concat([[f,op,v]]); return mk(n); }; a.limit=(n)=>{ const c=Object.assign({},qq); c.lim=n; return mk(c); }; a.get=async()=>run(qq); return a; }
}
function snap(key, id){ const v = STORE[key]; return { id, exists: v!==undefined, data: ()=>v, ref:{ delete: async()=>{ delete STORE[key]; } } }; }
function run(q){
  const pre = q.name+'/'; let docs = Object.keys(STORE).filter(k=>k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k=>snap(k, k.slice(pre.length)));
  docs = docs.filter(d=>q.filters.every(([f,op,v])=>{ const x = getF(d.data(), f);
    if(op==='==') return x===v; if(op==='in') return v.includes(x); if(op==='array-contains') return Array.isArray(x) && x.includes(v); if(op==='<=') return x<=v; if(op==='>') return x>v; throw op; }));
  if(q.lim) docs = docs.slice(0, q.lim);
  return { docs, empty: !docs.length };
}
const firestoreFn = ()=>({ collection: coll, batch: ()=>({}) });
firestoreFn.FieldValue = { serverTimestamp:()=>0, delete:()=>null }; firestoreFn.FieldPath = FieldPath;
const adminMock = { initializeApp(){}, firestore: firestoreFn, auth: ()=>({}),
  messaging: ()=>({ sendEachForMulticast: async(m)=>{ SENT.push(m); return { successCount: m.tokens.length, responses: m.tokens.map(t=>t==='DEAD'?{ error:{ code:'messaging/registration-token-not-registered' } }:{}) }; } }) };
const h = (o, fn)=>fn || o;
const fnMock = { onCall:(a,b)=>b||a, HttpsError: Error, onSchedule:(o,fn)=>fn, onDocumentWritten:(o,fn)=>fn, onDocumentCreated:(o,fn)=>fn, defineSecret:()=>({ value:()=>'' }) };
const orig = Module._load;
Module._load = function(r){ if(r==='firebase-admin') return adminMock; if(r.startsWith('firebase-functions')) return fnMock; if(r==='nodemailer') return {}; return orig.apply(this, arguments); };
const F = require(path.resolve(process.argv[2]));
const wr0 = (b, a, params)=>({ params, data:{ before: b===null?{exists:false,data:()=>undefined}:{ exists:true, data:()=>b }, after: a===null?{exists:false,data:()=>undefined}:{ exists:true, data:()=>a } } });
const cr = (a, params)=>({ params, data:{ data:()=>a } });
let fails = 0; const ok = (c, m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) fails++; };
const take = ()=>SENT.splice(0);
const toksOf = (m)=>m.tokens.slice().sort().join(',');

const RUN = async()=>{ await F.pushWatcher(); NOW += 60000; return take(); };
const T = (v, rev, upd)=>({ value: JSON.stringify(v), rev: rev||1, updatedAt: upd });
(async()=>{
  STORE['pushTokens/TA']={ uid:'tA', authUid:'tA', sid:'S1' };
  STORE['pushTokens/TB']={ uid:'tB', authUid:'tB', sid:'S1' };
  STORE['pushTokens/TP']={ uid:'pr', authUid:'pr', sid:'S1' };
  STORE['pushTokens/TG']={ uid:'ag', authUid:'ag', sid:'S1' };
  STORE['pushTokens/DEAD']={ uid:'tB', authUid:'tB', sid:'S1' };
  STORE['users/pr']={ role:'schoolAdmin', adminSchools:['S1'] };
  STORE['users/ag']={ role:'teacher', schools:{ S1:{ role:'agent' } } };
  STORE['users/tA']={ schools:{ S1:{ role:'teacher' } } };
  STORE['schoolData/S1']={ _isSchool:true, name:'م', activePeriod:'first' };
  const TT = (id)=>'timetables/S1/data/'+id;
  const old = NOW - 3600e3;
  // بيانات قديمة موجودة قبل أول تشغيل: لا تُشعِر
  STORE[TT('first_published')] = T({ byUser:{ tA:{ sig:'a1' }, tB:{ sig:'b1' } } }, 1, old);
  STORE['notes/oldNote'] = { schoolId:'S1', fromUserId:'tA', recipients:['ag'], studentName:'قديم', createdAt: NOW-30000 };
  STORE['dutyPlans/S1_first_m'] = { schoolId:'S1', period:'first', members:['tA'], pub:{ at: old, members:['tA'], stageLabel:'م' } };

  console.log('0. أول تشغيل = خط أساس صامت');
  let s = await RUN(); ok(s.length===0, 'لا إشعارات عن الماضي (تحويل/جدول/مناوبة موجودة سلفًا)');
  s = await RUN(); ok(s.length===0, 'التشغيل الثاني بلا تغيير → صامت');

  console.log('1. الجدول المنشور');
  STORE[TT('first_published')] = T({ byUser:{ tA:{ sig:'a2' }, tB:{ sig:'b1' }, tC:{ sig:'c1' } } }, 2, NOW);
  STORE['pushTokens/TC']={ uid:'tC', authUid:'tC', sid:'S1' };
  s = await RUN();
  const ttl = (m)=>m.webpush.notification.title;
  ok(s.length===2 && s.some(m=>ttl(m)==='تغيّر جدولك الدراسي' && toksOf(m)==='TA') && s.some(m=>ttl(m)==='نُشر جدولك الدراسي' && toksOf(m)==='TC'), 'تعديل → من تغيّرت حصصه فقط، وجديد → «نُشر جدولك»');
  ok(s[0].webpush.fcmOptions.link==='https://injaz.awraqai.com/myschedule.html', 'الضغط يفتح «جدولي»');
  s = await RUN(); ok(s.length===0, 'لا تكرار');
  STORE['pushTokens/DEAD']&&0;

  console.log('2. الانتظار');
  const day = new Date(NOW+3*3600e3).toISOString().slice(0,10);
  const wd0 = { sent:false, items:[{ subUid:'tA', st:'m', p:2, cls:'1/1', clsLabel:'أول/١', subj:'رياضيات', absentName:'س' }] };
  STORE[TT('first_wday_'+day)] = T(wd0, 1, NOW);
  s = await RUN(); ok(s.length===0, 'قبل «اعتماد وإرسال» لا إشعار');
  const wd1 = Object.assign({}, wd0, { sent:true, sentAt:1 });
  STORE[TT('first_wday_'+day)] = T(wd1, 2, NOW);
  s = await RUN(); ok(s.length===1 && toksOf(s[0])==='TA' && ttl(s[0])==='حصة انتظار اليوم' && /الحصة الثالثة/.test(s[0].webpush.notification.body), 'عند الإرسال → البديل: «حصة انتظار اليوم — الحصة الثالثة»');
  STORE[TT('first_wday_'+day)] = T({ sent:true, sentAt:2, items: wd1.items.concat([{ subUid:'tB', st:'m', p:4, cls:'2/1' }]) }, 3, NOW);
  s = await RUN(); ok(s.length===1 && toksOf(s[0])==='DEAD,TB', 'إعادة إرسال بعد إضافة بديل → الجديد فقط');

  console.log('3. ساعات الهدوء');
  STORE['schoolCalendar/S1'] = { quiet:{ on:true, from:'21:00', to:'09:00' }, holidays:[] };   // الآن ٠٧:٠٠–٠٧:٥٠ → داخلها
  STORE['notes/n1'] = { schoolId:'S1', fromUserId:'tA', fromName:'أحمد', recipients:['ag','tA'], studentName:'خالد', className:'أول/١', createdAt: NOW-1000 };
  s = await RUN(); ok(s.length===0 && Object.keys(STORE).some(k=>k.startsWith('pushQueue/')), 'داخل الهدوء → يُؤجَّل في الطابور');
  NOW = Date.parse('2026-10-05T06:01:00Z'); await F.flushPushQueue(); s = take();
  ok(s.length===1 && toksOf(s[0])==='TG' && ttl(s[0])==='تحويل جديد' && s[0].webpush.fcmOptions.link.endsWith('index.html?tab=received'), 'بعد انتهائها يُرسل للمستلم (لا للمرسل)');
  STORE['schoolCalendar/S1'].quiet.on = false;
  s = await RUN(); ok(s.length===0, 'التحويل لا يتكرر');

  console.log('4. التعاميم');
  STORE['circulars/S1/items/c1'] = { mandatory:true, number:7, title:'تعميم', recipients:['tA','pr'], createdBy:'pr', createdAt: NOW-500 };
  STORE['circulars/S1/items/c2'] = { mandatory:false, recipients:['tA'], createdAt: NOW-400 };
  STORE['circulars/S1/items/c3'] = { mandatory:true, source:'duty', recipients:['tA'], createdAt: NOW-300 };
  s = await RUN(); ok(s.length===1 && toksOf(s[0])==='TA' && /رقم ٧/.test(s[0].webpush.notification.body), 'إلزامي → المستلمون عدا المنشئ؛ الاختياري وتعميم المناوبة بلا إشعار');
  s = await RUN(); ok(s.length===0, 'بلا تكرار');

  console.log('5. المناوبة والزيارات');
  STORE['dutyPlans/S1_first_m'] = { schoolId:'S1', period:'first', members:['tA','tB'], pub:{ at: NOW, members:['tA','tB'], stageLabel:'المتوسطة', circular:{ number:9 } } };
  s = await RUN(); ok(s.length===1 && toksOf(s[0])==='TA,TB' && /التعميم رقم ٩/.test(s[0].webpush.notification.body), 'اعتماد → المكلَّفون + رقم التعميم');
  s = await RUN(); ok(s.length===0, 'بلا اعتماد جديد → صامت');
  const dd = new Date(NOW+3*3600e3).toISOString().slice(0,10);
  STORE['classVisits/v1'] = { kind:'plan', schoolId:'S1', period:'first', teacherId:'tA', v1:{ date:dd, p:3, cls:'أول/١' }, updatedAt: NOW };
  s = await RUN(); ok(s.length===1 && toksOf(s[0])==='TA' && /الزيارة الأولى: اليوم — الحصة الرابعة/.test(s[0].webpush.notification.body), 'زيارة → المعلم');
  s = await RUN(); ok(s.length===0, 'الزيارة لا تتكرر');
  STORE['classVisits/v1'] = { kind:'plan', schoolId:'S1', period:'first', teacherId:'tA', v1:{ date:dd, p:3, cls:'أول/١' }, v2:{ date:dd, p:1, cls:'ثاني' }, updatedAt: NOW };
  s = await RUN(); ok(s.length===1 && /الزيارة الثانية/.test(s[0].webpush.notification.body) && !/الأولى/.test(s[0].webpush.notification.body), 'إضافة الزيارة الثانية → هي فقط');

  console.log('6. تنبيه الغياب');
  STORE['attAlerts/al1'] = { schoolId:'S1', name:'خالد', className:'أول/١', byName:'أحمد', ts: NOW-200, resolved:false };
  s = await RUN(); ok(s.length===1 && toksOf(s[0])==='TG,TP' && s[0].webpush.fcmOptions.link.endsWith('tab=absence'), 'المدير والوكيل فقط');
  s = await RUN(); ok(s.length===0, 'بلا تكرار');

  console.log('7. التذكير الصباحي');
  STORE[TT('first_published')] = T({ byUser:{ tA:{ sig:'a2', lessons:[{ d:1, p:0 },{ d:1, p:3, n:2 },{ d:2, p:1 }] } } }, 9, NOW);
  STORE['dutyPlans/S1_first_m'] = { schoolId:'S1', period:'first', pub:{ dutyDays:{ [dd]:['tA'] }, sup:{ 1:{ break_3:{ pl1:['tB'] } } }, events:[{ key:'break_3', label:'الفسحة' }], places:[{ id:'pl1', name:'الساحة' }] } };
  STORE[TT('first_wday_'+dd)] = T({ sent:true, items:[{ subUid:'tA', p:2 }] }, 9, NOW);
  STORE['classVisits/v1'] = { kind:'plan', schoolId:'S1', period:'first', teacherId:'tA', v1:{ date:dd, p:3 } };
  STORE['guidanceAppointments/a1'] = { schoolId:'S1', byUserId:'ag', date:dd, time:'09:30', status:'scheduled' };
  NOW = Date.parse('2026-10-05T03:50:00Z');
  await F.morningReminder(); s = take();
  const byT = {}; s.forEach(m=>m.tokens.forEach(t=>byT[t]=m.webpush.notification.body));
  ok(byT.TA==='اليوم: مناوبة · ٣ حصص · انتظار الحصة الثالثة · زيارة صفية الحصة الرابعة', 'معلم: '+byT.TA);
  ok(byT.TB==='اليوم: إشراف الفسحة (الساحة)', 'مشرف: '+byT.TB);
  ok(byT.TG==='اليوم: موعد ولي أمر ٩:٣٠ ص', 'وكيل: '+byT.TG);
  ok(!byT.TP, 'المدير بلا شيء اليوم → لا تذكير');
  STORE['schoolCalendar/S1'].holidays = [{ from:'2026-10-04', to:'2026-10-06', label:'إجازة' }];
  await F.morningReminder(); ok(take().length===0, 'يوم إجازة → لا تذكير');
  console.log(fails ? '✗ FAILS: '+fails : 'ALL PASS');
})().catch(e=>{ console.error(e); process.exit(1); });
