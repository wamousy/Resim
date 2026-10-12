// Display cropping only: physical coordinates and evaluation inputs never change.
export function coreFrames(report,die){
  const defs=new Map(report.project.architecture.modules.map(m=>[m.id,m])),groups=new Map();
  for(const m of report.modules.filter(m=>m.die===die&&!m.shared_cores?.length)){
    if(!groups.has(m.core))groups.set(m.core,[]);
    groups.get(m.core).push(defs.get(m.id)?.placement_window||m);
  }
  return [...groups].map(([core,rects])=>{
    const x_um=Math.min(...rects.map(r=>r.x_um)),y_um=Math.min(...rects.map(r=>r.y_um));
    return {core,x_um,y_um,width_um:Math.max(...rects.map(r=>r.x_um+r.width_um))-x_um,height_um:Math.max(...rects.map(r=>r.y_um+r.height_um))-y_um};
  });
}
export function coreBounds(report,core){
  if(!core)return {x:0,y:0,width:Math.max(...report.dies.map(d=>d.width_um)),height:Math.max(...report.dies.map(d=>d.height_um))};
  const rects=report.modules.filter(m=>m.core===core&&!m.shared_cores?.length);
  const regions=report.interfaces.filter(v=>v.region?.core===core).map(v=>v.region);
  const points=report.ports.filter(p=>p.core===core).map(p=>({...p,width_um:0,height_um:0}));
  const all=[...rects,...regions,...points];
  if(!all.length)return coreBounds(report,null);
  const x=Math.min(...all.map(r=>r.x_um)),y=Math.min(...all.map(r=>r.y_um)),right=Math.max(...all.map(r=>r.x_um+r.width_um)),top=Math.max(...all.map(r=>r.y_um+r.height_um));
  const pad=Math.max(right-x,top-y)*.025;
  return {x:Math.max(0,x-pad),y:Math.max(0,y-pad),width:right+pad-Math.max(0,x-pad),height:top+pad-Math.max(0,y-pad)};
}
export function insideBounds(point,b){return point[0]>=b.x&&point[0]<=b.x+b.width&&point[1]>=b.y&&point[1]<=b.y+b.height;}
export function cropRect(r,b){
  const x=Math.max(r.x_um,b.x),y=Math.max(r.y_um,b.y),right=Math.min(r.x_um+r.width_um,b.x+b.width),top=Math.min(r.y_um+r.height_um,b.y+b.height);
  return right>x&&top>y?{...r,x_um:x,y_um:y,width_um:right-x,height_um:top-y}:null;
}
export function clipPath(points,b){
  const paths=[];let current=null;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],z=points[i],dx=z[0]-a[0],dy=z[1]-a[1];let lo=0,hi=1,ok=true;
    for(const [p,q] of [[-dx,a[0]-b.x],[dx,b.x+b.width-a[0]],[-dy,a[1]-b.y],[dy,b.y+b.height-a[1]]]){
      if(p===0){if(q<0)ok=false;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    }
    if(!ok||lo>hi){current=null;continue;}
    const start=[a[0]+lo*dx,a[1]+lo*dy],end=[a[0]+hi*dx,a[1]+hi*dy];
    if(start[0]===end[0]&&start[1]===end[1])continue;
    if(current&&Math.hypot(current.at(-1)[0]-start[0],current.at(-1)[1]-start[1])<1e-7)current.push(end);
    else {current=[start,end];paths.push(current);}
    if(hi<1)current=null;
  }
  return paths;
}
export function peerConnections(project,core){
  if(!core)return [];
  const modules=Object.fromEntries(project.architecture.modules.map(m=>[m.id,m])),groups=new Map();
  for(const l of project.architecture.links){
    const from=modules[l.source],to=modules[l.target];
    if((from.core===core)===(to.core===core))continue;
    const local=from.core===core?from:to,remote=from.core===core?to:from,key=local.id+'|'+remote.id;
    if(!groups.has(key))groups.set(key,{local:local.id,remote:remote.id,core:remote.core,incoming:[],outgoing:[]});
    groups.get(key)[from.core===core?'outgoing':'incoming'].push(l);
  }
  return [...groups.values()];
}
