import {distinctCandidates} from './layout-variants.js';
export const METRICS=[['die_count','Die 数量','层'],['module_count','模块数量','个'],['total_die_area_mm2','Die 总面积','mm²'],['total_module_footprint_mm2','模块总占地','mm²'],['power_W','总功耗','W'],['peak_congestion','峰值拥塞比',''],['wiring_metal_area_um2','互联金属面积','µm²'],['wiring_track_area_um2','互联轨道面积','µm²'],['weighted_wirelength_um','加权线长','µm'],['weighted_delay_ps','加权延迟估算','ps'],['signal_via_segments','信号 TSV 需求','根'],['signal_hb_sites','信号 HB 接点','个'],['errors','实现性违例','项'],['unknowns','待补数据','项']];
export function savedCandidates(payload){
  if(payload.mode!=='optimize')return payload.result?.summary?[{id:'current',name:'给定布局',report:payload.result}]:[];
  return distinctCandidates(payload.result);
}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function historyDiff(a,b){
  if(!a?.summary||!b?.summary)throw new Error('两个历史方案都需要完整的评估结果');
  const metrics=METRICS.map(([key,label,unit])=>{const av=a.summary[key],bv=b.summary[key];return {key,label,unit,a:finite(av)?av:null,b:finite(bv)?bv:null,delta:finite(av)&&finite(bv)?bv-av:null};});
  const placements=r=>new Map((r.project?.floorplan?.placements||r.modules||[]).map(m=>[m.module||m.id,m]));
  const pa=placements(a),pb=placements(b),changes=[];
  for(const id of new Set([...pa.keys(),...pb.keys()])){const x=pa.get(id),y=pb.get(id);if(!x||!y){changes.push({id,type:x?'移除':'新增',before:x||null,after:y||null});continue;}
    const kinds=[];if(x.die!==y.die)kinds.push('跨层迁移');if(x.x_um!==y.x_um||x.y_um!==y.y_um)kinds.push('位置变化');if(x.width_um!==y.width_um||x.height_um!==y.height_um)kinds.push('尺寸变化');
    if(kinds.length)changes.push({id,type:kinds.join('、'),before:x,after:y});
  }
  const key=i=>JSON.stringify([i.severity,i.code,i.subject]);
  const ai=new Map((a.issues||[]).map(i=>[key(i),i])),bi=new Map((b.issues||[]).map(i=>[key(i),i]));
  const added=[...bi].filter(([k])=>!ai.has(k)).map(([,v])=>v),resolved=[...ai].filter(([k])=>!bi.has(k)).map(([,v])=>v),persistent=[...bi].filter(([k])=>ai.has(k)).map(([,v])=>v);
  const warnings=[];
  if(a.simulator_version!==b.simulator_version)warnings.push('计算版本不同：数值差异可能来自模型更新。');
  if(JSON.stringify(a.project?.resources)!==JSON.stringify(b.project?.resources))warnings.push('工艺库或资源参数不同：比较的是完整方案代价，不能只归因于布局。');
  if(a.summary.unknowns||b.summary.unknowns)warnings.push('至少一个方案有缺失数据；未知数值不按零计算。');
  return {metrics,changes,issues:{added,resolved,persistent},warnings};
}
