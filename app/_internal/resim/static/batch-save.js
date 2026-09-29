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
export class BatchSavePanel{
  constructor(){this.signature='';this.batchId=null;}
  render(batch,report,candidates,busy,blocked){
    const $=id=>document.getElementById(id);
    if(batch?.id!==this.batchId){this.batchId=batch?.id;this.signature='';$('batch-plan-list').replaceChildren();$('result-name').value=batch?.name||'';$('plan-name').value='';}
    $('result-name').disabled=busy||Boolean(batch?.persisted);
    if(batch?.persisted)$('result-name').value=batch.name;
    $('plan-name').disabled=busy;
    const saved=report&&batch?.saved.has(planKey(report));
    $('evaluate').disabled=busy||!report||Boolean(blocked)||saved;
    $('evaluate').textContent=saved?'当前方案已保存':'保存当前方案';
    $('save-blocked-reason').textContent=blocked||'';
    $('bulk-save-options').hidden=!candidates.length;
    const signature=JSON.stringify(candidates.map(c=>[c.id,c.report.plan_id,batch?.saved.has(planKey(c.report))]));
    if(signature!==this.signature){
      const previous=new Map([...$('batch-plan-list').querySelectorAll('[data-save-key]')].map(row=>[row.dataset.saveKey,{checked:row.querySelector('input[type=checkbox]').checked,name:row.querySelector('input[type=text]').value}]));
      $('batch-plan-list').innerHTML=candidates.map(c=>{
        const key=planKey(c.report),done=batch?.saved.has(key),old=previous.get(key);
        return `<label class="batch-plan-row" data-save-key="${esc(key)}"><input type="checkbox" aria-label="选择${esc(c.name)}" ${done?'disabled':old?.checked?'checked':''}><span>${esc(c.name)}${done?' · 已保存':''}</span><input type="text" aria-label="${esc(c.name)}保存名称" maxlength="120" value="${esc(old?.name||c.name)}" ${done?'disabled':''}></label>`;
      }).join('');this.signature=signature;
    }
    for(const row of $('batch-plan-list').querySelectorAll('[data-save-key]'))for(const field of row.querySelectorAll('input'))field.disabled=busy||Boolean(batch?.saved.has(row.dataset.saveKey));
    const remaining=candidates.some(c=>!batch?.saved.has(planKey(c.report)));
    for(const id of ['save-selected','save-all'])$(id).disabled=busy||Boolean(blocked)||!remaining;
  }
  choices(){return [...document.querySelectorAll('#batch-plan-list [data-save-key]')].map(row=>({key:row.dataset.saveKey,name:row.querySelector('input[type=text]').value,selected:row.querySelector('input[type=checkbox]').checked}));}
}
