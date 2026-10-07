const E = require('/home/claude/injaz/injaz-classroom-backup-2026-09-23/timetable-engine.js');
eval(require('fs').readFileSync('engine-test.js','utf8').split('const input =')[0].replace("const E = require('/home/claude/injaz/injaz-classroom-backup-2026-09-23/timetable-engine.js');",''));
function consistent(pr,st){
  let bad=0;
  pr.units.forEach((u,ui)=>{ const s=st.pos[ui]; if(s<0) return; for(let k=0;k<u.len;k++){ if(st.cGrid[u.ci*pr.S+s+k]!==ui) bad++; if(u.ti>=0 && st.tGrid[u.ti*pr.S+s+k]!==ui) bad++; } });
  return bad;
}
const inp=makeSchool(3,6); const pr=E.buildProblem(inp);
// check units per class vs slots, and teacher loads
const perC={}; pr.units.forEach(u=>perC[u.ci]=(perC[u.ci]||0)+1); console.log('per class', Object.values(perC).slice(0,3), 'slots', pr.S);
const tl=[...pr.tLoad].sort((a,b)=>b-a).slice(0,5); console.log('top teacher loads', tl);
const st=E.solve(pr,{seed:1,timeLimitMs:3000});
console.log('consistency errors', consistent(pr,st), 'unplaced', E.countUnplaced(st));
