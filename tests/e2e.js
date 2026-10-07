const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:8765/';
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const XLSX_STUB = `window.XLSX={utils:{aoa_to_sheet:()=>({}),book_new:()=>({}),book_append_sheet:()=>{},sheet_to_json:()=>window.__xlsxRows||[]},read:()=>({SheetNames:['a'],Sheets:{a:{}}}),writeFile:()=>{window.__xlsxWritten=true;}};`;
const out = (...a)=>console.log(...a);
const SHOTS = '/tmp/claude-0/tt/shots/'; fs.mkdirSync(SHOTS,{recursive:true});

function seedDB(){
  const DB = {};
  const perms = (extra)=>Object.assign({ 'omr.classes':{access:true,edit:true,del:true} }, extra||{});
  DB['users/adm'] = { role:'admin', username:'أدمن النظام', authUid:'U_ADM', active:true };
  DB['users/sa1'] = { role:'schoolAdmin', username:'ياسر الجميعي', authUid:'U_SA1', adminSchools:['S2'], active:true };
  const staff = [['u1','محمد نجيب','1001','teacher'],['u2','سامي خان','1002','teacher'],['u3','أحمد الخلاف','1003','teacher'],['u4','منير النمري','1004','agent'],['u5','خالد سعيد','1005','teacher']];
  staff.forEach(([id,n,nid,role])=>{ DB['users/'+id] = { username:n, loginId:nid, authUid:'U_'+id, active:true,
    schools:{ S2:{ role, permissions: perms(), assignedClasses: role==='agent'?['__all__']:['م1أ'], subjectAssignments: id==='u1'?[{classCode:'م1أ',subject:'الرياضيات'}]:[], active:true } } }; });
  DB['users/ag1'] = { username:'موظف مشاهد', loginId:'1009', authUid:'U_ag1', active:true, schools:{ S2:{ role:'counselor', permissions:{ 'tools.timetable':{access:true,edit:false,del:false} }, assignedClasses:[], active:true } } };
  DB['users/pend1'] = { username:'معلم لم يفعّل', loginId:'1006', role:'teacher', schoolId:'S2', active:true };
  DB['schoolData/S2'] = { name:'مدرسة الاختبار', code:'1234', _isSchool:true, active:true };
  const classes = [
    ['أول متوسط','م1أ','متوسطة'],['أول متوسط','م1ب','متوسطة'],['ثاني متوسط','م2أ','متوسطة'],['ثاني متوسط','م2ب','متوسطة'],['ثالث متوسط','م3أ','متوسطة'],
    ['أول ثانوي','101','ثانوية'],['أول ثانوي','102','ثانوية'],['ثاني ثانوي','201','ثانوية','عام'],['ثاني ثانوي','ح201','ثانوية','علوم الحاسب والهندسة']
  ].map(([name,code,stage,track])=>Object.assign({ name, code, stage, loginCode:'x' }, track?{track}:{}));
  DB['schoolData/roster_S2'] = { value: JSON.stringify({ classes, students:[{name:'طالب',seat:'111',classCode:'م1أ'}], customSubjects:['مادة مخصصة'], loginCodeCounters:{}, teacherAdd:true }), schoolId:'S2', base:'roster' };
  return DB;
}

async function newPage(browser, uid, session, {seed, keepDB}={}){
  const ctx = await browser.newContext({ viewport:{ width:1440, height:900 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic/, r=>r.fulfill({ status:200, body:'' }));
  await ctx.route(/jsdelivr\.net\/npm\/xlsx/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: XLSX_STUB }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid, session, seed])=>{
    window.__mockUid = uid;
    localStorage.setItem('cls_session', JSON.stringify(session));
    if(seed && !sessionStorage.getItem('__seeded')){ localStorage.setItem('__mockdb', JSON.stringify(seed)); sessionStorage.setItem('__seeded','1'); }
  }, [uid, session, seed||null]);
  const page = await ctx.newPage();
  page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  page.on('console', m=>{ if(m.type()==='error') out('CONSOLE:', m.text()); });
  return { ctx, page };
}

