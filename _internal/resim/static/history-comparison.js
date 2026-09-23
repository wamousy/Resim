import {runLabel} from './ui-state.js';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const METRICS=[['die_count','Die 数量','层'],['module_count','模块数量','个'],['total_die_area_mm2','Die 总面积','mm²'],['total_module_footprint_mm2','模块总占地','mm²'],['power_W','总功耗','W'],['peak_congestion','峰值拥塞比',''],['wiring_metal_area_um2','互联金属面积','µm²'],['wiring_track_area_um2','互联轨道面积','µm²'],['weighted_wirelength_um','加权线长','µm'],['weighted_delay_ps','加权延迟估算','ps'],['signal_via_segments','信号 TSV 需求','根'],['signal_hb_sites','信号 HB 接点','个'],['errors','实现性违例','项'],['unknowns','待补数据','项']];
export function savedCandidates(payload){
  if(payload.mode!=='optimize')return payload.result?.summary?[{id:'current',name:'给定布局',report:payload.result}]:[];
  return [...(payload.result.baseline?[{id:'base',name:'给定布局 / 基线',report:payload.result.baseline}]:[]),...(payload.result.candidates||[]).map((report,i)=>({id:String(i),name:'候选 '+(i+1),report}))];
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
export class HistoryComparison{
  constructor({api,download}){
    Object.assign(this,{api,download,projectKey:'',comparison:null});this.sides={a:{token:0,options:[]},b:{token:0,options:[]}};
    const host=document.getElementById('history-comparison');
    host.innerHTML=`<div class="panel-head"><div><div class="section-label">HISTORY COMPARISON</div><h2>历史结果对比</h2></div><button id="download-history-diff" disabled>下载对比 JSON</button></div><p>选择两个历史方案；差值 = B − A。</p><div class="history-compare-pickers">${['a','b'].map((side,i)=>`<fieldset><legend>${i?'B / 对比方案':'A / 基准方案'}</legend><label>工程<select id="compare-${side}-project" aria-label="${side.toUpperCase()} 对比工程"></select></label><label>历史运行<select id="compare-${side}-run" aria-label="${side.toUpperCase()} 历史运行"></select></label><label>方案<select id="compare-${side}-candidate" aria-label="${side.toUpperCase()} 历史方案"></select></label><small id="compare-${side}-meta"></small><a id="compare-${side}-report" target="_blank" rel="noreferrer" hidden>查看这次的完整报告 ↗</a></fieldset>`).join('')}</div><p id="history-compare-status" role="status">选择历史记录后自动对比。</p><div id="history-diff"></div>`;
    for(const side of ['a','b']){this.el(side,'project').onchange=()=>{this.userSelection=true;this.loadRuns(side);};this.el(side,'run').onchange=()=>{this.userSelection=true;this.loadResult(side);};this.el(side,'candidate').onchange=()=>{this.userSelection=true;this.render();};}
    document.getElementById('download-history-diff').onclick=()=>{if(this.comparison)this.download('resim-history-comparison.json',JSON.stringify(this.comparison,null,2),'application/json');};
  }
  el(side,field){return document.getElementById('compare-'+side+'-'+field);}
  async refresh(projects,current){
    const key=JSON.stringify(projects.map(p=>[p.id,p.name]));
    if(key!==this.projectKey){this.projectKey=key;for(const side of ['a','b']){const e=this.el(side,'project'),old=e.value;e.innerHTML=projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');e.value=projects.some(p=>p.id===old)?old:projects.some(p=>p.id===current)?current:projects[0]?.id||'';}}
    if(current&&!this.userSelection&&current!==this.autoProject){for(const side of ['a','b'])this.el(side,'project').value=current;this.autoProject=current;}
    await Promise.all(['a','b'].map(side=>this.loadRuns(side)));
  }
  clear(side,message){this.sides[side].options=[];this.el(side,'candidate').innerHTML='<option value="">'+esc(message)+'</option>';this.el(side,'meta').textContent='';this.render();}
  async loadRuns(side){const state=this.sides[side],token=++state.token,p=this.el(side,'project').value,old=this.el(side,'run').value;this.clear(side,'等待运行记录');this.el(side,'run').innerHTML='';if(!p)return;
    try{const runs=await this.api(`projects/${encodeURIComponent(p)}/runs`);if(token!==state.token)return;state.runs=runs.filter(r=>r.status==='completed');this.el(side,'run').innerHTML=state.runs.length?state.runs.map(r=>`<option value="${esc(r.run_id)}">${esc(runLabel(r))} · ${esc(r.run_id)}</option>`).join(''):'<option value="">暂无已完成运行</option>';
      const selected=state.runs.find(r=>r.run_id===old);this.el(side,'run').value=selected?.run_id||(side==='b'?state.runs[1]?.run_id:null)||state.runs[0]?.run_id||'';await this.loadResult(side);
    }catch(e){if(token===state.token)this.clear(side,'读取失败：'+e.message);}
  }
  async loadResult(side){const state=this.sides[side],token=++state.token,p=this.el(side,'project').value,r=this.el(side,'run').value,old=state.loadedKey===p+'/'+r?state.selectedCandidate:null;this.clear(side,'正在读取结果…');if(!r){this.clear(side,'无可用结果');return;}
    try{const payload=await this.api(`projects/${encodeURIComponent(p)}/runs/${encodeURIComponent(r)}/result`);if(token!==state.token)return;state.options=savedCandidates(payload);this.el(side,'candidate').innerHTML=state.options.length?state.options.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''):'<option value="">无评估方案</option>';state.loadedKey=p+'/'+r;if(state.options.some(c=>c.id===old))this.el(side,'candidate').value=old;this.render();}
    catch(e){if(token===state.token)this.clear(side,'读取失败：'+e.message);}
  }
  selection(side){const r=this.sides[side].options.find(c=>c.id===this.el(side,'candidate').value);if(r)this.sides[side].selectedCandidate=r.id;return r?{project_id:this.el(side,'project').value,run_id:this.el(side,'run').value,candidate:r.id,candidate_name:r.name,report:r.report}:null;}
  render(){const a=this.selection('a'),b=this.selection('b'),host=document.getElementById('history-diff'),status=document.getElementById('history-compare-status');this.comparison=null;document.getElementById('download-history-diff').disabled=!a||!b;
    for(const side of ['a','b']){const s=side==='a'?a:b;this.el(side,'meta').textContent=s?`计算版本 ${s.report.simulator_version||'未知'} · PLAN ${s.report.plan_id||'未知'}`:'';const link=this.el(side,'report');link.hidden=!s;if(s)link.href=`/api/projects/${encodeURIComponent(s.project_id)}/runs/${encodeURIComponent(s.run_id)}/export/report.html?candidate=${encodeURIComponent(s.candidate)}`;}
    if(!a||!b){host.innerHTML='';status.textContent='请选择两边有效的历史运行与方案。';return;}
    const diff=historyDiff(a.report,b.report),meta=s=>({project_id:s.project_id,run_id:s.run_id,candidate:s.candidate,candidate_name:s.candidate_name,simulator_version:s.report.simulator_version,plan_id:s.report.plan_id});
    this.comparison={schema_version:'resim-comparison/1',created_at:new Date().toISOString(),baseline:meta(a),candidate:meta(b),...diff};
    status.textContent=a.project_id===b.project_id&&a.run_id===b.run_id&&a.candidate===b.candidate?'当前选择同一个历史方案，差值为 0（缺失值仍不可比较）。':`对比已完成 · ${diff.changes.length} 个模块布局变化 · ${diff.issues.added.length} 类对象问题新增 · ${diff.issues.resolved.length} 类对象问题消失`;
    const n=v=>v===null?'未知':v.toLocaleString('zh-CN',{maximumFractionDigits:5});
    const location=p=>p?`${p.die} · (${n(p.x_um??null)}, ${n(p.y_um??null)}) · ${n(p.width_um??null)} × ${n(p.height_um??null)} µm`:'—';
    const issues=(title,items)=>`<details><summary>${title} · ${items.length} 类对象问题</summary>${items.length?'<ul>'+items.slice(0,100).map(i=>`<li><b>${esc(i.subject)} · ${esc(i.code)}</b><span>${esc(i.reason)}</span></li>`).join('')+'</ul>':'<p>无</p>'}${items.length>100?'<p>页面显示前 100 项，下载对比 JSON 查看全部。</p>':''}</details>`;
    host.innerHTML=diff.warnings.map(w=>`<p class="compare-warning">${esc(w)}</p>`).join('')+`<div class="table-scroll"><table><thead><tr><th>资源 / 指标</th><th>A 基准</th><th>B 对比</th><th>变化 B − A</th></tr></thead><tbody>${diff.metrics.map(m=>`<tr><td>${esc(m.label)} <small>${esc(m.unit)}</small></td><td>${n(m.a)}</td><td>${n(m.b)}</td><td class="${m.delta===null?'':m.delta>0?'delta-up':m.delta<0?'delta-down':''}">${m.delta===null?'无法比较':(m.delta>0?'+':'')+n(m.delta)}</td></tr>`).join('')}</tbody></table></div><p class="hint">增减不直接代表优劣；未知指标不比较。</p><details class="module-diff"><summary>模块布局变化 · ${diff.changes.length} 个</summary><div class="table-scroll"><table><thead><tr><th>模块</th><th>变化</th><th>A 位置 / 尺寸</th><th>B 位置 / 尺寸</th></tr></thead><tbody>${diff.changes.slice(0,100).map(m=>`<tr><td>${esc(m.id)}</td><td>${esc(m.type)}</td><td>${esc(location(m.before))}</td><td>${esc(location(m.after))}</td></tr>`).join('')||'<tr><td colspan="4">没有模块布局变化</td></tr>'}</tbody></table></div>${diff.changes.length>100?'<p>页面显示前 100 个，完整数据见对比 JSON。</p>':''}</details><div class="issue-diff">${issues('新增问题',diff.issues.added)}${issues('已消失问题',diff.issues.resolved)}${issues('持续存在问题',diff.issues.persistent)}</div><details class="comparison-help"><summary>对比口径</summary><p class="hint">问题按严重级别、代码和对象匹配并去重；消失不代表已完成后端验证。</p></details>`;
  }
}
