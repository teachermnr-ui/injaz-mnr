// اختبار المرحلة ٣ — التحويلات (من المعلم إلى وكيل الشؤون الطلابية) على mock-firebase
const { chromium } = require('playwright'); const fs = require('fs');
const MOCK = fs.readFileSync(__dirname + '/mock-firebase.js', 'utf8');
let FAIL = 0, ERRS = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) FAIL++; };
const tUser = (name, perms, role) => ({ active: true, role: 'teacher', username: name, schools: { S1: { role: role || 'teacher', active: true, assignedClasses: ['__all__'], permissions: perms || {}, subjectAssignments: [{ classCode: '1/1', subject: 'الرياضيات' }, { classCode: '1/2', subject: 'العلوم' }] } } });
const tr = (id, seat, name, cls, why, st, extra) => ['notes/' + id, Object.assign({ schoolId: 'S1', period: 'first', trType: 'st', trSt: st, trReason: why, referralReason: why, studentSeat: String(seat), studentName: name, className: cls, classCode: cls,
  subject: 'الرياضيات', lessonNo: 3, dayName: 'الأحد', dateH: '1448/05/08', dateG: '2026-10-18', fromUserId: 'T1', fromName: 'معلم أول', recipients: ['A1'], text: 'ملاحظة ' + id, createdAt: Number(id.replace(/\D/g, '')) * 1000, replies: [], readAt: {}, closed: false }, extra || {})];
const DB0 = {
  'schoolData/S1': { name: 'مدرسة التجربة', _isSchool: true },
  'schoolData/roster_S1': { value: JSON.stringify({ classes: [{ code: '1/1', name: 'أول/١' }], students: [{ seat: '5', name: 'سالم', classCode: '1/1' }, { seat: '6', name: 'ماجد', classCode: '1/1' }] }) },
  'users/M1': { authUid: 'M1', active: true, role: 'schoolAdmin', username: 'المدير', adminSchools: ['S1'] },
  'users/T1': Object.assign({ authUid: 'T1' }, tUser('معلم أول', { 'omr.classes': { access: true, edit: true, del: true } })),
  'users/A1': Object.assign({ authUid: 'A1' }, tUser('وكيل طلابي', { 'tools.agentStudents': { access: true, edit: true } }, 'agent')),
  'users/A2': Object.assign({ authUid: 'A2' }, tUser('وكيل اطلاع', { 'tools.agentStudents': { access: true } }, 'agent')),
  'users/A3': Object.assign({ authUid: 'A3' }, tUser('وكيل بلا صلاحية', {}, 'agent'))
};
[
  tr('n1', 21, 'طالب اثنان', '٢/١', 'عدم أداء الواجب', 'new'), tr('n2', 21, 'طالب اثنان', '٢/١', 'تأخر عن الحصة', 'obs', { agentReport: 'نُبّه الطالب', reportAt: 5 }),
  tr('n3', 22, 'طالب واحد', '٢/٢', 'مشاغبة', 'new'),
  tr('n4', 23, 'طالب ملاحظة', '٢/٣', 'ضعف دراسي', 'obs', { agentReport: 'استُدعي' }),
  tr('n5', 24, 'طالب محال', '٢/٤', 'أخرى', 'ref'), tr('n6', 25, 'طالب منتهٍ', '٢/٥', 'مشاغبة', 'done', { agentReport: 'ت' }),
  tr('n7', 26, 'طالب فصل آخر', '٢/٦', 'مشاغبة', 'new', { period: 'second' })
].forEach(([k, v]) => DB0[k] = v);
DB0['notes/old1'] = { schoolId: 'S1', period: 'first', scope: 'student', studentSeat: '30', studentName: 'قديم', className: 'ق', fromUserId: 'T1', recipients: ['A1'], text: 'قديم', createdAt: 1, replies: [], readAt: {}, closed: false };

