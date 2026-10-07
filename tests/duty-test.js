const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
const SH = __dirname+'/shots/';
let ERRS = 0;
async function open(browser, uid, session, db, page){
  const ctx = await browser.newContext({ viewport:{ width:1250, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid,s,db])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{};
    window.open=()=>({ document:{ write:h=>{ window.__printed=(window.__printed||'')+h; }, close(){} } });
  }, [uid,session,db]);
  const p = await ctx.newPage(); p.on('pageerror', e=>{ ERRS++; out('PAGE ERROR:', e.message); });
  await p.goto('http://127.0.0.1:8765/'+(page||'index.html')); await p.waitForTimeout(1800);
  return p;
}
const ymd = d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
(async()=>{
  const browser = await chromium.launch();
  const DB = JSON.parse(JSON.stringify(DB0));
  const AGT = { userId:'u4', username:'منير النمري', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const SA = { userId:'sa1', username:'ياسر الجميعي', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pa = await open(browser, 'U_u4', AGT, DB);
  out('1. agent tools =', JSON.stringify(await pa.evaluate(()=>visibleTools().map(t=>t.key))));
  const pd = await open(browser, 'U_u4', AGT, DB, 'duty.html');
  out('   stages =', JSON.stringify(await pd.$$eval('[data-st]', b=>b.map(x=>x.innerText))), ' publish disabled for agent =', await pd.$eval('#btnPub', b=>b.disabled));
  out('   events m =', JSON.stringify(await pd.evaluate(()=>S().events.map(e=>e.key+':'+e.label))));
  out('   default participants m =', JSON.stringify(await pd.evaluate(()=>P().participants.map(uName))));
  // الإعداد: تحديد معلمي المرحلتين يدويًا في المتوسطة
  for(const c of await pd.$$('[data-pp]:not([disabled]):not(:checked)')){ await c.check(); await pd.waitForTimeout(60); }
  out('   participants after manual =', await pd.evaluate(()=>P().participants.length));
  const sun = new Date(); sun.setDate(sun.getDate()+((7-sun.getDay())%7||7)); const end = new Date(sun); end.setDate(end.getDate()+11);
  await pd.fill('#dFrom', ymd(sun)); await pd.dispatchEvent('#dFrom','change'); await pd.waitForTimeout(150);
  await pd.fill('#dTo', ymd(end)); await pd.dispatchEvent('#dTo','change'); await pd.waitForTimeout(150);
  await pd.fill('#dPer','2'); await pd.dispatchEvent('#dPer','change');
  // إجازة: الثلاثاء الأول
  const tue = new Date(sun); tue.setDate(tue.getDate()+2);
  // الإجازات الآن مصدر مركزي (schoolCalendar) — تُدرج مباشرة ثم تُعاد قراءتها
  await pd.evaluate(([k])=>{ DS.holidayList=[{ id:'h1', from:k, to:k, label:'إجازة' }]; DS.holidays=expandHolidays(DS.holidayList); Object.values(DS.plans).forEach(p=>{ delete p.dutyDays[k]; }); render(); }, [ymd(tue)]); await pd.waitForTimeout(150);
  out('   duty dates (12 days − weekend − 1 holiday) =', await pd.evaluate(()=>dutyDates().length), '(expect 9)');
  for(const [name, b, pr] of [['الساحة',2,0],['المقصف',1,0],['المصلى',0,2]]){
    await pd.click('#plAdd'); await pd.waitForTimeout(150);
    const i = await pd.$$eval('[data-pn]', x=>x.length-1);
    await pd.fill(`[data-pn="${i}"]`, name); await pd.dispatchEvent(`[data-pn="${i}"]`,'change');
    await pd.fill(`[data-pc="${i}"][data-ev="break_3"]`, String(b)); await pd.dispatchEvent(`[data-pc="${i}"][data-ev="break_3"]`,'change');
    await pd.fill(`[data-pc="${i}"][data-ev="prayer_5"]`, String(pr)); await pd.dispatchEvent(`[data-pc="${i}"][data-ev="prayer_5"]`,'change');
  }
  await pd.fill('#sgA','منير النمري'); await pd.dispatchEvent('#sgA','change');
  await pd.fill('#sgP','ياسر الجميعي'); await pd.dispatchEvent('#sgP','change');
  await pd.waitForTimeout(200);
  await pd.screenshot({ path: SH+'70-duty-setup.png', fullPage:true });
  await pd.click('#btnAuto'); await pd.waitForTimeout(500);
  // تحقق قاعدة المناوبة: المختار رتبته ≤ رتبة أي غير مختار
  const dutyOk = await pd.evaluate(()=>{ const p=P(); return Object.entries(p.dutyDays).every(([k,ids])=>{ const w=wdOf(k); const maxSel=Math.max(...ids.map(id=>dutyRank(id,w))); return p.participants.filter(id=>!ids.includes(id)).every(id=>dutyRank(id,w)>=maxSel); }); });
  const supOk = await pd.evaluate(()=>{ const p=P(), s=S(); let ok=true; s.days.forEach(w=>s.events.forEach(ev=>{ if(!evOnDay(ev,w)) return; const all=Object.values((p.sup[w]||{})[ev.key]||{}).flat(); const maxSel=Math.max(...all.map(id=>supTier(id,w,ev).rank)); p.participants.filter(id=>!all.includes(id)).forEach(id=>{ if(supTier(id,w,ev).rank<maxSel) ok=false; }); })); return ok; });
  out('2. duty priority respected =', dutyOk, ' sup priority respected =', supOk);
  out('   duty sample =', await pd.evaluate(()=>{ const k=Object.keys(P().dutyDays)[0]; return k+' → '+P().dutyDays[k].map(id=>uName(id)+'('+dutyRankLabel(dutyRank(id,wdOf(k)))+')').join('، '); }));
  out('   sup Sunday break الساحة =', await pd.evaluate(()=>{ const p=P(); const pl=p.places[0].id; return (p.sup[0].break_3[pl]||[]).map(id=>uName(id)+'('+supTier(id,0,S().events[0]).t.k+')').join('، '); }));
  const tabDuty = await pd.$eval('#tabBody', e=>e.innerText.replace(/\s+/g,' '));
  out('   duty tab shows =', tabDuty.includes('جدول المناوبة بالتواريخ'), ' warnings =', (tabDuty.match(/لم يُكلَّف[^\n]*/)||[''])[0].slice(0,80));
  await pd.screenshot({ path: SH+'71-duty-days.png', fullPage:true });
  await pd.click('[data-tab="sup"]'); await pd.waitForTimeout(200);
  await pd.screenshot({ path: SH+'72-duty-sup.png', fullPage:true });
  // تعديل يدوي لخانة
  await pd.click('[data-sw="0"][data-se="prayer_5"]'); await pd.waitForSelector('#pkOk');
  const firstUnchecked = await pd.$('#ovl input:not(:checked)');
  if(firstUnchecked) await firstUnchecked.check();
  await pd.click('#pkOk'); await pd.waitForTimeout(300);
  out('   manual edit saved =', await pd.evaluate(()=>{ const p=P(); const pl=p.places[2].id; return (p.sup[0].prayer_5[pl]||[]).length; }), '(expect +1)');
  await pd.click('#btnPrint'); await pd.waitForTimeout(200);
  const pr = await pd.evaluate(()=>window.__printed||'');
  out('   print: title =', pr.includes('سجل المناوبة والإشراف اليومي'), ' weeks pages =', (pr.match(/class="pg"/g)||[]).length, ' names =', pr.includes('منير النمري') && pr.includes('ياسر الجميعي'), ' sup text =', pr.includes('الفسحة — الساحة'));
  const plan = await pd.evaluate(()=>__mockDB()['dutyPlans/S2_first_m']);
  out('   plan saved: places =', plan && plan.places.length, ' dutyDays =', plan && Object.keys(plan.dutyDays).length, ' pub =', plan && !!plan.pub);
  const DBa = await pd.evaluate(()=>__mockDB());

  // ===== المدير: الاعتماد والتعميم =====
  const ps = await open(browser, 'U_SA1', SA, DBa, 'duty.html');
  out('3. principal publish enabled =', await ps.$eval('#btnPub', b=>!b.disabled));
  await ps.click('#btnPub'); await ps.waitForTimeout(1500);
  const DBs = await ps.evaluate(()=>__mockDB());
  const pl2 = DBs['dutyPlans/S2_first_m'];
  const circ = Object.entries(DBs).find(([k,v])=>k.startsWith('circulars/S2/items/') && k.split('/').length===4 && v.source==='duty');
  out('   pub saved =', !!pl2.pub, ' members =', pl2.members.length, ' circular =', circ && circ[1].number, ' mandatory =', circ && circ[1].mandatory, ' recipients =', circ && circ[1].recipients.length, ' pages =', circ && circ[1].pageCount);
  const pageDoc = circ && DBs[circ[0]+'/pages/0'];
  out('   page0 is jpeg =', !!(pageDoc && /^data:image\/jpeg/.test(pageDoc.dataUrl)), ' size KB =', pageDoc && Math.round(pageDoc.dataUrl.length/1024));
  const recv = await ps.$eval('#tabBody', e=>e.innerText.replace(/\s+/g,' '));
  out('   receipt tab =', recv.includes('وقّع 0 من') || recv.includes('وقّع ٠ من'));
  await ps.screenshot({ path: SH+'73-duty-recv.png', fullPage:true });
  // صفحة التعميم كصورة
  if(pageDoc){ const b64 = pageDoc.dataUrl.split(',')[1]; fs.writeFileSync(SH+'74-duty-circ-p0.jpg', Buffer.from(b64,'base64')); const p1 = DBs[circ[0]+'/pages/1']; if(p1) fs.writeFileSync(SH+'75-duty-circ-p1.jpg', Buffer.from(p1.dataUrl.split(',')[1],'base64')); }

  // ===== المعلم: لوحتي ← مناوبتي =====
  const memberId = pl2.members.find(id=>id!=='u4') || pl2.members[0];
  const T = { userId:memberId, username:'معلم', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pt = await open(browser, DBs['users/'+memberId].authUid, T, DBs);
  await pt.evaluate(()=>refreshMyBoardAlerts()); await pt.waitForTimeout(400);
  out('4. teacher', memberId, 'duty entries =', await pt.evaluate(()=>MYBOARD.duty.length), ' dot =', await pt.evaluate(()=>MYBOARD.dutyChanged));
  await pt.evaluate(()=>window.scrollTo(0,0));
  await pt.click('#myBoardToggle'); await pt.waitForTimeout(200);
  out('   لوحتي items =', JSON.stringify(await pt.$$eval('#myBoardMenu .tools-item', b=>b.map(x=>x.dataset.key))));
  await pt.click('#myBoardMenu [data-key="duty"]'); await pt.waitForTimeout(300);
  const mv = await pt.$eval('.modal', e=>e.innerText.replace(/\s+/g,' '));
  out('   modal =', mv.includes('مناوبتي وإشرافي'), ' has duty/sup =', mv.includes('المناوبة') && mv.includes('الإشراف'), ' circular link =', mv.includes('التوقيع على التعميم'));
  await pt.screenshot({ path: SH+'76-myduty.png' });
  out('   dot cleared =', await pt.evaluate(()=>!MYBOARD.dutyChanged));
  // معلم ليس عضوًا
  const non = Object.keys(DBs).filter(k=>/^users\/u\d$/.test(k)).map(k=>k.slice(6)).find(id=>!pl2.members.includes(id));
  if(non){ const pn = await open(browser, DBs['users/'+non].authUid, { userId:non, username:'x', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' }, DBs);
    await pn.evaluate(()=>refreshMyBoardAlerts()); await pn.waitForTimeout(300);
    out('   non-member duty item =', await pn.evaluate(()=>MYBOARD_ITEMS.find(t=>t.key==='duty').when()), '(expect false)'); }
  else out('   (all teachers are members)');
  // المعلم لا يدخل الأداة
  const pbt = await open(browser, DBs['users/'+memberId].authUid, T, DBs, 'duty.html');
  out('   teacher blocked =', (await pbt.$eval('#bootView', e=>e.innerText)).includes('لمدير المدرسة والوكيل'));
  out('PAGE ERRORS:', ERRS);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
