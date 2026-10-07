// زر «فتح PDF» يظهر للمستلم فقط في بطاقة الملاحظة، ويفتح الملف
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:420,height:820}});
  await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ if(/firebase-app-compat/.test(r.request().url())) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK}); r.fulfill({status:200,contentType:'application/javascript',body:''}); });
  const pdf=fs.readFileSync('/home/claude/injaz/out/analysis/sent-0.pdf').toString('base64');
  await ctx.addInitScript((pdf)=>{ window.__mockUid='U_sa1'; localStorage.setItem('cls_session',JSON.stringify({userId:'sa1',username:'مدير',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'})); localStorage.setItem('__mockdb',JSON.stringify({'schools/S2':{name:'م'},'users/sa1':{authUid:'U_sa1',active:true,role:'schoolAdmin',username:'مدير',schools:{S2:{role:'teacher'}}},'notes/n1':{schoolId:'S2',period:'first',fromUserId:'t1',fromName:'معلم',fromRole:'teacher',recipients:['sa1'],recipientsInfo:[{userId:'c1',name:'موجه',role:'counselor'}],scope:'report',text:'تقرير',pdfB64:pdf,pdfName:'x.pdf',createdAt:1,replies:[],readAt:{},closed:false}})); },pdf);
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/omr.html'); await p.waitForTimeout(2000);
  const html=await p.evaluate(()=>{ const n={id:'n1',fromName:'معلم',fromRole:'teacher',recipients:['sa1'],recipientsInfo:[],text:'تقرير',pdfB64:'AAAA',createdAt:1,replies:[]}; return [omrNoteCard(n,false), omrNoteCard(Object.assign({},n,{recipients:['zz']}),false)]; });
  ok(/openNotePdf/.test(html[0]),'الزر يظهر للمستلم'); ok(!/openNotePdf/.test(html[1]),'لا يظهر لغير المستلم');
  const opened=await p.evaluate(async()=>{ let loc=''; window.open=()=>({ set location(v){}, location:{ set href(v){ window.__url=v; } }, close(){} }); await openNotePdf('n1'); return window.__url||''; });
  ok(/^blob:/.test(opened),'يبني رابط ملف PDF: '+opened.slice(0,20));
  ok(!errs.length,'لا أخطاء صفحة '+errs.join('|'));
  await b.close(); console.log(FAIL?'✗ فشل '+FAIL:'✓ كل الاختبارات نجحت'); process.exit(FAIL?1:0);
})();