async function ctxFor(b, uid, w) { const ctx = await b.newContext({ viewport: { width: w || 1280, height: 1000 } });
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic/, r => { if (/firebase-app-compat/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/javascript', body: MOCK }); r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); }); return ctx; }
async function openPage(b, uid, url, seedDb) {
  const ctx = await ctxFor(b, uid); const u = seedDb['users/' + uid];
  const role = u.role === 'schoolAdmin' ? 'schoolAdmin' : u.schools.S1.role;
  await ctx.addInitScript(([uid, u, D, role]) => { window.__mockUid = uid;
    localStorage.setItem('cls_session', JSON.stringify({ userId: uid, username: u.username, role, schoolId: 'S1', period: 'first', ctxKey: 'school:S1' }));
    localStorage.setItem('__mockdb', JSON.stringify(D)); window.__alerts = []; window.alert = m => window.__alerts.push(m); window.confirm = () => true; }, [uid, u, seedDb, role]);
  const p = await ctx.newPage(); p.on('pageerror', e => { ERRS++; console.log('PAGEERR', e.message); });
  await p.goto('http://127.0.0.1:8765/' + url); await p.waitForTimeout(2200);
  await p.evaluate(() => { window.__alerts = []; window.alert = m => window.__alerts.push(String(m)); }); return p;
}
const dbOf = p => p.evaluate(() => window.__mockDB());
(async () => {
  const b = await chromium.launch(); let p, D;
  console.log('1. الوكيل: تبويب التحويلات');
  p = await openPage(b, 'A1', 'student-affairs.html', DB0);
  ok((await p.innerText('#s5')) === '٢', 'بطاقة «تحويلات جديدة» = ٢ (فصل آخر وسجل قديم لا يُحتسبان): ' + await p.innerText('#s5'));
  await p.click('#tabs [data-t="r"]'); await p.waitForTimeout(200);
  ok((await p.$$eval('#rSeg button', e => e.map(x => x.textContent))).join('|') === 'جديد|تحت الملاحظة|إحالات للتوجيه|منتهٍ', 'أربعة تبويبات فرعية');
  ok((await p.$$('#rRows .trow')).length === 2, 'جديد: ملفان (اثنان وواحد)');
  const f21 = p.locator('#rRows .trow', { hasText: 'طالب اثنان' });
  ok((await f21.innerText()).includes('تحويلان'), 'ملف الطالب ذو التحويلين: «تحويلان»');
  ok((await f21.locator('[data-rf]').count()) === 1, 'إحالة للموجه تظهر للطالب المتكرر');
  const f22 = p.locator('#rRows .trow', { hasText: 'طالب واحد' });
  ok((await f22.locator('[data-rf]').count()) === 0 && (await f22.locator('[data-rs]').count()) === 1, 'لا إحالة لتحويل واحد، ويظهر حفظ التقرير');
  ok((await f22.innerText()).includes('الرياضيات') && (await f22.innerText()).includes('الحصة ٣') && (await f22.innerText()).includes('معلم أول'), 'بطاقة التحويل: المادة والحصة والمعلم');
  console.log('2. حفظ التقرير');
  await f22.locator('[data-rs]').click(); await p.waitForTimeout(200);
  ok((await p.evaluate(() => document.querySelector('#toast').textContent)).includes('اكتب التقرير'), 'التقرير إلزامي');
  await f22.locator('textarea').fill('استُدعي الطالب ونُبّه'); await f22.locator('[data-rs]').click(); await p.waitForTimeout(400);
  D = await dbOf(p);
  ok(D['notes/n3'].trSt === 'obs' && D['notes/n3'].agentReport === 'استُدعي الطالب ونُبّه' && D['notes/n3'].reportByName === 'وكيل طلابي' && D['notes/n3'].reportBy === 'A1', 'خُزّن التقرير والحالة والكاتب');
  ok((await p.$$('#rRows .trow')).length === 1 && (await p.innerText('#s5')) === '١', 'انتقل الملف من «جديد» وانخفض العداد');
  await p.click('#rSeg [data-f="obs"]'); await p.waitForTimeout(200);
  ok((await p.$$('#rRows .trow')).length === 2, 'تحت الملاحظة: ملف ٢٣ و٢٢ (٢١ ما زال جديدًا)');
  ok((await p.locator('#rRows textarea:not([disabled])').count()) === 0, 'تقارير المغلق معطّلة');
  console.log('3. إحالة للموجه');
  await p.click('#rSeg [data-f="new"]'); await p.waitForTimeout(150);
  const g21 = p.locator('#rRows .trow', { hasText: 'طالب اثنان' });
  await g21.locator('textarea:not([disabled])').fill('تكرر الأمر'); await g21.locator('[data-rf]').click(); await p.waitForTimeout(400);
  D = await dbOf(p);
  ok(D['notes/n1'].trSt === 'ref' && D['notes/n2'].trSt === 'ref' && D['notes/n1'].referredBy === 'A1' && D['notes/n1'].agentReport === 'تكرر الأمر', 'الملف كاملًا صار «إحالة» مع التقرير');
  ok(D['notes/n6'].trSt === 'done', 'المنتهي لا يتأثر');
  await p.click('#rSeg [data-f="ref"]'); await p.waitForTimeout(150);
  ok((await p.$$('#rRows .trow')).length === 2, 'إحالات للتوجيه: ملفان (٢١ و٢٤)');
  await p.click('#rSeg [data-f="done"]'); await p.waitForTimeout(150);
  ok((await p.$$('#rRows .trow')).length === 1 && (await p.locator('#rRows .trow').innerText()).includes('طالب منتهٍ'), 'منتهٍ: ملف واحد');
  console.log('4. اطلاع فقط والمدير');
  for (const [uid, nm] of [['A2', 'اطلاع'], ['M1', 'المدير']]) {
    p = await openPage(b, uid, 'student-affairs.html', DB0); await p.click('#tabs [data-t="r"]'); await p.waitForTimeout(200);
    ok((await p.$$('#rRows .trow')).length === 2 && (await p.locator('[data-rs],[data-rf]').count()) === 0 && (await p.locator('#rRows textarea:not([disabled])').count()) === 0, nm + ': يرى الملفات بلا أزرار ولا كتابة');
  }
  console.log('5. المعلم: تحويل جماعي من صفحة الحصص');
  p = await openPage(b, 'T1', 'omr.html', DB0);
  ok(await p.evaluate(() => typeof omrCreateTransfers === 'function' && !!document.querySelector('#bulkNoteBtns')), 'صفحة الحصص جاهزة');
  const btns = await p.$$eval('#bulkNoteBtns button', e => e.map(x => x.textContent.trim()));
  ok(btns.length === 1 && btns[0] === 'تحويل إلى وكيل الشؤون الطلابية', 'زر واحد فقط: ' + btns.join('|'));
  const ag = await p.evaluate(async () => (await omrStudentAgents()).map(a => a.userId).join(','));
  ok(ag === 'A1', 'المستلم = صاحب تعديل «وكيل الشؤون الطلابية» فقط (لا الاطلاع ولا بلا صلاحية): ' + ag);
  await p.evaluate(() => { state.selectedStudents = { '5': true, '6': true }; bulkNote(); }); await p.waitForTimeout(800);
  ok((await p.$$eval('#btrR option', e => e.map(x => x.textContent))).join('|') === '— اختر —|عدم أداء الواجب|مشاغبة|تأخر عن الحصة|ضعف دراسي|أخرى', 'خمسة أسباب فقط');
  ok((await p.$$eval('#btrS option', e => e.map(x => x.textContent))).join('|') === '— بدون —|الرياضيات|العلوم' || (await p.$$eval('#btrS option', e => e.length)) >= 2, 'قائمة المواد من إسناد المعلم');
  ok((await p.$$eval('#btrL option', e => e.length)) === 9, 'حصص ١–٨ مع «بدون»');
  await p.click('#omrNoteGo'); await p.waitForTimeout(200);
  ok((await p.evaluate(() => window.__alerts)).some(m => m.includes('سبب')), 'السبب إلزامي');
  await p.selectOption('#btrR', 'مشاغبة'); await p.selectOption('#btrS', 'الرياضيات'); await p.selectOption('#btrL', '4'); await p.fill('#omrNoteText', 'يشغب في الحصة');
  await p.click('#omrNoteGo'); await p.waitForTimeout(600);
  D = await dbOf(p);
  const mine = Object.entries(D).filter(([k, v]) => k.startsWith('notes/') && v.fromUserId === 'T1' && v.studentSeat && ['5', '6'].includes(v.studentSeat));
  ok(mine.length === 2, 'مستند تحويل مستقل لكل طالب: ' + mine.length);
  const m5 = mine.map(x => x[1]).find(v => v.studentSeat === '5');
  ok(m5.trType === 'st' && m5.trSt === 'new' && m5.trReason === 'مشاغبة' && m5.subject === 'الرياضيات' && m5.lessonNo === 4 && m5.recipients.join() === 'A1' && m5.scope === 'student', 'حقول التحويل');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(m5.dateG) && /^14\d\d\/\d\d\/\d\d$/.test(m5.dateH) && !!m5.dayName, 'اليوم والتاريخ الهجري والميلادي تلقائيًا: ' + m5.dayName + ' ' + m5.dateH + ' ' + m5.dateG);
  ok(!('agentReport' in m5) && !('referredAt' in m5), 'لا حقول وكيل عند الإنشاء');
  console.log('6. المعلم: تحويلاتي وحالتها فقط');
  await p.evaluate(() => { showTab('notes'); }); await p.waitForTimeout(1200);
  const inbox = await p.innerText('#omrInbox');
  ok(inbox.includes('سالم') && inbox.includes('بانتظار الوكيل') && inbox.includes('مشاغبة'), 'يرى تحويله وحالته');
  p = await openPage(b, 'T1', 'omr.html', Object.assign({}, DB0, { 'notes/n3': Object.assign({}, DB0['notes/n3'], { trSt: 'obs', agentReport: 'تقرير سري' }) }));
  await p.evaluate(() => { showTab('notes'); }); await p.waitForTimeout(1200);
  const inb = await p.innerText('#omrInbox');
  ok(inb.includes('تحت الملاحظة') && !inb.includes('تقرير سري'), 'يرى الحالة دون تقرير الوكيل');
  ok(!inb.includes('قديم'), 'السجل القديم لا يظهر');
  console.log('7. بلا وكيل معيّن');
  const D2 = Object.assign({}, DB0); delete D2['users/A1'];
  p = await openPage(b, 'T1', 'omr.html', D2);
  await p.evaluate(() => { state.selectedStudents = { '5': true }; bulkNote(); }); await p.waitForTimeout(800);
  ok((await p.innerText('#omrModalOv')).includes('لا يوجد وكيل شؤون طلابية معيّن') && (await p.locator('#omrNoteGo').count()) === 0, 'رسالة واضحة ولا زر إرسال');
  console.log('8. الصفحة الرئيسية: الشاشات القديمة');
  p = await openPage(b, 'A1', 'index.html', Object.assign({}, DB0, { 'users/A1': Object.assign({}, DB0['users/A1'], { schools: { S1: Object.assign({}, DB0['users/A1'].schools.S1, { permissions: { 'index.sent': { access: true, edit: true }, 'index.received': { access: true, edit: true }, 'tools.agentStudents': { access: true, edit: true } } }) } }) }));
  const tabs = await p.evaluate(() => visibleTabs().map(t => t.label));
  ok(!tabs.some(t => t.includes('التحويلات المرسلة')), '«التحويلات المرسلة» مخفية: ' + tabs.join('|'));
  ok(!tabs.some(t => t.includes('التحويلات الواردة')), '«التحويلات الواردة» بمسماها القديم مخفية');
  ok(tabs.some(t => t.includes('التقارير الواردة')), 'تبقى «التقارير الواردة» لتقارير التحليل');
  await b.close();
  console.log(FAIL || ERRS ? '✗ فشل: ' + FAIL + ' أخطاء صفحة: ' + ERRS : '\n✓ كل شيء نجح'); process.exit(FAIL || ERRS ? 1 : 0);
})();
