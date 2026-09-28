// Display decisions shared by the application and workflow regression tests.
export function assessment(summary) {
  if (!summary) return {tone:'neutral',title:'等待评估',detail:'载入输入后预览或评估布局。'};
  if (summary.errors) return {tone:'error',title:'发现实现性违例',detail:`${summary.errors} 项违例 · ${summary.unknowns} 项数据缺失`};
  if (summary.unknowns) return {tone:'unknown',title:'数据不足，尚不能确认可行',detail:`当前已检查项未见违例，但仍有 ${summary.unknowns} 项缺失数据。`};
  return {tone:'ok',title:'通过当前模型检查',detail:'这是架构级估算，需结合后端实现数据校准。'};
}
export function candidateFolder(storage,mode,candidate) {
  if (!storage) return null;
  const base=storage.run_dir+'\\results';
  if (mode!=='optimize') return base;
  if (candidate==='base') return base+'\\baseline';
  return /^\d+$/.test(candidate)?base+'\\candidate-'+(Number(candidate)+1):base;
}
export function compareReports(baseline,current) {
  if (!baseline||!current) return null;
  const keys=['errors','unknowns','weighted_delay_ps','weighted_wirelength_um','signal_via_segments','total_via_segments','peak_congestion','power_W'];
  const metrics=Object.fromEntries(keys.map(key=>{
    const before=baseline.summary[key],after=current.summary[key];
    return [key,{baseline:before,candidate:after,delta:before==null||after==null?null:after-before}];
  }));
  const original=Object.fromEntries(baseline.modules.map(m=>[m.id,m]));
  metrics.migrated_modules=current.modules.filter(m=>original[m.id]&&original[m.id].die!==m.die).map(m=>m.id);
  return metrics;
}
export function matchingSavedCandidate(result,mode,working) {
  const same=r=>r&&r.plan_id===working.plan_id&&r.simulator_version===working.simulator_version;
  if(mode==='evaluate') return same(result)?'current':null;
  if(same(result.baseline)) return 'base';
  const index=result.candidates.findIndex(same);
  return index<0?null:String(index);
}
export function runLabel(run) {
  const date=new Date(run.created_at);
  const time=Number.isNaN(date.getTime())?run.run_id:date.toLocaleString('zh-CN',{hour12:false});
  const state={completed:'已完成',failed:'失败',running:'计算中'}[run.status]||run.status;
  return `${time} · ${run.mode==='optimize'?'自动寻优':'布局评估'} · ${state}`;
}
