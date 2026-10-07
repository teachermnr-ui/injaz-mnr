// ص-١٣: طريقة البناء + الإدخال اليدوي + قالب النظام + المستورد المرن + الربط + المعلم الجديد/التعميد + الفحص والمسودة + التراجع
// ملاحظة: مكتبتا SheetJS وExcelJS محجوبتان في بيئة الاختبار — تُستبدلان بمحاكيات بنفس الواجهة المستخدمة (read/sheet_to_json/!merges، وWorkbook/addWorksheet/getCell…).
const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
const SH = __dirname+'/shots/';
let ERRS = 0;
const SHIMS = `
window.XLSX = { read(){ return window.__wb; }, utils:{ sheet_to_json(ws){ return ws.__rows.map(r=>r.slice()); } } };
(function(){ const log = window.__xl = { sheets:{}, dv:0, values:0 };
  function WS(name, opts){ this.name=name; this.opts=opts; this.cells={}; this.cols={}; this.merges=[]; log.sheets[name]=this; }
  WS.prototype.getCell = function(r,c){ const k=r+','+c; return this.cells[k] = this.cells[k] || { set value(v){ this._v=v; log.values++; }, get value(){ return this._v; }, set dataValidation(v){ this._dv=v; log.dv++; }, get dataValidation(){ return this._dv; } }; };
  WS.prototype.getColumn = function(i){ return this.cols[i] = this.cols[i] || { letter: String.fromCharCode(64+i) }; };
  WS.prototype.mergeCells = function(){ this.merges.push([...arguments]); };
  function Workbook(){ this.sheets=[]; this.xlsx = { writeBuffer: async()=>new ArrayBuffer(8) }; }
  Workbook.prototype.addWorksheet = function(n,o){ const w=new WS(n,o); this.sheets.push(w); return w; };
  window.ExcelJS = { Workbook };
})();`;
async function open(browser, uid, session, db, page){
  const ctx = await browser.newContext({ viewport:{ width:1350, height:900 }, acceptDownloads:true });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid,s,db,shims])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{}; window.open=()=>({ document:{ write(){}, close(){} } });
    document.addEventListener('DOMContentLoaded', ()=>{ (0,eval)(shims); });
  }, [uid,session,db,SHIMS]);
  const p = await ctx.newPage(); p.on('pageerror', e=>{ ERRS++; out('PAGE ERROR:', e.message); });
  await p.goto('http://127.0.0.1:8765/'+(page||'timetable.html')); await p.waitForTimeout(2600);
  await p.evaluate(s=>{ (0,eval)(s); }, SHIMS);
  return p;
}
const cbOk = async p=>{ await p.waitForSelector('#cbOk'); await p.click('#cbOk'); await p.waitForTimeout(400); };
(async()=>{
  const browser = await chromium.launch();
  const DB = JSON.parse(JSON.stringify(DB0));
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const p = await open(browser, 'U_SA1', SA, DB);
  // ١) شاشة البداية
  await p.evaluate(()=>{ TT._forceStart = true; show('table'); }); await p.waitForTimeout(300);
  out('1. start screen =', !!(await p.$('[data-mode="scratch"]')) && !!(await p.$('[data-mode="ready"]')));
  await p.click('[data-mode="ready"]'); await p.waitForTimeout(500);
  out('   mode =', await p.evaluate(()=>buildMode()), ' manual screen =', !!(await p.$('#imCheck')));
  // مدرسة اختبار متسقة: خطة صغيرة لكل صف، إسناد دوري، وتوليد كامل لكل مرحلة (المرجع الصحيح)
  out('   synthetic solve =', await p.evaluate(()=>{
    const res = [];
    enabledStages().forEach(s=>{
      stagePlanKeys(s.key).forEach(pk=>{ cfg().plans[pk] = [{ id:uid('sb'), name:'الرياضيات', code:'', weekly:3, timing:'any', prefDays:[], consec:'no' }, { id:uid('sb'), name:'العلوم', code:'', weekly:2, timing:'any', prefDays:[], consec:'no' }]; });
      const T = impStageTeachers(s.key);
      stageClasses(s.key).forEach((c,ci)=>{ amap()[c.code] = {}; planOf(planKeyOf(c)).forEach((sb,si)=>{ amap()[c.code][sb.id] = T[(ci*2+si) % T.length].id; }); });
      invalidateStage();
      const S = getStageState(s.key,'draft'); S.pins.clear();
      const st = TTEngine.solve(S.pr, { timeLimitMs:3000, seed:7 }); S.st = st; saveStageState(S);
      res.push(s.key+':'+TTEngine.evaluate(S.pr, st).unplaced.length);
    });
    markDirty(docIds.config()); markDirty(docIds.assign()); invalidateStage();
    return res.join(',');
  }));
  // مرجع: الجدول الحالي (المولَّد) كحصص موحّدة
  const ref = await p.evaluate(()=>{ const out=[]; enabledStages().forEach(s=>{ const S=getStageState(s.key,'draft'); const { pr, st } = S; pr.units.forEach((u,ui)=>{ const pos=st.pos[ui]; if(pos<0 || u.ti<0) return; const d=pr.days[Math.floor(pos/pr.P)], p0=pos%pr.P, code=String(pr.classes[u.ci]), tid=pr.teachers[u.ti]; for(let k=0;k<u.len;k++) out.push({ sk:s.key, d, p:p0+k, tid, code, subj:u.subjName, tname:teacherName(tid), nid:(teacherById(tid)||{}).nid||'', clabel:classLabel(code) }); }); }); return out; });
  out('   reference unplaced (m,h) =', await p.evaluate(()=>['m','h'].map(sk=>TTEngine.evaluate(getStageState(sk,'draft').pr,getStageState(sk,'draft').st).unplaced.length).join(',')));
  out('   reference lessons =', ref.length);
  // ٢) الإدخال اليدوي: تعبئة الشبكة من المرجع ثم الفحص
  await p.evaluate(ref=>{ const G = manualDoc().grid = {}; ref.forEach(e=>{ ((G[e.sk]=G[e.sk]||{})[e.tid]=G[e.sk][e.tid]||{})[e.d+'|'+e.p] = { c:e.code, s:e.subj }; }); markDirty(docIds.manual()); show('imp'); }, ref);
  await p.waitForTimeout(500);
  out('2. manual grid cells =', await p.$$eval('[data-mc] b', x=>x.length), ' summary all complete =', !(await p.$eval('#mainBody', e=>/\d+\/\d+|[٠-٩]+\/[٠-٩]+/.test([...e.querySelectorAll('.chip.warn,.chip.err')].map(c=>c.textContent).join('')))));
  await p.screenshot({ path: SH+'90-manual.png' });
  // تعارض: خانة لمعلم آخر بنفس الشعبة والوقت
  const clash = ref.find(e=>e.sk==='m');
  const other = await p.evaluate(e=>{ const t = impStageTeachers('m').find(x=>x.id!==e.tid && !((manualDoc().grid.m||{})[x.id]||{})[e.d+'|'+e.p]); return t && t.id; }, clash);
  await p.click(`[data-mc="${other}|${clash.d}|${clash.p}"]`); await p.waitForSelector('#ipQ');
  await p.fill('#ipQ', clash.code+' – '+clash.subj); await p.waitForTimeout(150);
  out('   picker shows "الشعبة مشغولة" =', (await p.$eval('#ipList', e=>e.innerText)).includes('الشعبة مشغولة'));
  await p.click('#ipList [data-op]'); await p.waitForTimeout(400);
  out('   clash highlighted =', await p.$$eval('[data-mc]', x=>x.filter(td=>td.style.outline.includes('2px')).length), '(expect 2)');
  await p.click('#imCheck'); await p.waitForTimeout(700);
  const errTxt = await p.$eval('#modalRoot', e=>e.innerText.replace(/\s+/g,' '));
  out('   check with clash: no draft =', errTxt.includes('لم تُنشأ المسودة'), ' class clash =', errTxt.includes('تعارض الشعبة'), ' quota/count errors shown =', errTxt.includes('عدد حصص المادة يخالف الخطة'));
  await p.evaluate(()=>closeModal());
  // إزالة التعارض ثم الفحص
  await p.evaluate(([tid,d,pp])=>{ delete manualDoc().grid.m[tid][d+'|'+pp]; markDirty(docIds.manual()); show('imp'); }, [other, clash.d, clash.p]); await p.waitForTimeout(300);
  const draftBefore = await p.evaluate(()=>JSON.stringify((tableDoc('m','draft')||{}).lessons||[]).length);
  await p.click('#imCheck'); await p.waitForTimeout(1500);
  const okTxt = await p.$eval('#modalRoot', e=>e.innerText.replace(/\s+/g,' '));
  out('   check clean: draft created =', okTxt.includes('أُنشئت المسودة'));
  const built = await p.evaluate(()=>{ const r={}; ['m','h'].forEach(sk=>{ const L=(tableDoc(sk,'draft')||{}).lessons||[]; r[sk]={ n:L.reduce((a,l)=>a+(l.n||1),0), placed:L.filter(l=>l.d!=null).length, pinned:L.every(l=>l.pin), units:getStageState(sk,'draft').pr.units.length, unplaced:TTEngine.evaluate(getStageState(sk,'draft').pr,getStageState(sk,'draft').st).unplaced.length, conflicts:getStageState(sk,'draft').conflicts.length }; }); return r; });
  out('   draft:', JSON.stringify(built), ' undo saved =', await p.evaluate(()=>!!(D(docIds.impUndo())||{}).at));
  await p.screenshot({ path: SH+'91-import-ok.png' });
  await p.evaluate(()=>closeModal());
  // ٣) التراجع
  await p.evaluate(()=>{ const d = tableDoc('m','draft'); d.lessons = d.lessons.slice(0,3); });
  await p.evaluate(()=>show('table')); await p.waitForTimeout(400);
  await p.click('[data-imp="undo"]'); await cbOk(p); await p.waitForTimeout(500);
  out('3. undo: m draft restored size =', await p.evaluate(()=>JSON.stringify((tableDoc('m','draft')||{}).lessons||[]).length), ' (before import', draftBefore, ')', ' undo cleared =', await p.evaluate(()=>!!(D(docIds.impUndo())||{}).cleared));
  // ٤) قالب النظام: التنزيل (محاكي ExcelJS) ثم الرفع (محاكي SheetJS بنفس تخطيط القالب)
  await p.evaluate(()=>impTemplateDownload()); await p.waitForTimeout(500);
  const xl = await p.evaluate(()=>{ const L=window.__xl; return { sheets:Object.keys(L.sheets), dv:L.dv, lists:Object.values(L.sheets.find?{}:L.sheets).length, hidden:(L.sheets['قوائم']||{}).opts }; });
  out('4. template sheets =', JSON.stringify(xl.sheets), ' dropdown cells =', xl.dv, ' lists hidden =', JSON.stringify(xl.hidden));
  const tplWb = await p.evaluate(ref=>{ const wb = { SheetNames:[], Sheets:{} };
    impStages().forEach(s=>{ const sc=stageCfg(s.key), mp=maxP(s.key); const rows=[['الجدول العام'],['المعلم','رقم الهوية'],['','']];
      impStageTeachers(s.key).forEach(t=>{ const row=[t.name, String(t.nid||'')]; sc.days.forEach((d,di)=>{ for(let p=0;p<mp;p++){ const e = ref.find(x=>x.sk===s.key && x.tid===t.id && x.d===d && x.p===p); row[2+di*mp+p] = e ? e.code+' – '+e.subj : ''; } }); rows.push(row); });
      // خانة خاطئة للتجربة
      if(s.key==='m') rows[3][2] = 'شعبة وهمية – مادة';
      wb.SheetNames.push(tplSheetName(s)); wb.Sheets[tplSheetName(s)] = { __rows: rows }; });
    return wb; }, ref);
  await p.evaluate(wb=>{ manualDoc().grid = {}; impTemplateApply(wb); }, tplWb); await p.waitForTimeout(600);
  const tplMsg = await p.$eval('#modalRoot', e=>e.innerText.replace(/\s+/g,' '));
  out('   template upload: filled =', (tplMsg.match(/عُبّئت\s*([٠-٩\d]+)/)||[])[1], ' bad cell reported =', tplMsg.includes('ليست من القائمة'));
  await p.evaluate(()=>closeModal());
  // ٥) المستورد المرن — شكل «قائمة»
  const listRows = [['اليوم','الحصة','الفصل','المادة','المعلم','الهوية']].concat(ref.map(e=>[['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'][e.d], String(e.p+1), e.clabel, e.subj, e.tname, '']));
  await p.evaluate(rows=>{ window.__wb = { SheetNames:['جدول'], Sheets:{ 'جدول':{ __rows: rows } } }; IMP.view='flex'; IMP.flex=null; impFlexStart(window.__wb, 'list.xlsx'); }, listRows); await p.waitForTimeout(500);
  const pv = await p.$eval('#flBody', e=>e.innerText.replace(/\s+/g,' '));
  out('5. flex list: layout =', await p.evaluate(()=>IMP.flex.layout), ' parsed =', await p.evaluate(()=>IMP.flex.raw.length), '/', ref.length, ' bad =', await p.evaluate(()=>IMP.flex.bad));
  await p.screenshot({ path: SH+'92-flex-setup.png', fullPage:true });
  await p.fill('#flPfName','برنامج اختبار'); await p.click('#flPfSave'); await p.waitForTimeout(200);
  await p.click('#flNext'); await p.waitForTimeout(500);
  const unmapped = await p.evaluate(()=>({ t:Object.values(IMP.flex.mapT).filter(x=>!x.val).length, c:Object.values(IMP.flex.mapC).filter(x=>!x.val).length, s:Object.values(IMP.flex.mapS).filter(x=>!x.val).length }));
  out('   auto-mapped: unmapped =', JSON.stringify(unmapped));
  await p.screenshot({ path: SH+'93-flex-map.png', fullPage:true });
  await p.click('#flGo'); await p.waitForTimeout(1500);
  out('   flex list result =', (await p.$eval('#modalRoot', e=>e.innerText)).includes('أُنشئت المسودة'));
  await p.evaluate(()=>closeModal());
  // الشكل المحفوظ يُتعرّف عليه، والربط المحفوظ يُستخدم
  await p.evaluate(rows=>{ window.__wb = { SheetNames:['جدول'], Sheets:{ 'جدول':{ __rows: rows } } }; IMP.flex=null; impFlexStart(window.__wb, 'list2.xlsx'); }, listRows); await p.waitForTimeout(400);
  out('   profile recognized =', await p.evaluate(()=>IMP.flex.profile));
  // ٦) المستورد المرن — «جدول لكل معلم» (جداول متتالية في ورقة واحدة، الخانة: الشعبة فوق والمادة تحت)
  const tg = await p.evaluate(ref=>{ const rows=[]; const T=[...new Set(ref.filter(e=>e.sk==='m').map(e=>e.tid))];
    T.forEach(tid=>{ const L=ref.filter(e=>e.tid===tid && e.sk==='m'); rows.push(['جدول المعلم: '+L[0].tname]); rows.push(['','الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة']);
      ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'].forEach((dn,d)=>{ const row=[dn]; for(let p=0;p<7;p++){ const e=L.find(x=>x.d===d&&x.p===p); row.push(e ? e.code+'\n'+e.subj : ''); } rows.push(row); }); rows.push(['']); });
    return { rows, n: ref.filter(e=>e.sk==='m').length }; }, ref);
  await p.evaluate(rows=>{ window.__wb = { SheetNames:['المعلمون'], Sheets:{ 'المعلمون':{ __rows: rows } } }; IMP.flex=null; impFlexStart(window.__wb, 'tgrid.xlsx'); }, tg.rows); await p.waitForTimeout(400);
  out('6. flex tgrid: layout =', await p.evaluate(()=>IMP.flex.layout), ' parsed =', await p.evaluate(()=>IMP.flex.raw.length), '/', tg.n, ' teachers =', await p.evaluate(()=>new Set(IMP.flex.raw.map(r=>r.tStr)).size));
  // متوسطة فقط: الشعب تطابق، ونفحص
  await p.click('#flNext'); await p.waitForTimeout(400);
  await p.click('#flGo'); await p.waitForTimeout(1500);
  out('   tgrid (m only) result =', (await p.$eval('#modalRoot', e=>e.innerText)).includes('أُنشئت المسودة'));
  await p.evaluate(()=>closeModal());
  // ٧) أخطاء: شعبة ناقصة توقف الاستيراد، ومادة غير موجودة مع «إضافة كمادة»
  const dropCls = ref.find(e=>e.sk==='m').clabel;
  await p.evaluate(([rows, drop])=>{ window.__wb = { SheetNames:['ج'], Sheets:{ 'ج':{ __rows: rows.filter((r,i)=>i===0 || r[2]!==drop) } } }; IMP.flex=null; impFlexStart(window.__wb, 'bad.xlsx'); }, [listRows, dropCls]); await p.waitForTimeout(300);
  await p.click('#flNext'); await p.waitForTimeout(300); await p.click('#flGo'); await p.waitForTimeout(800);
  out('7. missing class stops =', (await p.$eval('#modalRoot', e=>e.innerText)).includes('الشعب لا تطابق المسجّلة'));
  await p.evaluate(()=>closeModal());
  const subj0 = ref.find(e=>e.sk==='m').subj;
  const oddRows = listRows.map((r,i)=>i && r[3]===subj0 && r[2]===dropCls ? [r[0],r[1],r[2],'مادة غريبة',r[4],r[5]] : r);
  await p.evaluate(rows=>{ window.__wb = { SheetNames:['ج'], Sheets:{ 'ج':{ __rows: rows } } }; IMP.flex=null; impFlexStart(window.__wb, 'odd.xlsx'); }, oddRows); await p.waitForTimeout(300);
  await p.click('#flNext'); await p.waitForTimeout(300); await p.click('#flGo'); await p.waitForTimeout(800);
  const oddTxt = await p.$eval('#modalRoot', e=>e.innerText);
  out('   unknown subject stops + add button =', oddTxt.includes('مواد غير موجودة') && !!(await p.$('#modalRoot [data-addsub]')));
  await p.evaluate(()=>closeModal());
  // ٨) معلم جديد — المدير: يُضاف مباشرة
  const t0 = ref.find(e=>e.sk==='m');
  const newRows = listRows.map((r,i)=>i && r[4]===t0.tname ? [r[0],r[1],r[2],r[3],'معلم جديد اختبار',r[5]] : r);
  await p.evaluate(rows=>{ window.__wb = { SheetNames:['ج'], Sheets:{ 'ج':{ __rows: rows } } }; IMP.flex=null; impMaps().teachers={}; impFlexStart(window.__wb, 'new.xlsx'); }, newRows); await p.waitForTimeout(300);
  await p.click('#flNext'); await p.waitForTimeout(300);
  const nk = await p.evaluate(()=>Object.values(IMP.flex.mapT).find(t=>t.label==='معلم جديد اختبار').key);
  await p.selectOption(`[data-mt="${nk}"]`, '__new__'); await p.click('#flGo'); await p.waitForTimeout(400);
  out('8. new-teacher form =', !!(await p.$('#nwOk')));
  await p.fill('[data-ni="0"]', '1099887766'); await p.click('#nwOk'); await p.waitForTimeout(1200);
  const nwTxt = await p.$eval('#modalRoot', e=>e.innerText);
  const newUser = await p.evaluate(()=>Object.values(__mockDB()).find(u=>u && u.loginId==='1099887766'));
  out('   principal: user created =', !!newUser, ' password shown =', nwTxt.includes('كلمة المرور الأولية'), ' teacher in tool =', await p.evaluate(()=>teachers().some(t=>t.nid==='1099887766')));
  await p.click('#nwCont'); await p.waitForTimeout(1500);
  out('   then draft =', (await p.$eval('#modalRoot', e=>e.innerText)).includes('أُنشئت المسودة'));
  await p.evaluate(()=>closeModal());
  const DBa = await p.evaluate(()=>__mockDB());
  // ٩) معلم جديد — مفوَّض بالجدول (غير المدير): طلب تعميد + توقف
  DBa['users/u4'].schools.S2.permissions = Object.assign({}, DBa['users/u4'].schools.S2.permissions||{}, { 'tools.timetable':{ access:true, edit:true, del:false } });
  const AG = { userId:'u4', username:'منير', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pa = await open(browser, 'U_u4', AG, DBa);
  const rows2 = listRows.map((r,i)=>i && r[4]===t0.tname ? [r[0],r[1],r[2],r[3],'معلم ثان جديد',r[5]] : r);
  await pa.evaluate(rows=>{ window.__wb = { SheetNames:['ج'], Sheets:{ 'ج':{ __rows: rows } } }; IMP.view='flex'; IMP.flex=null; impMaps().teachers={}; show('imp'); impFlexStart(window.__wb, 'n2.xlsx'); }, rows2); await pa.waitForTimeout(400);
  await pa.click('#flNext'); await pa.waitForTimeout(300);
  const nk2 = await pa.evaluate(()=>Object.values(IMP.flex.mapT).find(t=>t.label==='معلم ثان جديد').key);
  await pa.selectOption(`[data-mt="${nk2}"]`, '__new__'); await pa.click('#flGo'); await pa.waitForTimeout(300);
  await pa.fill('[data-ni="0"]', '1088776655'); await pa.click('#nwOk'); await pa.waitForTimeout(1200);
  const DBb = await pa.evaluate(()=>__mockDB());
  const req = Object.entries(DBb).find(([k,v])=>k.startsWith('userRequests/') && v.loginId==='1088776655');
  const job = DBb['timetables/S2/data/first_importJob'];
  out('9. agent: request =', req && req[1].status, ' job =', job && JSON.parse(job.value).status, ' user NOT created =', !Object.entries(DBb).some(([k,u])=>k.startsWith('users/') && u.loginId==='1088776655'));
  await pa.evaluate(()=>{ closeModal(); show('table'); }); await pa.waitForTimeout(300);
  await pa.click('#jobGo'); await pa.waitForTimeout(600);
  out('   continue before approval =', await pa.$eval('#toast', e=>e.innerText));
  // المدير يعمّد من «المستخدمون»
  const pi = await open(browser, 'U_SA1', SA, DBb, 'index.html');
  await pi.evaluate(()=>{ activeTab='users'; renderTabs(); renderPanel(); }); await pi.waitForTimeout(1200);
  out('   principal sees request card =', (await pi.$eval('#uReqHost', e=>e.innerText)).includes('طلبات تعميد'));
  await pi.click('#uReqHost button:has-text("تعميد")'); await pi.waitForTimeout(800);
  const DBc = await pi.evaluate(()=>__mockDB());
  out('   approved: user created =', Object.entries(DBc).some(([k,u])=>k.startsWith('users/') && u.loginId==='1088776655'), ' request =', DBc[req[0]].status);
  await pi.screenshot({ path: SH+'94-approve.png' });
  const pa2 = await open(browser, 'U_u4', AG, DBc);
  await pa2.evaluate(()=>show('table')); await pa2.waitForTimeout(300);
  await pa2.click('#jobGo'); await pa2.waitForTimeout(1500);
  out('   agent continues → draft =', (await pa2.$eval('#modalRoot', e=>e.innerText)).includes('أُنشئت المسودة'));
  out('PAGE ERRORS:', ERRS);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
