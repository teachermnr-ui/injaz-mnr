// صيانة الجدول بعد التحديث: استبعاد حصص نفس المادة لنفس الشعبة من خيارات التبديل ومن خطوات السلسلة
const { chromium } = require('playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(__dirname+'/mock-firebase.js','utf8');
const DB = JSON.parse(fs.readFileSync(__dirname+'/db-after.json','utf8'));
const out=(...a)=>console.log(...a);
(async()=>{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{ width:1300, height:900 } });
  await ctx.route(/cdnjs|googleapis|jsdelivr/, r=>r.fulfill({ status:200, contentType:'application/javascript', body:'' }));
  await ctx.route(/gstatic\.com\/firebasejs\/.*firebase-app-compat/, r=>r.fulfill({ status:200, contentType:'application/javascript', body: MOCK }));
  await ctx.addInitScript(([db])=>{ window.__mockUid='U_SA1'; localStorage.setItem('cls_session', JSON.stringify({ userId:'sa1', username:'م', role:'schoolAdmin', schoolId:'S2', period:'first', ctxKey:'school:S2' })); localStorage.setItem('__mockdb', JSON.stringify(db)); window.confirm=()=>true; }, [DB]);
  const p = await ctx.newPage(); let errs=0; p.on('pageerror', e=>{ if(!/XLSX/.test(e.message)){ errs++; out('PAGE ERROR:', e.message); } });
  await p.goto('http://127.0.0.1:8765/timetable.html'); await p.waitForTimeout(2500);
  const r = await p.evaluate(()=>{
    const res = { units:0, targets:0, sameSubjTargets:0, solutions:0, sameSubjChainSteps:0 };
    ['m','h'].forEach(sk=>{
      const S = getStageState(sk,'draft'); const { pr, st } = S;
      pr.units.forEach((u,ui)=>{
        if(st.pos[ui]<0 || res.units>=40) return; res.units++;
        const opts = TTEngine.swapOptions(pr, st, u.id, { maxExtra:2, nodeBudget:800, maxSolutions:3 });
        opts.forEach(o=>{
          res.targets++;
          if(o.target.unitId){ const v = pr.units.find(x=>x.id===o.target.unitId); if(v && v.subj===u.subj && v.ci===u.ci) res.sameSubjTargets++; }
          (o.solutions||[]).forEach(sol=>{
            res.solutions++;
            // خطوة سلسلة تبادل حصتين بنفس المادة لنفس الشعبة: حركتان متعاكستان لنفس الشعبة والمادة
            const mv = sol.moves.map(m=>({ u: pr.units.find(x=>x.id===m.unitId), from: m.from, to: m.to }));
            for(let i=0;i<mv.length;i++) for(let j=i+1;j<mv.length;j++){
              const a=mv[i], b=mv[j];
              if(a.u.ci===b.u.ci && a.u.subj===b.u.subj && a.from.day===b.to.day && a.from.p===b.to.p && b.from.day===a.to.day && b.from.p===a.to.p) res.sameSubjChainSteps++;
            }
          });
        });
      });
    });
    return res;
  });
  out('1. maintenance after update:', JSON.stringify(r));
  out('   same-subject targets excluded =', r.sameSubjTargets===0, ' same-subject chain swaps excluded =', r.sameSubjChainSteps===0);
  out('PAGE ERRORS:', errs);
  await browser.close();
})().catch(e=>{ console.error(e); process.exit(1); });
