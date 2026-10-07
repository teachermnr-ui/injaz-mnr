const { chromium } = require('playwright');
const fs = require('fs');
const MOD = fs.readFileSync(__dirname+'/mock-modular.js','utf8');
const out=(...a)=>console.log(...a);
function seed(){
  const DB = {};
  DB['users/u1'] = { username:'محمد نجيب', loginId:'1001', authUid:'U_u1', active:true, schools:{ S2:{ role:'teacher', permissions:{ 'worksheets.enabled':{access:true,edit:true} }, assignedClasses:['101'], subjectAssignments:[{classCode:'101',subject:'الرياضيات'}], active:true } }, solo:{ active:true } };
  DB['schoolData/roster_S2'] = { value: JSON.stringify({ classes:[{name:'أول ثانوي',code:'101',stage:'ثانوية'}], students:[{name:'طالب أ',seat:'111',classCode:'101'},{name:'طالب ب',seat:'222',classCode:'101'}] }) };
  const base = { createdBy:'u1', createdByName:'محمد', subject:'الرياضيات', grade:'', unit:'', lesson:'', exercises:[{exerciseId:'e1',type:'mcq',data:{items:[{prompt:'1+1',options:['2','3'],correctIndex:0}]}}], assignedClassIds:['101'], status:'published' };
  DB['worksheets/W1'] = Object.assign({}, base, { title:'نشاط هنا', schoolId:'S2', period:'first' });
  DB['worksheets/W2'] = Object.assign({}, base, { title:'نشاط الفترة الثانية', schoolId:'S2', period:'second' });
  DB['worksheets/W3'] = Object.assign({}, base, { title:'نشاط فردي', schoolId:null, period:'first' });
  DB['worksheets/W5'] = Object.assign({}, base, { title:'نشاط قديم بلا فترة', schoolId:'S2' });
  DB['worksheets/W4'] = Object.assign({}, base, { title:'مسودة', status:'draft', schoolId:'S9', assignedClassIds:[] });
  // مدرسة أخرى بنفس رمز الفصل 101
  DB['worksheets/X1'] = Object.assign({}, base, { title:'نشاط مدرسة أخرى', createdBy:'zz', schoolId:'S9', period:'first' });
  DB['submissions/s1'] = { worksheetId:'W1', studentId:'111', studentUid:'STU1', teacherUid:'u1', status:'submitted', totalScore:'1 / 1' };
  DB['submissions/s2'] = { worksheetId:'W1', studentId:'222', status:'submitted', totalScore:'0 / 1' };   // قديم بلا حقول
  // الطالب
  DB['studentAccounts/STU1'] = { googleUid:'STU1', seat:'111', email:'s@x', linkedRosters:[] };
  DB['rosterIndex/S2'] = { rosterId:'S2', kind:'school', seatList:['111','222'], classBySeat:{ '111':['101'], '222':['101'] }, classMeta:{} };
  DB['rosterIndex/S9'] = { rosterId:'S9', kind:'school', seatList:['999'], classBySeat:{ '999':['101'] }, classMeta:{} };
  return DB;
}
async function ctxFor(browser, uid, local){
  const ctx = await browser.newContext({ viewport:{ width:1280, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'window.pdfjsLib={GlobalWorkerOptions:{}};' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*\.js/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOD }));
  await ctx.addInitScript(([uid, local, db])=>{ window.__mockUid=uid; Object.entries(local).forEach(([k,v])=>localStorage.setItem(k, JSON.stringify(v))); if(!sessionStorage.getItem('__s')){ localStorage.setItem('__mockdb', JSON.stringify(db)); sessionStorage.setItem('__s','1'); } window.alert=m=>(window.__alerts=window.__alerts||[]).push(m); window.confirm=()=>true; }, [uid, local, seed()]);
  const page = await ctx.newPage(); page.on('pageerror', e=>out('PAGE ERROR:', e.message));
  return page;
}
(async()=>{
  const browser = await chromium.launch();
  // المعلم في المدرسة S2، الفترة الأولى
  let p = await ctxFor(browser, 'U_u1', { cls_session:{ userId:'u1', username:'محمد نجيب', role:'teacher', schoolId:'S2', period:'first' } });
  await p.goto('http://127.0.0.1:8765/worksheets.html'); await p.waitForTimeout(1500);
  await p.evaluate(()=>showWsTab('submissions')); await p.click('#refreshWsBtn'); await p.waitForTimeout(600);
  const listText = await p.$eval('#worksheetsList', e=>e.innerText.replace(/\s+/g,' '));
  out('teacher S2/first list:', listText.slice(0,300));
  out('   reclaim called =', JSON.stringify(await p.evaluate(()=>window.__calls||[])));
  // نسخ نشاط من سياق آخر
  await p.click('[data-copy-here="W2"]'); await p.waitForTimeout(400);
  const copies = await p.evaluate(()=>Object.entries(__mockDB()).filter(([k,v])=>k.startsWith('worksheets/') && v.copiedFrom==='W2').map(([k,v])=>({st:v.status, sid:v.schoolId, by:v.createdBy})));
  out('   copy created:', JSON.stringify(copies));
  // فتح نشاط هنا: التسليمات الجديدة والقديمة
  await p.click('[data-open-ws="W1"]'); await p.waitForTimeout(600);
  out('   students list:', (await p.$eval('#studentsList', e=>e.innerText.replace(/\s+/g,' '))).slice(0,200));
  await p.screenshot({ path:'/tmp/claude-0/tt/shots/30-ws-teacher.png', fullPage:true });
  // المعلم نفسه في حسابه الفردي: يرى W3 هنا
  p = await ctxFor(browser, 'U_u1', { cls_session:{ userId:'u1', username:'محمد نجيب', role:'soloTeacher', schoolId:null, period:'first' } });
  await p.goto('http://127.0.0.1:8765/worksheets.html'); await p.waitForTimeout(1500);
  await p.evaluate(()=>showWsTab('submissions')); await p.click('#refreshWsBtn'); await p.waitForTimeout(600);
  out('teacher solo list:', (await p.$eval('#worksheetsList', e=>e.innerText.replace(/\s+/g,' '))).slice(0,200));
  // النشر يختم السياق والفترة
  await p.evaluate(()=>showWsTab('publish')); await p.waitForTimeout(600);
  out('   drafts (library across contexts):', (await p.$eval('#draftsList', e=>e.innerText.replace(/\s+/g,' '))).slice(0,160));
  // الطالب: يرى نشاط مدرسته فقط رغم تكرار رمز 101 في مدرسة أخرى
  const s = await ctxFor(browser, 'STU1', { stu_session:{ seat:'111', googleUid:'STU1', accountId:'STU1' } });
  await s.goto('http://127.0.0.1:8765/student-worksheets.html'); await s.waitForTimeout(1500);
  const stuText = await s.$eval('#worksheetsWrap', e=>e.innerText.replace(/\s+/g,' '));
  out('student sees:', stuText.slice(0,300));
  out('   other school visible =', stuText.includes('نشاط مدرسة أخرى'), ' W1 status mapped =', stuText.includes('مُسلّم'));
  await s.screenshot({ path:'/tmp/claude-0/tt/shots/31-student.png', fullPage:true });
  // حل نشاط: الحقول الجديدة في التسليم
  const s2 = await ctxFor(browser, 'STU1', { stu_session:{ seat:'111', googleUid:'STU1', accountId:'STU1' } });
  await s2.goto('http://127.0.0.1:8765/student-solve.html?worksheetId=W5'); await s2.waitForTimeout(1500);
  await s2.evaluate(()=>{ const b=document.getElementById('submitBtn'); if(b){ b.style.display='block'; b.click(); } });
  await s2.waitForTimeout(600);
  const sub = await s2.evaluate(()=>Object.values(__mockDB()).find(v=>v.worksheetId==='W5'));
  out('student submission fields:', JSON.stringify(sub && { studentUid:sub.studentUid, teacherUid:sub.teacherUid, schoolId:sub.schoolId, period:sub.period, studentId:sub.studentId }));
  await browser.close();
})().catch(e=>{ console.error('FAILED', e); process.exit(1); });
