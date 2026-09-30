import {number as fmt,area} from './layout-model.js?v=13';
import {showCalculations} from './calculations.js?v=clarity-1';
import {showRoutingResources} from './routing-resources.js?v=clarity-1';
import {areaBudget,wiringState,resourceData} from './resource-model.js?v=clarity-1';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=(v,digits=2)=>v==null?'待补数据':fmt(v,digits);
const sumKnown=(items,key)=>items.every(i=>Number.isFinite(i[key]))?items.reduce((n,i)=>n+i[key],0):null;

// Keep every physical region, but never combine separate boundaries or HB with TSV.
export function interfaceGroups(interfaces,die){
  const groups=new Map();
  for(const item of interfaces||[]){
    if(item.lower_die!==die&&item.upper_die!==die)continue;
    const kind=item.interconnect||'TSV',key=JSON.stringify([item.lower_die,item.upper_die,kind]);
    if(!groups.has(key))groups.set(key,{lower:item.lower_die,upper:item.upper_die,kind,items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()].map(group=>({...group,...Object.fromEntries(['signal_vias','power_vias','ground_vias','total_vias','capacity','margin'].map(key=>[key,sumKnown(group.items,key)]))}));
}
function renderInterfaces(report,die){
  const groups=interfaceGroups(report.interfaces,die);
  if(!groups.length)return '<p class="resource-empty">本层没有已记录的跨层接口。</p>';
  return groups.map(g=>`<article class="interface-budget"><div class="resource-subhead"><h3>${esc(g.lower)} ↔ ${esc(g.upper)}</h3><span class="pill">${esc(g.kind)} · ${g.items.length} 个区域${g.items.some(i=>i.margin<0)?' · '+g.items.filter(i=>i.margin<0).length+' 处不足':''}</span></div><div class="resource-metric-grid">${[['信号需求',g.signal_vias],['全部需求',g.total_vias],['接口容量',g.capacity],['余量',g.margin]].map(([label,n])=>`<div class="resource-metric"><span>${label} / ${g.kind==='HB'?'接点':'根'}</span><strong class="${n<0?'negative':''}">${value(n,0)}</strong></div>`).join('')}</div><details class="resource-disclosure"><summary>区域与 Core 明细</summary><div class="table-scroll"><table><thead><tr><th>区域 / Core</th><th>信号需求</th><th>电源 / 地</th><th>全部需求</th><th>容量</th><th>余量</th></tr></thead><tbody>${g.items.map(i=>`<tr><td>${esc(i.id)}<small>${esc(i.region?.core||'共享')}</small></td><td>${value(i.signal_vias,0)}</td><td>${value(i.power_vias,0)} / ${value(i.ground_vias,0)}</td><td>${value(i.total_vias,0)}</td><td>${value(i.capacity,0)}</td><td class="${i.margin<0?'negative':''}">${value(i.margin,0)}</td></tr>`).join('')}</tbody></table></div></details></article>`).join('')+`<details class="resource-disclosure"><summary>接口统计口径</summary><p>每个相邻层接口按全部所属 Core、全部区域汇总；不同接口分别统计。全部需求 = 信号 + 电源 + 地，任一分量缺失时合计与余量保持未知。区域余量不可互相借用。</p><p>TSV 容量取各区域已评估容量之和，单区按尺寸、pitch 等输入计算；HB 计接点预算，不计独立预留占地。详情保留各区域原始结果。</p></details>`;
}
let currentReport=null,currentPending=false,currentLink=()=>{},currentModule=()=>{},activeGroup='area';
function draw(){
  const report=currentReport;if(!report)return;
  const die=$('calculation-die').value;
  document.querySelectorAll('[data-resource-die]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.resourceDie===die)));
  document.querySelectorAll('[data-resource-row]').forEach(row=>row.classList.toggle('selected',row.dataset.resourceRow===die));
  document.querySelectorAll('[data-calculation-group]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calculationGroup===activeGroup)));
  const platform=report.dies.find(d=>d.id===die)?.display_platform;
  $('resource-die-meta').textContent=platform?'封装抽象层':currentPending?'等待重算':'当前方案 · 已应用输入';
  showCalculations(report,currentPending,{die,group:activeGroup});
  $('routing-resources').hidden=activeGroup!=='wiring'||currentPending||platform;
  if(activeGroup==='wiring'&&!platform)showRoutingResources(report,currentPending,currentLink,die,currentModule);
  $('resource-interfaces').hidden=activeGroup!=='vertical'||currentPending;
  $('resource-interfaces').innerHTML=activeGroup==='vertical'&&!currentPending?renderInterfaces(report,die):'';
  $('resource-supply').hidden=activeGroup!=='power'||currentPending||platform;
  const supply=(report.supply||[]).filter(s=>s.die===die);
  $('supply-rows').innerHTML=supply.length?supply.map(s=>`<tr><td>${esc(s.domain)}</td><td>${value(s.local_current_A,4)}</td><td>${value(s.injection_current_A,4)}</td><td>${value(s.capacity_A,4)}</td><td class="${s.margin_A<0?'negative':''}">${value(s.margin_A,4)}</td></tr>`).join(''):'<tr><td colspan="5">本层未配置供电电压域。</td></tr>';
  document.querySelectorAll('#supply-port-details [data-port-die]').forEach(row=>row.hidden=row.dataset.portDie!==die);
  const ports=$('edit-supply-port');
  for(const option of ports.options){const p=(report.ports||[]).find(p=>p.id===option.value);option.hidden=option.disabled=p?.die!==die;}
  const valid=[...ports.options].filter(o=>!o.disabled);
  if(!valid.some(o=>o.value===ports.value)){ports.value=valid[0]?.value||'';ports.dispatchEvent(new Event('change'));}
  $('supply-port-editor').hidden=!valid.length;
  $('supply-port-empty').hidden=!!valid.length;
}
export function showResourceWorkspace(report,pending=false,onLink=()=>{},onModule=()=>{}){
  currentReport=report;currentPending=pending;currentLink=onLink;currentModule=onModule;
  $('resource-workbench').hidden=!report;$('resource-empty').hidden=!!report;
  if(!report){$('ledger').innerHTML='';$('calculation-die').innerHTML='';activeGroup='area';return;}
  const dies=[...report.dies].sort((a,b)=>b.order-a.order),select=$('calculation-die'),previous=select.value;
  select.innerHTML=dies.map(d=>`<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('');
  select.value=dies.some(d=>d.id===previous)?previous:(dies.find(d=>!d.display_platform)||dies[0])?.id||'';
  $('ledger').innerHTML=dies.map(d=>{
    const number=(v,format=fmt)=>pending?'待重算':Number.isFinite(v)?format(v):'待补数据';
    const budget=areaBudget(d),routing=wiringState(report,d.id),data=resourceData(report,d.id),platform=d.display_platform;
    const peak=pending?'待重算':!routing.known?'未评估':routing.zeroCapacity?'零容量有需求':number(d.peak_congestion)+(routing.partial?'（部分）':'');
    return `<tr data-resource-row="${esc(d.id)}"><td><button data-resource-die="${esc(d.id)}" aria-pressed="false" aria-label="查看 ${esc(d.id)} 资源明细">${esc(d.id)} <span>→</span></button>${platform?'<small>封装抽象层</small>':''}</td><td>${platform?'—':number(d.area_mm2,area)}</td><td>${platform?'—':number(d.footprint_utilization,v=>fmt(v*100,2)+'%')}${!platform&&!pending?'<small>上限 '+number(d.max_utilization,v=>fmt(v*100)+'%')+'</small>':''}</td><td>${platform?'—':number(d.free_area_mm2,v=>fmt(v,3))}</td><td class="${!pending&&budget.headroom<0?'negative':''}">${platform?'—':number(budget.headroom,v=>fmt(v,3))}</td><td>${platform?'—':number(d.power_W)}${!platform&&!pending&&data.powerMissing.length?'<small>'+data.powerMissing.length+' 个模块待补</small>':''}</td><td class="${!pending&&routing.known&&(routing.zeroCapacity||d.peak_congestion>1)?'negative':''}">${platform?'—':peak}</td></tr>`;
  }).join('');
  $('ledger').querySelectorAll('[data-resource-die]').forEach(button=>button.onclick=()=>{select.value=button.dataset.resourceDie;draw();});
  select.onchange=draw;
  document.querySelectorAll('[data-calculation-group]').forEach(button=>button.onclick=()=>{activeGroup=button.dataset.calculationGroup;draw();});
  draw();
}
