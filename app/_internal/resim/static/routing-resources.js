import {number as fmt} from './layout-model.js?v=13';
import {wiringState} from './resource-model.js?v=clarity-1';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(heads,rows)=>`<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
export function spacingPage(rows,{query='',status='all',page=0,size=50}={}){
  const needle=String(query).trim().toLocaleLowerCase(),limit=[25,50,100].includes(size)?size:50;
  const filtered=rows.filter(r=>(status==='all'||(status==='failed'?!r.passed:r.passed))&&(!needle||r.modules.some(id=>String(id).toLocaleLowerCase().includes(needle))));
  const pages=Math.max(1,Math.ceil(filtered.length/limit)),current=Math.max(0,Math.min(Number.isFinite(page)?Math.floor(page):0,pages-1));
  return {items:filtered.slice(current*limit,(current+1)*limit),total:filtered.length,pages,page:current,size:limit};
}
export function showRoutingResources(report,pending=false,onLink=()=>{},die,onModule=()=>{}){
  const root=document.getElementById('routing-resources');
  if(!report||pending){root.innerHTML='';return;}
  if(!report.metal_routing){root.innerHTML='<p class="resource-empty">本历史报告未记录分层布线分配。</p>';return;}
  const layers=report.metal_routing.layers.filter(r=>r.die===die),channels=report.metal_routing.channels.filter(r=>r.die===die),spacing=(report.spacing||[]).filter(r=>r.die===die);
  const state=wiringState(report,die),known=state.known;
  const overloaded=layers.filter(r=>r.overflow_cells||r.zero_capacity_demand).length;
  const layerContent=()=>table(['金属层 / 方向','线宽 / pitch µm','可用比例','容量 / 格','峰值需求','峰值比','超限格','热点格与连接'],layers.map(r=>`<tr class="${r.overflow_cells||r.zero_capacity_demand?'resource-fail':''}"><td>${esc(r.metal)} / ${r.direction==='HORIZONTAL'?'H':'V'}</td><td>${fmt(r.width_um,5)} / ${fmt(r.pitch_um,5)}</td><td>${fmt(r.availability*100)}%</td><td>${fmt(r.capacity_tracks)}</td><td>${known?fmt(r.peak_demand_tracks,3):'待补数据'}</td><td>${known?(r.zero_capacity_demand?'零容量有需求':fmt(r.peak_ratio,3)):'—'}</td><td>${known?r.overflow_cells:'—'}</td><td>${known?'('+r.peak_cell.x+', '+r.peak_cell.y+')':'—'}<small>${r.peak_cell.links.map(id=>`<button class="text-button" data-routing-link="${esc(id)}">${esc(id)}</button>`).join('')}</small></td></tr>`));
  const spacingContent=()=>{
    const container=root.querySelector('[data-routing-content="spacing"]');
    container.innerHTML='<div class="resource-table-tools"><label>模块 <input type="search" placeholder="输入模块 ID" aria-label="搜索间距模块"></label><label>状态 <select data-spacing-status><option value="all">全部</option><option value="failed">仅不足</option><option value="passed">仅通过</option></select></label><label>每页 <select data-spacing-size><option>25</option><option selected>50</option><option>100</option></select></label></div><div data-spacing-rows></div><div class="resource-table-tools"><button data-spacing-prev>上一页</button><span data-spacing-count role="status"></span><button data-spacing-next>下一页</button></div>';
    let page=0;
    const query=container.querySelector('input'),status=container.querySelector('[data-spacing-status]'),size=container.querySelector('[data-spacing-size]');
    const draw=()=>{
      const result=spacingPage(spacing,{query:query.value,status:status.value,page,size:Number(size.value)});page=result.page;
      container.querySelector('[data-spacing-rows]').innerHTML=result.total?table(['模块对','要求 / µm','实际距离 / µm','余量 / µm','状态'],result.items.map(r=>`<tr class="${r.passed?'':'resource-fail'}"><td>${r.modules.map(id=>`<button class="text-button" data-spacing-module="${esc(id)}">${esc(id)}</button>`).join(' / ')}</td><td>${fmt(r.required_um)}</td><td>${fmt(r.actual_um)}</td><td>${fmt(r.margin_um)}</td><td>${r.passed?'通过':'不足'}</td></tr>`)):'<p class="resource-empty">没有符合条件的记录。</p>';
      container.querySelector('[data-spacing-count]').textContent=`${result.total} 项 · 第 ${page+1} / ${result.pages} 页`;
      container.querySelector('[data-spacing-prev]').disabled=page===0;container.querySelector('[data-spacing-next]').disabled=page===result.pages-1;
      container.querySelectorAll('[data-spacing-module]').forEach(button=>button.onclick=()=>onModule(button.dataset.spacingModule));
    };
    query.oninput=status.onchange=size.onchange=()=>{page=0;draw();};
    container.querySelector('[data-spacing-prev]').onclick=()=>{page--;draw();};container.querySelector('[data-spacing-next]').onclick=()=>{page++;draw();};draw();
  };
  root.innerHTML=`<details class="resource-disclosure"><summary>逐金属层容量 <span>${layers.length} 层 · ${known?overloaded+' 层超限':'需求待补'}</span></summary>`+'<div data-routing-content="layers"></div>'+`</details>
  <details class="resource-disclosure"><summary>通道容量 <span>${channels.length} 条 · ${known?channels.filter(r=>!r.passed).length+' 条超限':'需求未评估'}</span></summary>`+(channels.length?table(['通道 / 层','净宽 / 最小要求 µm','需求 / 容量（根）','余量','状态'],channels.map(r=>`<tr class="${known&&!r.passed?'resource-fail':''}"><td>${esc(r.channel)} / ${esc(r.metal)}</td><td>${fmt(r.width_um)} / ${fmt(r.min_width_um)}</td><td>${known?r.demand_tracks:'未评估'} / ${r.capacity_tracks}</td><td>${known?r.margin_tracks:'—'}</td><td>${known?(r.passed?(state.partial?'已分配部分通过':'通过'):'超限'):'未评估'}</td></tr>`)):'<p>本层未配置显式布线通道。</p>')+`</details>
  <details class="resource-disclosure"><summary>模块间距 <span>${spacing.filter(r=>!r.passed).length} 项不足 / ${spacing.length} 对要求</span></summary>`+'<div data-routing-content="spacing"></div>'+`</details>
  <details class="resource-disclosure"><summary>布线容量与间距口径</summary><p>容量 = floor(网格横向尺寸 ÷ pitch × 该层可用比例)。需求按该层已分配线数和格内长度计；其它层空闲不抵消本层超载。</p><p>通道按完整线束检查同一截面的同时需求，不按线段长度折减。绑定连接必须位于通道所属 Die，并沿通道中心线经过两端。</p><p>全局模块间距 ${fmt(report.project.constraints.min_module_spacing_um||0)} µm；模块间要求取全局间距与双方 halo 之和的较大值。通道禁止模块及其 halo 占用。</p><p>这些结果为架构级轨道预算；实际过孔接入、绕障与布线签核仍需后端确认。</p></details>`;
  for(const [key,render] of Object.entries({layers:layerContent,spacing:spacingContent})){
    const container=root.querySelector('[data-routing-content="'+key+'"]');
    container.parentElement.ontoggle=()=>{if(!container.parentElement.open||container.childElementCount)return;if(key==='spacing')render();else container.innerHTML=render();container.querySelectorAll('[data-routing-link]').forEach(button=>button.onclick=()=>onLink(button.dataset.routingLink));};
  }
}
