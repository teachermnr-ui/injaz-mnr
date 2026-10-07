// اختبار نوافذ «مُنجز المدرسي» (لا نوافذ متصفح أصلية): python3 -m http.server 8765 ثم node tests/dialogs-test.js
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0, ERRS=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
const PAGES=['index','omr','worksheets','duty','holidays','timetable','circulars','visits','myday','myschedule','student-solve','student-worksheets','auth-action'];
(async()=>{
  const b=await chromium.launch(); let native=0;
  console.log('1. كل صفحة تحمّل الملف ولا أخطاء ولا نافذة أصلية');
  for(const pg of PAGES){
    const ctx=await b.newContext({viewport:{width:420,height:800}});
    await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ if(/firebase-app-compat/.test(r.request().url())) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK}); r.fulfill({status:200,contentType:'application/javascript',body:''}); });
    if(pg==='omr'){ await ctx.addInitScript(()=>{ window.__mockUid='U_sa1'; localStorage.setItem('cls_session',JSON.stringify({userId:'sa1',username:'مدير',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'})); localStorage.setItem('__mockdb',JSON.stringify({'schools/S2':{name:'م'},'users/sa1':{authUid:'U_sa1',active:true,role:'schoolAdmin',username:'مدير',schools:{S2:{role:'teacher'}}}})); }); }
    const p=await ctx.newPage(); let pe=[]; p.on('pageerror',e=>pe.push(e.message)); p.on('dialog',d=>{ native++; d.dismiss(); });
    await p.goto('http://127.0.0.1:8765/'+pg+'.html'); await p.waitForTimeout(900);
    const has=await p.evaluate(()=>typeof window.mnConfirm==='function'&&typeof window.mnPrompt==='function');
    ok(has,pg+': النوافذ الموحّدة محمّلة'); const real=pe.filter(m=>!/firebase|is not defined|Cannot read/.test(m)); if(real.length){ ERRS+=real.length; console.log('   PAGEERR',pg,real.join(' | ')); }
    if(pg==='omr'){
      console.log('2. السلوك على omr');
      await p.evaluate(()=>{ window.__r=[]; });
      await p.evaluate(()=>alert('تعذّر حفظ الملاحظة: اختبار'));
      ok(await p.isVisible('#mnDlg'),'alert يعرض نافذة داخلية');
      ok((await p.textContent('#mnDlg .mnT'))==='مُنجز المدرسي','العنوان «مُنجز المدرسي»');
      ok(!/injaz|awraqai|يعرض موقع/.test(await p.textContent('#mnDlgOv')),'لا يظهر الرابط');
      await p.click('#mnDlg .mnOk'); ok(!(await p.isVisible('#mnDlg').catch(()=>false)),'تُغلق بزر حسنًا');
      p.evaluate(async()=>{ window.__r.push(await mnConfirm('حذف؟')); });
      await p.waitForSelector('#mnDlg'); await p.click('#mnDlg .mnNo'); await p.waitForTimeout(100);
      ok((await p.evaluate(()=>window.__r[0]))===false,'confirm → إلغاء = false');
      p.evaluate(async()=>{ window.__r.push(await mnConfirm('حذف؟')); });
      await p.waitForSelector('#mnDlg'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
      ok((await p.evaluate(()=>window.__r[1]))===true,'confirm → Enter = true');
      p.evaluate(async()=>{ window.__r.push(await mnPrompt('اسم؟','س')); });
      await p.waitForSelector('#mnDlg .mnI'); ok((await p.inputValue('#mnDlg .mnI'))==='س','prompt يعرض القيمة الافتراضية');
      await p.fill('#mnDlg .mnI','ص'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
      ok((await p.evaluate(()=>window.__r[2]))==='ص','prompt → النص');
      p.evaluate(async()=>{ window.__r.push(await mnPrompt('اسم؟')); });
      await p.waitForSelector('#mnDlg'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
      ok((await p.evaluate(()=>window.__r[3]))===null,'prompt → Esc = null');
      p.evaluate(()=>{ alert('أ'); alert('ب'); });
      await p.waitForSelector('#mnDlg'); ok((await p.textContent('#mnDlg .mnM'))==='أ','الطابور: الأولى'); await p.click('#mnDlg .mnOk'); await p.waitForTimeout(100);
      ok((await p.textContent('#mnDlg .mnM'))==='ب','الطابور: الثانية'); await p.click('#mnDlg .mnOk');
      ok(!/عرض سجل الطالب|نقل الطالب أو حذفه|تسجيل الحضور والغياب والتأخّر/.test(await p.content()),'نصوص التلميح محذوفة من omr');
      // حذف نتيجة يمر عبر النافذة
      await p.evaluate(()=>{ state.results=[{id:'r1',title:'ن',date:Date.now()}]; });
      p.evaluate(()=>{ clearAllResults(); }).catch(()=>{});
      await p.waitForTimeout(300); ok(await p.isVisible('#mnDlg'),'clearAllResults تعرض تأكيدًا داخليًا'); await p.click('#mnDlg .mnNo');
    }
    await ctx.close();
  }
  ok(native===0,'عدد نوافذ المتصفح الأصلية = '+native);
  const bad=require('child_process').execSync("grep -nE '\\b(confirm|prompt)\\(' ../*.html | grep -v 'await mn' | grep -v 'window.mnConfirm=' | wc -l",{cwd:__dirname}).toString().trim();
  ok(bad==='0','لا confirm/prompt أصلي في الصفحات: '+bad);
  await b.close(); console.log(FAIL||ERRS?`✗ فشل ${FAIL} / أخطاء ${ERRS}`:'✓ كل الاختبارات نجحت'); process.exit(FAIL||ERRS?1:0);
})();
