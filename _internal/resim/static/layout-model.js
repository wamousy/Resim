// Pure geometry and display helpers shared by the viewer and its regression tests.
export function number(value, digits=2) {
  if(value==null) return '未知';
  const n=Number(value);
  if(n!==0 && Math.abs(n)<10**(-digits))
    return n.toLocaleString('zh-CN',{maximumSignificantDigits:4});
  return n.toLocaleString('zh-CN',{maximumFractionDigits:digits});
}
export const area=value=>value==null?'未知':Number(value).toLocaleString('zh-CN',{maximumSignificantDigits:7});
export function linkBudget(link) {
  const required=Math.ceil(link.bandwidth_GBps*8/link.lane_rate_Gbps);
  const data=link.data_wires??required,control=link.control_wires??8;
  const total=Math.ceil((data+control)*(1+(link.spare_fraction??.1)));
  return {bus_width_bits:link.bus_width_bits??null,data_wires:data,control_wires:control,spare_wires:total-data-control,wires:total,
    data_wires_source:link.data_wires==null?'bandwidth_derived':'explicit'};
}
export function linkCaption(link) {
  const count=linkBudget(link);
  return (count.bus_width_bits==null?'':count.bus_width_bits+' bit · ')+count.wires+' wires';
}
export function sceneDimensions(dies) {
  const width=Math.max(...dies.map(d=>d.width_um)),height=Math.max(...dies.map(d=>d.height_um));
  return {width,height,scale:6/Math.max(width,height)};
}
export function fitPerspective(points,aspect,fov,padding=1.2){
  const tanV=Math.tan(fov*Math.PI/360),tanH=tanV*aspect;
  // Points are relative to the target, in the camera's right/up/back basis.
  return Math.max(3,...points.map(([x,y,z])=>z+padding*Math.max(Math.abs(x)/tanH,Math.abs(y)/tanV)));
}
export function movePlacement(project,id,die,x,y) {
  const next=structuredClone(project),p=next.floorplan.placements.find(p=>p.module===id);
  const module=next.architecture.modules.find(m=>m.id===id);
  if(!p||!module||!next.architecture.dies.some(d=>d.id===die)) throw new Error('模块或目标 die 不存在');
  if(module.fixed) throw new Error('该模块已固定，请先在输入中解除固定约束');
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0) throw new Error('坐标必须是大于或等于 0 的有限数值');
  Object.assign(p,{die,x_um:x,y_um:y});
  return next;
}
export function edgeAnchor(rect,toward,location=null,fallback='east') {
  const cx=rect.x_um+rect.width_um/2,cy=rect.y_um+rect.height_um/2,dx=toward[0]-cx,dy=toward[1]-cy;
  const side=location?.side||((dx||dy)?(Math.abs(dx)*rect.height_um>=Math.abs(dy)*rect.width_um?(dx>=0?'east':'west'):(dy>=0?'north':'south')):fallback);
  const offset=location?.offset??.5,x=rect.x_um,y=rect.y_um;
  const point={east:[x+rect.width_um,y+offset*rect.height_um],west:[x,y+offset*rect.height_um],north:[x+offset*rect.width_um,y+rect.height_um],south:[x+offset*rect.width_um,y]}[side];
  return {point,side,offset,source:location?'specified_port':'automatic_edge_midpoint'};
}
export function escapePath(start,end,rectangles){
  const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  const crosses=(a,b,r)=>{
    const left=r.x_um,right=left+r.width_um,bottom=r.y_um,top=bottom+r.height_um;
    return a[1]===b[1]?bottom+1e-9<a[1]&&a[1]<top-1e-9&&Math.max(Math.min(a[0],b[0]),left)<Math.min(Math.max(a[0],b[0]),right)-1e-9:
      left+1e-9<a[0]&&a[0]<right-1e-9&&Math.max(Math.min(a[1],b[1]),bottom)<Math.min(Math.max(a[1],b[1]),top)-1e-9;
  };
  const choices=[[start,[end[0],start[1]],end],[start,[start[0],end[1]],end]];
  for(const x of [(start[0]+end[0])/2,...rectangles.flatMap(r=>[r.x_um,r.x_um+r.width_um])])choices.push([start,[x,start[1]],[x,end[1]],end]);
  for(const y of [(start[1]+end[1])/2,...rectangles.flatMap(r=>[r.y_um,r.y_um+r.height_um])])choices.push([start,[start[0],y],[end[0],y],end]);
  const options=choices.map((path,index)=>{
    const points=path.filter((p,i)=>i===0||!same(path[i-1],p));let invalid=false,length=0;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];length+=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);if(rectangles.some(r=>crosses(a,b,r)))invalid=true;}
    return {points,invalid,length,index};
  }).sort((a,b)=>Number(a.invalid)-Number(b.invalid)||a.length-b.length||a.points.length-b.points.length||a.index-b.index);
  return {points:options[0].points,valid:!options[0].invalid};
}
export const METAL_COLORS=[0x56b4e9,0xe69f00,0x009e73,0xcc79a7,0xf0e442,0x0072b2,0xd55e00,0x7fc97f,0xbeaed4,0xfdc086];
export function metalColorHex(name,metals){
  const index=Math.max(0,metals.findIndex(m=>m.name===name));
  return METAL_COLORS[index%METAL_COLORS.length];
}
export function routeDraft(project) {
  const placements=Object.fromEntries(project.floorplan.placements.map(p=>[p.module,p])),modules=Object.fromEntries(project.architecture.modules.map(m=>[m.id,m]));
  const dies=[...project.architecture.dies].sort((a,b)=>a.order-b.order),order=Object.fromEntries(dies.map(d=>[d.id,d.order]));
  const routes=[],vertical=[],terminals=[];
  const center=p=>[p.x_um+p.width_um/2,p.y_um+p.height_um/2];
  for(const link of project.architecture.links) {
    const p=placements[link.source],q=placements[link.target];if(!p||!q)continue;
    const i=order[p.die],j=order[q.die],step=j>i?1:-1,viaPoints=[];
    for(let k=i;k!==j;k+=step) {
      const lower_die=dies[Math.min(k,k+step)].id,upper_die=dies[Math.max(k,k+step)].id;
      const candidates=project.floorplan.tsv_regions.filter(r=>r.lower_die===lower_die&&r.upper_die===upper_die);
      const sourceCore=modules[link.source]?.core,targetCore=modules[link.target]?.core;
      const owned=candidates.filter(r=>r.core&&(r.core===sourceCore||r.core===targetCore)),pool=owned.length?owned:candidates,mid=center(p).map((v,n)=>(v+center(q)[n])/2);
      const region=[...pool].sort((a,b)=>center(a).reduce((s,v,n)=>s+Math.abs(v-mid[n]),0)-center(b).reduce((s,v,n)=>s+Math.abs(v-mid[n]),0))[0];
      const point=region?center(region):center(p).map((v,n)=>(v+center(q)[n])/2);
      const via={link:link.id,lower_die,upper_die,region_id:region?.id,point};viaPoints.push(via);vertical.push(via);
    }
    const source=edgeAnchor(p,viaPoints.length?viaPoints[0].point:center(q),modules[link.source]?.port_locations?.[link.source_port||'out'],'east');
    const target=edgeAnchor(q,viaPoints.length?viaPoints.at(-1).point:center(p),modules[link.target]?.port_locations?.[link.target_port||'in'],'west');
    terminals.push({link:link.id,source:{die:p.die,...source},target:{die:q.die,...target}});
    const channel=project.constraints?.routing_channels?.find(c=>c.links.includes(link.id)&&p.die===q.die&&p.die===c.die);
    const segment=(die,a,b,rectangles=[])=>{
      let points;
      if(channel){
        const horizontal=channel.direction==='HORIZONTAL',axis=horizontal?0:1;
        let entry=horizontal?[channel.x_um,channel.y_um+channel.height_um/2]:[channel.x_um+channel.width_um/2,channel.y_um];
        let exit=horizontal?[channel.x_um+channel.width_um,entry[1]]:[entry[0],channel.y_um+channel.height_um];
        if(a[axis]>b[axis])[entry,exit]=[exit,entry];
        points=[...escapePath(a,entry,rectangles).points,exit,...escapePath(exit,b,rectangles).points.slice(1)];
        points=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);
      }else points=escapePath(a,b,rectangles).points;
      if(points.length>1)routes.push({die,link:link.id,points});
    };
    if(!viaPoints.length)segment(p.die,source.point,target.point,[p,q]);
    else{
      let cursor=source.point;
      viaPoints.forEach((via,n)=>{segment(dies[i+n*step].id,cursor,via.point,n===0?[p]:[]);cursor=via.point;});
      segment(q.die,cursor,target.point,[q]);
    }
  }
  return {routes,vertical,terminals};
}
