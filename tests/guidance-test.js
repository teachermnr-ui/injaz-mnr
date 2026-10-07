const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB0 = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
const SH = __dirname+'/shots/';
async function open(browser, uid, session, db){
  const ctx = await browser.newContext({ viewport:{ width:1200, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([uid,s,db])=>{
    window.__mockUid=uid; localStorage.setItem('cls_session', JSON.stringify(s)); localStorage.setItem('__mockdb', JSON.stringify(db));
    window.confirm=()=>true; window.alert=()=>{};
    window.open=()=>({ document:{ write:h=>{ window.__printed=(window.__printed||'')+h; }, close(){} } });
  }, [uid,session,db]);
  const p = await ctx.newPage(); p.on('pageerror', e=>out('PAGE ERROR:', e.message));
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForTimeout(1800);
  return p;
}
const go = (p,tab)=>p.evaluate(t=>{ activeTab=t; renderTabs(); renderPanel(); }, tab).then(()=>p.waitForTimeout(700));
const dk = d=>{ const x=new Date(); x.setDate(x.getDate()-d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
(async()=>{
  const browser = await chromium.launch();
  const DB = JSON.parse(JSON.stringify(DB0));
  // ٥ أيام غياب لطالب 111 سجّلها ٣ أشخاص مختلفين + ٣ تحويلات عنه
  const markers = ['u1','u2','sa1','u1','u2'];
  for(let i=0;i<5;i++){ const d=dk(i); DB['attendance/att_S2_first_111_'+d] = { schoolId:'S2', period:'first', seat:'111', name:'طالب', classCode:'م1أ', className:'أول متوسط', date:d, status:'absent', markedBy:markers[i], markedByName:markers[i], ts:Date.now()-i*86400000 }; }
  for(let i=0;i<3;i++) DB['notes/n_g'+i] = { schoolId:'S2', period:'first', fromUserId:'u1', fromName:'معلم', recipients:['u4'], recipientsInfo:[], scope:'student', studentSeat:'111', studentName:'طالب', classCode:'م1أ', text:'ملاحظة', createdAt:Date.now()-i*1000, replies:[], readAt:{}, closed:false };

  // الوكيل بصلاحياته الافتراضية الحقيقية (الغياب وصول+تعديل)
  DB['users/u4'].schools.S2.permissions = Object.assign({}, DB['users/u4'].schools.S2.permissions||{}, { 'index.absence':{access:true,edit:true,del:false}, 'index.sent':{access:true,edit:true,del:false}, 'index.received':{access:true,edit:true,del:false} });
  // ===== ١) الوكيل =====
  const AGT = { userId:'u4', username:'الوكيل', role:'agent', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pa = await open(browser, 'U_u4', AGT, DB);
  out('1. agent: guidance tab visible =', await pa.evaluate(()=>visibleTabs().some(t=>t.key==='guidance')), '(expect false)  canAppts =', await pa.evaluate(()=>canAppts()));
  await go(pa,'absence');
  await pa.evaluate(()=>{ ABS_OPEN[attDateKey()]=true; paintAbsence(); }); await pa.waitForTimeout(150);
  out('   absence days on card (5 days by 3 recorders) =', await pa.evaluate(()=>{ const t=document.querySelector('#absRoot').innerText; const m=t.match(/أيام الغياب\s*(\d+)/); return m?m[1]:t.slice(0,80); }), '(expect 5)');
  out('   refer button present =', !!(await pa.$('button:has-text("تحويل للموجه")')));
  await pa.click('button:has-text("تحويل للموجه")'); await pa.waitForSelector('#grOk');
  await pa.selectOption('#grR','غياب متكرر'); await pa.fill('#grT','غاب ٥ أيام متتالية'); await pa.click('#grOk'); await pa.waitForTimeout(400);
  const ref = await pa.evaluate(()=>Object.values(__mockDB()).find(v=>v && v.guidanceReferral));
  out('   referral note: recipients =', JSON.stringify(ref && ref.recipients), ' reason =', ref && ref.referralReason, ' seat =', ref && ref.studentSeat);
  // لوحتي ← مواعيدي
  await pa.evaluate(()=>refreshMyBoardAlerts()); await pa.waitForTimeout(300);
  await pa.evaluate(()=>window.scrollTo(0,0)); await pa.waitForTimeout(200);
  await pa.click('#myBoardToggle'); await pa.waitForTimeout(200);
  out('   لوحتي items =', JSON.stringify(await pa.$$eval('#myBoardMenu .tools-item', b=>b.map(x=>x.dataset.key))));
  await pa.click('#myBoardMenu [data-key="appts"]'); await pa.waitForSelector('#myApptHost button');
  await pa.click('#myApptHost button:has-text("+ موعد جديد")'); await pa.waitForSelector('#gaOk');
  await pa.selectOption('#gaCls','م1أ'); await pa.selectOption('#gaStu','111'); await pa.fill('#gaG','سعد'); await pa.fill('#gaP','0555'); await pa.fill('#gaR','مناقشة الغياب');
  await pa.click('#gaOk'); await pa.waitForTimeout(500);
  out('   agent appt saved, back in مواعيدي modal =', !!(await pa.$('#myApptHost')), ' today count =', await pa.$$eval('#myApptHost .card', e=>e.length));
  await pa.screenshot({ path: SH+'50-agent-appts.png' });
  await pa.evaluate(()=>{ closeModal(); return refreshMyBoardAlerts(); }); await pa.waitForTimeout(300);
  out('   لوحتي dot for today appt =', await pa.evaluate(()=>MYBOARD.apptsToday), '(expect 1)');
  const DBa = await pa.evaluate(()=>__mockDB());

  // ===== ٢) الموجه =====
  const CNS = { userId:'ag1', username:'الموجه', role:'counselor', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const pc = await open(browser, 'U_ag1', CNS, DBa);
  out('2. counselor: guidance tab visible =', await pc.evaluate(()=>visibleTabs().some(t=>t.key==='guidance')), ' full =', await pc.evaluate(()=>guideFull()));
  await go(pc,'guidance');
  const listTxt = await pc.$eval('#gBody', e=>e.innerText.replace(/\s+/g,' '));
  out('   list row 111: abs chip =', listTxt.includes('5 أيام غياب'), ' notes chip =', /\d+ تحويلات/.test(listTxt), ' referral chip =', listTxt.includes('محوَّل من') && listTxt.includes('غياب متكرر'));
  await pc.screenshot({ path: SH+'51-guidance-list.png', fullPage:true });
  // الفلتر
  await pc.evaluate(()=>{ GUIDE.filter='l'; paintGuideList(); });
  out('   filter استئذان hides row =', await pc.$eval('#gBody', e=>e.innerText.includes('لا يوجد طلاب')));
  await pc.evaluate(()=>{ GUIDE.filter='all'; paintGuideList(); });
  // فتح حالة
  await pc.click('#gBody button:has-text("فتح حالة")'); await pc.waitForSelector('#gcOk');
  await pc.selectOption('#gcType','سلوكية'); await pc.click('#gcOk'); await pc.waitForTimeout(700);
  const cs = await pc.evaluate(()=>Object.values(__mockDB()).filter(v=>v && v.caseId===undefined && v.type && v.openedBy));
  out('   case created =', cs.length, ' source =', cs[0] && cs[0].source, '(expect referral)  status =', cs[0] && cs[0].status);
  await pc.click('button:has-text("+ جلسة جديدة")'); await pc.waitForSelector('#gsOk');
  await pc.click('#gsOk'); await pc.waitForTimeout(100);
  out('   session validation =', await pc.$eval('#gsAlert', e=>e.innerText.trim()));
  await pc.fill('#gsSum','جلسة أولى مع الطالب حول الغياب'); await pc.selectOption('#gsAct','توجيه فردي');
  await pc.evaluate(()=>{ document.getElementById('gsNext').value = attDateKey(); });
  await pc.click('#gsOk'); await pc.waitForTimeout(700);
  out('   session shown =', await pc.$eval('#gSessList', e=>e.innerText.includes('جلسة أولى')), ' case sessionsCount =', await pc.evaluate(()=>GUIDE.data.cases[0].sessionsCount));
  await pc.screenshot({ path: SH+'52-guidance-case.png', fullPage:true });
  await pc.evaluate(()=>printCaseReport(GUIDE.selCase)); await pc.waitForTimeout(300);
  out('   case report printed =', await pc.evaluate(()=>(window.__printed||'').includes('تقرير حالة إرشادية') && (window.__printed||'').includes('جلسة أولى')));
  // المواعيد: لا يرى موعد الوكيل، ويُنشئ موعدًا مرتبطًا بالحالة
  await pc.evaluate(()=>{ GUIDE.sub='appts'; renderGuidance($('#content')); }); await pc.waitForTimeout(600);
  out('   counselor appts sees agent appt =', await pc.$eval('#gBody', e=>e.innerText.includes('سعد')), '(expect false)');
  await pc.click('#gBody button:has-text("+ موعد جديد")'); await pc.waitForSelector('#gaOk');
  await pc.selectOption('#gaCls','م1أ'); await pc.selectOption('#gaStu','111'); await pc.fill('#gaG','والد الطالب'); await pc.fill('#gaR','متابعة الحالة');
  await pc.click('#gaOk'); await pc.waitForTimeout(800);
  out('   counselor appt linked to case =', await pc.$eval('#gBody', e=>e.innerText.includes('مرتبط بحالة')));
  await pc.click('#gBody button:has-text("حضر")'); await pc.waitForSelector('#garOk');
  await pc.fill('#gaRes','اتفقنا على متابعة يومية'); await pc.click('#garOk'); await pc.waitForTimeout(800);
  const sessN = await pc.evaluate(()=>Object.values(__mockDB()).filter(v=>v && v.caseId && v.summary).length);
  out('   attended → auto session added (sessions now) =', sessN, '(expect 2)');
  // لوحتي: متابعاتي (متابعة مستحقة اليوم) + مواعيدي
  await pc.evaluate(()=>refreshMyBoardAlerts()); await pc.waitForTimeout(400);
  out('   لوحتي: followupsDue =', await pc.evaluate(()=>MYBOARD.followupsDue), ' items =', await pc.evaluate(()=>JSON.stringify(MYBOARD_ITEMS.filter(t=>!t.when||t.when()).map(t=>t.key))));
  // الحدود
  await pc.evaluate(()=>{ GUIDE.sub='list'; return renderGuidance($('#content')); }); await pc.waitForTimeout(600);
  await pc.click('#gBody button:has-text("تعديل الحدود")'); await pc.waitForSelector('#gtOk');
  await pc.fill('#gtA','10'); await pc.click('#gtOk'); await pc.waitForTimeout(700);
  out('   thresholds saved =', JSON.stringify(await pc.evaluate(()=>__mockDB()['guidanceSettings/S2'].thr)), ' abs chip gone (5<10) =', !(await pc.$eval('#gBody', e=>e.innerText.includes('أيام غياب'))));
  // التجاهل
  await pc.click('#gBody button:has-text("تجاهل لهذه الفترة")'); await pc.waitForTimeout(700);
  out('   ignored → hidden =', await pc.$eval('#gBody', e=>e.innerText.includes('لا يوجد طلاب')));
  const DBc = await pc.evaluate(()=>__mockDB());

  // ===== ٣) المدير: اطلاع بلا تفاصيل =====
  const SA = { userId:'sa1', username:'المدير', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' };
  const ps = await open(browser, 'U_SA1', SA, DBc);
  out('3. principal: tab visible =', await ps.evaluate(()=>visibleTabs().some(t=>t.key==='guidance')), ' full =', await ps.evaluate(()=>guideFull()), '(expect false)');
  await ps.evaluate(()=>{ GUIDE.sub='cases'; GUIDE.caseFilter='open'; }); await go(ps,'guidance');
  const caseTxt = await ps.$eval('#gBody', e=>e.innerText.replace(/\s+/g,' '));
  out('   sees case meta =', caseTxt.includes('سلوكية'), ' sees session text =', caseTxt.includes('جلسة أولى'), '(expect false)  privacy note =', caseTxt.includes('خاصة بالموجه'), ' no add-session btn =', !caseTxt.includes('+ جلسة جديدة'));
  out('   sub-tabs =', JSON.stringify(await ps.$$eval('#gSubs button', b=>b.map(x=>x.textContent.trim()))));
  await ps.screenshot({ path: SH+'53-guidance-principal.png', fullPage:true });
  await browser.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
