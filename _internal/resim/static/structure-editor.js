export function updateStructure(project, rows){
  const next=structuredClone(project),old=new Map(project.architecture.dies.map(d=>[d.id,d]));
  if(!rows.length)throw new Error('至少保留一层 die');
  const ids=new Set(rows.map(r=>r.id));
  if(ids.size!==rows.length||rows.some(r=>!r.id.trim()))throw new Error('Die ID 不可为空或重复');
  for(const removed of old.keys())if(!ids.has(removed)){
    const used=project.architecture.modules.some(m=>m.allowed_dies.includes(removed))||project.floorplan.placements.some(p=>p.die===removed)||project.floorplan.tsv_regions.some(r=>r.lower_die===removed||r.upper_die===removed)||project.floorplan.supply_ports.some(p=>p.die===removed)||project.constraints.blockages.some(p=>p.die===removed)||project.constraints.routing_channels.some(p=>p.die===removed);
    if(used)throw new Error('不能删除 '+removed+'：请先迁移模块并处理接口、供电及约束引用');
  }
  next.architecture.dies=rows.map((r,order)=>{
    for(const k of ['area','width','thickness'])if(!Number.isFinite(r[k])||r[k]<=0)throw new Error(r.id+'：面积、宽度和厚度必须大于0');
    if(r.power!==null&&(!Number.isFinite(r.power)||r.power<=0))throw new Error(r.id+'：功耗预算须为正数或留空');
    return {...(old.get(r.id)||{voltage_V:1,max_utilization:.75,display_platform:false,package_layers:1}),id:r.id,kind:r.kind,order,width_um:r.width*1000,height_um:r.area/r.width*1000,thickness_um:r.thickness,power_budget_W:r.power};
  });
  return next;
}
