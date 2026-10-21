/* إصدار: 2026-10-21.1 — طلبات الملفات: الوكيل يطلب، المعلم يرفع (PDF أو صور حتى ٢٫٥ ميجا)، الوكيل يعاين ويعتمد أو يعيد
   fileRequests/{sid}/items/{id}: {kind,title,period,gradesPeriod?,empId,empName,deadline,note,status('req'|'wait'|'ok'|'ret'),
     files:[{path,url,name,size,type,classLabel?}],createdAt,createdBy,uploadedAt,agentNote,reviewedAt,remindedAt}
   التخزين: fileRequests/{sid}/{id}/{اسم الملف} */
(function(g){
  const MAX = 2.5 * 1024 * 1024;
  const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|webp))$/;
  const KINDS = {
    visits:     { title:'الزيارات بين المعلمين',               multi:false },
    worklog:    { title:'سجل الأعمال',                         multi:false },
    completion: { title:'إكمال المنهج الدراسي',                multi:false },
    grades:     { title:'تحليل الدرجات',                       multi:true  },
    plan:       { title:'الخطة الفصلية لتوزيع المادة الدراسية', multi:false }
  };
  const ST = { req:'مطلوب', wait:'بانتظار الاعتماد', ok:'معتمد', ret:'معاد للتعديل' };
  const esc = s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const AR = n=>String(n).replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);
  const dateOf = ms=>{ try{ return new Date(ms).toLocaleDateString('ar-SA-u-ca-islamic-umalqura',{day:'numeric',month:'long',year:'numeric'}); }catch(e){ return ''; } };
  const col = (db,sid)=>db.collection('fileRequests').doc(sid).collection('items');
  const overdue = r=> (r.status==='req'||r.status==='ret') && r.deadline && Date.now() > r.deadline;
  const sizeText = b=> b>=1048576 ? AR((b/1048576).toFixed(1))+' ميجا' : AR(Math.max(1,Math.round(b/1024)))+' كيلو';
  function checkFile(f){
    if(!f) return 'لم يُختر ملف.';
    if(!OK_TYPES.test(f.type||'')) return 'النوع غير مقبول: المسموح PDF أو صورة (JPG أو PNG).';
    if(f.size > MAX) return 'حجم الملف أكبر من ٢٫٥ ميجا.';
    return '';
  }
  function chip(r){
    const od = r.status==='req' && overdue(r);
    const cls = r.status==='ok' ? 'ok' : (od||r.status==='ret') ? 'bad' : '';
    return '<span class="dh-chip '+cls+'">'+esc(od ? 'متأخر عن الموعد' : ST[r.status]||'')+'</span>';
  }
  function fileLinks(r){
    return (r.files||[]).map((f,i)=>'<a class="dh-link" href="'+esc(f.url)+'" target="_blank" rel="noopener">معاينة'+(r.files.length>1||f.classLabel?' ('+esc(f.classLabel||('ملف '+AR(i+1)))+')':'')+'</a>').join(' ');
  }

  /* ---------- طلب جديد (الوكيل) ---------- */
  async function create(db, sid, me, o){
    // o: {kind, period, gradesPeriod, empIds:[{id,name}], deadline(ms), note}
    const k = KINDS[o.kind]; if(!k) throw new Error('نوع ملف غير معروف');
    if(!o.empIds || !o.empIds.length) throw new Error('اختر معلمًا واحدًا على الأقل.');
    const batch = db.batch(), now = Date.now();
    o.empIds.forEach(e=>{
      const ref = col(db,sid).doc();
      batch.set(ref, {
        kind:o.kind, title:k.title + (o.kind==='grades' && o.gradesPeriod ? ' — ' + (o.gradesPeriod==='second'?'الفترة الثانية':'الفترة الأولى') : ''),
        period:o.period||'', gradesPeriod:o.gradesPeriod||'', empId:e.id, empName:e.name||'',
        deadline:o.deadline||0, note:o.note||'', status:'req', files:[], createdAt:now, createdBy:me.id
      });
    });
    await batch.commit();
    return o.empIds.length;
  }
  /* نافذة إنشاء الطلب. employees: [{id,name}]، existing: طلبات الفترة (لخيار «من لم يرفع») */
  function openCreate(host, ctx, kind, employees, existing, onDone, hooks){
    hooks = hooks||{};
    const k = KINDS[kind];
    existing = existing||[];
    const doneIds = new Set(existing.filter(r=>r.kind===kind && (r.status==='wait'||r.status==='ok')).map(r=>r.empId));
    host.innerHTML = '<div class="dh-card" id="frCreate"><h3>طلب ملف: '+esc(k.title)+'</h3>'
      + (kind==='grades' ? '<div style="margin:6px 0">الفترة: <label><input type="radio" name="frGP" value="first" checked> الأولى</label> <label><input type="radio" name="frGP" value="second"> الثانية</label></div>' : '')
      + '<div style="margin:6px 0">المستلمون: '
      + '<label><input type="radio" name="frTo" value="all" checked> الجميع</label> '
      + '<label><input type="radio" name="frTo" value="notyet"> من لم يرفع</label> '
      + '<label><input type="radio" name="frTo" value="pick"> معلمون محددون</label></div>'
      + '<div id="frPick" style="display:none;max-height:180px;overflow:auto;border:1px solid #cfd8dc;border-radius:8px;padding:6px;margin:6px 0">'
      + employees.map(e=>'<label style="display:block"><input type="checkbox" data-e="'+esc(e.id)+'"> '+esc(e.name)+'</label>').join('') + '</div>'
      + '<div style="margin:6px 0">آخر موعد للرفع: <input type="date" id="frDl"></div>'
      + '<div style="margin:6px 0"><textarea id="frNote" rows="2" style="width:100%" placeholder="ملاحظة للمعلم (اختياري، بأسلوب لطيف)"></textarea></div>'
      + '<div class="dh-links"><button class="dh-link" id="frSend" style="background:#0f766e;color:#fff">إرسال الطلب</button><button class="dh-link" id="frCancel">إلغاء</button></div>'
      + '<div id="frMsg" class="m"></div></div>';
    const q = s=>host.querySelector(s);
    host.querySelectorAll('input[name=frTo]').forEach(r=>r.onchange=()=>{ q('#frPick').style.display = r.value==='pick'&&r.checked ? 'block' : 'none'; });
    q('#frCancel').onclick = ()=>{ host.innerHTML=''; };
    q('#frSend').onclick = async ()=>{
      const to = host.querySelector('input[name=frTo]:checked').value;
      let list;
      if(to==='all') list = employees;
      else if(to==='notyet') list = employees.filter(e=>!doneIds.has(e.id));
      else { const ids = [...host.querySelectorAll('[data-e]:checked')].map(x=>x.dataset.e); list = employees.filter(e=>ids.includes(e.id)); }
      let skipped = 0;
      const gp0 = kind==='grades' ? host.querySelector('input[name=frGP]:checked').value : '';
      if(hooks.before){ const r = hooks.before(list, { kind, gp:gp0 }); list = r.list; skipped = r.skipped||0; }
      if(!list.length){ q('#frMsg').textContent = hooks.emptyMsg || 'لا يوجد من يُرسل إليه الطلب.'; return; }
      const dl = q('#frDl').value ? new Date(q('#frDl').value+'T23:59:59').getTime() : 0;
      const gp = kind==='grades' ? host.querySelector('input[name=frGP]:checked').value : '';
      q('#frSend').disabled = true;
      try{
        const n = await create(ctx.db, ctx.sid, ctx.me, { kind, period:ctx.period, gradesPeriod:gp, empIds:list, deadline:dl, note:q('#frNote').value.trim() });
        if(hooks.after) await hooks.after(list, { kind, gp });
        host.innerHTML = '';
        onDone && onDone(n, skipped);
      }catch(e){ q('#frMsg').textContent = e.message||String(e); q('#frSend').disabled = false; }
    };
  }

  /* ---------- المعلم: ملفات مطلوبة ---------- */
  async function uploadOne(ctx, r, file, classLabel){
    const err = checkFile(file); if(err) throw new Error(err);
    if(!g.firebase || !firebase.storage) throw new Error('خدمة رفع الملفات غير متاحة.');
    const safe = Date.now()+'_'+String(file.name||'file').replace(/[^\w.\-؀-ۿ]+/g,'_').slice(-60);
    const path = 'fileRequests/'+ctx.sid+'/'+r.id+'/'+safe;
    const ref = firebase.storage().ref(path);
    await ref.put(file, { contentType:file.type });
    const url = await ref.getDownloadURL();
    return { path, url, name:file.name||'', size:file.size, type:file.type, classLabel:classLabel||'' };
  }
  /* فصول المعلم من النسخة المنشورة للجدول (لاختيارها عند رفع تحليل الدرجات) */
  async function myClasses(db, sid, period, uid){
    try{
      const s = await db.collection('timetables').doc(sid).collection('data').doc(period+'_published').get();
      if(!s.exists) return [];
      const p = JSON.parse(s.data().value||'null') || {};
      const L = ((p.byUser||{})[uid]||{}).lessons || [];
      return [...new Set(L.map(l=>l.cl||l.c).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ar'));
    }catch(e){ return []; }
  }
  async function mountMine(host, ctx, onChange){
    if(!ctx.classes) ctx.classes = await myClasses(ctx.db, ctx.sid, ctx.period||'first', ctx.me.id);
    let rows = [];
    try{ const sn = await col(ctx.db,ctx.sid).where('empId','==',ctx.me.id).get(); rows = sn.docs.map(d=>({id:d.id,...d.data()})); }
    catch(e){ console.warn(e); }
    rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const open = rows.filter(r=>r.status==='req'||r.status==='ret');
    host.innerHTML = '<div class="dh-card" id="frMine"><h3>ملفات مطلوبة</h3>'
      + (rows.length ? '<div class="dh-list">' + rows.map(r=>{
          const can = r.status==='req'||r.status==='ret';
          return '<div class="dh-item" data-r="'+esc(r.id)+'"><div>'+esc(r.title)
            + '<div class="m">'+(r.deadline?'آخر موعد: '+esc(dateOf(r.deadline)):'دون موعد محدد')+(r.note?' · '+esc(r.note):'')+'</div>'
            + (r.status==='ret' && r.agentNote ? '<div class="m" style="color:#b91c1c">ملاحظة الوكيل: '+esc(r.agentNote)+'</div>' : '')
            + ((r.files||[]).length ? '<div class="m">'+fileLinks(r)+'</div>' : '')
            + '</div><div>'+chip(r)+(can?' <button class="dh-link" data-up="'+esc(r.id)+'">'+(r.status==='ret'?'رفع من جديد':'رفع الملف')+'</button>':'')+'</div></div>';
        }).join('') + '</div>' : '<div class="dh-empty">لا ملفات مطلوبة منك حاليًا.</div>')
      + '<div id="frUp"></div></div>';
    host.querySelectorAll('[data-up]').forEach(b=>b.onclick = ()=>uploadForm(host.querySelector('#frUp'), ctx, rows.find(x=>x.id===b.dataset.up), ()=>{ mountMine(host, ctx, onChange); onChange&&onChange(); }));
    return { total:rows.length, pending:open.length };
  }
  function uploadForm(box, ctx, r, done){
    const multi = KINDS[r.kind] && KINDS[r.kind].multi;
    box.innerHTML = '<div style="border-top:1px solid #cfd8dc;margin-top:10px;padding-top:10px"><b>'+esc(r.title)+'</b>'
      + '<div class="m">PDF أو صورة، وبحد أقصى ٢٫٥ ميجا للملف'+(multi?'، وملف لكل شعبة (اكتب الصف والشعبة بجوار كل ملف)':'')+'.</div>'
      + '<div id="frRows"></div>'
      + (multi ? '<button class="dh-link" id="frAdd">+ إضافة ملف آخر</button>' : '')
      + '<div class="dh-links" style="margin-top:8px"><button class="dh-link" id="frGo" style="background:#0f766e;color:#fff">إرسال للاعتماد</button><button class="dh-link" id="frX">إلغاء</button></div>'
      + '<div class="m" id="frErr" style="color:#b91c1c"></div></div>';
    const rowsEl = box.querySelector('#frRows');
    const addRow = ()=>{ const d = document.createElement('div'); d.style.margin='6px 0';
      d.innerHTML = (multi ? (ctx.classes && ctx.classes.length
          ? '<select class="frCls" style="margin-inline-end:6px"><option value="">— اختر الصف والشعبة —</option>'+ctx.classes.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select> '
          : '<input type="text" class="frCls" placeholder="الصف والشعبة (مثال: ٣/أ)" style="width:120px;margin-inline-end:6px"> ') : '')+'<input type="file" class="frFile" accept="application/pdf,image/jpeg,image/png,image/webp">';
      rowsEl.appendChild(d); };
    addRow();
    if(multi) box.querySelector('#frAdd').onclick = addRow;
    box.querySelector('#frX').onclick = ()=>{ box.innerHTML=''; };
    box.querySelector('#frGo').onclick = async ()=>{
      const err = box.querySelector('#frErr'); err.textContent = '';
      const items = [...rowsEl.children].map(d=>({ file:(d.querySelector('.frFile').files||[])[0], cls:(d.querySelector('.frCls')||{value:''}).value.trim() })).filter(x=>x.file);
      if(!items.length){ err.textContent = 'اختر ملفًا أولًا.'; return; }
      for(const it of items){ const e = checkFile(it.file); if(e){ err.textContent = e; return; } if(multi && !it.cls){ err.textContent = 'اكتب الصف والشعبة لكل ملف.'; return; } }
      box.querySelector('#frGo').disabled = true; err.textContent = 'جارٍ الرفع…';
      try{
        const files = [];
        for(const it of items) files.push(await uploadOne(ctx, r, it.file, it.cls));
        await col(ctx.db,ctx.sid).doc(r.id).update({ files, status:'wait', uploadedAt:Date.now() });
        done && done();
      }catch(e){ console.error(e); err.textContent = 'تعذّر الرفع: '+(e.message||e); box.querySelector('#frGo').disabled = false; }
    };
  }

  /* ---------- الوكيل: المراجعة ---------- */
  async function loadAll(db, sid, period){
    const sn = await col(db,sid).get();
    return sn.docs.map(d=>({id:d.id,...d.data()})).filter(r=>!period || !r.period || r.period===period);
  }
  async function review(db, sid, me, r, ok, note){
    await col(db,sid).doc(r.id).update({ status: ok?'ok':'ret', agentNote: ok?'':(note||''), reviewedAt:Date.now(), reviewedBy:me.id });
  }
  async function remind(db, sid, r){
    await col(db,sid).doc(r.id).update({ remindedAt:Date.now() });
  }

  g.FileReq = { KINDS, ST, MAX, checkFile, overdue, chip, fileLinks, create, openCreate, mountMine, uploadForm, loadAll, review, remind, col, sizeText, myClasses };
})(typeof window!=='undefined' ? window : globalThis);
