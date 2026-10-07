// In-memory Firebase compat mock (Firestore + Auth) persisted in localStorage for reload tests.
(function(){
  const KEY='__mockdb';
  let DB = {};
  try{ DB = JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){ DB={}; }
  const persist = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(DB)); }catch(e){} };
  window.__mockDB = ()=>DB;
  window.__mockSet = (path, data)=>{ DB[path]=JSON.parse(JSON.stringify(data)); persist(); };
  window.__mockWrites = [];
  const listeners = {};
  const colListeners = [];   // {run} — أي كتابة تُعيد تشغيل كل استعلامات المجموعات الحيّة (تبسيط كافٍ للاختبار)
  function notify(path){ (listeners[path]||[]).forEach(cb=>{ try{ cb(snapOf(path)); }catch(e){} }); colListeners.forEach(l=>{ try{ l.run(); }catch(e){} }); }
  function snapOf(path){ const d=DB[path]; const id=path.split('/').pop();
    return { id, exists: d!==undefined, data: ()=> d===undefined?undefined:JSON.parse(JSON.stringify(d)), ref: docRef(path) }; }
  function setPath(obj, dotted, val){ const parts=dotted.split('.'); let o=obj; for(let i=0;i<parts.length-1;i++){ if(typeof o[parts[i]]!=='object'||o[parts[i]]===null) o[parts[i]]={}; o=o[parts[i]]; } o[parts[parts.length-1]]=val; }
  function write(path, data, merge){
    window.__mockWrites.push({ path, data: JSON.parse(JSON.stringify(data)), merge: !!merge, user: window.__mockUid });
    if(window.__mockDeny && window.__mockDeny(path, data)) throw Object.assign(new Error('Missing or insufficient permissions.'), {code:'permission-denied'});
    if(merge){ if(DB[path]===undefined) throw new Error('No document to update: '+path); const cur=DB[path]; Object.keys(data).forEach(k=>setPath(cur,k,JSON.parse(JSON.stringify(data[k])))); }
    else DB[path]=JSON.parse(JSON.stringify(data));
    persist(); notify(path);
  }
  function docRef(path){
    return {
      id: path.split('/').pop(), path,
      get: async()=>snapOf(path),
      set: async(d)=>write(path,d,false),
      update: async(d)=>write(path,d,true),
      delete: async()=>{ delete DB[path]; persist(); notify(path); },
      onSnapshot: (cb)=>{ (listeners[path]=listeners[path]||[]).push(cb); setTimeout(()=>cb(snapOf(path)),0); return ()=>{}; },
      collection: (name)=>colRef(path+'/'+name)
    };
  }
  function colRef(path, filters, order){
    filters = filters||[]; order = order||null;
    const q = {
      doc: (id)=>docRef(path+'/'+(id||('auto'+Math.random().toString(36).slice(2,10)))),
      where: (f,op,v)=>colRef(path, filters.concat([[f,op,v]]), order),
      orderBy: (f,dir)=>colRef(path, filters, [f, dir||'asc']),
      limit: (n)=>{ const c=colRef(path, filters, order); const g=c.get; c.get=async()=>{ const r=await g(); r.docs=r.docs.slice(0,n); r.empty=!r.docs.length; r.size=r.docs.length; return r; }; return c; },
      get: async()=>{
        const depth = path.split('/').length+1;
        let docs = Object.keys(DB).filter(k=>k.startsWith(path+'/') && k.split('/').length===depth)
          .filter(k=>filters.every(([f,op,v])=>{ const x=(DB[k]||{})[f]; return op==='==' ? x===v : (op==='array-contains' ? Array.isArray(x)&&x.includes(v) : true); }))
          .map(k=>snapOf(k));
        if(order){ const [f,dir]=order; docs = docs.slice().sort((a,b)=>{ const av=(a.data()||{})[f], bv=(b.data()||{})[f]; const c = av<bv?-1:(av>bv?1:0); return dir==='desc'?-c:c; }); }
        return { docs, empty: !docs.length, size: docs.length, forEach: f=>docs.forEach(f) };
      },
      add: async(d)=>{ const r=q.doc(); await r.set(d); return r; },
      onSnapshot: (cb, errCb)=>{
        const run = async()=>{ try{ cb(await q.get()); }catch(e){ if(errCb) errCb(e); } };
        const l = { run }; colListeners.push(l); run();
        return ()=>{ const i=colListeners.indexOf(l); if(i>=0) colListeners.splice(i,1); };
      }
    };
    return q;
  }
  const firestore = {
    collection: (n)=>colRef(n),
    runTransaction: async(fn)=>{
      const tx = { get: async(ref)=>snapOf(ref.path), set:(ref,d)=>write(ref.path,d,false), update:(ref,d)=>write(ref.path,d,true), delete:(ref)=>{ delete DB[ref.path]; persist(); } };
      return fn(tx);
    },
    batch: ()=>{
      const ops = [];
      return {
        set:(ref,d)=>ops.push(['set',ref,d]), update:(ref,d)=>ops.push(['update',ref,d]), delete:(ref)=>ops.push(['delete',ref]),
        commit: async()=>{ ops.forEach(([op,ref,d])=>{ if(op==='set') write(ref.path,d,false); else if(op==='update') write(ref.path,d,true); else { delete DB[ref.path]; persist(); notify(ref.path); } }); }
      };
    }
  };
  const authObj = { currentUser: null,
    onAuthStateChanged: (cb)=>{ setTimeout(()=>{ authObj.currentUser = window.__mockUid ? { uid: window.__mockUid } : null; cb(authObj.currentUser); }, 10); return ()=>{}; },
    signOut: async()=>{ authObj.currentUser=null; } };
  window.firebase = {
    initializeApp: ()=>({}),
    firestore: ()=>firestore,
    auth: ()=>authObj,
    functions: ()=>({ httpsCallable: ()=>async()=>({data:{}}) })
  };
  window.firebase.auth.EmailAuthProvider = { credential: ()=>({}) };
})();
