import {coreFrames,peerConnections} from './core-view.js?v=19';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:3});
export function chipDimensions(report){
  return `<details class="object-section"><summary>芯片与各层尺寸</summary><p>${report.project.architecture.cores.length} Core · ${report.dies.length} 层</p>${report.dies.map(d=>{
    const platform=report.project.architecture.dies.find(x=>x.id===d.id)?.display_platform;
    return `<div class="dimension-item"><b>${esc(d.id)}</b><span>${platform?'DRAM 存储平台':`${fmt(d.width_um/1000)} × ${fmt(d.height_um/1000)} mm · ${fmt(d.area_mm2)} mm²`}</span></div>`;
  }).join('')}</details>`;
}
export function coreDimensions(report,core){
  return report.dies.filter(d=>d.kind!=='dram').flatMap(d=>{
    const f=coreFrames(report,d.id).find(f=>f.core===core);
    return f?[{die:d.id,...f}]:[];
  });
}
export function corePeers(report,core,module=null){
  const peers=peerConnections(report.project,core).filter(p=>!module||p.local===module);
  if(module&&!peers.length)return '';
  return `<details class="object-section core-interfaces"><summary>${module?'本模块跨 Core 连接':'Core 外部接口'}${peers.length?' · '+peers.length:''}</summary><div class="peer-details">${peers.length?peers.map(p=>`<article><b>${esc(p.local.replace(core+'__',''))}</b><span>↔ ${esc(p.core)} / ${esc(p.remote.replace(p.core+'__',''))}</span><div>${[...p.outgoing.map(l=>[l,'发送 →']),...p.incoming.map(l=>[l,'← 接收'])].map(([l,d])=>`<button data-peer-link="${esc(l.id)}" data-peer-core="${esc(core)}">${d} ${l.bus_width_bits==null?'位宽待补充':fmt(l.bus_width_bits)+' bit'}</button>`).join('')}</div></article>`).join(''):'<p>输入中未定义跨 Core 连接。</p>'}</div></details>`;
}
export function coreDetails(report,core,die){
  const frames=coreDimensions(report,core);
  return `<h3>${esc(core)} <span class="pill">Core</span></h3><p>${report.modules.filter(m=>m.core===core).length} 个模块 · ${frames.length} 个逻辑层</p><div class="detail-actions"><button id="enter-core">查看核内布局</button></div><div class="object-section"><b>各层布局区</b>${frames.map(f=>`<div class="dimension-item ${f.die===die?'current':''}"><b>${esc(f.die)}</b><span>${fmt(f.width_um/1000)} × ${fmt(f.height_um/1000)} mm · ${fmt(f.width_um*f.height_um/1e6)} mm²</span></div>`).join('')}<p class="hint">以上为该核的布局范围，整片 Die 尺寸见下方。</p></div>${corePeers(report,core)}${chipDimensions(report)}`;
}

export function referenceDetails(report,module){
  const groups=(report.project.architecture.reference_groups||[]).filter(g=>g.modules.includes(module));
  if(!groups.length)return '';
  return `<details class="object-section"><summary>图纸参数与参考估算 · ${groups.length}</summary><p>参考尺寸与当前布局尺寸分开记录；子系统面积只记一次，不分摊到子模块，也不替代标准单元利用率。</p>${groups.map(g=>{
    const result=(report.reference_groups||[]).find(r=>r.id===g.id);
    const rows=[['来源',g.source],['涉及模块',g.modules.join('、')],['参考尺寸',g.width_um!=null&&g.height_um!=null?`${fmt(g.width_um)} × ${fmt(g.height_um)} µm`:'未提供'],['参考资源面积',g.area_estimate_um2==null?'未定':`${fmt(g.area_estimate_um2/1e6)} mm²`],['面积口径',g.area_basis||'未定'],['单元数量',g.cell_count==null?'未定':fmt(g.cell_count)],...Object.entries(g.pin_counts||{}).map(([key,value])=>[key,fmt(value)+' pin'])];
    return `<article><h4>${esc(g.label)}</h4>${rows.map(([k,v])=>`<div class="detail-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}${result?.minimum_area_fits===false?'<p>当前占地小于参考资源面积，需要调整布局。</p>':''}${(g.notes||[]).map(n=>`<p>${esc(n)}</p>`).join('')}</article>`;
  }).join('')}</details>`;
}
