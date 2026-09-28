// Display-only semantics; never change routing budgets or project inputs.
export const SCOPE_COLORS={intra:0x48d8c0,inter:0xc193ff,cross:0xffb869};
export function connectionScope(link,modules,placements){
  if(placements[link.source]?.die!==placements[link.target]?.die)return 'cross';
  return modules[link.source]?.core===modules[link.target]?.core?'intra':'inter';
}
export const SCOPE_NAMES={intra:'同层 core 内',inter:'同层 core 间',cross:'跨 die'};
export function transferBudget(link){
  const rate=Number(link.lane_rate_Gbps),data=link.data_wires??Math.ceil(link.bandwidth_GBps*8/rate);
  return {bits:link.bus_width_bits??null,lanes:data,laneRate:rate,rawGBps:Number.isFinite(rate)&&rate>0?data*rate/8:null,demandGBps:link.bandwidth_GBps};
}
export function logicalCaption(link){
  const b=transferBudget(link),fmt=n=>n==null?'未知':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2});
  return `${b.bits==null?'位宽未知':fmt(b.bits)+' bit'}\n${fmt(b.rawGBps)} GB/s 原始上限`;
}
export function visibleConnection(link,scope,filter,core,modules){
  return (filter==='all'||scope===filter)&&(!core||modules[link.source]?.core===core||modules[link.target]?.core===core);
}
