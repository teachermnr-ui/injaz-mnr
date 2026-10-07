const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
const SH = __dirname+'/shots/';
async function open(browser, uid, session, db, url, vw){
  const ctx = await browser.newContext({ viewport: vw||{ width:1200, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid,s,db])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{};
    window.open=()=>({ document:{ write:h=>{ window.__printed=(window.__printed||'')+h; }, close(){} } });
  }, [uid,session,db]);
  const p = await ctx.newPage(); p.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await p.goto('http://127.0.0.1:8765/'+(url||'index.html')); await p.waitForTimeout(1800);
  return p;
}
const openClass = p=>p.evaluate(()=>{ activeTab='classes'; renderTabs&&renderTabs(); return renderPanel(); }).then(()=>p.waitForTimeout(600)).then(()=>p.evaluate(()=>{
  const st=groupStages().find(g=>g.classes.some(c=>c.code==='م1أ')); RUI.openStage=st.name; RUI.openClass='م1أ'; paintClasses(); }));
(async()=>{
  const browser = await chromium.launch();
  const SA = { userId:'sa1', username:'المدير', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };

  // ١) المدير: زر «استئذان» بجانب غائب/متأخر، وتسجيل
  const p = await open(browser, 'U_SA1', SA, DB0);
  await openClass(p);
  out('1. buttons on student row =', JSON.stringify(await p.$$eval('#content button', b=>b.map(x=>x.textContent.trim()).filter(t=>['غائب','متأخر','استئذان'].includes(t)))));
  await p.screenshot({ path: SH+'40-leave-button.png' });
  await p.click('button:has-text("استئذان")'); await p.waitForSelector('#lvOk');
  await p.click('#lvOk'); await p.waitForTimeout(150);
  out('   validation (no receiver) =', await p.$eval('#lvAlert', e=>e.innerText.trim()));
  await p.selectOption('#lvReason', 'أخرى'); await p.click('#lvOk'); await p.waitForTimeout(100);
  out('   validation (other w/o text) =', await p.$eval('#lvAlert', e=>e.innerText.trim()));
  await p.fill('#lvOther', 'موعد في الأحوال المدنية'); await p.fill('#lvRecv', 'أحمد محمد'); await p.selectOption('#lvRel','الأب'); await p.fill('#lvPhone','0500000000'); await p.fill('#lvTime','10:30');
  await p.screenshot({ path: SH+'41-leave-form.png' });
  await p.click('#lvOk'); await p.waitForSelector('#lvPrint');
  const saved = await p.evaluate(()=>Object.entries(__mockDB()).filter(([k])=>k.startsWith('leaves/')).map(([k,v])=>v));
  out('   saved docs =', saved.length, JSON.stringify(saved[0] && { seat:saved[0].seat, time:saved[0].time, reason:saved[0].reason, reasonText:saved[0].reasonText, recv:saved[0].receiverName, rel:saved[0].receiverRel, by:saved[0].byName, period:saved[0].period, cls:saved[0].classCode }));
  out('   attendance untouched (no att doc for 111 today) =', await p.evaluate(()=>!Object.keys(__mockDB()).some(k=>k.startsWith('attendance/') && k.includes('_111_'))));
  await p.click('#lvPrint'); await p.waitForTimeout(100);
  const slip = await p.evaluate(()=>window.__printed||'');
  out('   slip printed: title =', slip.includes('إذن خروج طالب'), ' receiver =', slip.includes('أحمد محمد'), ' reason =', slip.includes('موعد في الأحوال المدنية'), ' signature+stamp =', slip.includes('توقيع المستلِم') && slip.includes('ختم المدرسة'));
  fs.writeFileSync(SH+'42-leave-slip.html', slip);
  await p.evaluate(()=>{ window.__printed=''; closeModal(); });

  // ٢) تبويب «تأخر وغياب الطلاب»: قسم «الاستئذان» في بطاقة اليوم
  await p.evaluate(()=>{ activeTab='absence'; renderTabs&&renderTabs(); renderPanel(); }); await p.waitForTimeout(800);
  await p.evaluate(()=>{ const dk=attDateKey(); ABS_OPEN[dk]=true; paintAbsence(); }); await p.waitForTimeout(200);
  const absTxt = await p.$eval('#absRoot', e=>e.innerText.replace(/\s+/g,' '));
  out('2. day card has الاستئذان section =', /الاستئذان \(1\)/.test(absTxt), ' row shows time/receiver/by =', absTxt.includes('خرج 10:30') && absTxt.includes('أحمد محمد') && absTxt.includes('ياسر الجميعي'));
  await p.screenshot({ path: SH+'43-leave-in-absence.png', fullPage:true });
  await p.evaluate(()=>printAbsDay(attDateKey())); await p.waitForTimeout(100);
  const dayPdf = await p.evaluate(()=>window.__printed||'');
  out('   day PDF includes leave table =', dayPdf.includes('الاستئذان — العدد: 1') && dayPdf.includes('أحمد محمد'));
  // سجل الطالب
  await p.evaluate(()=>openStudentRecordIndex('111','م1أ')); await p.waitForTimeout(500);
  out('   student record shows leaves =', await p.$eval('#srIdxBody', e=>e.innerText.includes('الاستئذان (العدد: 1)')));
  await p.evaluate(()=>closeModal());
  // أيام الغياب لم تتأثر
  out('   absence days for 111 unaffected =', await p.evaluate(()=>(RABS['111']||0)===0));

  // ٣) الموجه بلا صلاحيات: لا زر — ثم مع «تسجيل الاستئذان» فقط: يظهر الزر ويحفظ
  const AG = { userId:'ag1', username:'مستشار', role:'counselor', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const DBa = JSON.parse(JSON.stringify(await p.evaluate(()=>__mockDB())));
  const p2 = await open(browser, 'U_ag1', AG, DBa);
  const hasClassesTab = await p2.evaluate(()=>visibleTabs().some(t=>t.key==='classes'));
  out('3. counselor default: classes tab visible =', hasClassesTab, ' canLeave =', await p2.evaluate(()=>canLeave()));
  const DBb = JSON.parse(JSON.stringify(DBa));
  const ctx = DBb['users/ag1'].schools.S2; ctx.permissions = Object.assign({}, ctx.permissions||{}, { 'index.classes':{access:true,edit:false,del:false}, 'index.leave':{access:false,edit:true,del:false} });
  const p3 = await open(browser, 'U_ag1', AG, DBb);
  out('   with index.leave: canLeave =', await p3.evaluate(()=>canLeave()), ' can edit absence =', await p3.evaluate(()=>can('index.absence','edit')));
  await openClass(p3);
  const btns3 = await p3.$$eval('#content button', b=>b.map(x=>x.textContent.trim()).filter(t=>['غائب','متأخر','استئذان'].includes(t)));
  out('   buttons =', JSON.stringify(btns3), '(expect only استئذان)');
  out('   perm editor lists «تسجيل الاستئذان» =', await p3.evaluate(()=>JSON.stringify(PERM_TREE).includes('تسجيل الاستئذان')));

  // ٤) المعلم في إدارة الصفوف: «مستأذن 10:30» بجانب اسم الطالب
  const U1 = { userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const p4 = await open(browser, 'U_u1', U1, DBa, 'omr.html');
  await p4.waitForTimeout(1500);
  out('4. omr leaves loaded =', JSON.stringify(await p4.evaluate(()=>Object.keys(CLS_LEAVES_TODAY))));
  const chip = await p4.evaluate(()=>{
    const sel=document.getElementById('stViewClass'); if(!sel) return 'no selector';
    const opt=[...sel.options].find(o=>o.value.startsWith('م1أ')); if(!opt) return 'no class option: '+[...sel.options].map(o=>o.value).join(',');
    sel.value=opt.value; renderStudents();
    const card=[...document.querySelectorAll('#studentsHost .stcard')].find(c=>c.innerText.includes('111')); return card ? card.innerText.replace(/\s+/g,' ').slice(0,160) : 'no card';
  });
  out('   student card =', chip, ' has chip =', chip.includes('مستأذن 10:30'));
  await p4.screenshot({ path: SH+'44-leave-omr.png' });
  await browser.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
