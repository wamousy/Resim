import {number as fmt} from './layout-model.js?v=13';
const esc=s=>String(s??'未知').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let activeGroup='area';
const groups={area:['die_area','module_area','reserved','utilization','free'],wiring:['congestion','wire_area'],power:['power','tsv']};
export function showCalculations(report,pending=false){
  const select=document.getElementById('calculation-die'),target=document.getElementById('calculation-detail');
  const before=select.value;select.innerHTML=report.dies.map(d=>`<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('');
  if(report.dies.some(d=>d.id===before))select.value=before;
  const draw=()=>{
    if(pending){target.innerHTML='<p>输入或布局有变化，计算完成后显示新的代入值。</p>';return;}
    const entry=report.calculations?.dies.find(d=>d.die===select.value);
    if(!entry){target.innerHTML='<p>历史结果未记录计算明细，请重新评估。</p>';return;}
    target.innerHTML=entry.metrics.filter(m=>groups[activeGroup].includes(m.key)).map(m=>`<article class="formula-card"><h3>${esc(m.title)}</h3><code>${esc(m.formula)}</code><p class="substitution">${esc(m.substitution)}</p><p>${esc(m.note)}</p></article>`).join('')+
    `<details data-source-group="area power"><summary>模块尺寸与面积需求明细</summary><div class="table-scroll"><table><tr><th>模块</th><th>宽 × 高 µm</th><th>矩形面积 µm²</th><th>最低需求 µm²</th><th>目标 / 实际单元利用率</th><th>设定依据</th><th>功耗 W</th></tr>${entry.module_terms.map(m=>`<tr><td>${esc(m.id)}</td><td>${fmt(m.width_um)} × ${fmt(m.height_um)}</td><td>${fmt(m.footprint_um2)}</td><td>${fmt(m.required_footprint_um2)}</td><td>${m.target_cell_utilization==null?'未知':fmt(m.target_cell_utilization*100)+'%'} / ${m.cell_utilization==null?'未知':fmt(m.cell_utilization*100)+'%'}</td><td>${esc(m.utilization_basis||'未提供；规划输入，需确认')}</td><td>${fmt(m.power_W)}</td></tr>`).join('')}</table></div><p>最低需求 = 标准单元面积 / 目标单元利用率 + 硬宏面积。</p></details>`+
    `<details data-source-group="area"><summary>预留区域明细（并集计算前）</summary><div class="table-scroll"><table><tr><th>区域</th><th>类型</th><th>左下角 µm</th><th>宽 × 高 µm</th></tr>${entry.reserve_rectangles.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${fmt(r.x_um)}, ${fmt(r.y_um)}</td><td>${fmt(r.width_um)} × ${fmt(r.height_um)}</td></tr>`).join('')}</table></div></details>`+
    `<details data-source-group="wiring"><summary>每个金属层对网格容量的贡献</summary><div class="table-scroll"><table><tr><th>层</th><th>方向</th><th>pitch µm</th><th>有效轨道容量 / 格</th></tr>${entry.congestion_capacity_terms.map(m=>`<tr><td>${esc(m.metal)}</td><td>${esc(m.direction)}</td><td>${fmt(m.pitch_um,5)}</td><td>${fmt(m.capacity_tracks,5)}</td></tr>`).join('')}</table></div></details>`;
  };
  const refresh=()=>{draw();target.querySelectorAll('[data-source-group]').forEach(d=>d.hidden=!d.dataset.sourceGroup.split(' ').includes(activeGroup));document.querySelectorAll('[data-calculation-group]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calculationGroup===activeGroup)));};
  document.querySelectorAll('[data-calculation-group]').forEach(button=>button.onclick=()=>{activeGroup=button.dataset.calculationGroup;refresh();});
  select.onchange=refresh;refresh();
}
