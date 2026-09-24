import {METRICS,savedCandidates} from './history-comparison.js?v=3';
import {placementRows,layoutSignature} from './layout-variants.js';
import {runLabel} from './ui-state.js';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:5}):'未知';
const key=s=>JSON.stringify([s.project_id,s.run_id,s.candidate]);
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);

export function compareSelections(selections){
  if(selections.length<2||selections.some(s=>!s?.report?.summary))throw new Error('至少选择两个有效方案。');
  if(new Set(selections.map(key)).size!==selections.length)throw new Error('同一个历史方案已被重复选择，请更换或移除。');
  const metrics=METRICS.map(([id,label,unit])=>({id,label,unit,values:selections.map(s=>finite(s.report.summary[id])?s.report.summary[id]:null)}));
  const maps=selections.map(s=>new Map(placementRows(s.report).map(p=>[p.id,p])));
  const ids=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort();
  const changes=ids.map(id=>({id,placements:maps.map(m=>m.get(id)||null)})).filter(row=>new Set(row.placements.map(stable)).size>1);
  const issues=new Map();
  selections.forEach((s,i)=>(s.report.issues||[]).forEach(issue=>{
    const id=JSON.stringify([issue.severity,issue.code,issue.subject]);
    if(!issues.has(id))issues.set(id,{severity:issue.severity,code:issue.code,subject:issue.subject,occurrences:selections.map(()=>null)});
    issues.get(id).occurrences[i]={reason:issue.reason||'',suggestion:issue.suggestion||''};
  }));
  const warnings=[];
  if(new Set(selections.map(s=>s.report.simulator_version)).size>1)warnings.push('计算版本不同，数值差异可能来自模型更新。');
  if(new Set(selections.map(s=>stable(s.report.project?.resources))).size>1)warnings.push('工艺或资源参数不同，差异不能只归因于布局。');
  if(selections.some(s=>s.report.summary.unknowns))warnings.push('部分方案有缺失数据；未知值不按零计算。');
  if(new Set(selections.map(s=>layoutSignature(s.report))).size<selections.length)warnings.push('部分历史记录的模块布局相同，可继续比较其资源参数与评估结果。');
  if(new Set(selections.map(s=>s.project_id)).size>1)warnings.push('跨工程比较按模块 ID 对齐，模块语义请结合各工程确认。');
  return {schema_version:'resim-comparison/2',created_at:new Date().toISOString(),
    selections:selections.map(({report,...s})=>({...s,simulator_version:report.simulator_version,plan_id:report.plan_id})),
    metrics,changes,issues:[...issues.values()],warnings};
}

