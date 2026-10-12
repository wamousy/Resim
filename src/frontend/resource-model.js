// Presentation budgets preserve unknown values and keep geometry separate from constraints.
const known=Number.isFinite;
export function areaBudget(die){
  const effective=known(die.area_mm2)&&known(die.reserved_area_mm2)?Math.max(0,die.area_mm2-die.reserved_area_mm2):null;
  const occupied=known(die.usable_module_area_mm2)?die.usable_module_area_mm2:null;
  const limit=known(die.max_utilization)&&known(effective)?effective*die.max_utilization:null;
  return {effective,occupied,limit,headroom:known(limit)&&known(occupied)?limit-occupied:null};
}
export function wiringState(report,die){
  const links=report.project?.architecture?.links??report.links;
  const aggregate=report.routing_status==='aggregate_budget_only'||(links?.length===0&&(report.interfaces||[]).some(i=>i.signal_vias>0));
  const layers=(report.metal_routing?.layers||[]).filter(r=>r.die===die);
  const unassigned=(report.metal_routing?.unassigned||[]).filter(r=>r.die===die);
  const incompleteConnections=(report.interfaces||[]).some(i=>(i.lower_die===die||i.upper_die===die)&&i.unallocated_signal_budget>0);
  let reason='';
  if(aggregate)reason='仅有跨层接口总位宽，尚未提供模块连接与路径。';
  else if(links?.length===0)reason='尚未定义模块连接，未评估互联资源。';
  else if(!layers.length)reason='缺少本层金属分配结果，需补充工艺数据或重新评估。';
  return {known:!reason,reason,unassigned:unassigned.length,incompleteConnections,zeroCapacity:layers.some(r=>r.zero_capacity_demand),partial:unassigned.length>0||incompleteConnections};
}
export function resourceData(report,die){
  const modules=(report.modules||[]).filter(m=>m.die===die);
  const areaMissing=modules.filter(m=>!known(m.required_footprint_um2));
  const powerMissing=modules.filter(m=>!known(m.power_W));
  const knownPower=modules.reduce((sum,m)=>sum+(known(m.power_W)?m.power_W:0),0);
  const ids=new Set(modules.map(m=>m.id));
  const geometryIssues=(report.issues||[]).filter(i=>['MODULE_OVERLAP','OUT_OF_BOUNDS','RESERVED_OVERLAP','RESERVE_BOUNDS'].includes(i.code)&&(i.subject===die||String(i.subject).split(' / ').some(id=>ids.has(id))));
  return {modules,areaMissing,powerMissing,knownPower,geometryIssues};
}
