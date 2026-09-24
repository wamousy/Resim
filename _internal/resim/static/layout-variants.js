// Compare physical placements, never solver IDs, scores or array order.
export function placementRows(report) {
  const placements=report?.project?.floorplan?.placements ?? report?.modules ?? [];
  return placements.map(p=>({id:p.module??p.id,die:p.die,x_um:p.x_um,y_um:p.y_um,width_um:p.width_um,height_um:p.height_um}))
    .sort((a,b)=>String(a.id).localeCompare(String(b.id),'en'));
}
export function layoutSignature(report) {
  return JSON.stringify(placementRows(report).map(p=>[p.id,p.die,p.x_um,p.y_um,p.width_um,p.height_um]));
}
export function distinctCandidates(result) {
  const seen=new Set();
  return (result?.candidates||[]).flatMap((report,index)=>{
    const signature=layoutSignature(report);
    if(seen.has(signature))return [];
    seen.add(signature);
    // Preserve the stored candidate index so exports/open-folder still match.
    return [{id:String(index),name:'候选 '+(index+1),report}];
  });
}
export function layoutDifference(a,b) {
  const before=new Map(placementRows(a).map(p=>[p.id,p])),after=new Map(placementRows(b).map(p=>[p.id,p]));
  const counts={moved:0,migrated:0,resized:0,added:0,removed:0,changed:0};
  for(const id of new Set([...before.keys(),...after.keys()])){
    const x=before.get(id),y=after.get(id);
    if(!x||!y){counts[x?'removed':'added']++;counts.changed++;continue;}
    const moved=x.x_um!==y.x_um||x.y_um!==y.y_um,migrated=x.die!==y.die,resized=x.width_um!==y.width_um||x.height_um!==y.height_um;
    counts.moved+=Number(moved);counts.migrated+=Number(migrated);counts.resized+=Number(resized);counts.changed+=Number(moved||migrated||resized);
  }
  return counts;
}
