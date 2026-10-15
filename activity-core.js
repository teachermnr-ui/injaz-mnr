// إصدار: 2026-10-16.2
/* نواة منصة النشاط المدرسي — مشتركة بين activity.html (الرائد والمدير) وmyactivities.html (المعلم).
   تحوي: الثوابت (الأندية الوزارية، قالب المسار العام)، التاريخ الهجري (أم القرى)، تحميل البيانات وحفظها،
   النوافذ والاختيار المتعدد، ضغط الصور ورفعها إلى Firebase Storage، ونموذج توثيق التنفيذ المطبوع (QR + شواهد). */
(function(g){
  'use strict';
  const esc = s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const arN = n=>String(n).replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);
  const $ = (s,r)=>(r||document).querySelector(s);
  const $$ = (s,r)=>Array.from((r||document).querySelectorAll(s));

  /* ---------- الثوابت ---------- */
  const CLUBS_DEFAULT = [
    { key:'scout',    name:'النادي الكشفي',        domain:'النشاط الكشفي',        icon:'⚜️', dom:'كشفي' },
    { key:'sports',   name:'النادي الرياضي',       domain:'الرياضة والصحة',       icon:'🏅', dom:'رياضي' },
    { key:'social',   name:'النادي الاجتماعي',     domain:'المواطنة والحياة',     icon:'🤝', dom:'اجتماعي' },
    { key:'science',  name:'النادي العلمي',        domain:'العلوم والتقنية',      icon:'🔬', dom:'علمي' },
    { key:'art',      name:'النادي الفني',         domain:'الثقافة والفنون',      icon:'🎨', dom:'فني' },
    { key:'cultural', name:'النادي الثقافي',       domain:'الثقافة والفنون',      icon:'📚', dom:'ثقافي' },
    { key:'training', name:'نادي التدريب الطلابي', domain:'المواطنة والحياة',     icon:'🎓', dom:'تدريبي' }
  ];
  const DOMAINS = ['رياضي','اجتماعي','كشفي','علمي','فني','ثقافي','تدريبي'];
  const GENERAL_TEMPLATE = [
    { id:'national_day',     title:'الاحتفاء باليوم الوطني',          freq:'سنوي',  clubs:['social'] },
    { id:'vision_2030',      title:'رؤية المملكة ٢٠٣٠',               freq:'سنوي',  clubs:['training'] },
    { id:'traffic_safety',   title:'أسبوع المرور',                    freq:'سنوي',  clubs:['scout'] },
    { id:'volunteer_work',   title:'العمل التطوعي',                   freq:'فصلي',  clubs:['social'] },
    { id:'school_olympics',  title:'الأولمبياد المدرسي',              freq:'سنوي',  clubs:['sports'] },
    { id:'tree_week',        title:'أسبوع الشجرة',                    freq:'سنوي',  clubs:['science','scout'] },
    { id:'arabic_day',       title:'اليوم العالمي للغة العربية',      freq:'سنوي',  clubs:['cultural'] },
    { id:'anti_drugs',       title:'مكافحة المخدرات',                 freq:'سنوي',  clubs:['social','scout'] },
    { id:'anti_smoking',     title:'مكافحة التدخين',                  freq:'سنوي',  clubs:['sports','science'] },
    { id:'dental_health',    title:'صحة الأسنان',                     freq:'سنوي',  clubs:['science'] },
    { id:'civil_defense',    title:'اليوم العالمي للدفاع المدني',     freq:'سنوي',  clubs:['scout'] },
    { id:'disability_day',   title:'اليوم العالمي لذوي الإعاقة',      freq:'سنوي',  clubs:['social'] },
    { id:'flag_day',         title:'يوم العلم',                       freq:'سنوي',  clubs:['social','cultural'] },
    { id:'founding_day',     title:'يوم التأسيس',                     freq:'سنوي',  clubs:['social','cultural'] },
    { id:'school_broadcast', title:'الإذاعة المدرسية',                freq:'يومي',  clubs:['cultural'] }
  ];
  const DAYS = [['sunday','الأحد'],['monday','الاثنين'],['tuesday','الثلاثاء'],['wednesday','الأربعاء'],['thursday','الخميس']];
  const PLAN_ST = { planned:'مخطط', executed:'مُنفَّذ', cancelled:'ملغى' };
  const ST_CLS = { planned:'', executed:'ok', cancelled:'bad' };

  /* ---------- التاريخ ---------- */
  const pad = n=>String(n).padStart(2,'0');
  const today = ()=>{ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
  const addDays = (k,n)=>{ const d=new Date(k+'T12:00:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
  /* تقويم أم القرى: ٢٣/٠٣/١٤٤٧هـ */
  function hijri(k, long){
    if(!k) return '';
    try{
      const d = new Date(k+'T12:00:00');
      if(long) return arN(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'long',year:'numeric'}).format(d)).replace(/\s*هـ?$/,'')+'هـ';
      const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(d);
      const m = {}; parts.forEach(p=>{ m[p.type]=p.value; });
      return arN(m.day+'/'+m.month+'/'+m.year)+'هـ';
    }catch(e){ return k; }
  }
  const dayName = k=>{ try{ return new Date(k+'T12:00:00').toLocaleDateString('ar',{weekday:'long'}); }catch(e){ return ''; } };

  /* ---------- الأنماط المشتركة ---------- */
  const CSS = `
.ac-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px;border-bottom:1px solid var(--line)}
.ac-tab{flex:none;background:#fff;border:1.5px solid var(--line);color:var(--ink);padding:8px 14px;border-radius:10px;font:700 13.5px Tajawal,system-ui;white-space:nowrap}
.ac-tab.on{background:var(--brand);border-color:var(--brand);color:#fff}
.ac-tab .n{display:inline-block;min-width:18px;padding:0 5px;margin-inline-start:5px;background:#b42318;color:#fff;border-radius:9px;font-size:11px;line-height:18px;text-align:center}
.ac-btn{background:var(--brand);color:#fff;padding:8px 14px;border-radius:10px;font:700 13px Tajawal,system-ui}
.ac-btn.sec{background:#fff;color:var(--brand);border:1.5px solid var(--brand)}
.ac-btn.bad{background:#b42318}.ac-btn.sm{padding:5px 10px;font-size:12px}.ac-btn[disabled]{opacity:.5;cursor:not-allowed}
.ac-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ac-row.sb{justify-content:space-between}
.ac-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.ac-club{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff;box-shadow:var(--shadow)}
.ac-club .ic{font-size:26px}.ac-club h4{margin:4px 0 2px;font-size:15px}
.ac-tbl{width:100%;border-collapse:collapse;font-size:13px}
.ac-tbl th,.ac-tbl td{border:1px solid var(--line);padding:6px 8px;text-align:right;vertical-align:top}
.ac-tbl th{background:#eef5f4;font-weight:800}
.ac-wrap{overflow-x:auto}
.ac-in,.ac-sel,.ac-ta{width:100%;padding:8px 10px;border:1.5px solid var(--line);border-radius:9px;font:inherit;background:#fff;color:var(--ink)}
.ac-ta{min-height:80px;resize:vertical}
.ac-f{margin-bottom:10px}.ac-f>label{display:block;font-weight:700;font-size:12.5px;margin-bottom:3px;color:var(--muted)}
.ac-2c{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:560px){.ac-2c{grid-template-columns:1fr}}
.ac-ov{position:fixed;inset:0;z-index:900;background:rgba(15,23,42,.5);display:flex;align-items:flex-start;justify-content:center;padding:14px;overflow:auto}
.ac-md{background:#fff;border-radius:16px;width:100%;max-width:560px;margin:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}
.ac-md.wide{max-width:760px}
.ac-md>h3{margin:0;padding:12px 16px;background:var(--brand);color:#fff;font-size:15.5px}
.ac-md .bd{padding:14px 16px;max-height:68vh;overflow:auto}
.ac-md .ft{display:flex;gap:8px;justify-content:flex-start;padding:10px 16px;border-top:1px solid var(--line);background:#f8fbfa}
.ac-bar{height:12px;border-radius:7px;background:#e3ecea;overflow:hidden}.ac-bar>i{display:block;height:100%;background:var(--brand)}
.ac-pick{border:1.5px solid var(--line);border-radius:10px;padding:6px}
.ac-pick .list{max-height:190px;overflow:auto;margin-top:6px}
.ac-pick label{display:flex;gap:8px;align-items:center;padding:4px 6px;border-radius:7px;font-size:13px}
.ac-pick label:hover{background:#f1f6f5}
.ac-pick .cnt{font-size:12px;color:var(--muted)}
.ac-steps{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted);flex-wrap:wrap;margin:6px 0}
.ac-steps b{padding:2px 9px;border-radius:12px;background:#eef2f1}.ac-steps b.on{background:var(--brand-l);color:var(--brand-2)}
.ac-ro .ac-edit{display:none !important}
details.ac-acc{border:1px solid var(--line);border-radius:12px;background:#fff;margin-bottom:8px}
details.ac-acc>summary{cursor:pointer;padding:10px 12px;font-weight:700;display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}
details.ac-acc .in{padding:4px 12px 12px}
.ac-ph{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.ac-ph .p{position:relative;width:84px;height:84px;border-radius:9px;overflow:hidden;border:1px solid var(--line)}
.ac-ph .p img{width:100%;height:100%;object-fit:cover}
.ac-ph .p button{position:absolute;top:2px;left:2px;background:#b42318;color:#fff;border-radius:50%;width:20px;height:20px;font-size:12px;line-height:20px;padding:0}
`;
  function injectCss(){ if(document.getElementById('acCss')) return; const s=document.createElement('style'); s.id='acCss'; s.textContent=CSS; document.head.appendChild(s); }

  /* ---------- نافذة منبثقة ---------- */
  function modal(o){
    injectCss();
    const ov = document.createElement('div'); ov.className='ac-ov';
    ov.innerHTML = '<div class="ac-md'+(o.wide?' wide':'')+'"><h3>'+esc(o.title||'')+'</h3><div class="bd">'+(o.body||'')+'</div><div class="ft"></div></div>';
    const ft = $('.ft', ov);
    const api = { el:ov, close:()=>{ ov.remove(); }, q:s=>$(s,ov), qa:s=>$$(s,ov) };
    (o.buttons||[{label:'إغلاق'}]).forEach(b=>{
      const bt = document.createElement('button'); bt.type='button'; bt.className='ac-btn '+(b.cls||''); bt.textContent=b.label;
      bt.onclick = async ()=>{
        if(!b.onClick){ api.close(); return; }
        bt.disabled = true;
        try{ const r = await b.onClick(api); if(r!==false) api.close(); }
        catch(e){ console.error(e); toast(e&&e.message?e.message:'تعذّر الحفظ'); }
        bt.disabled = false;
      };
      ft.appendChild(bt);
    });
    ov.addEventListener('mousedown', e=>{ if(e.target===ov && o.dismiss!==false && !o.noDismiss) api.close(); });
    document.body.appendChild(ov);
    if(o.onOpen) o.onOpen(api);
    return api;
  }
  function toast(msg){
    let t = document.getElementById('acToast');
    if(!t){ t=document.createElement('div'); t.id='acToast'; t.style.cssText='position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#15242b;color:#fff;padding:10px 18px;border-radius:12px;z-index:3000;font:700 13.5px Tajawal,system-ui;max-width:90vw;text-align:center'; document.body.appendChild(t); }
    t.textContent=msg; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>{ t.style.display='none'; },3200);
  }
  const confirmBox = msg=> (g.mnConfirm ? g.mnConfirm(msg) : Promise.resolve(g.confirm(msg)));

  /* ---------- اختيار متعدد بحث + علامات ---------- */
  /* items: [{id,name,sub}] — selected: Set/array — يعيد {get():[ids], el:html} عبر ACT.pickHtml + ACT.pickInit */
  function pickHtml(pid, items, selected, o){
    o = o||{}; const sel = new Set(selected||[]);
    return '<div class="ac-pick" id="'+pid+'" data-pick="1"><input class="ac-in" placeholder="'+esc(o.ph||'بحث بالاسم...')+'" data-pick-q>'
      +'<div class="cnt" data-pick-cnt></div><div class="list">'
      + items.map(it=>'<label data-n="'+esc((it.name||'')+' '+(it.sub||''))+'"><input type="checkbox" value="'+esc(it.id)+'"'+(sel.has(it.id)?' checked':'')+(o.single?' data-single':'')+'><span>'+esc(it.name)+(it.sub?' <span class="cnt">'+esc(it.sub)+'</span>':'')+'</span></label>').join('')
      + (items.length?'':'<div class="cnt">لا توجد خيارات.</div>')+'</div></div>';
  }
  function pickInit(root, pid){
    const box = $('#'+pid, root); if(!box) return;
    const cnt = ()=>{ $('[data-pick-cnt]',box).textContent = 'المحدد: '+arN($$('input[type=checkbox]:checked',box).length); };
    $('[data-pick-q]',box).addEventListener('input', e=>{
      const q = e.target.value.trim();
      $$('label',box).forEach(l=>{ l.style.display = (!q || l.dataset.n.includes(q)) ? '' : 'none'; });
    });
    box.addEventListener('change', e=>{
      if(e.target.hasAttribute('data-single') && e.target.checked) $$('input[type=checkbox]',box).forEach(c=>{ if(c!==e.target) c.checked=false; });
      cnt();
    });
    cnt();
  }
  const pickGet = (root,pid)=>$$('#'+pid+' input[type=checkbox]:checked', root).map(c=>c.value);

  /* ---------- البيانات ---------- */
  const keyOf = (sid,period)=>sid+'_'+period;
  async function list(env, col, extra){
    let q = env.db.collection(col).where('schoolId','==',env.sid).where('period','==',env.period);
    (extra||[]).forEach(f=>{ q = q.where(f[0],f[1],f[2]); });
    const s = await q.get();
    return s.docs.map(d=>Object.assign({ id:d.id }, d.data()));
  }
  async function getDoc(env, col, id){
    /* استعلام بدل get مفرد: قراءة مستند غير موجود تُرفض بالقواعد (resource فارغ)، أما الاستعلام فيرجع فارغًا بسلام */
    const s = await env.db.collection(col).where('schoolId','==',env.sid).where('period','==',env.period).get();
    const d = s.docs.find(x=>x.id===id);
    return d ? Object.assign({ id:d.id }, d.data()) : null;
  }
  /* إنشاء (id فارغ → معرّف تلقائي) */
  async function create(env, col, data, id){
    const now = Date.now();
    const full = Object.assign({}, data, { schoolId:env.sid, period:env.period, createdAt:now, updatedAt:now, createdBy:env.me.id });
    const ref = id ? env.db.collection(col).doc(id) : env.db.collection(col).doc();
    await ref.set(full);
    return ref.id;
  }
  async function patch(env, col, id, data){
    await env.db.collection(col).doc(id).update(Object.assign({}, data, { updatedAt:Date.now() }));
  }
  /* عدّ سريع: يحمّل ثم يصفّي */
  const by = (arr, f)=>arr.reduce((m,x)=>{ const k=f(x); (m[k]=m[k]||[]).push(x); return m; },{});

  /* موظفو المدرسة: [{id,name,role,perms}] */
  const ROLE_NAMES = { schoolAdmin:'مدير', agent:'وكيل', counselor:'موجه طلابي', assistant:'مساعد إداري', teacher:'معلم' };
  async function loadStaff(env){
    const out = [];
    try{
      const snap = await g.UsersAPI.listSnap(env.sid);
      snap.forEach(d=>{
        const u = d.data(); const c = (u.schools||{})[env.sid];
        const isAdm = u.role==='schoolAdmin' && (u.adminSchools||[]).includes(env.sid);
        if(!isAdm && (!c || c.active===false)) return;
        out.push({ id:d.id, name:u.username||'', role:isAdm?'schoolAdmin':(c.role||''), perms:(c&&c.permissions)||{} });
      });
    }catch(e){ console.warn('staff', e); }
    out.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    return out;
  }
  /* روستر المدرسة: {classes:[{code,name}], students:[{seat,name,classCode}]} */
  async function loadRoster(env){
    try{
      const s = await env.db.collection('schoolData').doc('roster_'+env.sid).get();
      const d = s.exists ? JSON.parse(s.data().value||'{}') : {};
      return { classes:(d.classes||[]).map(c=>Object.assign({},c,{code:String(c.code)})), students:(d.students||[]).map(x=>Object.assign({},x,{seat:String(x.seat),classCode:String(x.classCode)})) };
    }catch(e){ return { classes:[], students:[] }; }
  }
  const classLabel = (roster,code)=>{ const c=roster.classes.find(x=>x.code===String(code)); return c ? (c.name||c.code) : String(code); };

  /* ---------- الصور: ضغط في المتصفح ثم رفع ---------- */
  const MAX_BYTES = 900*1024;
  function compress(file, maxDim, q){
    return new Promise((res,rej)=>{
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = ()=>{
        let w=img.width, h=img.height; const s=Math.min(1, (maxDim||1280)/Math.max(w,h)); w=Math.max(1,Math.round(w*s)); h=Math.max(1,Math.round(h*s));
        const c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(img,0,0,w,h);
        c.toBlob(b=>{ URL.revokeObjectURL(url); b?res(b):rej(new Error('تعذّر ضغط الصورة')); },'image/jpeg',q||0.7);
      };
      img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error('ملف الصورة غير صالح')); };
      img.src = url;
    });
  }
  async function compressFit(file){
    let q=0.72, dim=1280, b=await compress(file,dim,q);
    for(let i=0;i<4 && b.size>MAX_BYTES;i++){ q-=0.12; dim=Math.round(dim*0.82); b=await compress(file,dim,Math.max(0.35,q)); }
    if(b.size>MAX_BYTES) throw new Error('الصورة كبيرة جدًا حتى بعد الضغط، اختر صورة أخرى.');
    return b;
  }
  async function uploadPhoto(env, eventId, file){
    if(!g.firebase || !firebase.storage) throw new Error('خدمة رفع الصور غير متاحة.');
    const blob = await compressFit(file);
    const path = 'activities/'+env.sid+'/'+env.period+'/'+eventId+'/'+Date.now()+'_'+Math.random().toString(36).slice(2,7)+'.jpg';
    const ref = firebase.storage().ref(path);
    await ref.put(blob, { contentType:'image/jpeg' });
    const url = await ref.getDownloadURL();
    return { path, url };
  }

  /* ---------- نموذج توثيق التنفيذ (الإدخال) ---------- */
  /* يفتح نافذة توثيق: opts = {env, prefill:{title,domain,clubName}, source:{type,assignmentId,programIdx,openEventId,clubId}, existing, staff, roster, onSaved} */
  async function openDocForm(opts){
    const env = opts.env, ex = opts.existing || null;
    const staff = opts.staff || await loadStaff(env), roster = opts.roster || await loadRoster(env);
    const pre = Object.assign({ title:'', domain:'', date:today(), location:'', duration:'', objectives:'', executionSteps:'', evidenceUrl:'', beneficiaries:{type:'طلاب',count:''}, participants:[], executors:[{uid:env.me.id,name:env.me.name,type:'staff'}], photos:[] }, opts.prefill||{}, ex||{});
    let photos = (pre.photos||[]).slice();       // [{path,url}] محفوظة سابقًا
    const newFiles = [];                          // ملفات جديدة بالانتظار
    const pStu = (pre.participants||[]).filter(p=>p.type==='student').map(p=>p.uid);
    const pStf = (pre.participants||[]).filter(p=>p.type==='staff').map(p=>p.uid);
    const exSel = (pre.executors||[]).map(p=>p.uid);
    const stuItems = roster.students.map(s=>({ id:s.seat, name:s.name, sub:classLabel(roster,s.classCode) }));
    const stfItems = staff.map(s=>({ id:s.id, name:s.name, sub:ROLE_NAMES[s.role]||'' }));
    const body = `
      <div class="ac-f"><label>اسم البرنامج / المبادرة *</label><input class="ac-in" id="d_title" value="${esc(pre.title)}"></div>
      <div class="ac-2c">
        <div class="ac-f"><label>المجال *</label><select class="ac-sel" id="d_domain"><option value="">— اختر —</option>${DOMAINS.map(d=>'<option'+(pre.domain===d?' selected':'')+'>'+d+'</option>').join('')}</select></div>
        <div class="ac-f"><label>تاريخ التنفيذ *</label><input type="date" class="ac-in" id="d_date" value="${esc(pre.date)}"></div>
        <div class="ac-f"><label>مكان التنفيذ *</label><input class="ac-in" id="d_loc" value="${esc(pre.location)}"></div>
        <div class="ac-f"><label>مدة التنفيذ *</label><input class="ac-in" id="d_dur" placeholder="مثال: يوم واحد" value="${esc(pre.duration)}"></div>
      </div>
      <div class="ac-f"><label>المنفِّذون (من موظفي المدرسة) *</label>${pickHtml('d_exec', stfItems, exSel)}</div>
      <div class="ac-2c">
        <div class="ac-f"><label>نوع المستفيدين</label><select class="ac-sel" id="d_btype">${['طلاب','معلمون','أولياء أمور','مجتمع'].map(t=>'<option'+((pre.beneficiaries||{}).type===t?' selected':'')+'>'+t+'</option>').join('')}</select></div>
        <div class="ac-f"><label>عدد المستفيدين *</label><input type="number" min="0" class="ac-in" id="d_bcount" value="${esc((pre.beneficiaries||{}).count)}"></div>
      </div>
      <div class="ac-f"><label>الطلاب المشاركون (اختياري)</label>${pickHtml('d_stu', stuItems, pStu)}</div>
      <div class="ac-f"><label>المعلمون المشاركون (اختياري)</label>${pickHtml('d_stf', stfItems, pStf)}</div>
      <div class="ac-f"><label>الأهداف *</label><textarea class="ac-ta" id="d_obj">${esc(pre.objectives)}</textarea></div>
      <div class="ac-f"><label>خطوات التنفيذ / الوصف *</label><textarea class="ac-ta" id="d_steps">${esc(pre.executionSteps)}</textarea></div>
      <div class="ac-f"><label>صور الشواهد * (الأولى إلزامية، وحد أقصى صورتان — تُضغط تلقائيًا)</label>
        <input type="file" accept="image/*" id="d_file" multiple><div class="ac-ph" id="d_ph"></div></div>
      <div class="ac-f"><label>رابط الشواهد (اختياري — يُولَّد منه رمز QR في النسخة المطبوعة)</label><input class="ac-in" id="d_url" placeholder="https://" value="${esc(pre.evidenceUrl)}"></div>`;
    const m = modal({ title: ex?'تعديل توثيق التنفيذ':'توثيق التنفيذ', body, wide:true, noDismiss:true,
      buttons:[
        { label: ex?'حفظ التعديل':'إرسال التوثيق للاعتماد', onClick: async api=>{
          const v = id=>api.q('#'+id).value.trim();
          const miss = [];
          if(!v('d_title')) miss.push('اسم البرنامج'); if(!v('d_domain')) miss.push('المجال'); if(!v('d_date')) miss.push('التاريخ');
          if(!v('d_loc')) miss.push('مكان التنفيذ'); if(!v('d_dur')) miss.push('مدة التنفيذ'); if(!v('d_bcount')) miss.push('عدد المستفيدين');
          if(!v('d_obj')) miss.push('الأهداف'); if(!v('d_steps')) miss.push('خطوات التنفيذ');
          const execIds = pickGet(api.el,'d_exec'); if(!execIds.length) miss.push('المنفِّذون');
          if(photos.length+newFiles.length<1) miss.push('صورة الشاهد الأول');
          if(miss.length){ toast('أكمل الحقول: '+miss.join('، ')); return false; }
          const url = v('d_url'); if(url && !/^https?:\/\//i.test(url)){ toast('رابط الشواهد يجب أن يبدأ بـ http:// أو https://'); return false; }
          const nameOf = id=>(staff.find(s=>s.id===id)||{}).name||'';
          const stuName = seat=>(roster.students.find(s=>s.seat===seat)||{}).name||'';
          const execs = execIds.map(id=>({ uid:id, name:nameOf(id), type:'staff' }));
          const parts = pickGet(api.el,'d_stu').map(s=>({ uid:s, name:stuName(s), type:'student' }))
            .concat(pickGet(api.el,'d_stf').map(s=>({ uid:s, name:nameOf(s), type:'staff' })));
          const base = ex ? ex.id : env.db.collection('activityEvents').doc().id;
          const up = [];
          for(const f of newFiles){ up.push(await uploadPhoto(env, base, f)); }
          const data = {
            title:v('d_title'), domain:v('d_domain'), date:v('d_date'), location:v('d_loc'), duration:v('d_dur'),
            beneficiaries:{ type:api.q('#d_btype').value, count:Number(v('d_bcount'))||0 },
            participants:parts, executors:execs, participantCount:(Number(v('d_bcount'))||0),
            objectives:v('d_obj'), executionSteps:v('d_steps'), evidenceUrl:url, photos:photos.concat(up),
            executedBy:env.me.id, executedByName:env.me.name, description:v('d_steps')
          };
          if(ex){ await patch(env,'activityEvents',ex.id, Object.assign(data,{ approvalStatus: (opts.autoApprove?ex.approvalStatus:'pending'), returnNote:'' })); }
          else {
            const s = opts.source||{};
            await create(env,'activityEvents', Object.assign(data,{
              clubId:s.clubId||null, planItemId:s.planItemId||null, track:s.track||'specialized', sourceType:s.type||'open',
              generalEventId:s.generalEventId||null,
              assignmentId:s.assignmentId||null, programIdx:(s.programIdx==null?null:s.programIdx), openEventId:s.openEventId||null,
              documentedBy:env.me.id, documentedByName:env.me.name, status:'done',
              approvalStatus: opts.autoApprove?'approved':'pending',
              approvedBy: opts.autoApprove?env.me.id:null, approvedByName: opts.autoApprove?env.me.name:null, approvedAt: opts.autoApprove?Date.now():null
            }), base);
            if(opts.onCreated) await opts.onCreated(base);
          }
          toast(opts.autoApprove?'تم تسجيل الفعالية واعتمادها':'تم حفظ التوثيق وإرساله لرائد النشاط'); if(opts.onSaved) await opts.onSaved(); return true;
        } },
        { label:'إلغاء', cls:'sec' }
      ],
      onOpen: api=>{
        ['d_exec','d_stu','d_stf'].forEach(id=>pickInit(api.el,id));
        const draw = ()=>{
          const host = api.q('#d_ph'); host.innerHTML='';
          photos.forEach((p,i)=>{ const d=document.createElement('div'); d.className='p'; d.innerHTML='<img src="'+esc(p.url)+'"><button type="button" title="حذف">×</button>'; d.querySelector('button').onclick=()=>{ photos.splice(i,1); draw(); }; host.appendChild(d); });
          newFiles.forEach((f,i)=>{ const d=document.createElement('div'); d.className='p'; const u=URL.createObjectURL(f); d.innerHTML='<img src="'+u+'"><button type="button" title="حذف">×</button>'; d.querySelector('button').onclick=()=>{ newFiles.splice(i,1); draw(); }; host.appendChild(d); });
        };
        api.q('#d_file').addEventListener('change', e=>{
          Array.from(e.target.files||[]).forEach(f=>{ if(photos.length+newFiles.length<2) newFiles.push(f); else toast('الحد الأقصى صورتان لكل توثيق.'); });
          e.target.value=''; draw();
        });
        draw();
      }
    });
    return m;
  }

  /* ---------- نموذج التوثيق المطبوع ---------- */
  function qrImg(url){
    try{ if(!url || typeof g.qrcode!=='function') return ''; const q=g.qrcode(0,'M'); q.addData(url); q.make(); return q.createDataURL(4,2); }catch(e){ return ''; }
  }
  function docFormBody(ev, o){
    o = o||{};
    const names = a=>(a||[]).map(x=>x.name).filter(Boolean).join('، ');
    const stuN = (ev.participants||[]).filter(p=>p.type==='student').length;
    const stfNames = names((ev.participants||[]).filter(p=>p.type==='staff'));
    const parts = [stuN?('طلاب (عددهم '+arN(stuN)+')'):'', stfNames].filter(Boolean).join(' — ') || '—';
    const ph = (ev.photos||[]).slice(0,2);
    const qr = qrImg(ev.evidenceUrl);
    const row = (k,v)=>'<tr><th style="width:30%">'+esc(k)+'</th><td>'+esc(v||'—')+'</td></tr>';
    return `<style>
.df{width:100%;border-collapse:collapse;font-size:14px;margin-top:6px}.df th,.df td{border:1.5px solid #17475e;padding:7px 10px;text-align:right}.df th{background:#eaf2f4}
.df .big{height:90px;vertical-align:top;white-space:pre-wrap}.dfp{display:flex;gap:14px;justify-content:center;padding:10px}.dfp .ph{width:46%;height:200px;border:1.5px dashed #17475e;display:flex;align-items:center;justify-content:center;color:#777;font-size:13px;overflow:hidden}
.dfp .ph img{width:100%;height:100%;object-fit:contain}.dfq{display:flex;gap:14px;align-items:center;padding:6px 10px;font-size:13px;word-break:break-all}.dfq img{width:90px;height:90px}
</style><table class="df">
${row('اسم البرنامج / المبادرة', ev.title)}
${row('المنفِّذ / المنفِّذون', names(ev.executors && ev.executors.length ? ev.executors : [{name:ev.documentedByName}]))}
${row('المشاركون', parts)}
${row('مكان التنفيذ', ev.location)}
${row('مدة التنفيذ', ev.duration)}
${row('تاريخ التنفيذ', hijri(ev.date,true)+(ev.date?' — الموافق '+arN(ev.date):''))}
${row('المجال', ev.domain)}
${row('المستفيدون / عددهم', ((ev.beneficiaries||{}).type||'')+' — '+arN((ev.beneficiaries||{}).count||0))}
<tr><th colspan="2">الأهداف</th></tr><tr><td colspan="2" class="big">${esc(ev.objectives)}</td></tr>
<tr><th colspan="2">خطوات التنفيذ / الوصف</th></tr><tr><td colspan="2" class="big">${esc(ev.executionSteps||ev.description)}</td></tr>
<tr><th colspan="2">الشواهد</th></tr>
<tr><td colspan="2"><div class="dfp">${[0,1].map(i=>'<div class="ph">'+(ph[i]?'<img src="'+esc(ph[i].url)+'" crossorigin="anonymous">':(i===0?'صورة الشاهد الأول':'صورة الشاهد الثاني (اختياري)'))+'</div>').join('')}</div>
${ev.evidenceUrl?'<div class="dfq">'+(qr?'<img src="'+qr+'" alt="QR">':'')+'<div>رابط الشواهد:<br>'+esc(ev.evidenceUrl)+'</div></div>':''}</td></tr>
</table>
<div class="fh-sig" style="margin-top:28px"><span>رائد النشاط: ${esc(o.coordinator||'')}<br><br>التوقيع: ____________</span><span>قائد المدرسة: ${esc(o.principal||'')}<br><br>التوقيع: ____________</span></div>`;
  }
  async function printDoc(env, ev, o){
    const w = window.open('','_blank'); if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة'); return; }
    w.document.write('<p style="font-family:Tahoma;padding:20px">جارٍ تجهيز النموذج...</p>');
    const ctx = await g.FormHdr.resolve({ db:env.db, session:env.session, period:env.period });
    const coord = ev.approvedByName || (o&&o.coordinator) || '';
    const html = g.FormHdr.doc({ title:'نموذج توثيق تنفيذ برنامج / مبادرة', formTitle:'نموذج توثيق تنفيذ برنامج / مبادرة', ctx, body:docFormBody(ev,{coordinator:coord, principal:ctx.principal}) });
    w.document.open(); w.document.write(html); w.document.close();
  }
  /* طباعة جدول عام بترويسة النموذج الموحدة */
  async function printPage(env, formTitle, body, opts){
    const w = window.open('','_blank'); if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة'); return; }
    w.document.write('<p style="font-family:Tahoma;padding:20px">جارٍ تجهيز النموذج...</p>');
    const ctx = await g.FormHdr.resolve({ db:env.db, session:env.session, period:env.period });
    const css = '.pt{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0}.pt th,.pt td{border:1.5px solid #17475e;padding:6px 9px;text-align:right}.pt th{background:#eaf2f4}.pp{font-size:15px;line-height:2;margin:8px 4px}';
    const html = g.FormHdr.doc(Object.assign({ title:formTitle, formTitle, ctx, body, extraCss:css }, opts||{}));
    w.document.open(); w.document.write(html); w.document.close();
    return ctx;
  }

  g.ACT = { esc, arN, $, $$, CLUBS_DEFAULT, DOMAINS, GENERAL_TEMPLATE, DAYS, PLAN_ST, ST_CLS, ROLE_NAMES,
    today, addDays, hijri, dayName, injectCss, modal, toast, confirmBox, pickHtml, pickInit, pickGet,
    keyOf, list, getDoc, create, patch, by, loadStaff, loadRoster, classLabel,
    compress, compressFit, uploadPhoto, openDocForm, docFormBody, printDoc, printPage, qrImg };
})(window);
