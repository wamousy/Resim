import {numeric} from './architecture-io.js?v=2';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(id,title,type='number')=>`<label>${title}<input id="tech-${id}" aria-label="${title}" type="${type}" ${type==='number'?'min="0" step="any"':''}></label>`;
const tsvFields=[['diameter_um','TSV 直径 / µm'],['pitch_um','TSV pitch / µm'],['keepout_um','TSV 禁布距离 / µm'],['bond_pitch_um','键合 pitch / µm'],['max_current_mA','单 TSV 电流能力 / mA']];
export function updateTechnology(base,values){
  const r=structuredClone(base||{});
  r.technology=values.technology.trim();if(!r.technology)throw new Error('请填写工艺名称');
  r.technology_provenance=values.provenance.trim();
  r.routing_availability=numeric(values.availability,'默认布线可用比例',{positive:true});
  if(r.routing_availability>1)throw new Error('布线可用比例不能超过 1');
  const names=new Set();r.metals=values.metals.map(m=>{
    const name=m.name.trim();if(!name||names.has(name))throw new Error('金属层名称不能为空或重复');names.add(name);
    if(!['HORIZONTAL','VERTICAL'].includes(m.direction))throw new Error('金属层方向无效');
    const width_um=numeric(m.width_um,name+' 线宽',{positive:true}),pitch_um=numeric(m.pitch_um,name+' pitch',{positive:true});
    if(width_um>pitch_um)throw new Error(name+' 的线宽不能大于 pitch');
    const availability=numeric(m.availability,name+' 可用比例',{nullable:true});if(availability>1)throw new Error(name+' 可用比例不能超过 1');
    return {name,direction:m.direction,width_um,pitch_um,availability};
  });
  r.tsv=values.tsv?Object.fromEntries(tsvFields.map(([key,label])=>[key,numeric(values.tsv[key],label,{positive:key!=='keepout_um'})])):null;
  if(r.tsv){r.tsv.provenance=values.tsv.provenance.trim();if(r.tsv.diameter_um>r.tsv.pitch_um)throw new Error('TSV 直径不能大于 pitch');}
  return r;
}
export class TechnologyForm{
  constructor(host,onChange){
    this.host=host;this.onChange=onChange;this.base={};
    host.innerHTML=`<div class="input-form-grid">${field('name','工艺名称','text')}${field('provenance','工艺数据来源','text')}${field('availability','默认布线可用比例（0–1）')}</div><div class="table-section-head"><b>金属层资源</b><button id="add-metal">新增金属层</button></div><div class="table-scroll"><table class="metal-input-table"><thead><tr><th>名称</th><th>方向</th><th>线宽 / µm</th><th>pitch / µm</th><th>可用比例</th><th></th></tr></thead><tbody id="technology-metal-rows"></tbody></table></div><p class="compact-note">单层可用比例留空时沿用默认值；0 表示不用于自动分配。</p><label class="check tsv-toggle"><input id="tech-tsv-enabled" type="checkbox">定义 TSV / 键合工艺参数</label><div id="tech-tsv-fields" hidden><div class="input-form-grid">${tsvFields.map(([key,title])=>field(key,title)).join('')}${field('tsv-provenance','TSV / 键合数据来源','text')}</div></div>`;
    host.addEventListener('input',()=>onChange());
    host.querySelector('#tech-tsv-enabled').onchange=()=>{this.toggle();onChange();};
    host.querySelector('#add-metal').onclick=()=>{this.addMetal({});onChange();};
  }
  get(id){return this.host.querySelector('#tech-'+id);}
  toggle(){this.get('tsv-fields').hidden=!this.get('tsv-enabled').checked;}
  addMetal(m){
    const tr=document.createElement('tr');
    const input=(key)=>`<input data-metal="${key}" aria-label="金属层 ${key}" value="${esc(m[key])}" ${key==='name'?'':'type="number" min="0" step="any"'}>`;
    tr.innerHTML=`<td>${input('name')}</td><td><select data-metal="direction" aria-label="金属层方向"><option value="HORIZONTAL" ${m.direction!=='VERTICAL'?'selected':''}>水平</option><option value="VERTICAL" ${m.direction==='VERTICAL'?'selected':''}>垂直</option></select></td><td>${input('width_um')}</td><td>${input('pitch_um')}</td><td>${input('availability')}</td><td><button aria-label="移除金属层">移除</button></td>`;
    tr.querySelector('button').onclick=()=>{tr.remove();this.onChange();};this.host.querySelector('tbody').append(tr);
  }
  fill(resources){
    this.base=structuredClone(resources);this.get('name').value=resources.technology||'';this.get('provenance').value=resources.technology_provenance||'';this.get('availability').value=resources.routing_availability??'';
    this.host.querySelector('tbody').replaceChildren();for(const m of resources.metals||[])this.addMetal(m);
    this.get('tsv-enabled').checked=Boolean(resources.tsv);for(const [key] of tsvFields)this.get(key).value=resources.tsv?.[key]??'';
    this.get('tsv-provenance').value=resources.tsv?.provenance||'';this.toggle();
  }
  read(){return updateTechnology(this.base,{technology:this.get('name').value,provenance:this.get('provenance').value,availability:this.get('availability').value,metals:[...this.host.querySelectorAll('tbody tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-metal]')].map(e=>[e.dataset.metal,e.value]))),tsv:this.get('tsv-enabled').checked?{...Object.fromEntries(tsvFields.map(([key])=>[key,this.get(key).value])),provenance:this.get('tsv-provenance').value}:null});}
}
