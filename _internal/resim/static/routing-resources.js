import {number as fmt} from './layout-model.js?v=13';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function showRoutingResources(report,pending=false,onLink=()=>{}){
  const root=document.getElementById('routing-resources');
  if(!report){root.innerHTML='';return;}
  const previous=root.querySelector('select')?.value;
  if(pending){root.classList.add('pending');root.setAttribute('aria-busy','true');return;}
  root.classList.remove('pending');root.removeAttribute('aria-busy');
  if(!report.metal_routing){root.innerHTML='<h2>间距、通道与逐金属层容量</h2><p>此历史报告未记录分层分配，请重新评估。</p>';return;}
  root.innerHTML=`<div class="panel-head"><div><div class="section-label">物理规划检查</div><h2>间距、通道与逐金属层容量</h2></div><label>查看 die <select aria-label="布线资源 die">${report.dies.map(d=>`<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('')}</select></label></div><p>全局模块间距 ${fmt(report.project.constraints.min_module_spacing_um||0)} µm；模块间要求取全局间距与双方 halo 之和的较大值。通道禁止模块及其 halo 占用。</p><div class="routing-tables"></div>`;
  const select=root.querySelector('select');if(report.dies.some(d=>d.id===previous))select.value=previous;
  const draw=()=>{
    const die=select.value,layers=report.metal_routing.layers.filter(r=>r.die===die),channels=report.metal_routing.channels.filter(r=>r.die===die),spacing=(report.spacing||[]).filter(r=>r.die===die);
    const table=(heads,rows)=>`<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    root.querySelector('.routing-tables').innerHTML=`<h3>独立金属层容量</h3><p>容量 = floor(网格横向尺寸 ÷ pitch × 该层可用比例)。需求按该层已分配线数和格内长度计；其它层空闲不抵消本层超载。</p>`+table(['金属层 / 方向','单线宽 / pitch µm','可用比例','容量 / 格','峰值需求','峰值比','超限格','热点格与连接'],layers.map(r=>`<tr class="${r.overflow_cells?'resource-fail':''}"><td><b>${esc(r.metal)}</b> / ${r.direction==='HORIZONTAL'?'H':'V'}</td><td>${fmt(r.width_um,5)} / ${fmt(r.pitch_um,5)}</td><td>${fmt(r.availability*100)}%</td><td>${r.capacity_tracks}</td><td>${fmt(r.peak_demand_tracks,3)}</td><td>${r.zero_capacity_demand?'零容量有需求':fmt(r.peak_ratio,3)}</td><td>${r.overflow_cells}</td><td>(${r.peak_cell.x}, ${r.peak_cell.y})<small>${r.peak_cell.links.map(id=>`<button class="text-button" data-routing-link="${esc(id)}">${esc(id)}</button>`).join('')}</small></td></tr>`))+
    `<h3>布线通道截面容量</h3><p>通道使用完整线数检查同一截面上的同时需求，不按线段长度折减。绑定连接必须留在通道所属 die，并沿通道中心线经过两端。</p>`+(channels.length?table(['通道 / 层','净宽 / 最小要求 µm','需求 / 容量（根）','余量','状态'],channels.map(r=>`<tr class="${r.passed?'':'resource-fail'}"><td>${esc(r.channel)} / ${esc(r.metal)}</td><td>${fmt(r.width_um)} / ${fmt(r.min_width_um)}</td><td>${r.demand_tracks} / ${r.capacity_tracks}</td><td>${r.margin_tracks}</td><td>${r.passed?'截面通过':'超限'}</td></tr>`)):'<p>本 die 未配置显式布线通道。旧项目不会自动补造通道或间距要求。</p>')+
    `<details ${spacing.some(r=>!r.passed)?'open':''}><summary>模块间距检查 · ${spacing.filter(r=>!r.passed).length} 项不足 / ${spacing.length} 对要求</summary>`+table(['模块对','要求 µm','实际分离距离 µm','余量 µm','状态'],spacing.map(r=>`<tr class="${r.passed?'':'resource-fail'}"><td>${r.modules.map(esc).join(' / ')}</td><td>${fmt(r.required_um)}</td><td>${fmt(r.actual_um)}</td><td>${fmt(r.margin_um)}</td><td>${r.passed?'通过':'不足'}</td></tr>`))+`</details><p class="connection-note">分配是确定性的架构级轨道预算；按允许层逐段分配并保留超载需求。不同段可以换层，过孔接入、真实层高、详细绕障与布线签核仍需后端确认。</p>`;
    root.querySelectorAll('[data-routing-link]').forEach(button=>button.onclick=()=>onLink(button.dataset.routingLink));
  };
  select.onchange=draw;draw();
}
