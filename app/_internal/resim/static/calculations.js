import {number as fmt,area} from './layout-model.js?v=13';
import {areaBudget,wiringState,resourceData} from './resource-model.js?v=clarity-1';
const esc=s=>String(s??'未提供').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const groups={area:['die_area','module_area','reserved','utilization','free'],wiring:['congestion','wire_area'],power:['power'],vertical:[]};
const table=(heads,rows)=>'<div class="table-scroll"><table><thead><tr>'+heads.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const fold=(title,body)=>'<details class="resource-disclosure"><summary>'+title+'</summary>'+body+'</details>';
const note=text=>'<p class="resource-notice">'+esc(text)+'</p>';
const metric=(label,n,unit='',options={})=>'<div class="resource-metric"><span>'+label+(unit?' / '+unit:'')+'</span><strong class="'+(n<0||options.critical?'negative':'')+'">'+(options.text?esc(options.text):Number.isFinite(n)?fmt(n,3):'待补数据')+'</strong>'+(options.hint?'<small>'+esc(options.hint)+'</small>':'')+'</div>';

export function calculationMarkup(report,pending=false,{die,group='area'}={}){
  if(pending)return '<p class="resource-empty" role="status">输入已变化，等待重新计算。</p>';
  const d=report.dies.find(d=>d.id===die);if(!d||group==='vertical')return '';
  if(d.display_platform)return '<p class="resource-empty">此层为封装抽象平台，不评估内部面积、布线与功耗。跨层接口见 TSV / HB。</p>';
  const entry=report.calculations?.dies?.find(d=>d.die===die),data=resourceData(report,die),budget=areaBudget(d),routing=wiringState(report,die);
  let html='';
  if(group==='area'){
    if(budget.effective===0)html+=note('预留区域已占满本层，没有有效布局区域；占用率无法计算。');
    if(data.areaMissing.length)html+=note(data.areaMissing.length+' / '+data.modules.length+' 个模块缺少单元或硬宏面积，当前可统计外形占地，但不能确认模块尺寸是否足够。');
    if(data.geometryIssues.length)html+=note('本层有 '+data.geometryIssues.length+' 项重叠或越界问题；面积已按并集、边界裁剪，空余面积不代表布局可实现。');
    html+='<div class="resource-metric-grid">'+[
      metric('Die 面积',d.area_mm2,'mm²'),metric('预留面积',d.reserved_area_mm2,'mm²'),
      metric('有效区模块占地',budget.occupied,'mm²'),metric('几何空余面积',d.free_area_mm2,'mm²'),
      metric('有效区占用率',d.footprint_utilization==null?null:d.footprint_utilization*100,'%',{text:budget.effective===0?'无有效区':'',hint:Number.isFinite(d.max_utilization)?'上限 '+fmt(d.max_utilization*100)+'%':'上限待补',critical:budget.effective===0||(Number.isFinite(d.max_utilization)&&d.footprint_utilization>d.max_utilization)}),
      metric('利用率上限内余量',budget.headroom,'mm²',{hint:budget.headroom<0?'已超过本层占用率上限':'尚未考虑空余区域的形状与间距'})
    ].join('')+'</div>';
    html+=fold('面积与利用率口径','<p>Die 面积 = 预留面积 + 有效区模块占地 + 几何空余面积。预留与模块均按并集去重，并裁剪到 Die 内；有效区模块占地不含侵入预留区的部分。</p><p>模块占地并集 '+esc(area(d.module_area_mm2))+' mm²，其中侵入预留区 '+esc(area(d.reserved_overlap_mm2))+' mm²。重叠、越界需要单独修正。</p><p>利用率上限内余量 =（Die 面积 − 预留面积）× 最大布局利用率 − 有效区模块占地。负值表示超限；正值仍需满足模块形状、间距和通道约束。</p><p>此处的有效区占用率是模块外形占用比例；模块内部的标准单元利用率在模块明细中查看。</p>');
  }else if(group==='wiring'){
    if(!routing.known)html+=note(routing.reason+' 布线面积与拥塞显示为未评估，不能视为零需求。');
    else {
      if(routing.unassigned)html+=note('本层仍有 '+routing.unassigned+' 个线段未完成金属层分配，当前面积与拥塞仅覆盖已分配部分。');
      if(routing.incompleteConnections)html+=note('本层接口总预算尚未全部分配到模块连接；当前线长、金属面积和拥塞只覆盖已录入连接。');
    }
    if(routing.known&&routing.zeroCapacity)html+=note('存在容量为零但有布线需求的金属网格；不能用其它网格的低拥塞值表示通过。');
    const missing=routing.known?'':'未评估';
    html+='<div class="resource-metric-grid">'+[
      metric('峰值拥塞比',routing.known?d.peak_congestion:null,'',{text:missing||(routing.zeroCapacity?'零容量有需求':''),hint:'需求 / 容量；大于 1 表示超限',critical:routing.known&&(routing.zeroCapacity||d.peak_congestion>1)}),
      metric('已分配金属面积',routing.known?d.wire_area?.metal_area_um2:null,'µm²',{text:missing,hint:'各金属层线宽 × 线长 × 线数之和'}),
      metric('已分配轨道面积',routing.known?d.wire_area?.track_area_um2:null,'µm²',{text:missing,hint:'含线间距；不是额外 Die 占地'})
    ].join('')+'</div>';
  }else if(group==='power'){
    if(data.powerMissing.length)html+=note(data.powerMissing.length+' / '+data.modules.length+' 个模块未提供功耗；已知部分合计 '+fmt(data.knownPower,3)+' W，不作为本层总功耗。');
    html+='<div class="resource-metric-grid">'+[
      metric('模块总功耗',d.power_W,'W',{hint:'按模块输入功耗求和'}),metric('功耗预算',d.power_budget_W,'W'),metric('功耗余量',d.power_margin_W,'W')
    ].join('')+'</div>';
  }
  const terms=entry?.module_terms||data.modules;
  if(group==='area'){
    html+=fold('模块面积明细 · '+terms.length+' 个',table(['模块','宽 × 高 / µm','外形面积 / mm²','最低需求 / mm²','目标 / 实际单元利用率'],terms.map(m=>'<tr><td>'+esc(m.id)+'</td><td>'+fmt(m.width_um)+' × '+fmt(m.height_um)+'</td><td>'+(m.footprint_um2==null?'待补数据':area(m.footprint_um2/1e6))+'</td><td>'+(m.required_footprint_um2==null?'待补数据':area(m.required_footprint_um2/1e6))+'</td><td>'+(m.target_cell_utilization==null?'未知':fmt(m.target_cell_utilization*100)+'%')+' / '+(m.cell_utilization==null?'未知':fmt(m.cell_utilization*100)+'%')+'</td></tr>'))+'<p>最低需求 = 标准单元面积 ÷ 目标单元利用率 + 硬宏面积；各模块外形面积直接相加，可能含重叠与越界，因此不等于总览中的占地并集。</p>');
    if(entry)html+=fold('预留区域明细 · '+(entry.reserve_rectangles||[]).length+' 个',table(['区域','类型','左下角 / µm','宽 × 高 / µm'],(entry.reserve_rectangles||[]).map(r=>'<tr><td>'+esc(r.id)+'</td><td>'+esc(r.kind)+'</td><td>'+fmt(r.x_um)+', '+fmt(r.y_um)+'</td><td>'+fmt(r.width_um)+' × '+fmt(r.height_um)+'</td></tr>'))+'<p>此处为原始矩形；预留总面积按并集去重计算。</p>');
  }
  if(group==='power')html+=fold('模块功耗明细 · '+terms.length+' 个',table(['模块','功耗 / W'],terms.map(m=>'<tr><td>'+esc(m.id)+'</td><td>'+(m.power_W==null?'待补数据':fmt(m.power_W))+'</td></tr>')));
  if(group!=='wiring'||routing.known){
    const formulas=(entry?.metrics||[]).filter(m=>groups[group]?.includes(m.key));
    if(formulas.length)html+=fold('计算公式与代入值',formulas.map(m=>'<article class="resource-formula"><h3>'+esc(m.title)+'</h3><code>'+esc(m.formula)+'</code><p class="substitution">'+esc(m.key==='congestion'&&routing.zeroCapacity?'存在零容量有需求的网格，需求 / 容量无法得到有限比值，已判定超限。':m.substitution)+'</p><p>'+esc(m.note)+'</p></article>').join(''));
    else html+='<p class="resource-empty">本历史结果未记录计算过程。</p>';
  }
  return html;
}
export function showCalculations(report,pending=false,options={}){
  document.getElementById('calculation-detail').innerHTML=calculationMarkup(report,pending,options);
}
