import {number as fmt,area} from './layout-model.js?v=13';
const esc=s=>String(s??'未提供').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups={area:['die_area','module_area','reserved','utilization','free'],wiring:['congestion','wire_area'],power:['power'],vertical:[]};
const table=(heads,rows)=>`<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const fold=(title,body)=>`<details class="resource-disclosure"><summary>${title}</summary>${body}</details>`;
export function showCalculations(report,pending=false,{die,group='area'}={}){
  const target=document.getElementById('calculation-detail');
  if(pending){target.innerHTML='<p class="resource-empty" role="status">输入已变化，等待重新计算。</p>';return;}
  const d=report.dies.find(d=>d.id===die);if(!d){target.innerHTML='';return;}
  const entry=report.calculations?.dies?.find(d=>d.die===die);
  if(group==='vertical'){target.innerHTML='';return;}
  if(d.display_platform&&group!=='wiring'){target.innerHTML='<p class="resource-empty">此层仅表示封装平台，不展示内部面积与功耗估算。跨层资源见 TSV / HB。</p>';return;}
  const metrics={area:[['Die 面积',d.area_mm2,'mm²'],['模块占地',d.module_area_mm2,'mm²'],['预留面积',d.reserved_area_mm2,'mm²'],['剩余可布局',d.free_area_mm2,'mm²'],['有效区占用率',d.footprint_utilization==null?null:d.footprint_utilization*100,'%']],wiring:[['峰值拥塞比',d.peak_congestion,''],['互联金属面积',d.wire_area?.metal_area_um2,'µm²'],['互联轨道面积',d.wire_area?.track_area_um2,'µm²']],power:[['模块总功耗',d.power_W,'W'],['功耗预算',d.power_budget_W,'W'],['功耗余量',d.power_margin_W,'W']]};
  let html=`<div class="resource-metric-grid">${metrics[group].map(([label,n,unit])=>`<div class="resource-metric"><span>${label}${unit?' / '+unit:''}</span><strong class="${n<0?'negative':''}">${n==null?'待补数据':fmt(n,3)}</strong></div>`).join('')}</div>`;
  if(!entry){target.innerHTML=html+'<p class="resource-empty">本历史结果未记录计算过程。</p>';return;}
  const terms=entry.module_terms||[];
  if(group==='area'){
    html+=fold(`模块面积明细 · ${terms.length} 个`,table(['模块','宽 × 高 / µm','占地 / mm²','最低需求 / mm²','目标 / 实际单元利用率'],terms.map(m=>`<tr><td>${esc(m.id)}</td><td>${fmt(m.width_um)} × ${fmt(m.height_um)}</td><td>${area(m.footprint_um2/1e6)}</td><td>${m.required_footprint_um2==null?'待补数据':area(m.required_footprint_um2/1e6)}</td><td>${m.target_cell_utilization==null?'未知':fmt(m.target_cell_utilization*100)+'%'} / ${m.cell_utilization==null?'未知':fmt(m.cell_utilization*100)+'%'}</td></tr>`))+'<p>最低需求 = 标准单元面积 ÷ 目标单元利用率 + 硬宏面积；目标利用率由项目输入设定。</p>');
    html+=fold(`预留区域明细 · ${(entry.reserve_rectangles||[]).length} 个`,table(['区域','类型','左下角 / µm','宽 × 高 / µm'],(entry.reserve_rectangles||[]).map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.kind)}</td><td>${fmt(r.x_um)}, ${fmt(r.y_um)}</td><td>${fmt(r.width_um)} × ${fmt(r.height_um)}</td></tr>`))+'<p>此处为原始矩形；预留总面积按并集去重计算。</p>');
  }
  if(group==='power')html+=fold(`模块功耗明细 · ${terms.length} 个`,table(['模块','功耗 / W'],terms.map(m=>`<tr><td>${esc(m.id)}</td><td>${m.power_W==null?'待补数据':fmt(m.power_W)}</td></tr>`)));
  html+=fold('计算公式与代入值',(entry.metrics||[]).filter(m=>groups[group].includes(m.key)).map(m=>`<article class="resource-formula"><h3>${esc(m.title)}</h3><code>${esc(m.formula)}</code><p class="substitution">${esc(m.key==='congestion'&&d.peak_congestion==null?'布线需求待补，当前无法给出有效的拥塞代入结果。':m.substitution)}</p><p>${esc(m.note)}</p></article>`).join(''));
  target.innerHTML=html;
}