(async()=>{
  const browser = await chromium.launch();
  const seed = seedDB();
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const { ctx, page } = await newPage(browser, 'U_SA1', SA, { seed });
  await page.goto(BASE+'timetable.html');
  await page.waitForSelector('#app:not(.hidden)', { timeout:10000 });
  out('1. loaded; mode =', await page.textContent('#tbMode'));
  // stage defaults: m and h enabled (classes exist), p disabled
  out('   stages enabled:', await page.evaluate(()=>STAGES.map(s=>s.key+':'+stageCfg(s.key).enabled).join(' ')));
  await page.screenshot({ path: SHOTS+'01-settings.png' });

  // 2. Settings UI: change Thursday periods of secondary to 6 via input
  await page.evaluate(()=>{ TT.ui.collapsed['st_h']=false; show('settings'); });
  const thu = await page.$('#stc_h input[data-f="ppd"][data-w="4"]');
  await thu.fill('6'); await thu.dispatchEvent('change');
  out('2. h ppd thu =', await page.evaluate(()=>stageCfg('h').ppd[4]), ' weeklySlots h =', await page.evaluate(()=>weeklySlots('h')));
  await page.screenshot({ path: SHOTS+'02-settings-h.png', fullPage:true });

  // 3. Teachers: add one via UI modal
  await page.click('#sideNav button[data-sec="teachers"]');
  await page.click('#tAdd');
  await page.fill('#tmName', 'معلم تجربة الواجهة');
  await page.fill('#tmNid', '1001');
  await page.click('#tmSave');
  out('3. teachers after UI add =', await page.evaluate(()=>teachers().length));
  // import from users
  await page.click('#tFromUsers'); await page.waitForSelector('#iuOk');
  out('   import-users rows =', await page.$$eval('.iuCb', els=>els.length), ' disabled(dup) =', await page.$$eval('.iuCb:disabled', els=>els.length));
  await page.click('#modalRoot .btn.sec');
  // Excel import (stubbed rows)
  await page.evaluate(()=>{ window.__xlsxRows = [['الاسم','رقم الهوية','المراحل','النصاب'],['معلم إكسل','2001','متوسطة، ثانوية','20'],['مكرر','1001','متوسطة','24']]; });
  await page.evaluate(()=>importTeachersXlsx(new Blob(['x'])));
  await page.waitForTimeout(300);
  out('   after excel import =', await page.evaluate(()=>teachers().map(t=>t.name+'['+t.stages.join('')+']').join(' | ')));
  await page.evaluate(()=>closeModal());

  // 4. Build a full scenario programmatically: teachers & plans & assignment
  await page.evaluate(()=>{
    const T = teachers(); T.length = 0;
    const mk = (name, nid, stages, q)=>{ const t={ id:uid('t'), name, nid, stages, quota:q||24, unavail:{} }; T.push(t); return t.id; };
    const subjM = [['القرآن الكريم',3,'early'],['الدراسات الإسلامية',3,'any'],['لغتي الخالدة',5,'early'],['الرياضيات',6,'early'],['العلوم',5,'any','require'],['اللغة الإنجليزية',4,'any'],['الدراسات الاجتماعية',3,'any'],['المهارات الرقمية',2,'any'],['التربية الفنية',1,'late'],['التربية البدنية والدفاع عن النفس',2,'late'],['المهارات الحياتية والأسرية',1,'any']];
    const subjH = [['القرآن الكريم والتفسير',3,'early'],['التوحيد والفقه',3,'any'],['الكفايات اللغوية',5,'early'],['الرياضيات',6,'early'],['الكيمياء',4,'any'],['الفيزياء',4,'any'],['اللغة الإنجليزية',4,'any'],['التقنية الرقمية',3,'any'],['التربية الصحية والبدنية',2,'late']];
    const C = cfg();
    const mkPlan = (list, code)=>list.map(([n,w,tm,cs],i)=>({ id:uid('sb'), name:n, code: code?code+'-'+(i+1):'', weekly:w, timing:tm, prefDays: n==='الرياضيات'?[0,2]:[], consec: cs||'no' }));
    stagePlanKeys('m').forEach(pk=>C.plans[pk]=mkPlan(subjM));
    stagePlanKeys('h').forEach(pk=>C.plans[pk]=mkPlan(subjH,'1'));
    // Teachers: one per subject for middle (5 classes); a shared math teacher m+h
    const ids = {};
    ids.q  = mk('معلم القرآن','1001',['m','h']);
    ids.is = mk('معلم الإسلامية','1002',['m']);
    ids.ar = mk('معلم لغتي','1003',['m']);
    ids.ma = mk('معلم الرياضيات م','1004',['m','h']);   // shared, user u4
    ids.ma2= mk('معلم الرياضيات ث','1005',['h']);
    ids.sc = mk('معلم العلوم','',['m']);
    ids.en = mk('معلم الإنجليزي','',['m','h']);
    ids.so = mk('معلم الاجتماعيات','',['m']);
    ids.dg = mk('معلم الرقمية','',['m','h']);
    ids.pe = mk('معلم البدنية','',['m','h']);
    ids.ch = mk('معلم الكيمياء','',['h']);
    ids.ph = mk('معلم الفيزياء','',['h']);
    ids.lang = mk('معلم الكفايات','',['h']);
    ids.tw = mk('معلم التوحيد','',['h']);
    const byName = { 'القرآن الكريم':ids.q,'القرآن الكريم والتفسير':ids.q,'الدراسات الإسلامية':ids.is,'التوحيد والفقه':ids.tw,'لغتي الخالدة':ids.ar,'الكفايات اللغوية':ids.lang,
      'العلوم':ids.sc,'اللغة الإنجليزية':ids.en,'الدراسات الاجتماعية':ids.so,'المهارات الرقمية':ids.dg,'التقنية الرقمية':ids.dg,'التربية الفنية':ids.so,'التربية البدنية والدفاع عن النفس':ids.pe,
      'التربية الصحية والبدنية':ids.pe,'المهارات الحياتية والأسرية':ids.is,'الكيمياء':ids.ch,'الفيزياء':ids.ph };
    ['m','h'].forEach(sk=>stageClasses(sk).forEach((c,i)=>planOf(planKeyOf(c)).forEach(sb=>{
      let tid = byName[sb.name];
      if(sb.name==='الرياضيات') tid = sk==='m' ? ids.ma : (i<2 ? ids.ma : ids.ma2);
      if(sb.name==='اللغة الإنجليزية' && sk==='h' && c.code==='ح201') tid = '';   // عجز مقصود
      if(tid) setAssigned(c.code, sb.id, tid);
    })));
    // unavailability: English teacher unavailable Sunday period 1-2 in middle
    teacherById(ids.en).unavail = { m:['0-0','0-1'] };
    markDirty(docIds.teachers()); markDirty(docIds.config()); markDirty(docIds.assign());
    window.__ids = ids;
  });
  await page.waitForTimeout(1500);
  out('4. saveSt =', await page.textContent('#saveSt'));
  await page.click('#sideNav button[data-sec="plan"]'); await page.screenshot({ path: SHOTS+'03-plan.png', fullPage:false });
  await page.click('#sideNav button[data-sec="assign"]'); await page.screenshot({ path: SHOTS+'04-assign.png', fullPage:false });
  await page.click('#sideNav button[data-sec="report"]');
  out('   report stats:', (await page.$$eval('.stat', els=>els.map(e=>e.innerText.replace(/\n/g,' ')))).join(' | '));
  await page.screenshot({ path: SHOTS+'05-report.png', fullPage:true });
  await page.click('#sideNav button[data-sec="teachers"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS+'06-teachers.png', fullPage:false });

  // 5. Generate middle stage (worker)
  await page.click('#sideNav button[data-sec="table"]');
  // ص-١٣: شاشة البداية في فترة جديدة — اختيار «إعداد من الصفر»
  if(await page.$('[data-mode="scratch"]')){ out('   start screen shown → إعداد من الصفر'); await page.click('[data-mode="scratch"]'); await page.waitForTimeout(400); }
  await page.selectOption('#genTime', '10000');
  await page.click('#genBtn');
  await page.waitForFunction(()=>tableDoc('m','draft') && (tableDoc('m','draft').lessons||[]).length>0, null, { timeout:30000 });
  await page.waitForTimeout(300);
  const repM = await page.evaluate(()=>{ const S=getStageState('m','draft'); const r=TTEngine.evaluate(S.pr,S.st); return { units:S.pr.units.length, unplaced:r.unplaced.length, viol:r.violations.length, types:[...new Set(r.violations.map(v=>v.type))] }; });
  out('5. middle generated:', JSON.stringify(repM));
  await page.screenshot({ path: SHOTS+'07-master-m.png' });
  // hard check: English teacher not on Sunday 0,1 ; no teacher double booking
  const hard = await page.evaluate(()=>{
    const S=getStageState('m','draft'); const pr=S.pr, st=S.st; let bad=0;
    const en = pr.teacherIdx[__ids.en]; if(en!=null){ if(st.tGrid[en*pr.S+0]>=0) bad++; if(st.tGrid[en*pr.S+1]>=0) bad++; }
    const doubles = pr.units.filter((u,ui)=>u.len===2 && st.pos[ui]>=0).length;
    return { bad, doubles };
  });
  out('   hard checks (unavail respected=0):', JSON.stringify(hard));

  // 6. Generate secondary: shared teacher must not overlap middle by time
  await page.click('[data-stab="h"]');
  await page.selectOption('#genTime', '10000');
  await page.click('#genBtn');
  await page.waitForFunction(()=>tableDoc('h','draft') && (tableDoc('h','draft').lessons||[]).length>0, null, { timeout:30000 });
  const cross = await page.evaluate(()=>{
    // compare shared teachers' lessons across m and h by time
    let overlaps=0, checked=0;
    ['q','ma','en','dg','pe'].forEach(k=>{
      const tid=__ids[k]; const iv=[];
      ['m','h'].forEach(sk=>(tableDoc(sk,'draft').lessons||[]).forEach(l=>{ if(l.t!==tid||l.d==null) return; const b=bell(sk,l.d); for(let j=0;j<(l.n||1);j++){ const pp=b.periods[l.p+j]; iv.push({w:l.d,s:pp.start,e:pp.end,sk}); } }));
      iv.forEach((a,i)=>iv.forEach((b,j)=>{ if(j<=i||a.w!==b.w||a.sk===b.sk) return; checked++; if(a.s<b.e&&b.s<a.e) overlaps++; }));
    });
    const S=getStageState('h','draft'); const r=TTEngine.evaluate(S.pr,S.st);
    const def = S.pr.units.filter(u=>u.ti<0).length;
    return { overlaps, checked, unplaced:r.unplaced.length, deficitUnits:def };
  });
  out('6. secondary generated; cross-stage overlaps =', JSON.stringify(cross));
  await page.screenshot({ path: SHOTS+'08-master-h.png' });

  // 7. Maintenance on middle: select a lesson, check options, apply a chain/direct swap via preview
  await page.click('[data-stab="m"]'); await page.waitForTimeout(200);
  const cellSel = await page.evaluate(()=>{
    const S=getStageState('m','draft'); const pr=S.pr;
    // pick a lesson with at least one chain option
    for(let ui=0; ui<pr.units.length; ui++){
      if(S.st.pos[ui]<0 || pr.units[ui].ti<0) continue;
      const o = TTEngine.swapOptions(pr,S.st,pr.units[ui].id,{maxExtra:2,nodeBudget:1500,maxSolutions:4});
      if(o.some(x=>x.status==='chain')){ const s=S.st.pos[ui]; return { row:'t:'+pr.teachers[pr.units[ui].ti], d:Math.floor(s/pr.P), p:s%pr.P, id:pr.units[ui].id }; }
    }
    return null;
  });
  out('7. chosen lesson for chain test:', JSON.stringify(cellSel));
  const t0 = Date.now();
  await page.click(`#masterTbl td.cell[data-row="${cellSel.row}"][data-d="${cellSel.d}"][data-p="${cellSel.p}"]`);
  await page.waitForSelector('.selbar');
  out('   selection ms =', Date.now()-t0, ' counts:', await page.$eval('.selbar', e=>e.innerText.replace(/\s+/g,' ').slice(0,160)));
  out('   colored cells: direct', await page.$$eval('td.opt-direct', e=>e.length), 'chain', await page.$$eval('td.opt-chain', e=>e.length), 'none', await page.$$eval('td.opt-none', e=>e.length));
  await page.screenshot({ path: SHOTS+'09-selected.png' });
  const chainCell = await page.$('td.opt-chain');
  await chainCell.click();
  await page.waitForTimeout(200);
  const solModal = await page.$('#modalRoot .sol');
  let pvMoves = 0;
  if(solModal){
    out('   solutions shown:', await page.$$eval('#modalRoot .sol', e=>e.length));
    // تبويبات العرض الأربعة
    out('   [tabs] labels =', JSON.stringify(await page.$$eval('#modalRoot [data-sv]', e=>e.map(b=>b.textContent.trim()))), ' active =', await page.$eval('#modalRoot [data-sv].active', e=>e.dataset.sv));
    out('   [tabs] text view: ol items in sol1 =', await page.$$eval('#solBody .sol:first-child ol li', e=>e.length));
    await page.screenshot({ path: SHOTS+'10-solutions.png' });
    await page.click('#modalRoot [data-sv="color"]'); await page.waitForTimeout(80);
    out('   [tabs] color: rows =', await page.$$eval('#solBody .sol:first-child .mvrow', e=>e.length), ' legend chips =', await page.$$eval('#solBody .sol:first-child .sv-legend .tchip', e=>e.length),
        ' same teacher same color =', await page.evaluate(()=>{ const m={}; let ok=true; document.querySelectorAll('#solBody .tchip').forEach(c=>{ const n=c.textContent.replace(/×.*/,'').replace(/·.*/,'').trim(); const col=c.style.color; if(m[n] && m[n]!==col) ok=false; m[n]=col; }); return ok; }));
    await page.screenshot({ path: SHOTS+'10b-sol-color.png' });
    await page.click('#modalRoot [data-sv="chain"]'); await page.waitForTimeout(80);
    out('   [tabs] chain: steps =', await page.$$eval('#solBody .sol:first-child .ch-step', e=>e.length), ' why lines =', await page.$$eval('#solBody .sol:first-child .ch-why', e=>e.length),
        ' first why =', await page.$eval('#solBody .sol:first-child', e=>{ const w=e.querySelector('.ch-why'); return w ? w.innerText.replace(/\s+/g,' ') : '(none)'; }),
        ' done =', !!(await page.$('#solBody .sol:first-child .ch-done')));
    await page.screenshot({ path: SHOTS+'10c-sol-chain.png' });
    await page.click('#modalRoot [data-sv="grid"]'); await page.waitForTimeout(80);
    out('   [tabs] grid: grids =', await page.$$eval('#solBody .sol:first-child .mg', e=>e.length), ' changed cells (after) =', await page.$$eval('#solBody .sol:first-child .mg-c.chg', e=>e.length));
    await page.screenshot({ path: SHOTS+'10d-sol-grid.png' });
    pvMoves = await page.evaluate(()=>{ const t=document.querySelector('#solBody .sol .sol-head').innerText; const m=t.match(/([٠-٩]+) حركات/); return m ? +m[1].replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)) : 0; });
    await page.click('#solBody .sol');
  }
  await page.waitForSelector('.selbar.preview');
  out('   preview:', await page.$eval('.selbar.preview', e=>e.innerText.replace(/\s+/g,' ').slice(0,200)), ' changed cells =', await page.$$eval('td.changed', e=>e.length));
  out('   [preview] selection colors hidden =', (await page.$$eval('td.opt-direct,td.opt-chain,td.opt-none,td.cell.sel', e=>e.length))===0,
      ' big letters =', JSON.stringify(await page.$$eval('td.cell .mvL', e=>e.map(x=>x.textContent).sort())),
      ' small letters =', JSON.stringify(await page.$$eval('td.cell .mvS', e=>e.map(x=>x.textContent).sort())),
      ' expected moves =', pvMoves || '(direct)');
  out('   [preview] every big-letter cell is framed =', await page.$$eval('td.cell .mvL', e=>e.every(x=>x.closest('td').classList.contains('changed'))),
      ' legend =', await page.$eval('.legend', e=>e.innerText.replace(/\s+/g,' ').slice(0,60)));
  await page.screenshot({ path: SHOTS+'11-preview.png' });
  const before = await page.evaluate(()=>JSON.stringify(tableDoc('m','draft').lessons.filter(l=>l.d!=null).map(l=>l.id+'@'+l.d+'-'+l.p).sort()));
  await page.click('#pvOk'); await page.waitForTimeout(200);
  const after = await page.evaluate(()=>JSON.stringify(tableDoc('m','draft').lessons.filter(l=>l.d!=null).map(l=>l.id+'@'+l.d+'-'+l.p).sort()));
  const hardAfter = await page.evaluate(()=>{ const S=getStageState('m','draft'); const pr=S.pr; const seenT={}, seenC={}; let bad=0;
    (tableDoc('m','draft').lessons).forEach(l=>{ if(l.d==null) return; for(let j=0;j<l.n;j++){ const k1=l.t+'|'+l.d+'|'+(l.p+j), k2=l.c+'|'+l.d+'|'+(l.p+j); if(l.t){ if(seenT[k1]) bad++; seenT[k1]=1; } if(seenC[k2]) bad++; seenC[k2]=1; } }); return bad; });
  out('   swap applied: changed =', before!==after, ' hard conflicts after =', hardAfter);

  // 8. pin, delete, add back
  const tgt = await page.evaluate(()=>{ const S=getStageState('m','draft'); const pr=S.pr; const ui=pr.units.findIndex((u,i)=>u.ti>=0 && u.len===1 && S.st.pos[i]>=0); const s=S.st.pos[ui]; return { row:'t:'+pr.teachers[pr.units[ui].ti], d:Math.floor(s/pr.P), p:s%pr.P, id:pr.units[ui].id }; });
  await page.click(`#masterTbl td.cell[data-row="${tgt.row}"][data-d="${tgt.d}"][data-p="${tgt.p}"]`);
  await page.click('#sbPin'); await page.waitForTimeout(100);
  out('8. pinned saved =', await page.evaluate(id=>tableDoc('m','draft').lessons.find(l=>l.id===id).pin, tgt.id));
  await page.click('#sbPin'); await page.waitForTimeout(100);
  await page.click('#sbDel'); await page.waitForTimeout(100);
  out('   deleted -> unplaced =', await page.evaluate(id=>tableDoc('m','draft').lessons.find(l=>l.id===id).d===null, tgt.id), ' pool shown =', !!(await page.$('#unplacedHost .card')));
  await page.click(`#masterTbl td.cell[data-row="${tgt.row}"][data-d="${tgt.d}"][data-p="${tgt.p}"]`);
  await page.waitForSelector('#modalRoot [data-ui]');
  await page.click('#modalRoot [data-ui]'); await page.waitForTimeout(100);
  out('   re-added =', await page.evaluate(id=>tableDoc('m','draft').lessons.find(l=>l.id===id).d!==null, tgt.id));

  // 8b. تثبيت المعلم: الضغط على الاسم ← شريط ← تثبيت كل حصصه الموزعة، ثم إلغاؤه
  const tPinState = ()=>page.evaluate(row=>{ const tid=row.slice(2); const L=tableDoc('m','draft').lessons.filter(l=>l.t===tid && l.d!=null); return { placed:L.length, pinned:L.filter(l=>l.pin).length }; }, tgt.row);
  await page.click(`#masterTbl td.nm[data-trow="${tgt.row}"]`); await page.waitForSelector('#sbTPin');
  out('8b. teacher bar =', await page.$eval('.selbar', e=>e.innerText.replace(/\s+/g,' ').slice(0,90)), ' name selected =', !!(await page.$(`#masterTbl td.nm.nm-sel[data-trow="${tgt.row}"]`)));
  await page.click('#sbTPin'); await page.waitForTimeout(120);
  const tp1 = await tPinState();
  out('   after pin: placed =', tp1.placed, ' pinned =', tp1.pinned, ' all =', tp1.placed>0 && tp1.placed===tp1.pinned,
      ' 📌 at name =', await page.$eval(`#masterTbl td.nm[data-trow="${tgt.row}"]`, e=>e.textContent.includes('📌')),
      ' pinned cells in row =', await page.$$eval(`#masterTbl td.cell.pinned[data-row="${tgt.row}"]`, e=>e.length));
  out('   pinned lesson offers no swap =', await page.evaluate(row=>{ const S=getStageState('m','draft'); const ui=S.pr.units.findIndex((u,i)=>'t:'+S.pr.teachers[u.ti]===row && S.st.pos[i]>=0); return S.pins.has(S.pr.units[ui].id); }, tgt.row));
  await page.screenshot({ path: SHOTS+'11b-teacher-pinned.png' });
  out('   button now =', await page.$eval('#sbTPin', e=>e.textContent.trim()));
  await page.click('#sbTPin'); await page.waitForTimeout(120);
  const tp2 = await tPinState();
  out('   after unpin: pinned =', tp2.pinned, ' 📌 at name gone =', !(await page.$eval(`#masterTbl td.nm[data-trow="${tgt.row}"]`, e=>e.textContent.includes('📌'))));
  await page.click('#sbX'); await page.waitForTimeout(80);

  // 9. Views and approve and print
  await page.click('[data-view="teacher"]'); await page.screenshot({ path: SHOTS+'12-teacher-view.png' });
  await page.evaluate(()=>{ TT.ui.teacherSel = __ids.ma; renderTableBody('m'); });
  await page.screenshot({ path: SHOTS+'13-teacher-shared.png', fullPage:true });
  await page.click('[data-view="section"]'); await page.screenshot({ path: SHOTS+'14-section-view.png' });
  await page.click('[data-view="master"]');
  await page.click('#approveBtn'); await page.click('#cbOk'); await page.waitForTimeout(200);
  out('9. approved m =', await page.evaluate(()=>!!(tableDoc('m','approved')||{}).approvedAt));
  await page.click('[data-stab="h"]'); await page.click('#approveBtn'); await page.click('#cbOk'); await page.waitForTimeout(200);
  await page.click('[data-stab="m"]');
  await page.click('#printBtn'); await page.selectOption('#prWhat','master');
  await page.evaluate(()=>{ window.print = ()=>{ window.__printed = document.getElementById('printArea').innerHTML.length; }; });
  await page.click('#prGo'); await page.waitForTimeout(300);
  out('   print master html length =', await page.evaluate(()=>window.__printed), ' pages =', await page.$$eval('#printArea .pg', e=>e.length));
  await page.emulateMedia({ media:'print' }); await page.screenshot({ path: SHOTS+'15-print-master.png', fullPage:true }); await page.emulateMedia({ media:'screen' });
  await page.click('#printBtn'); await page.selectOption('#prWhat','sections'); await page.click('#prGo'); await page.waitForTimeout(300);
  out('   print sections pages =', await page.$$eval('#printArea .pg', e=>e.length));
  await page.emulateMedia({ media:'print' }); await page.screenshot({ path: SHOTS+'16-print-sections.png', fullPage:false }); await page.emulateMedia({ media:'screen' });
  await page.waitForTimeout(1500);
  out('   saveSt =', await page.textContent('#saveSt'));

  // 10. Publish first period
  await page.click('#sideNav button[data-sec="export"]');
  await page.click('#pubBtn'); await page.waitForSelector('#pubGo');
  await page.screenshot({ path: SHOTS+'17-publish-preview.png' });
  await page.click('#pubGo'); await page.waitForSelector('#modalRoot h2');
  out('10. publish result:', await page.$eval('#modalRoot', e=>e.innerText.replace(/\s+/g,' ').slice(0,120)));
  const u4 = await page.evaluate(()=>__mockDB()['users/u4'].schools.S2);
  out('   u4 byPeriod.first =', (u4.subjectAssignmentsByPeriod.first||[]).length, ' union =', u4.subjectAssignments.length, ' assignedClasses =', JSON.stringify(u4.assignedClasses));
  const u1 = await page.evaluate(()=>__mockDB()['users/u1'].schools.S2);
  out('   u1 (quran) byP =', (u1.subjectAssignmentsByPeriod.first||[]).length, ' assignedClasses sample =', JSON.stringify(u1.assignedClasses.slice(0,4)));
  out('   roster customSubjects =', await page.evaluate(()=>JSON.parse(__mockDB()['schoolData/roster_S2'].value).customSubjects.length));
  const pubDoc = await page.evaluate(()=>{ const d=__mockDB()['timetables/S2/data/first_published']; if(!d) return null; const v=JSON.parse(d.value); const k=Object.keys(v.byUser); return { users:k.length, u1:(v.byUser.u1||{}).lessons ? v.byUser.u1.lessons.length : 0, sig:(v.byUser.u1||{}).sig, sample:(v.byUser.u1||{lessons:[]}).lessons[0] }; });
  out('   [جدولي] published doc =', JSON.stringify(pubDoc));
  await page.click('#modalRoot .btn');

  // 11. Export middle to second with substitution of the Arabic teacher by a new teacher
  await page.click('[data-expst="m"]');
  await page.waitForSelector('[data-exa]');
  out('11. export rows =', await page.$$eval('[data-exa]', e=>e.length));
  const arId = await page.evaluate(()=>__ids.ar), isId = await page.evaluate(()=>__ids.is), maId = await page.evaluate(()=>__ids.ma);
  await page.selectOption(`[data-exa="${arId}"]`, 'sub');
  await page.selectOption(`[data-exto="${arId}"]`, isId);   // substitute with existing teacher -> conflicts expected
  await page.selectOption(`[data-exa="${maId}"]`, 'only');
  await page.screenshot({ path: SHOTS+'18-export.png', fullPage:true });
  await page.click('#expGo'); await page.waitForSelector('#goSecond', { timeout:5000 });
  out('   export modal:', await page.$eval('#modalRoot', e=>e.innerText.replace(/\s+/g,' ').slice(0,260)));
  await page.click('#goSecond');
  await page.waitForFunction(()=>TT.period==='second' && D(docIds.assign()));
  await page.waitForTimeout(300);
  const sec = await page.evaluate(()=>({ mEnabled: stageCfg('m').enabled, plans: stagePlanKeys('m').every(pk=>planOf(pk).length>0), teacherStagesMa: JSON.stringify(cfg().teacherStages[__ids.ma]||null),
     arAssigned: Object.values(amap()).some(m=>Object.values(m).includes(__ids.ar)), hPlans: stagePlanKeys('h').filter(pk=>planOf(pk).length).length }));
  out('   second period:', JSON.stringify(sec));
  await page.click('#sideNav button[data-sec="table"]'); await page.click('[data-stab="m"]').catch(()=>{});
  await page.waitForTimeout(200);
  out('   second m table alert:', (await page.$$eval('#tbBody .alert', e=>e.map(x=>x.innerText.replace(/\s+/g,' ').slice(0,140)))).join(' || '));
  await page.screenshot({ path: SHOTS+'19-second-m.png' });

  // 12. View-only user
  const V = { userId:'ag1', username:'موظف مشاهد', role:'counselor', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const dbNow = await page.evaluate(()=>__mockDB());
  const v = await newPage(browser, 'U_ag1', V, { seed: dbNow });
  await v.page.goto(BASE+'timetable.html'); await v.page.waitForSelector('#app:not(.hidden)');
  out('12. viewer mode =', await v.page.textContent('#tbMode'), ' genBtn present =', !!(await (async()=>{ await v.page.click('#sideNav button[data-sec="table"]'); return v.page.$('#genBtn'); })()));
  await v.page.screenshot({ path: SHOTS+'20-viewer.png' });

  // 13. Conflict detection: another tab bumps rev of teachers doc then this tab edits
  await page.evaluate(()=>{ const d=__mockDB()['timetables/S2/data/teachers']; d.rev += 5; __mockSet('timetables/S2/data/teachers', d); });
  await page.evaluate(()=>{ teachers()[0].quota = 23; markDirty(docIds.teachers()); });
  await page.waitForTimeout(1500);
  out('13. conflict status =', await page.textContent('#saveSt'), ' modal =', (await page.$('#modalRoot h2')) ? await page.$eval('#modalRoot h2', e=>e.innerText) : 'none');

  // 14. Mobile notice
  const mctx = await browser.newContext({ viewport:{ width:390, height:800 } });
  await mctx.route(/gstatic|jsdelivr|googleapis/, r=>r.fulfill({ status:200, body:'' }));
  await mctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await mctx.addInitScript(([s,db])=>{ window.__mockUid='U_SA1'; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db)); }, [SA, dbNow]);
  const mp = await mctx.newPage(); await mp.goto(BASE+'timetable.html'); await mp.waitForTimeout(800);
  out('14. mobile notice visible =', await mp.isVisible('#mobileNotice'));
  await mp.screenshot({ path: SHOTS+'21-mobile.png' });

  fs.writeFileSync('/tmp/claude-0/tt/db-after.json', JSON.stringify(dbNow));
  await browser.close();
})().catch(e=>{ console.error('TEST FAILED', e); process.exit(1); });
