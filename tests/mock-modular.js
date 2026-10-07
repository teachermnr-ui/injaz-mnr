// ESM mock of Firebase modular SDK v10 (app/firestore/auth/functions) backed by localStorage '__mockdb'
const KEY='__mockdb';
function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){ return {}; } }
function save(DB){ localStorage.setItem(KEY, JSON.stringify(DB)); }
window.__mockDB = ()=>load();
window.__writes = window.__writes || [];
export function initializeApp(){ return {}; }
export function getFirestore(){ return {}; }
export function getAuth(){ return { get currentUser(){ return window.__mockUid ? { uid: window.__mockUid } : null; } }; }
export function onAuthStateChanged(auth, cb){ setTimeout(()=>cb(window.__mockUid ? { uid: window.__mockUid } : null), 5); return ()=>{}; }
export function getFunctions(){ return {}; }
export function httpsCallable(f, name){ return async(data)=>{ (window.__calls=window.__calls||[]).push(name); return { data: { moved: 0 } }; }; }
export function serverTimestamp(){ return Date.now(); }
export function arrayUnion(...v){ return { __arrayUnion: v }; }
export function collection(db, ...path){ return { kind:'col', path: path.join('/') }; }
export function doc(db, ...path){ if(db && db.kind==='col'){ return { kind:'doc', path: db.path+'/'+(path[0]||('auto'+Math.random().toString(36).slice(2,10))) }; } return { kind:'doc', path: path.join('/'), id: path[path.length-1] }; }
export function where(f, op, v){ return { f, op, v }; }
export function query(col, ...w){ return { kind:'query', path: col.path, w }; }
function snapOf(DB, p){ const d = DB[p]; return { id: p.split('/').pop(), exists: ()=>d!==undefined, data: ()=> d===undefined?undefined:JSON.parse(JSON.stringify(d)), ref: { kind:'doc', path:p } }; }
export async function getDoc(ref){ return snapOf(load(), ref.path); }
export async function getDocs(q){
  const DB = load(); const depth = q.path.split('/').length+1;
  const docs = Object.keys(DB).filter(k=>k.startsWith(q.path+'/') && k.split('/').length===depth).filter(k=>(q.w||[]).every(({f,op,v})=>{
    const x = DB[k][f];
    if(op==='==') return x===v;
    if(op==='array-contains') return Array.isArray(x) && x.includes(v);
    if(op==='array-contains-any') return Array.isArray(x) && x.some(e=>v.includes(e));
    if(op==='in') return v.includes(x);
    return true; })).map(k=>snapOf(DB,k));
  return { docs, empty: !docs.length, size: docs.length, forEach: fn=>docs.forEach(fn) };
}
function applyUpdate(cur, data){ Object.keys(data).forEach(k=>{ const v=data[k]; if(v && v.__arrayUnion){ cur[k]=[...new Set([...(cur[k]||[]), ...v.__arrayUnion])]; } else cur[k]=v; }); }
export async function addDoc(col, data){ const DB=load(); const id='auto'+Math.random().toString(36).slice(2,10); DB[col.path+'/'+id]=JSON.parse(JSON.stringify(data)); save(DB); window.__writes.push({op:'add', path:col.path+'/'+id, data}); return { id, path: col.path+'/'+id }; }
export async function setDoc(ref, data, opt){ const DB=load(); if(opt && opt.merge && DB[ref.path]) applyUpdate(DB[ref.path], data); else DB[ref.path]=JSON.parse(JSON.stringify(data)); save(DB); window.__writes.push({op:'set', path:ref.path, data}); }
export async function updateDoc(ref, data){ const DB=load(); if(!DB[ref.path]) throw new Error('no doc '+ref.path); applyUpdate(DB[ref.path], JSON.parse(JSON.stringify(data, (k,v)=>v))); save(DB); window.__writes.push({op:'update', path:ref.path, data}); }
export async function deleteDoc(ref){ const DB=load(); delete DB[ref.path]; save(DB); window.__writes.push({op:'delete', path:ref.path}); }
