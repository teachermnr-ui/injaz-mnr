const E = require('/home/claude/injaz/injaz-classroom-backup-2026-09-23/timetable-engine.js');
function makeSchool(grades, secs){
  const plan = [['قرآن',3,'early'],['إسلامية',3,'any'],['لغتي',5,'early'],['رياضيات',6,'early'],['علوم',5,'any'],
    ['إنجليزي',4,'any'],['اجتماعيات',3,'any'],['رقمية',2,'any'],['فنية',1,'late'],['بدنية',2,'late'],['حياتية',1,'any']];
  const classes=[]; for(let g=1;g<=grades;g++) for(let s=0;s<secs;s++) classes.push('م'+g+'أبجدهوزحطي'[s]);
  // المعلمون: لكل مادة عدد معلمين يكفي بنصاب ≤ 24
  const units=[]; const loads={};
  plan.forEach(([name,w,timing],si)=>{
    const need = classes.length*w; const nT = Math.ceil(need/22);
    const tIds=[...Array(nT).keys()].map(i=>'T_'+si+'_'+i);
    classes.forEach((c,ci)=>{
      const tid = tIds[Math.floor(ci*nT/classes.length)];
      for(let k=0;k<w;k++){
        units.push({id:c+'|'+si+'|'+k, classCode:c, subjectId:'s'+si, subjectName:name, teacherId:tid, len:1, timing, prefDays: name==='رياضيات'?[0,2]:[], consec:'no'});
      }
    });
  });
  return { days:[0,1,2,3,4], ppd:{0:7,1:7,2:7,3:7,4:7}, breakAfter:[2,4], params:{earlyMax:5,lateMin:4,maxDaily:5,goldenLast:4}, units, blocked:{} };
}
function hardCheck(pr, placement){
  const byId={}; placement.forEach(x=>byId[x.id]=x);
  const tOcc={}, cOcc={}; let bad=0;
  pr.units.forEach(u=>{ const x=byId[u.id]; if(x.day==null) return;
    for(let k=0;k<u.len;k++){ const key=x.day+':'+(x.p+k);
      const ck=u.ci+'@'+key; if(cOcc[ck]) bad++; cOcc[ck]=1;
      if(u.ti>=0){ const tk=u.ti+'@'+key; if(tOcc[tk]) bad++; tOcc[tk]=1; if(pr.blocked[u.ti*pr.S + pr.days.indexOf(x.day)*pr.P + x.p+k]) bad++; }
    }});
  return bad;
}
const input = makeSchool(3,3);
const pr = E.buildProblem(input);
console.log('units',pr.units.length,'classes',pr.C,'teachers',pr.T,'slots',pr.S);
let t=Date.now();
const st = E.solve(pr,{seed:7,timeLimitMs:6000});
const pl = E.exportPlacement(pr,st);
const rep = E.evaluate(pr,st);
const types={}; rep.violations.forEach(v=>types[v.type]=(types[v.type]||0)+1);
console.log('time',Date.now()-t,'ms  cost',rep.cost,'unplaced',rep.unplaced.length,'hardViolations',hardCheck(pr,pl),'soft',JSON.stringify(types));
// pins + stateFrom roundtrip
const rt = E.stateFrom(pr, pl); console.log('roundtrip conflicts', rt.conflicts.length, 'cost equal', E.totalCost(pr,rt.st)===E.totalCost(pr,st));
// swap options for a lesson
const uid = pr.units[10].id;
t=Date.now();
const opts = E.swapOptions(pr, st, uid, {});
const cnt={}; opts.forEach(o=>cnt[o.status]=(cnt[o.status]||0)+1);
console.log('swapOptions',Date.now()-t,'ms', JSON.stringify(cnt));
const ch = opts.find(o=>o.status==='chain') || opts.find(o=>o.status==='direct');
if(ch){ const before=E.totalCost(pr,st); const ok=E.applySolution(pr,st,ch.solutions[0].moves);
  console.log('apply',ch.status,'moves',ch.solutions[0].moves.length,'ok',ok,'hard after',hardCheck(pr,E.exportPlacement(pr,st)),'unplaced',E.countUnplaced(st), 'delta', E.totalCost(pr,st)-before, 'pred', ch.solutions[0].delta); }
// Blocked test: block teacher T_3_0 entirely on Sunday
const inp2 = makeSchool(3,3); inp2.blocked={'T_3_0':[[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6]]};
const pr2=E.buildProblem(inp2); const st2=E.solve(pr2,{seed:3,timeLimitMs:4000});
const pl2=E.exportPlacement(pr2,st2);
const sunday = pl2.filter(x=>x.day===0 && pr2.units[pr2.units.findIndex(u=>u.id===x.id)].ti===pr2.teacherIdx['T_3_0']).length;
console.log('blocked test: lessons on blocked day =',sunday,'hard',hardCheck(pr2,pl2),'unplaced',E.countUnplaced(st2));
// Double lessons
const inp3 = makeSchool(2,2); inp3.units.forEach(u=>{ if(u.subjectName==='علوم'){ u.consec='require'; } });
// convert science 5 singles into 2 doubles + 1 single
const others=inp3.units.filter(u=>u.subjectName!=='علوم'); const sci=inp3.units.filter(u=>u.subjectName==='علوم');
const byC={}; sci.forEach(u=>(byC[u.classCode]=byC[u.classCode]||[]).push(u));
const newU=[...others]; Object.values(byC).forEach(arr=>{ newU.push(Object.assign({},arr[0],{id:arr[0].id+'D1',len:2})); newU.push(Object.assign({},arr[1],{id:arr[1].id+'D2',len:2})); newU.push(Object.assign({},arr[2],{id:arr[2].id+'S'})); });
inp3.units=newU; const pr3=E.buildProblem(inp3); const st3=E.solve(pr3,{seed:5,timeLimitMs:3000});
const pl3=E.exportPlacement(pr3,st3);
const crossBreak = pl3.filter(x=>{ const u=pr3.units.find(q=>q.id===x.id); return u.len===2 && x.day!=null && [2,4].includes(x.p); }).length;
console.log('doubles: hard',hardCheck(pr3,pl3),'unplaced',E.countUnplaced(st3),'doubles crossing break',crossBreak);
