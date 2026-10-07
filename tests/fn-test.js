// Test index.js functions with mocked firebase-admin / firebase-functions
const Module = require('module');
const DB = {};
const authUsers = { U_live:{ disabled:false }, U_dis:{ disabled:true } };   // U_dead not present
function snap(p){ const d=DB[p]; return { id:p.split('/').pop(), exists: d!==undefined, data: ()=>d && JSON.parse(JSON.stringify(d)), ref: ref(p) }; }
function ref(p){ return { path:p, id:p.split('/').pop(), get: async()=>snap(p), update: async(u)=>{ Object.assign(DB[p], u); }, set: async(d)=>{ DB[p]=d; } }; }
function col(name, filters=[]){
  return {
    doc: id=>ref(name+'/'+id),
    where: (f,op,v)=>col(name, filters.concat([[f,op,v]])),
    add: async(d)=>{ const id='n'+Math.random().toString(36).slice(2,8); DB[name+'/'+id]=d; return ref(name+'/'+id); },
    get: async()=>{ const docs = Object.keys(DB).filter(k=>k.startsWith(name+'/') && k.split('/').length===2)
      .filter(k=>filters.every(([f,op,v])=>op==='=='?DB[k][f]===v:(op==='in'?v.includes(DB[k][f]):true))).map(snap);
      return { docs, empty:!docs.length }; }
  };
}
const firestore = ()=>({ collection: col, batch: ()=>{ const ops=[]; return { update:(r,u)=>ops.push([r,u]), commit: async()=>{ for(const [r,u] of ops) await r.update(u); } }; } });
firestore.FieldValue = { serverTimestamp: ()=>'TS', delete: ()=>undefined };
const adminMock = { initializeApp: ()=>{}, firestore, auth: ()=>({ getUser: async(uid)=>{ if(authUsers[uid]) return authUsers[uid]; const e=new Error('nf'); e.code='auth/user-not-found'; throw e; }, updateUser: async()=>{} }) };
const handlers = {};
const orig = Module._load;
Module._load = function(req, ...rest){
  if(req==='firebase-admin') return adminMock;
  if(req==='firebase-functions/v2/https') return { onCall: (a,b)=>{ const fn = b||a; return fn; }, HttpsError: class extends Error{} };
  if(req==='firebase-functions/v2/scheduler') return { onSchedule: (opt, fn)=>fn };
  if(req==='firebase-functions/params') return { defineSecret: ()=>({ value: ()=>'' }) };
  if(req==='nodemailer') return {};
  return orig.call(this, req, ...rest);
};
const F = require('/home/claude/injaz/injaz-classroom-backup-2026-09-23/index.js');
(async()=>{
  // المستخدمون
  DB['users/t1'] = { active:true, schools:{ S2:{ role:'teacher', active:true } } };            // باقٍ
  DB['users/t2'] = { active:true, schools:{ S2:{ role:'teacher', active:false } }, solo:{active:true} }; // أُوقف في S2
  DB['users/t3'] = { active:true, schools:{} };                                                // أُزيل من S2
  DB['users/t4'] = { active:true, solo:{ active:false } };                                     // انتهى الفردي
  DB['users/sa'] = { role:'schoolAdmin', adminSchools:['S2'], active:true };
  DB['schoolData/S2'] = { name:'s' };
  const W = (id, by, sid, st)=>{ DB['worksheets/'+id] = { createdBy:by, schoolId:sid, status:st, title:id, exercises:[1], assignedClassIds:['101'] }; };
  W('a','t1','S2','published'); W('b','t2','S2','published'); W('c','t3','S2','closed'); W('d','t4',null,'published'); W('e','sa','S2','published');
  W('f','t2',null,'published'); W('g','t9','S7','published'); W('h','t3','S2','draft');
  DB['submissions/x1'] = { worksheetId:'b', teacherUid:'t2', studentUid:'S' }; DB['submissions/x2'] = { worksheetId:'c', studentId:'1' };
  await F.archiveDepartedTeachers();
  const st = id=>DB['worksheets/'+id].status;
  console.log('statuses:', ['a','b','c','d','e','f','g','h'].map(i=>i+':'+st(i)).join(' '));
  console.log('expected: a:published b:archived c:archived d:archived e:published f:published g:archived h:draft');
  const copies = Object.entries(DB).filter(([k,v])=>k.startsWith('worksheets/') && v.copiedFrom).map(([k,v])=>v.copiedFrom+'->'+v.createdBy+':'+v.status);
  console.log('draft copies:', copies.sort().join(' '));
  console.log('subs:', JSON.stringify(DB['submissions/x1']), JSON.stringify(DB['submissions/x2']));
  // تشغيل ثانٍ لا يكرر
  const n1 = Object.keys(DB).filter(k=>k.startsWith('worksheets/')).length; await F.archiveDepartedTeachers();
  console.log('idempotent:', n1 === Object.keys(DB).filter(k=>k.startsWith('worksheets/')).length);
  // الاسترجاع
  DB['users/NEW'] = { email:'t@x.com', authUid:'NEW' };
  DB['users/OLD_DEAD'] = { email:'t@x.com', authUid:'U_dead' };      // محذوف من Auth
  DB['users/OLD_LIVE'] = { email:'t@x.com', authUid:'U_live' };      // حي — لا يُسترجع منه
  DB['users/OLD_MIG'] = { migratedTo:'NEW' };                          // مدموج
  W('r1','OLD_DEAD',null,'draft'); W('r2','OLD_LIVE',null,'draft'); W('r3','OLD_MIG','S2','published'); W('r4','OLD_MIG',null,'draft');
  DB['questionBank/q1'] = { createdBy:'OLD_DEAD' }; DB['questionBank/q2'] = { createdBy:'OLD_LIVE' };
  const res = await F.reclaimTeacherContent({ auth:{ uid:'NEW', token:{ email:'t@x.com', email_verified:true } }, data:{} });
  console.log('reclaim moved =', res.moved);
  console.log('owners:', ['r1','r2','r3','r4'].map(i=>i+':'+DB['worksheets/'+i].createdBy+'/'+DB['worksheets/'+i].status).join(' '), ' q1:', DB['questionBank/q1'].createdBy, ' q2:', DB['questionBank/q2'].createdBy);
  console.log('r3 copy owner:', Object.values(DB).filter(v=>v.copiedFrom==='r3').map(v=>v.createdBy).join(','));
  const unauth = await F.reclaimTeacherContent({ auth:null, data:{} }).catch(e=>'threw');
  console.log('unauthenticated ->', unauth);
})();