export class HistoryComparison{
  constructor({api,download}){
    Object.assign(this,{api,download,projects:[],current:null,slots:new Map(),serial:0,comparison:null,initialized:false});
    this.host=document.getElementById('history-comparison');
    this.host.innerHTML=`<summary><span>历史结果对比</span><small id="compare-count">选择需要对比的方案</small></summary><div class="comparison-body"><div class="comparison-toolbar"><p>自由添加或移除方案，横向比较资源与布局。</p><button id="add-compare">＋ 添加方案</button></div><div class="history-compare-pickers" id="compare-pickers"></div><div class="comparison-toolbar"><span id="history-compare-status" role="status">请选择方案。</span><button id="compare-now" class="primary">开始对比</button><button id="download-history-diff" disabled>下载对比 JSON</button></div><div id="history-diff"></div></div>`;
    this.host.addEventListener('toggle',()=>{if(this.host.open&&!this.initialized){this.initialized=true;this.addSlot();this.addSlot();}});
    document.getElementById('add-compare').onclick=()=>this.addSlot();
    document.getElementById('compare-now').onclick=()=>this.compare();
    document.getElementById('download-history-diff').onclick=()=>{if(this.comparison)this.download('resim-comparison.json',JSON.stringify(this.comparison,null,2),'application/json');};
  }
  async refresh(projects,current){
    this.projects=projects;this.current=current;
    if(!this.initialized)return;
    await Promise.all([...this.slots.values()].map(slot=>{this.projectsFor(slot);return this.loadRuns(slot);}));
  }
  el(slot,field){return slot.element.querySelector(`[data-field="${field}"]`);}
  projectsFor(slot){
    const select=this.el(slot,'project'),previous=select.value;
    select.innerHTML=this.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')||'<option value="">暂无工程</option>';
    select.value=this.projects.some(p=>p.id===previous)?previous:this.projects.some(p=>p.id===this.current)?this.current:this.projects[0]?.id||'';
  }
  addSlot(){
    const id=++this.serial,element=document.createElement('fieldset');
    const slot={id,element,token:0,options:[],loadedKey:'',candidate:null};this.slots.set(id,slot);
    element.innerHTML=`<legend></legend><button type="button" class="remove-compare" aria-label="移除此对比方案">移除</button><label>工程<select data-field="project"></select></label><label>历史运行<select data-field="run"></select></label><label>方案<select data-field="candidate"></select></label><small data-field="meta"></small><a data-field="report" target="_blank" rel="noreferrer" hidden>完整报告 ↗</a>`;
    document.getElementById('compare-pickers').append(element);this.projectsFor(slot);
    for(const field of ['project','run','candidate'])this.el(slot,field).onchange=()=>{
      if(field==='project')this.loadRuns(slot);
      else if(field==='run')this.loadResult(slot);
      else{slot.candidate=this.el(slot,'candidate').value;this.invalidate();}
    };
    element.querySelector('.remove-compare').onclick=()=>{if(this.slots.size<=2)return;slot.token++;this.slots.delete(id);element.remove();this.renumber();this.invalidate();};
    this.renumber();this.loadRuns(slot);
  }
  renumber(){
    [...this.slots.values()].forEach((s,i)=>{
      s.element.querySelector('legend').textContent='方案 '+(i+1);
      s.element.querySelector('.remove-compare').disabled=this.slots.size<=2;
      for(const [f,label] of [['project','工程'],['run','历史运行'],['candidate','方案']])this.el(s,f).setAttribute('aria-label',`对比 ${i+1} ${label}`);
    });
    document.getElementById('compare-count').textContent=this.slots.size+' 个对比位置';
  }
  currentSelection(s){
    if(s.loading)return null;
    const option=s.options.find(c=>c.id===this.el(s,'candidate').value);if(!option)return null;
    return {project_id:this.el(s,'project').value,project_name:this.el(s,'project').selectedOptions[0]?.textContent,
      run_id:this.el(s,'run').value,run_name:this.el(s,'run').selectedOptions[0]?.textContent,
      candidate:option.id,candidate_name:option.name,report:option.report};
  }
  reset(slot,message){
    slot.loading=true;slot.options=[];
    this.el(slot,'candidate').innerHTML=`<option value="">${esc(message)}</option>`;this.el(slot,'candidate').disabled=true;
    this.invalidate();
  }
  valid(slot,token){return this.slots.has(slot.id)&&slot.token===token;}
  async loadRuns(slot){
    const token=++slot.token,p=this.el(slot,'project').value,old=this.el(slot,'run').value;
    this.reset(slot,'正在读取…');this.el(slot,'run').innerHTML='';this.el(slot,'run').disabled=true;
    if(!p){slot.loading=false;this.invalidate();return;}
    try{
      const runs=(await this.api(`projects/${encodeURIComponent(p)}/runs`)).filter(r=>r.status==='completed');
      if(!this.valid(slot,token))return;
      this.el(slot,'run').innerHTML=runs.map(r=>`<option value="${esc(r.run_id)}">${esc(runLabel(r))} · ${esc(r.run_id)}</option>`).join('')||'<option value="">暂无已完成运行</option>';
      this.el(slot,'run').disabled=!runs.length;
      const occupied=new Set([...this.slots.values()].filter(s=>s!==slot&&this.el(s,'project').value===p).map(s=>this.el(s,'run').value));
      this.el(slot,'run').value=runs.find(r=>r.run_id===old)?.run_id||runs.find(r=>!occupied.has(r.run_id))?.run_id||runs[0]?.run_id||'';
      await this.loadResult(slot);
    }catch(e){if(this.valid(slot,token)){slot.loading=false;this.el(slot,'candidate').innerHTML=`<option value="">读取失败</option>`;this.invalidate();this.el(slot,'meta').textContent=e.message;}}
  }
  async loadResult(slot){
    const token=++slot.token,p=this.el(slot,'project').value,r=this.el(slot,'run').value,old=slot.loadedKey===p+'/'+r?slot.candidate:null;
    this.reset(slot,'正在读取…');
    if(!r){slot.loading=false;this.el(slot,'candidate').innerHTML='<option value="">无可用结果</option>';this.invalidate();return;}
    try{
      const payload=await this.api(`projects/${encodeURIComponent(p)}/runs/${encodeURIComponent(r)}/result`);
      if(!this.valid(slot,token))return;
      slot.options=savedCandidates(payload);slot.loading=false;slot.loadedKey=p+'/'+r;
      this.el(slot,'candidate').innerHTML=slot.options.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')||'<option value="">无候选方案</option>';
      const occupied=new Set([...this.slots.values()].filter(s=>s!==slot).map(s=>this.currentSelection(s)).filter(Boolean).map(key));
      const choice=slot.options.find(c=>c.id===old)||slot.options.find(c=>!occupied.has(key({project_id:p,run_id:r,candidate:c.id})))||slot.options[0];
      this.el(slot,'candidate').value=choice?.id||'';slot.candidate=choice?.id;this.el(slot,'candidate').disabled=!choice;this.invalidate();
    }catch(e){if(this.valid(slot,token)){slot.loading=false;this.el(slot,'candidate').innerHTML='<option value="">读取失败</option>';this.invalidate();this.el(slot,'meta').textContent=e.message;}}
  }
  invalidate(){
    this.comparison=null;document.getElementById('history-diff').replaceChildren();document.getElementById('download-history-diff').disabled=true;
    const selected=[...this.slots.values()].map(s=>{
      const choice=this.currentSelection(s),link=this.el(s,'report');link.hidden=!choice;
      this.el(s,'meta').textContent=choice?`计算版本 ${choice.report.simulator_version||'未知'}`:s.loading?'读取中…':'';
      if(choice)link.href=`/api/projects/${encodeURIComponent(choice.project_id)}/runs/${encodeURIComponent(choice.run_id)}/export/report.html?candidate=${encodeURIComponent(choice.candidate)}`;
      return choice;
    });
    const ready=selected.length>=2&&selected.every(Boolean),duplicate=ready&&new Set(selected.map(key)).size!==selected.length;
    document.getElementById('compare-now').disabled=!ready||duplicate;
    document.getElementById('history-compare-status').textContent=duplicate?'同一方案被重复选择，请更换或移除。':ready?`已选择 ${selected.length} 个方案，点击“开始对比”查看详情。`:'请选择有效的历史运行和方案。';
  }
  compare(){
    try{this.comparison=compareSelections([...this.slots.values()].map(s=>this.currentSelection(s)));}
    catch(e){document.getElementById('history-compare-status').textContent=e.message;return;}
    const c=this.comparison;
    document.getElementById('download-history-diff').disabled=false;
    document.getElementById('history-compare-status').textContent=`已对比 ${c.selections.length} 个方案 · ${c.changes.length} 个模块布局不同`;
    const headers=c.selections.map((s,i)=>`<th title="${esc(s.run_id)}"><b>方案 ${i+1} · ${esc(s.candidate_name)}</b><small>${esc(s.project_name)}<br>${esc(s.run_name?.split(' · ').slice(0,3).join(' · '))}</small></th>`).join('');
    const table=(first,rows)=>`<div class="table-scroll"><table class="multi-compare-table"><thead><tr><th>${first}</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const loc=p=>p?`${esc(p.die)}<br>(${num(p.x_um)}, ${num(p.y_um)})<br>${num(p.width_um)} × ${num(p.height_um)} µm`:'未包含';
    document.getElementById('history-diff').innerHTML=c.warnings.map(w=>`<p class="compare-warning">${esc(w)}</p>`).join('')+
      table('资源 / 指标',c.metrics.map(m=>`<tr><td>${esc(m.label)} <small>${esc(m.unit)}</small></td>${m.values.map(v=>`<td>${num(v)}</td>`).join('')}</tr>`).join(''))+
      `<details><summary>模块布局差异 · ${c.changes.length} 个</summary>${c.changes.length?table('模块',c.changes.slice(0,100).map(row=>`<tr><td>${esc(row.id)}</td>${row.placements.map(p=>`<td>${loc(p)}</td>`).join('')}</tr>`).join('')):'<p>所选方案的模块布局一致。</p>'}${c.changes.length>100?'<p>展示前 100 个；完整内容可下载 JSON。</p>':''}</details>`+
      `<details><summary>约束问题分布 · ${c.issues.length} 类</summary>${c.issues.length?table('对象 / 问题',c.issues.slice(0,100).map(row=>`<tr><td>${esc(row.subject)}<small>${esc(row.code)} · ${esc(row.severity)}</small></td>${row.occurrences.map(o=>`<td>${o?esc(o.reason||'存在此问题'):'未报告'}</td>`).join('')}</tr>`).join('')):'<p>所选报告均未记录约束问题。</p>'}${c.issues.length>100?'<p>展示前 100 类；完整内容可下载 JSON。</p>':''}</details>`;
  }
}
