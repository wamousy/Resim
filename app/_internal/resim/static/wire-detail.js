import {number as fmt} from './layout-model.js?v=13';
const esc=s=>String(s??'未知').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function segmentDiagram(segment) {
  if(!segment)return '<p>该连接没有非零平面线段；跨层 TSV 单独统计。</p>';
  const s=segment,n=s.wires;
  if(s.width_um==null||s.pitch_um==null)return '<p>缺少这一方向的参考金属层，无法绘制线宽或计算该段面积。</p>';
  if(!n)return '<p>该连接预算为 0 根线，平面互联面积需求为 0。</p>';
  const count=Math.min(8,n),step=24,thick=step*s.width_um/s.pitch_um,top=48,bottom=top+(count-1)*step+thick,height=bottom+80;
  const wires=Array.from({length:count},(_,i)=>`<rect x="95" y="${top+i*step}" width="285" height="${thick}" fill="#59c8bf"/><text x="78" y="${top+i*step+thick/2+4}" text-anchor="end" fill="#9bb3c6" font-size="11">${i+1}</text>`).join('');
  return `<svg class="wire-diagram" viewBox="0 0 580 ${height}" role="img" aria-label="${esc(n)} 根线的线宽、间距和包络示意">
    <text x="18" y="22" fill="#e6eff6" font-size="13">${esc(s.die)} · ${esc(s.reference_metal)} · ${s.direction==='HORIZONTAL'?'水平段':'垂直段'}的局部展开</text>
    <rect x="88" y="${top-5}" width="299" height="${bottom-top+10}" fill="none" stroke="#f0b675" stroke-dasharray="5 4"/>
    ${wires}<path d="M95 ${bottom+26} H380 M95 ${bottom+21} v10 M380 ${bottom+21} v10" stroke="#c8d5df" fill="none"/>
    <text x="237" y="${bottom+46}" text-anchor="middle" fill="#c8d5df" font-size="12">L = ${fmt(s.length_um,5)} µm</text>
    <path d="M400 ${top} H410 M405 ${top} V${top+thick} M400 ${top+thick} H410" stroke="#59c8bf" fill="none"/>
    <text x="420" y="${top+10}" fill="#9fe0d8" font-size="12">w = ${fmt(s.width_um,5)} µm</text>
    <text x="420" y="${top+35}" fill="#c8d5df" font-size="12">pitch = ${fmt(s.pitch_um,5)} µm</text>
    <text x="420" y="${top+60}" fill="#c8d5df" font-size="12">间隙 = ${fmt(s.pitch_um-s.width_um,5)} µm</text>
    <text x="420" y="${top+85}" fill="#f0b675" font-size="12">N = ${n} 根</text>
    <text x="18" y="${height-10}" fill="#9bb3c6" font-size="11">${n>count?`仅画 ${count} / ${n} 根；`:''}宽度方向放大，长宽不同比例；颜色不代表真实工艺。</text></svg>`;
}

export function wireDetail(linkRow,pending=false) {
  if(pending)return '<p class="wire-area-state">布局变化后正在重算互联面积，暂不显示旧值。</p>';
  const budget=linkRow?.wire_area;
  if(!budget)return '<p>这份历史结果没有互联面积明细，请重新评估。</p>';
  return `<section class="wire-budget"><h3>互联面积预算 · ${linkRow.physical_width_status?.startsWith('layer_budget')?'已分配金属层':'历史参考层估算'}</h3><div class="connection-summary"><span>金属面积需求<b>${fmt(budget.metal_area_um2,5)} µm²</b></span><span>轨道面积预算（含间距）<b>${fmt(budget.track_area_um2,5)} µm²</b></span><span>线束包络面积之和<b>${fmt(budget.bundle_envelope_area_um2,5)} µm²</b></span></div>
  <p class="connection-note">面积 = 各段需求相加；没有求布线多边形并集，不是额外 die 占地。不含模块内部线、时钟、PDN、绕障和接触孔焊盘。</p>
  <label>查看线段 <select id="wire-segment" aria-label="查看线段">${budget.segments.map((s,i)=>`<option value="${i}">${i+1}. ${esc(s.die)} · ${s.direction==='HORIZONTAL'?'水平':'垂直'} · ${esc(s.reference_metal)} · ${fmt(s.length_um)} µm</option>`).join('')}</select></label><div id="wire-segment-detail"></div>
  <div class="table-scroll"><table><thead><tr><th>Die / 方向</th><th>金属层</th><th>L µm</th><th>N 根</th><th>w / pitch µm</th><th>包络宽 µm</th><th>金属面积 µm²</th><th>轨道面积 µm²</th></tr></thead><tbody>${budget.segments.map(s=>`<tr><td>${esc(s.die)} / ${s.direction==='HORIZONTAL'?'H':'V'}</td><td>${esc(s.reference_metal)}<small class="dimension">${({allowed_layers:'在指定允许层中分配',automatic:'自动分配',unassigned:'未分配',input_reference:'历史面积参考层',first_directional_metal:'历史默认参考层'}[s.reference_source]||'未记录')}</small></td><td>${fmt(s.length_um,5)}</td><td>${s.wires}</td><td>${fmt(s.width_um,5)} / ${fmt(s.pitch_um,5)}</td><td>${fmt(s.bundle_width_um,5)}</td><td>${fmt(s.metal_area_um2,5)}</td><td>${fmt(s.track_area_um2,5)}</td></tr>`).join('')}</tbody></table></div>
  <p class="connection-note">${linkRow.physical_width_status?.startsWith('layer_budget')?'同一几何段可分配到多个金属层；每行是该层承担的线数，合计保持连接总线数。拥塞只使用各自金属层容量。':'这是旧版参考层预算；重新评估后才能查看逐层分配与容量。'}</p></section>`;
}

export function mountSegmentDetail(linkRow){
  const select=document.getElementById('wire-segment'),target=document.getElementById('wire-segment-detail');
  if(!select||!target)return;
  const draw=()=>{const s=linkRow.wire_area.segments[Number(select.value)];target.innerHTML=segmentDiagram(s)+(s?`<div class="formula-card"><b>这一段的计算</b><p>金属面积：N × w × L = ${s.wires} × ${fmt(s.width_um,5)} × ${fmt(s.length_um,5)} = <strong>${fmt(s.metal_area_um2,5)} µm²</strong></p><p>轨道面积：N × pitch × L = ${s.wires} × ${fmt(s.pitch_um,5)} × ${fmt(s.length_um,5)} = <strong>${fmt(s.track_area_um2,5)} µm²</strong></p><p>线束包络宽：${s.wires?'(N − 1) × pitch + w':'N = 0'} = <strong>${fmt(s.bundle_width_um,5)} µm</strong></p><small>轨道宽 N×pitch 在两边合计多预留一个线间隙；包络宽只包含最外两条线之间的范围。</small></div>`:'');};
  select.onchange=draw;draw();
}
