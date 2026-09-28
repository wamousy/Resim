import {stackModel} from './stack-model.js?v=2';

// Supplement preserved engine reports consistently, without rewriting snapshots.
export function assessedReport(report){
  if(!report)return report;
  const issues=[...(report.issues||[])],summary={...report.summary};
  if(!report.project?.architecture?.dies||!report.project.floorplan)return {...report,issues,summary};
  const identity=i=>JSON.stringify([i.severity,i.code,i.subject,i.reason]);
  const known=new Set(issues.map(identity));
  for(const issue of stackModel(report.project).issues){
    if(known.has(identity(issue)))continue;
    issues.push(issue);known.add(identity(issue));
    const key={error:'errors',unknown:'unknowns',warning:'warnings'}[issue.severity];
    if(key)summary[key]=(summary[key]||0)+1;
  }
  return {...report,issues,summary};
}
