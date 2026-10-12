const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const copy=value=>structuredClone(value);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function family(project){const p=copy(project);delete p.name;delete p.floorplan.placements;return stable(p);}
export function planKey(report){return 'layout-'+report.plan_id;}
export function newBatch(project,kind='manual',search={}){
  return {id:'batch-'+crypto.randomUUID(),base:copy(project),kind,search,name:'',persisted:false,saved:new Map()};
}
export function saveBlockedReason({rawEdited,pendingInput,structureDirty,previewPending,previewFailed}){
  if(rawEdited||pendingInput||structureDirty)return '输入仍有未应用修改，请先应用预览，再保存正在查看的方案。';
  if(previewPending)return '正在重算布局，请等待预览完成。';
  if(previewFailed)return '预览失败，请重试或撤销后再保存。';
  return '';
}
export function nextUnsaved(candidates,batch,current){
  const start=candidates.findIndex(c=>planKey(c.report)===current);
  const ordered=[...candidates.slice(start+1),...candidates.slice(0,start+1)];
  return ordered.find(c=>!batch?.saved.has(planKey(c.report)))||null;
}
export class BatchSavePanel{
  constructor(){this.signature='';this.batchId=null;this.reportKey=null;this.names=new Map();}
  render(batch,report,candidates,busy,blocked,{options=[],active='current'}={}){
    const $=id=>document.getElementById(id);
    if(batch?.id!==this.batchId){this.batchId=batch?.id;this.reportKey=null;this.names.clear();this.signature='';$('batch-plan-list').replaceChildren();$('result-name').value=batch?.name||'';}
    const key=report?planKey(report):null;
    if(key!==this.reportKey){this.reportKey=key;$('plan-name').value=this.names.get(key)||'';}
    $('plan-name').oninput=()=>this.names.set(this.reportKey,$('plan-name').value);
    $('result-name').disabled=busy||Boolean(batch?.persisted);
    if(batch?.persisted)$('result-name').value=batch.name;
    const saved=Boolean(key&&batch?.saved.has(key));
    if(saved)$('plan-name').value=batch.saved.get(key)?.storage?.run_name||report?.storage?.run_name||this.names.get(key)||'';
    $('plan-name').disabled=busy||saved||!report;
    const picker=$('result-candidate');
    picker.innerHTML=options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')||'<option value="current">暂无方案</option>';
    picker.value=active;picker.disabled=busy||!report||options.length<2;
    const current=options.find(o=>o.value===active)?.label||'当前方案';
    $('plan-name').placeholder=saved?'该方案已保存':`留空使用“${current}”`;
    $('evaluate').disabled=busy||!report||Boolean(blocked)||saved;
    $('evaluate').textContent=saved?'已保存':'保存方案';
    $('single-save-state').textContent=report?(saved?'已保存到当前批次':'待保存'):'请先载入或生成布局';
    const next=nextUnsaved(candidates,batch,key);
    $('save-next-plan').hidden=!next||planKey(next.report)===key;
    $('save-next-plan').disabled=busy||Boolean(blocked);
    $('save-next-plan').dataset.candidate=next?.id||'';
    $('batch-state').textContent=batch?.persisted?'继续保存到此批次':'首次保存时创建';
    $('save-blocked-reason').textContent=blocked||'';
    $('bulk-save-options').hidden=!candidates.length;
    $('batch-empty').hidden=Boolean(candidates.length);
    const savedCount=candidates.filter(c=>batch?.saved.has(planKey(c.report))).length;
    $('batch-save-state').textContent=candidates.length?`${candidates.length} 个候选 · ${savedCount} 个已保存`:batch?.persisted?`${batch.saved.size} 个已保存`:'尚未生成候选';
    $('batch-empty').textContent=batch?.persisted?'已保存的方案可在下方历史列表中查看。':'自动布局生成候选后，可一次保存整批。';
    const signature=JSON.stringify(candidates.map(c=>[c.id,c.report.plan_id,batch?.saved.has(planKey(c.report))]));
    if(signature!==this.signature){
      const previous=new Map([...$('batch-plan-list').querySelectorAll('[data-save-key]')].map(row=>[row.dataset.saveKey,{checked:row.querySelector('input[type=checkbox]').checked,name:row.querySelector('input[type=text]').value}]));
      $('batch-plan-list').innerHTML=candidates.map(c=>{
        const key=planKey(c.report),done=batch?.saved.has(key),old=previous.get(key);
        const savedName=batch?.saved.get(key)?.storage?.run_name;
        return `<div class="batch-plan-row" data-save-key="${esc(key)}"><input type="checkbox" aria-label="选择${esc(c.name)}" ${done?'disabled':old?.checked===false?'':'checked'}><span>${esc(c.name)}${done?' <small>已保存</small>':''}</span><input type="text" aria-label="${esc(c.name)}保存名称" maxlength="120" value="${esc(savedName||old?.name||c.name)}" ${done?'disabled':''}></div>`;
      }).join('');this.signature=signature;
    }
    for(const row of $('batch-plan-list').querySelectorAll('[data-save-key]'))for(const field of row.querySelectorAll('input'))field.disabled=busy||Boolean(batch?.saved.has(row.dataset.saveKey));
    const remaining=candidates.some(c=>!batch?.saved.has(planKey(c.report)));
    const updateSelection=()=>{
      const count=this.choices().filter(c=>c.selected&&!batch?.saved.has(c.key)).length;
      $('batch-selection-count').textContent=`选择方案 · ${count} 个待保存`;
      $('save-batch').disabled=busy||Boolean(blocked)||!remaining||!count;
      $('save-batch').textContent=remaining?`保存批次${count?'（'+count+' 个）':''}`:candidates.length?'本批次已保存':'保存批次';
    };
    for(const checkbox of $('batch-plan-list').querySelectorAll('input[type=checkbox]'))checkbox.onchange=updateSelection;
    updateSelection();
  }
  choices(){return [...document.querySelectorAll('#batch-plan-list [data-save-key]')].map(row=>({key:row.dataset.saveKey,name:row.querySelector('input[type=text]').value,selected:row.querySelector('input[type=checkbox]').checked}));}
}
