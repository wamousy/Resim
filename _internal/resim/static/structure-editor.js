import {readStack,writeStack,stackModel,applyStack} from './stack-model.js?v=2';
export function updateStructure(project, rows, interfaceKinds=[]){
  const next=structuredClone(project),old=new Map(project.architecture.dies.map(d=>[d.id,d]));
  if(!rows.length)throw new Error('至少保留一层 Die');
  const normalized=rows.map(r=>({...r,id:String(r.id??'').trim(),originalId:r.originalId===undefined?(old.has(r.id)?r.id:null):r.originalId}));
  const ids=new Set(normalized.map(r=>r.id));
  if(ids.size!==rows.length||normalized.some(r=>!r.id))throw new Error('Die ID 不可为空或重复');
  const originals=normalized.filter(r=>r.originalId).map(r=>r.originalId);
  if(new Set(originals).size!==originals.length||originals.some(id=>!old.has(id)))throw new Error('Die 原始记录无效，请重新载入结构表格');
  const used=id=>project.architecture.modules.some(m=>m.allowed_dies.includes(id))||project.floorplan.placements.some(p=>p.die===id)||(project.floorplan.tsv_regions||[]).some(r=>r.lower_die===id||r.upper_die===id)||(project.floorplan.supply_ports||[]).some(p=>p.die===id)||(project.constraints.blockages||[]).some(p=>p.die===id)||(project.constraints.routing_channels||[]).some(p=>p.die===id);
  for(const removed of old.keys())if(!originals.includes(removed)&&used(removed))throw new Error('不能删除 '+removed+'：仍有模块、接口或约束引用');
  const renames=new Map(normalized.filter(r=>r.originalId).map(r=>[r.originalId,r.id])),rename=id=>renames.get(id)??id;
  next.architecture.dies=normalized.map((r,order)=>{
    const height=r.height===undefined?r.area/r.width:r.height;
    if(![r.width,height,r.thickness].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(r.width*height))throw new Error(r.id+'：宽度、高度和厚度必须大于 0');
    if(r.area!==undefined&&(!Number.isFinite(r.area)||r.area<=0||Math.abs(r.area-r.width*height)>Math.max(1,r.area)*1e-9))throw new Error(r.id+'：面积须大于 0，且等于宽度 × 高度');
    if(r.power!==null&&(!Number.isFinite(r.power)||r.power<=0))throw new Error(r.id+'：功耗预算须为正数或留空');
    return {...(old.get(r.originalId)||{voltage_V:1,max_utilization:.75,display_platform:false,package_layers:1}),id:r.id,kind:r.kind,order,width_um:r.width*1000,height_um:height*1000,thickness_um:r.thickness,power_budget_W:r.power};
  });
  // Simultaneous substitution also supports swapping two existing IDs.
  for(const m of next.architecture.modules)m.allowed_dies=m.allowed_dies.map(rename);
  for(const p of next.floorplan.placements)p.die=rename(p.die);
  for(const r of next.floorplan.tsv_regions||[]){r.lower_die=rename(r.lower_die);r.upper_die=rename(r.upper_die);}
  for(const list of [next.floorplan.supply_ports,next.constraints.blockages,next.constraints.routing_channels])for(const r of list||[])r.die=rename(r.die);
  const explicit=readStack(project).die_faces;
  if(rows.some(r=>r.face!==undefined)){
    const inferred=stackModel(project).faces;
    const faces=Object.fromEntries(normalized.map(r=>[r.id,r.face??inferred.get(r.originalId)?.face??'unknown']));
    return applyStack(next,faces,interfaceKinds.map(p=>({...p,lower:rename(p.lower),upper:rename(p.upper)})));
  }
  if(Object.keys(explicit).length)return writeStack(next,{die_faces:Object.fromEntries(Object.entries(explicit).filter(([id])=>originals.includes(id)).map(([id,face])=>[rename(id),face]))});
  return next;
}

// Visual roles belong to stack interfaces, rather than editable Die names.
export function dieDisplayRoles(project){
  const roles=new Map();
  for(const d of project.architecture.dies)if(d.kind==='dram'&&d.package_layers===8)roles.set(d.id,'dram_8layers');
  if(project.architecture.chip==='blx_scheme1')for(const r of project.floorplan.tsv_regions||[]){
    if(r.interconnect==='HB'&&r.orientation==='F2F'){roles.set(r.lower_die,'ldie');roles.set(r.upper_die,'bdie');}
    if(r.orientation==='B2B'){roles.set(r.lower_die,'xdie');roles.set(r.upper_die,'ldie');}
  }
  // Functional roles survive a legitimate change to bonding type or face direction.
  if(project.architecture.chip==='blx_scheme1')for(const p of project.floorplan.placements||[]){
    if(/__rssram_wrapper$/.test(p.module))roles.set(p.die,'bdie');
    if(/__TC[0-3]$/.test(p.module))roles.set(p.die,'ldie');
    if(/__iox_subsystem__UCIE[0-2]$/.test(p.module))roles.set(p.die,'xdie');
  }
  return roles;
}
