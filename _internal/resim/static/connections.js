import {transferBudget} from './connection-view.js?v=13';
import {number as fmt,linkBudget} from './layout-model.js?v=13';
import {wireDetail,mountSegmentDetail} from './wire-detail.js?v=13';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class Connections {
  constructor(onSelect,onRoutingChange=()=>{}){
    this.onRoutingChange=onRoutingChange;
    this.selected=null;this.module='';this.query='';this.onSelect=onSelect;
    $('connection-search').oninput=()=>{this.query=$('connection-search').value.trim().toLowerCase();this.render();};
    $('connection-module').onchange=()=>{this.module=$('connection-module').value;this.render();};
    $('connection-select').onchange=()=>this.select($('connection-select').value);
  }
  clear(){this.query='';$('connection-search').value='';$('connection-count').textContent='';this.report=null;this.module='';this.selected=null;$('connection-module').innerHTML='<option value="">全部模块</option>';$('connection-select').innerHTML='<option value="">选择连接</option>';$('connection-rows').innerHTML='';$('connection-detail').innerHTML='<p>评估后显示各模块的互联数据。</p>';}
  update(report,pending){this.report=report;this.pending=pending;this.render();}
  filter(module){if(this.module===module)return;this.module=module||'';this.render();}
  select(id){
    this.selected=id||null;
    const link=this.report?.project.architecture.links.find(l=>l.id===id);
    if(link&&this.module&&link.source!==this.module&&link.target!==this.module)this.module='';
    if(link&&this.query&&![link.id,link.source,link.target].some(v=>v.toLowerCase().includes(this.query))){this.query='';$('connection-search').value='';}
    this.render();this.onSelect(this.selected);
  }
  render(){
    if(!this.report)return;const project=this.report.project,links=project.architecture.links;
    if(this.module&&!project.architecture.modules.some(m=>m.id===this.module))this.module='';
    $('connection-module').innerHTML='<option value="">全部模块</option>'+project.architecture.modules.map(m=>`<option value="${esc(m.id)}">${esc(m.id)}</option>`).join('');$('connection-module').value=this.module;
    const visible=links.filter(l=>(!this.module||l.source===this.module||l.target===this.module)&&(!this.query||[l.id,l.source,l.target].some(v=>v.toLowerCase().includes(this.query))));
    if(this.selected&&!visible.some(l=>l.id===this.selected)){this.selected=null;this.onSelect(null);}
    $('connection-count').textContent=`显示 ${visible.length} / ${links.length} 条连接${this.selected?' · 已选中 1 条':''}`;

    $('connection-select').innerHTML='<option value="">选择连接</option>'+visible.map(l=>`<option value="${esc(l.id)}">${esc(l.source)} → ${esc(l.target)} · ${esc(l.id)}</option>`).join('');$('connection-select').value=this.selected||'';
    $('connection-rows').innerHTML=visible.length?visible.map(link=>{
      const b=linkBudget(link),r=this.report.links.find(l=>l.id===link.id);
      return `<tr class="${link.id===this.selected?'active-connection':''}"><td><button class="connection-row" data-link="${esc(link.id)}">${esc(link.source)} → ${esc(link.target)}</button><small class="dimension">${esc(link.id)}</small></td><td>${b.bus_width_bits==null?'未提供':fmt(b.bus_width_bits,0)}</td><td>${fmt(b.data_wires,0)}<small class="dimension">${b.data_wires_source==='explicit'?'显式输入':'由带宽推导'}</small></td><td>${b.control_wires} / ${b.spare_wires}</td><td><b>${fmt(b.wires,0)}</b></td><td>${fmt(link.bandwidth_GBps)}</td><td>${this.pending?'重算中…':fmt(r?.planar_length_um)}</td><td>${this.pending?'…':fmt(r?.tier_hops,0)}</td><td>${this.pending?'…':fmt(r?.wire_area?.metal_area_um2,5)}</td><td>${this.pending?'…':fmt(r?.wire_area?.track_area_um2,5)}</td></tr>`;
    }).join(''):'<tr><td colspan="10">没有匹配的连接，请调整搜索词或模块筛选。</td></tr>';
    $('connection-rows').querySelectorAll('[data-link]').forEach(button=>button.onclick=()=>{this.select(button.dataset.link);$('connection-detail').scrollIntoView({behavior:'smooth',block:'start'});});
    const link=links.find(l=>l.id===this.selected);
    if(!link){$('connection-detail').innerHTML=`<p>共 ${visible.length} 条连接。位宽表示逻辑数据字宽；并行数据线可由带宽和每线速率推导，两者不自动等同。</p>`;return;}
    const b=linkBudget(link),r=this.report.links.find(l=>l.id===link.id),metals=project.resources.metals;
    $('connection-detail').innerHTML=`<h3>${esc(link.source)}.${esc(link.source_port)} → ${esc(link.target)}.${esc(link.target_port)} <span class="pill">${esc(link.id)}</span></h3>
      <p>源 core：${esc(project.architecture.modules.find(m=>m.id===link.source)?.core)} → 目标 core：${esc(project.architecture.modules.find(m=>m.id===link.target)?.core)}</p><div class="connection-summary"><span>原始速率上限 <b>${fmt(transferBudget(link).rawGBps)} GB/s</b>（配置值，不含损耗）</span><span>逻辑位宽 <b>${b.bus_width_bits==null?'未提供':b.bus_width_bits+' bit'}</b></span><span>线数预算 <b>${b.data_wires} 数据 + ${b.control_wires} 控制 + ${b.spare_wires} 冗余 = ${b.wires} 根</b></span><span>每线速率 <b>${fmt(link.lane_rate_Gbps)} Gbit/s</b></span><span>当前平面线长 <b>${this.pending?'重算中…':fmt(r?.planar_length_um)+' µm'}</b></span></div>
      ${r?.endpoints&&!this.pending?`<p class="endpoint-note">边缘端口：${Object.entries(r.endpoints).map(([role,e])=>`${role==='source'?'源':'目标'} ${esc(e.die)} · ${{east:'东',west:'西',north:'北',south:'南'}[e.side]}边 · (${fmt(e.point[0])}, ${fmt(e.point[1])}) µm · ${e.source==='specified_port'?'输入指定':'自动边中点'}`).join(' → ')}</p>`:''}
      <details class="metal-details"><summary>配置此连接的允许金属层</summary><p>不选择表示自动使用该方向的全部金属层；只选一层可锁定到该层。通道还会进一步限制允许层。</p><div class="edit-fields">${['horizontal','vertical'].map(direction=>`<label>${direction==='horizontal'?'水平段':'垂直段'}<select multiple size="4" id="assign-${direction}" aria-label="${direction==='horizontal'?'水平段允许层':'垂直段允许层'}">${metals.filter(m=>m.direction===direction.toUpperCase()).map(m=>`<option value="${esc(m.name)}" ${link.routing_layers?.[direction]?.includes(m.name)?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>`).join('')}<button id="apply-routing" ${this.pending?'disabled':''}>应用金属层分配</button></div></details>
      <p>连接延迟估算：${this.pending?'重算中…':fmt(r?.estimated_delay_ps)+' ps'}；关键性权重 ${link.latency_weight||1}。模型系数和校准状态见「资源与计算」。</p>
      ${wireDetail(r,this.pending)}
      <details class="metal-details"><summary>全部工艺金属层 · ${metals.length?(r?.physical_width_status?.startsWith('layer_budget')?'轨道预算参数，逐段分配见上表':'历史参考参数'):'输入中没有金属层数据'}</summary>
      <div class="metal-list">${metals.map(m=>`<span><b>${esc(m.name)} · ${m.direction==='HORIZONTAL'?'水平':'垂直'}</b>单线宽 ${fmt(m.width_um,5)} µm<br>中心间距 ${fmt(m.pitch_um,5)} µm</span>`).join('')}</div></details>
      <p class="connection-note">合计线数 = ceil((数据线 + 控制线) × (1 + 冗余比例))。跨层时按每个经过的相邻接口预算信号 TSV。金属 width/pitch 为当前工艺输入，实际布线层与线宽需后端确认。</p>`;
    if(!this.pending)mountSegmentDetail(r);
    $('apply-routing').onclick=()=>{const layers={};for(const direction of ['horizontal','vertical']){const selected=[...$('assign-'+direction).selectedOptions].map(o=>o.value);if(selected.length)layers[direction]=selected;}this.onRoutingChange(link.id,layers);};
  }
}
