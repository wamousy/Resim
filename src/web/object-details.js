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
