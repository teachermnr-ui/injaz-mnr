// محرّر درجة البند: «حفظ» و«للجميع» تعملان وتُغلقان النافذة — بوجود mn-dialog.js وبغيابه (احتياط)
const { chromium } = require('playwright'); const fs=require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
let FAIL=0; const ok=(c,m)=>{ console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) FAIL++; };
(async()=>{
  const b=await chromium.launch();
  for(const withDlg of [true,false]){
    console.log(withDlg?'مع mn-dialog.js':'بدون mn-dialog.js (الاحتياط)');
    const ctx=await b.newContext({viewport:{width:390,height:820}});
    await ctx.route(/jsdelivr|cdnjs|googleapis|gstatic|opencv/, r=>{ if(/firebase-app-compat/.test(r.request().url())) return r.fulfill({status:200,contentType:'application/javascript',body:MOCK}); r.fulfill({status:200,contentType:'application/javascript',body:''}); });
    if(!withDlg) await ctx.route(/mn-dialog\.js/, r=>r.fulfill({status:404,body:''}));
    await ctx.addInitScript((w)=>{ window.__mockUid='U_sa1'; localStorage.setItem('cls_session',JSON.stringify({userId:'sa1',username:'مدير',role:'schoolAdmin',schoolId:'S2',period:'first',ctxKey:'school:S2'})); localStorage.setItem('__mockdb',JSON.stringify({'schools/S2':{name:'م'},'users/sa1':{authUid:'U_sa1',active:true,role:'schoolAdmin',username:'مدير',schools:{S2:{role:'teacher'}}}})); if(!w){ window.confirm=()=>true; window.alert=()=>{}; } },withDlg);
    const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
    await p.goto('http://127.0.0.1:8765/omr.html'); await p.waitForTimeout(2000);
    await p.evaluate(()=>{ const st=[1,2,3].map(i=>({seat:'10'+i,name:'طالب '+i,classCode:'7'})); state.students=st; state.fullStudents=st; state.classes=[{name:'الأول الثانوي 7',code:'7'}]; state.fullClasses=state.classes; state.workLog={}; });
    const itemId=await p.evaluate(()=>state.workCfg.periods[0].items[0].id);
    const cnt=()=>p.evaluate(([i])=>state.students.filter(s=>{ const e=state.workLog['7']&&state.workLog['7'][s.seat]; return e&&e.scores&&e.scores[i]===5; }).length,[itemId]);
    const open=()=>p.evaluate(([i])=>openBandEditor('101',i),[itemId]);
    await open();
    ok(await p.isVisible('#stRecordOverlay'),'النافذة تفتح');
    const hb=await p.locator('#stRecordOverlay button.ghost').first().boundingBox(), h2=await p.locator('#stRecordOverlay h2').boundingBox();
    ok(h2.height<40,'العنوان في سطر واحد ('+Math.round(h2.height)+'px)'); ok(hb.width<130,'زر الإغلاق مضغوط ('+Math.round(hb.width)+'px)');
    const sb=await p.locator('#stRecordBody button.primary').first().boundingBox(), inp=await p.locator('#bandScore').boundingBox();
    ok(sb.width<110 && inp.width>sb.width*1.5,'حقل الدرجة أعرض من زر «حفظ» ('+Math.round(inp.width)+' / '+Math.round(sb.width)+')');
    await p.fill('#bandScore','7'); await p.click('#stRecordBody button.primary >> nth=0'); await p.waitForTimeout(200);
    ok(!(await p.isVisible('#stRecordOverlay')),'«حفظ» تغلق النافذة');
    ok(await p.evaluate(()=>state.workLog['7']['101'].scores[state.workCfg.periods[0].items[0].id]===7),'درجة الطالب حُفظت');
    await open(); await p.fill('#bandScoreAll','5');
    await p.screenshot({path:'/home/claude/injaz/out/band-editor-'+(withDlg?'dlg':'fallback')+'.png'});
    await p.click('#stRecordBody button.primary >> nth=1');
    await p.waitForTimeout(250);
    if(withDlg){ ok(await p.isVisible('#mnDlg'),'نافذة التأكيد'); await p.click('#mnDlg .mnOk'); await p.waitForTimeout(300); if(await p.isVisible('#mnDlg')) await p.click('#mnDlg .mnOk'); }
    await p.waitForTimeout(200);
    ok((await cnt())===3,'«للجميع» سجّلت الدرجة لـ٣ طلاب ('+await cnt()+')');
    ok(!(await p.isVisible('#stRecordOverlay')),'«للجميع» تغلق النافذة');
    ok(!errs.some(e=>/mnConfirm/.test(e)),'لا خطأ mnConfirm');
    await ctx.close();
  }
  await b.close(); console.log(FAIL?'✗ فشل '+FAIL:'✓ كل الاختبارات نجحت'); process.exit(FAIL?1:0);
})();
