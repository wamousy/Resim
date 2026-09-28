// Display-only lanes: retain endpoints and never mutate evaluated routing.
export function orthogonalPoints(points){
  const out=[];
  for(const p of points){const last=out.at(-1);if(last&&last[0]!==p[0]&&last[1]!==p[1])out.push([p[0],last[1]]);if(!last||last[0]!==p[0]||last[1]!==p[1])out.push([...p]);}
  return out;
}
export function separateLogicalRoutes(routes,unit){
  const used=new Map();
  const tracks=r=>r.points.slice(1).map((b,i)=>{const a=r.points[i],h=a[1]===b[1];return {key:r.die+'|'+(h?'H|'+a[1]:'V|'+a[0]),lo:Math.min(a[h?0:1],b[h?0:1]),hi:Math.max(a[h?0:1],b[h?0:1])};});
  return routes.map(r=>{
    if(r.points.length<2)return r;
    const segments=tracks(r),blocked=new Set();
    for(const t of segments)for(const old of used.get(t.key)||[])if(t.lo<old.hi&&t.hi>old.lo)blocked.add(old.lane);
    let lane=0;while(blocked.has(lane))lane++;
    for(const t of segments){if(!used.has(t.key))used.set(t.key,[]);used.get(t.key).push({...t,lane});}
    if(!lane)return {...r,points:orthogonalPoints(r.points)};
    const offset=(lane%2?1:-1)*Math.ceil(lane/2)*.08*unit;
    const first=r.points[0],last=r.points.at(-1);
    // Two fanout segments preserve the real module/TSV anchors.
    const shifted=r.points.map(([x,y])=>[x+offset,y+offset*.73]);
    return {...r,points:orthogonalPoints([first,...shifted,last])};
  });
}
