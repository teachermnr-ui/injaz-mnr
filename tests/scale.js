const E = require('/home/claude/injaz/injaz-classroom-backup-2026-09-23/timetable-engine.js');
eval(require('fs').readFileSync('engine-test.js','utf8').split('const input =')[0].replace("const E = require('/home/claude/injaz/injaz-classroom-backup-2026-09-23/timetable-engine.js');",''));
for(const [g,s,tl] of [[3,6,10000],[6,4,12000]]){
  const inp=makeSchool(g,s); const pr=E.buildProblem(inp); const t=Date.now();
  const st=E.solve(pr,{seed:1,timeLimitMs:tl}); const rep=E.evaluate(pr,st);
  const types={}; rep.violations.forEach(v=>types[v.type]=(types[v.type]||0)+1);
  console.log(g+'x'+s,'units',pr.units.length,'T',pr.T,'time',Date.now()-t,'unplaced',rep.unplaced.length,'hard',hardCheck(pr,E.exportPlacement(pr,st)),'cost',rep.cost,JSON.stringify(types));
}
