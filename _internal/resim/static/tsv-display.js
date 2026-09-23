// Logical display fanout within the assigned TSV region; evaluation paths remain intact.
export function spreadTSV(paths,project,unit){
  const routes=paths.routes.map(r=>({...r,points:r.points.map(p=>[...p])}));
  const regions=new Map(project.floorplan.tsv_regions.map(r=>[r.id,r]));
  const groups=new Map();
  for(const v of paths.vertical){const key=v.region_id||v.lower_die+'|'+v.upper_die;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v.link);}
  const vertical=paths.vertical.map(v=>{
    const r=regions.get(v.region_id);if(!r)return {...v,point:[...v.point]};
    const ids=[...new Set(groups.get(v.region_id))].sort(),i=ids.indexOf(v.link),n=Math.ceil(Math.sqrt(ids.length));
    const pitch=Math.min(.10*unit,r.width_um/(n+1),r.height_um/(n+1));
    const point=[v.point[0]+(i%n-(n-1)/2)*pitch,v.point[1]+(Math.floor(i/n)-(n-1)/2)*pitch];
    for(const route of routes)if(route.link===v.link&&(route.die===v.lower_die||route.die===v.upper_die))for(const index of [0,route.points.length-1]){
      const p=route.points[index];if(Math.hypot(p[0]-v.point[0],p[1]-v.point[1])<1e-6)route.points[index]=[...point];
    }
    return {...v,point};
  });
  // A zero-length intermediate path can become nonzero after display fanout.
  const byLink=new Map();
  for(const v of vertical){if(!byLink.has(v.link))byLink.set(v.link,[]);byLink.get(v.link).push(v);}
  for(const [link,vias] of byLink)for(let i=1;i<vias.length;i++){
    const a=vias[i-1],b=vias[i],die=[a.lower_die,a.upper_die].find(d=>d===b.lower_die||d===b.upper_die);
    if(die&&!routes.some(r=>r.link===link&&r.die===die)&&Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1])>1e-6)routes.push({link,die,points:[[...a.point],[b.point[0],a.point[1]],[...b.point]]});
  }
  return {...paths,routes,vertical};
}
export function directedDies(v,link,placements,orders){
  return orders[placements[link.source].die]<orders[placements[link.target].die]?[v.lower_die,v.upper_die]:[v.upper_die,v.lower_die];
}
