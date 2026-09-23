import {number as fmt} from './layout-model.js?v=13';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'未提供').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function showMethods(report,searchResult=null){
  if(!report){$('technology-pill').textContent='工艺 · 等待输入';$('model-methods').innerHTML='';$('search-method').innerHTML='';return;}
  const resources=report.project.resources,m=report.methodology,modules=report.project.architecture.modules;
  $('technology-pill').textContent='工艺 · '+resources.technology;$('technology-pill').title=resources.technology_provenance;
  const targets=[...new Set(modules.map(x=>fmt(x.target_cell_utilization*100,1)+'%'))].join(' / ');
  $('model-methods').innerHTML=`<div class="panel-head"><div><div class="section-label">工艺与参数依据</div><h2>${esc(resources.technology)}</h2></div><span>${resources.metals.length} 个金属层 · 当前工程输入</span></div>
    <div class="method-grid">
    <details class="method-card"><summary>工艺数据与来源</summary><p class="method-source">来源声明：${esc(resources.technology_provenance)}</p><p>${esc(m?.technology.scope||'历史报告：使用已保存输入中的面积、金属线宽与 pitch 参数。')}</p><p>${esc(m?.technology.builtin_reference||'内置参考记录可从下方入口查看。')}</p>${resources.technology.toLowerCase().includes('nangate45')?'<p>内置多层示例的 SRAM/DRAM 尺寸、功耗和 TSV 参数是演示假设，并非 Nangate45 已标定工艺数据。</p>':''}<details class="source-notes"><summary>工程原始来源与备注</summary><p>TSV 来源：${esc(resources.tsv?.provenance||'未提供')}</p><p>${esc((resources.notes||[]).join('；'))}</p></details><a href="/api/sources" target="_blank" rel="noreferrer">查看内置参考文件的版本与 SHA-256 ↗</a><small>内置参考记录用于追溯示例；当前工程参数以输入为准。</small></details>
    <details class="method-card"><summary>目标利用率 · ${esc(targets)}</summary><b class="method-value">${esc(targets)} <small>本工程目标值</small></b><p>${esc(m?.utilization.ownership||'target_cell_utilization 为项目规划输入，省略时默认 65%；不是工艺库规定。')}</p><p>${esc(m?.utilization.definition||'实际利用率 = 标准单元面积 / (模块矩形面积 − 硬宏面积)。')}</p><p>建议在模块的 utilization_basis 中记录设定人或校准依据；模块详情可查看目标值和实际值。</p></details>
    <details class="method-card"><summary>TSV 需求计算</summary><code>Σ（物理信号线数 × 跨越接口数）</code><p>${esc(m?.signals.example||'64 根线跨越两个相邻接口，累计需求为 128 个信号 TSV 接口位置。')}</p><p>${esc(m?.signals.exclusions||'包含数据、控制与冗余，不含电源和地；不是独立逻辑连接数，也不是已放置孔数。')}</p></details>
    <details class="method-card"><summary>连接路径与线长</summary><p>${esc(m?.routing.description||'本历史报告未记录边缘端口模型，线长与路径保留当时结果；重新评估才使用当前模型。')}</p><p>端口位置随模块移动和跨层迁移更新，路径变化后同步重算互联面积与拥塞。</p></details></div>`;
  const algorithm=m?.optimization||searchResult?.methodology;
  if(!algorithm){$('search-method').innerHTML='<h3>算法说明</h3><p>本历史记录未保存算法明细。重新运行寻优会记录目标函数、求解状态与界限。</p>';return;}
  const c=report.candidate;
  $('search-method').innerHTML=`<div class="panel-head"><div><div class="section-label">寻优依据</div><h2>自动分区与布局 · ${esc(algorithm.algorithm)}</h2></div><span>网格 ${fmt(algorithm.grid_um)} µm · 时间上限 ${fmt(algorithm.time_limit_s)} s · 最多 ${algorithm.candidates} 个候选</span></div>
    ${c?`<div class="solver-evidence"><span>求解状态<b>${esc(c.solver_status)}</b></span><span>代理目标值<b>${fmt(c.surrogate_objective,3)}</b></span><span>目标下界<b>${fmt(c.objective_bound,3)}</b></span><span>相对差距<b>${c.relative_gap==null?'未记录':fmt(c.relative_gap*100,3)+'%'}</b></span></div><p>${c.bound_scope==='original_discrete_model'?'界限针对原始离散代理模型。':c.bound_scope?'本候选已排除 '+c.previous_candidates_excluded+' 个先前解；下界仅对剩余解空间有效。':'历史候选未记录下界的解空间范围。'} ${c.accepted?'已通过当前资源模型复核。':'尚未通过完整资源复核，请查看违例与缺失项。'}</p>`:'<p class="method-source">选中寻优候选后显示目标值、下界和差距；“给定布局 / 基线”没有求解最优性证明。</p>'}
    <details class="algorithm-details"><summary>目标、约束与“最优”的含义</summary><code>${esc(algorithm.objective)}</code><p>当前权重：线长 ${algorithm.wirelength_weight}；跨层 ${algorithm.tier_crossing_weight}。相对差距 = (目标值 − 下界) / max(|目标值|, 1)。</p><p><b>求解约束：</b>${esc(algorithm.constraints)}</p><p><b>复核与排名：</b>${esc(algorithm.ranking)}</p><p><b>适用范围：</b>${esc(algorithm.limitations)}</p><p class="optimality-note">${esc(algorithm.optimality)}</p><p>${esc(algorithm.improvement)}</p></details>
    ${searchResult?`<p>本次状态：${esc((searchResult.solver_statuses||[]).join(' / ')||searchResult.search_status)}。${esc(searchResult.message||'')}</p>`:''}`;
}
