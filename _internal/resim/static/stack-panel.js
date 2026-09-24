import {stackModel,faceText} from './stack-model.js?v=2';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'待补充':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:3});
const relation=p=>p.orientation==='unspecified'?'接触面待定':({F2F:'正面 ↔ 正面',B2B:'背面 ↔ 背面',F2B:'下层正面 ↔ 上层背面',B2F:'下层背面 ↔ 上层正面'}[p.orientation]);
const kind=p=>({HB:'HB 混合键合',TSV:'TSV 硅通孔',mixed:'HB + TSV',undefined:'接口待定义'}[p.kind]);
export function renderInterfaceInputs(project){
  const model=stackModel(project);
  $('stack-interface-inputs').innerHTML=model.pairs.length?model.pairs.map(p=>`<label class="interface-input" data-lower="${esc(p.lower)}" data-upper="${esc(p.upper)}"><span>${esc(p.upper)} ↔ ${esc(p.lower)}</span><select aria-label="${esc(p.lower)} 与 ${esc(p.upper)} 连接方式" ${p.regions.length?'':'disabled data-unavailable="true"'}>${[...(p.kind==='mixed'?['mixed']:[]),...(p.kind==='undefined'?['undefined']:[]),'TSV','HB'].map(k=>`<option value="${k}" ${p.kind===k?'selected':''}>${kind({kind:k})}</option>`).join('')}</select><small>${p.regions.length?p.regions.length+' 个接口区域 · 保留原预算与位置':'请通过架构 YAML 定义接口区域'}</small></label>`).join(''):'<p class="hint">单层 Die，无层间接口。</p>';
}
export const interfaceInputValues=()=>[...$('stack-interface-inputs').querySelectorAll('.interface-input')].filter(row=>!row.querySelector('select').disabled).map(row=>({lower:row.dataset.lower,upper:row.dataset.upper,kind:row.querySelector('select').value}));
export function renderStackStrip(report,onDie,onPair){
  if(!report){$('stack-strip').replaceChildren();return;}
  const model=stackModel(report.project),cards=[];
  for(const d of [...model.dies].reverse()){
    const {face,source}=model.faces.get(d.id),top=face==='up'?'正面':face==='down'?'背面':'待定',bottom=face==='up'?'背面':face==='down'?'正面':'待定';
    cards.push(`<button class="stack-die" data-stack-die="${esc(d.id)}" title="${esc(d.id)} · ${faceText(face)} · ${source}"><span class="face-edge ${top==='正面'?'front':'back'}">${top}</span><b>${esc(d.id)}</b><small>${d.display_platform?'DRAM ×'+d.package_layers:faceText(face)}</small><span class="face-edge ${bottom==='正面'?'front':'back'}">${bottom}</span></button>`);
    const p=model.pairs.find(p=>p.upper===d.id);
    if(p)cards.push(`<button class="stack-contact ${p.kind.toLowerCase()}" data-stack-pair="${esc(p.lower)}" title="${esc(relation(p))}"><span>↓</span><b>${esc(kind(p))}</b><small>${p.orientation==='unspecified'?'接触面待定':p.orientation}</small></button>`);
  }
  $('stack-strip').innerHTML=`<div class="stack-strip-label"><b>堆叠关系</b><small>顶层 → 底层</small></div><div class="stack-cards">${cards.join('')}</div><div class="face-legend"><span><i class="front"></i>正面 · 器件/金属</span><span><i class="back"></i>背面 · 硅基底</span></div>`;
  $('stack-strip').querySelectorAll('[data-stack-die]').forEach(b=>b.onclick=()=>onDie(b.dataset.stackDie));
  $('stack-strip').querySelectorAll('[data-stack-pair]').forEach(b=>b.onclick=()=>onPair(b.dataset.stackPair));
  $('stack-status').textContent=model.issues.length?model.issues.length+' 项堆叠配置待检查':'点击 Die 或接口查看详情';
}
export function dieDetails(report,id){
  const d=report.dies.find(d=>d.id===id),def=report.project.architecture.dies.find(d=>d.id===id),face=stackModel(report.project).faces.get(id);
  return `<h3>${esc(id)}</h3><div class="die-section ${face.face==='down'?'flipped':''}"><div class="section-front">正面 · 器件与金属布线</div><div class="section-silicon">硅基底</div><div class="section-back">背面</div></div><p>${faceText(face.face)} · ${face.source}</p><div class="detail-row"><span>尺寸</span><b>${def.display_platform?'存储平台':fmt(d.width_um/1000)+' × '+fmt(d.height_um/1000)+' mm'}</b></div><div class="detail-row"><span>厚度</span><b>${fmt(d.thickness_um)} µm</b></div><div class="detail-row"><span>面积</span><b>${def.display_platform?'不展示':fmt(d.area_mm2)+' mm²'}</b></div><div class="detail-actions"><button data-face-view="2d" data-die="${esc(id)}">查看正面</button><button data-face-view="back" data-die="${esc(id)}">查看背面</button></div><p class="hint">查看方向不改变堆叠朝向或模块坐标。</p>`;
}
export function pairDetails(report,lower){
  const p=stackModel(report.project).pairs.find(p=>p.lower===lower);if(!p)return '';
  const rows=report.interfaces.filter(r=>r.lower_die===p.lower&&r.upper_die===p.upper),sum=key=>rows.length&&rows.every(r=>r[key]!=null)?rows.reduce((n,r)=>n+r[key],0):null;
  return `<h3>${esc(p.upper)} ↔ ${esc(p.lower)}</h3><span class="pill">${esc(kind(p))}</span><p>${esc(relation(p))} · ${p.orientation}</p><div class="interface-section ${p.kind.toLowerCase()}"><span>上层 ${p.orientation.endsWith('F')?'正面':p.orientation.endsWith('B')?'背面':'接触面待定'}</span><b>${p.kind==='HB'?'••••••••••':p.kind==='TSV'?'┃ ┃ ┃ ┃ ┃':'待定义'}</b><span>下层 ${p.orientation.startsWith('F')?'正面':p.orientation.startsWith('B')?'背面':'接触面待定'}</span></div><div class="detail-row"><span>整片信号预算</span><b>${fmt(sum('signal_vias'))} bit</b></div><div class="detail-row"><span>区域数量</span><b>${p.regions.length}</b></div><p>${p.kind==='HB'?'面对面接点；当前模型不计独立占地区域，不画穿硅柱。':p.kind==='TSV'?'穿硅通孔按各区域的位置、pitch 与禁布间距估算；橙色柱为连接示意。':'先补全接口定义再评估。'}</p>${rows.length?`<label class="region-picker">接口区域<select id="inspect-region"><option value="">选择区域查看用量与容量</option>${rows.map(r=>`<option value="${esc(r.id)}">${esc(r.id)}</option>`).join('')}</select></label>`:''}`;
}
