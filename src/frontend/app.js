import {OutputFolders} from './output-folders.js?v=direct-projects-1';
import {BatchSavePanel,newBatch,family,planKey,saveBlockedReason} from './batch-save.js?v=1';
import {TaskProgress,resultFolderName} from './task-progress.js?v=named-folders-1';
import {InputEditor} from './input-editor.js?v=8';
import {HistoryComparison} from './multi-comparison.js?v=batch-plans-1';
import {assessedReport} from './report-assessment.js';
import {distinctCandidates,layoutDifference} from './layout-variants.js';
import {CandidateBrowser,candidateCount,searchCompletion} from './candidate-browser.js';
import {SEVERITIES,difficultyPage} from './difficulty-view.js';
import {updateStructure} from './structure-editor.js?v=4';
import {stackModel,faceText,assertStack} from './stack-model.js?v=native-3';
import {renderInterfaceInputs,interfaceInputValues,renderStackStrip,dieDetails,pairDetails} from './stack-panel.js?v=2';
import {readYaml} from './architecture-io.js?v=2';
import {peerConnections} from './core-view.js?v=19';
import {chipDimensions,coreDetails,corePeers} from './object-details.js?v=2';
import {connectionScope,SCOPE_NAMES,transferBudget} from './connection-view.js?v=19';
import {showResourceWorkspace} from './resource-workspace.js?v=paging-3';
import {number as fmt,area,movePlacement,linkBudget} from './layout-model.js?v=19';
import {Viewer} from './viewer.js?v=24';
import {Connections} from './connections.js?v=20';
import {assessment,candidateFolder,matchingSavedCandidate,runDetails,runOptionLabel} from './ui-state.js?v=batch-plans-1';
import {showMethods} from './methods.js?v=resources-2';
import {initWorkbench,openWorkspace} from './workbench.js?v=task-save-1';
initWorkbench();
const $=id=>document.getElementById(id),clone=x=>structuredClone(x);
const candidateBrowser=new CandidateBrowser($('layout-candidates'));
const taskProgress=new TaskProgress($('task-progress'));
let candidateSaves=new Map();
let batchContext=null,planParent=null;
const batchPanel=new BatchSavePanel();
function unsavedSearch(){return searchResult&&!searchResult.storage&&distinctCandidates(searchResult).some(c=>!candidateSaves.has(c.id));}
let difficultySelection=null,difficultyPageIndex=0;
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let report,searchResult,baseline,activeStorage,currentProjectId=null,selectedId=null;
// Creation is explicitly opened by a user action, not inferred from a missing ID.
let creationMode=null,creationFieldsOpen=false;
let busy=false,dirty=false,draftChanged=false,rawEdited=false,revision=0,previewPending=false,previewFailed=false,previewTimer,editBase=null,undo=[],redo=[];
let storageMode='evaluate',activeCandidate='current',savedCandidate='current',previewController,selectedIssue=null;
let connectionPane;let structureDirty=false;let inputEditor,historyComparison;
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function allIssues(){return assessedReport(report)?.issues||[];}
function displaySummary(value=report){return assessedReport(value)?.summary;}
function setInspector(open){$('selection-inspector').hidden=!open;$('layout-workbench').classList.toggle('has-detail',open);if(!open)$('inspector-diagnostics').open=false;}
function clearSelection(){
  inspect(null);if(viewer){viewer.selectedLink=null;viewer.selectedTSV=null;viewer.selectedPort=null;viewer.selectedDie=null;}
  if(connectionPane)connectionPane.selected=null;$('port-popover').hidden=true;viewer?.draw(report,previewPending||previewFailed);
}
function showDie(id){
  if(!report)return;clearSelection();viewer.selectedDie=id;setInspector(true);$('detail').innerHTML=dieDetails(report,id)+chipDimensions(report);
  if($('scene-scope').value==='core'){$('detail').insertAdjacentHTML('beforeend','<button id=inspect-core>查看当前 Core 详情</button>');$('inspect-core').onclick=()=>showCore($('scene-core').value,id);}
  $('detail').querySelectorAll('[data-face-view]').forEach(b=>b.onclick=()=>{$('layer').value=b.dataset.die;setView(b.dataset.faceView);});viewer.draw(report,previewPending||previewFailed);
}
function bindPeerLinks(){
  $('detail').querySelectorAll('[data-peer-link]').forEach(b=>b.onclick=()=>{
    const core=b.dataset.peerCore,link=report.project.architecture.links.find(l=>l.id===b.dataset.peerLink);
    if(!link)return;
    const local=report.modules.find(m=>m.core===core&&(m.id===link.source||m.id===link.target));
    $('scene-scope').value='core';$('scene-core').value=core;$('show-external').checked=true;
    $('connection-scope').value='all';$('connection-core').value='';$('wires').checked=true;
    // Cross-die peers need the complete stack, not only the local endpoint's layer.
    const target=report.modules.find(m=>m.id===(link.source===local.id?link.target:link.source));
    $('layer').value=target.die===local.die?local.die:'all';
    refreshSceneUI();inspect(null);connectionPane.select(link.id);viewer?.reset();
  });
}
function showCore(core,die){
  if(!report)return;clearSelection();viewer.selectedCore=core;setInspector(true);
  $('detail').innerHTML=coreDetails(report,core,die);bindPeerLinks();
  $('enter-core').onclick=()=>{$('scene-scope').value=report.project.architecture.cores.length>1?'core':'array';$('scene-core').value=core;changeScene();};
  viewer.draw(report,previewPending||previewFailed);
}
function showInterface(lower){
  if(!report)return;clearSelection();setInspector(true);$('detail').innerHTML=pairDetails(report,lower);
  const select=$('inspect-region');if(select)select.onchange=()=>{if(select.value)showTSV(select.value);};
}
async function canLeaveDraft(includeSearch=true){
  if(!(draftChanged||rawEdited||structureDirty||inputEditor?.hasPending()||(includeSearch&&unsavedSearch())))return true;
  const dialog=$('discard-dialog');dialog.showModal();
  return new Promise(resolve=>{
    const finish=value=>{dialog.close();dialog.oncancel=null;resolve(value);};
    $('keep-draft').onclick=()=>finish(false);$('discard-draft').onclick=()=>finish(true);
    dialog.oncancel=event=>{event.preventDefault();finish(false);};
  });
}
async function api(path,body,signal){const response=await fetch('/api/'+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Resim-Local':'1'},body:JSON.stringify(body)}:{}),signal});if(!response.ok){let message=`请求失败（${response.status}）`;try{const error=await response.json();message=typeof error.detail==='string'?error.detail:JSON.stringify(error.detail);}catch{}throw new Error(message);}return response.json();}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function updateControls(){
  inputEditor?.busy(busy);
  const creationVisible=!currentProjectId&&creationMode!==null&&creationFieldsOpen;
  $('project-create-fields').hidden=!creationVisible;
  $('web-new-project').setAttribute('aria-expanded',String(creationVisible));
  if(!creationVisible){$('project-options-panel').hidden=true;$('project-options').setAttribute('aria-expanded','false');}
  $('result-name').disabled=busy;
  $('search-count').disabled=busy;
  for(const button of $('layout-candidates').querySelectorAll('[data-plan]'))button.disabled=busy;
  const m=report?.project.architecture.modules.find(m=>m.id===selectedId);
  for(const id of ['web-new-project','open-project','hide-project-create','project-options','apply-structure','add-die','reset-structure','output-dir','browse-output','new-output-folder','load','evaluate','optimize','validate','preview-input','candidate','load-run','project','history','editor-toggle','input-export','yaml'])$(id).disabled=busy;
  if(!$('project').value&&$('project').options.length)$('project').selectedIndex=0;
  $('load').disabled=busy||!$('project').value;
  for(const id of ['apply-move','edit-die','edit-x','edit-y'])$(id).disabled=busy||rawEdited||!m||m.fixed;
  $('apply-spacing').disabled=busy||rawEdited||!report;$('edit-spacing').disabled=busy||rawEdited||!report;$('edit-halo').disabled=busy||rawEdited||!m;
  if($('apply-routing'))$('apply-routing').disabled=busy||rawEdited||previewPending;
  $('apply-supply').disabled=busy||rawEdited||previewPending||!report?.ports.length;
  for(const id of ['edit-supply-port','supply-x','supply-y','supply-capacity','supply-feed'])$(id).disabled=busy||rawEdited||previewPending||!report?.ports.length;
  $('edit-mode').disabled=busy||rawEdited||!m||m.fixed;
  $('undo-move').disabled=busy||rawEdited||!undo.length;$('redo-move').disabled=busy||rawEdited||!redo.length;
  $('retry-preview').hidden=!previewFailed;$('retry-preview').disabled=busy;
  $('project-name').disabled=busy||Boolean(currentProjectId);
  renderSavePanel();
}
function setBusy(value){busy=value;updateControls();}
function clearResult(){
  batchContext=null;planParent=null;
  candidateSaves=new Map();taskProgress.reset();$('result-name').value='';
  difficultySelection=null;difficultyPageIndex=0;$('difficulty-panel').hidden=true;candidateBrowser.clear();
  inputEditor?.reset();
  structureDirty=false;
  showPort(null);
  showResourceWorkspace(null);
  revision++;previewController?.abort();clearTimeout(previewTimer);previewPending=false;previewFailed=false;dirty=false;draftChanged=false;rawEdited=false;undo=[];redo=[];editBase=null;report=null;renderStackStrip(null);searchResult=null;baseline=null;activeStorage=null;selectedId=null;selectedIssue=null;activeCandidate=savedCandidate='current';
  $('result-files').hidden=true;$('nav-links').textContent='—';showMethods(null);for(const id of ['ledger','issues','live-metrics','difficulty-summary'])$(id).innerHTML='';
  for(const id of ['s-dies','s-modules','s-power','s-tsv','s-congestion','s-errors','s-status','plan-id','difficulty-errors','difficulty-warnings','difficulty-unknowns'])$(id).textContent='—';
  $('supply-rows').innerHTML='';$('calculation-detail').innerHTML='';$('calculation-die').innerHTML='';$('issue-filter').value='all';$('edit-x').value='';$('edit-y').value='';$('candidate').innerHTML='<option value="current">当前输入</option>';$('edit-mode').checked=false;
  $('edit-die').innerHTML='';$('undo-move').disabled=true;connectionPane?.clear();if(viewer){viewer.selectedLink=null;viewer.selectedModule=null;}inspect(null);viewer?.clear();updateAssessment();updateFiles();
}
async function refreshProjects(id=currentProjectId){
  const items=await api('projects');
  $('project').innerHTML=items.length?items.map(p=>`<option value="${esc(p.id)}" title="${esc(p.project_dir||p.id)}">${esc(p.name)}</option>`).join(''):'<option value="" disabled>暂无已有项目</option>';
  $('project').value=items.some(p=>p.id===id)?id:items[0]?.id||'';
  historyComparison?.refresh(items,id).catch(e=>notice(e.message,true));updateControls();return items;
}
function updateHistoryDetails(){
  const option=$('history').selectedOptions[0];
  $('history-record-details').hidden=!option?.value;
  $('history-record-meta').textContent=option?.value?`${option.title}\n记录编号：${option.value}`:'';
}
async function refreshHistory(runId){
  const runs=currentProjectId?await api(`projects/${currentProjectId}/runs`):[];
  const groups=new Map();for(const r of runs){const key=r.batch_id||'legacy';if(!groups.has(key))groups.set(key,{name:r.batch_name||'历史独立记录',rows:[]});groups.get(key).rows.push(r);}
  $('history').innerHTML='<option value="">选择历史方案</option>'+[...groups.values()].map(g=>`<optgroup label="${esc(g.name)}">${g.rows.map(r=>`<option value="${esc(r.run_id)}" title="${esc(runDetails(r))}">${esc(runOptionLabel(r,g.rows))}</option>`).join('')}</optgroup>`).join('');
  if(runId)$('history').value=runId;updateHistoryDetails();return runs;
}
function currentFolder(){return candidateFolder(activeStorage,storageMode,dirty?savedCandidate:activeCandidate);}
function resultUrl(format){return `/api/projects/${activeStorage.project_id}/runs/${activeStorage.run_id}/export/${format}?candidate=${encodeURIComponent($('candidate').value)}`;}
function updateFiles(){
  if(report&&!rawEdited&&!previewPending&&!previewFailed&&(!batchContext||family(batchContext.base)!==family(report.project))){
    if(batchContext){searchResult=null;candidateSaves=new Map();activeCandidate='draft';$('candidate').innerHTML='<option value="draft">新输入 · 未保存</option>';}
    batchContext=newBatch(report.project);planParent=null;
  }
  const saved=Boolean(activeStorage);$('result-files').hidden=!saved&&!dirty&&!rawEdited;$('reports-empty').hidden=saved||dirty||rawEdited;$('unsaved-dot').hidden=!dirty&&!rawEdited&&!unsavedSearch();
  $('result-state').textContent=rawEdited?'输入已修改 · 图中仍是上次布局':dirty?'未保存预览':report?activeStorage?.run_name||'评估结果':'已保存搜索记录 · 没有可展示的布局';
  const plan=$('candidate').selectedOptions[0]?.textContent?.split(' · ')[0]||'当前布局';
  $('save-result-context').textContent=report?`当前方案：${plan} · 保存到 项目 / 批次 / 方案。`:'尚未载入方案';
  $('result-location').textContent=saved?currentFolder():'尚未保存到工程';
  $('result-note').textContent=dirty||rawEdited?(saved?'路径指向上次结果。保存后会生成新的独立记录。':'当前方案尚未写入文件，请在上方填写名称并保存。'):report?.storage_format==='resim-report/2'?'本方案的 inputs 保存架构与工艺；floorplan.svg 为布局图，implementation-difficulties.md 为实现难点，report.html / resource-report.json 为资源报告。':'历史格式：保留原方案的输入、布局和报告。';
  if(saved)$('storage-path').textContent=activeStorage.run_dir;
  $('open-results').disabled=!saved;$('copy-results').disabled=!saved;$('html-report').hidden=!report||!saved||dirty||rawEdited;
  if(report&&saved&&!dirty&&!rawEdited)$('html-report').href=resultUrl('report.html');
  $('floorplan-report').hidden=!report||!saved||dirty||rawEdited||previewPending||previewFailed;
  if(report&&saved&&!dirty&&!rawEdited)$('floorplan-report').href=resultUrl('floorplan.svg');
  $('active-context').textContent=`当前工程：${$('project-name').value||'新工程'} · ${rawEdited?'输入待应用':dirty?'未保存预览':report?'已保存方案':'等待评估'}`;
  showMethods(report,searchResult);renderCandidates();updateControls();updateAssessment();
  renderSavePanel();
}
function renderSavePanel(){batchPanel.render(batchContext,report,searchResult?distinctCandidates(searchResult):[],busy,saveBlockedReason({rawEdited,pendingInput:inputEditor?.hasPending(),structureDirty,previewPending,previewFailed}));}
function renderCandidates(){
  $('candidate-origin').hidden=activeCandidate!=='base';
  const host=$('layout-candidates');host.hidden=!searchResult;
  if(!searchResult){candidateBrowser.clear();host.replaceChildren();return;}
  const candidates=distinctCandidates(searchResult),requested=searchResult.baseline?.project.search?.candidates||candidates[0]?.report.project.search?.candidates;
  const plans=candidates.map(c=>({...c,key:c.id,summary:displaySummary(c.report)}));
  const difference=(p,i)=>{if(plans.length<2)return '';const other=plans[i===0?1:0],d=layoutDifference(other.report,p.report);return `<small class="candidate-difference">与${other.name}相比：${d.changed} 个模块不同${d.migrated?' · '+d.migrated+' 个跨层迁移':''}${d.moved?' · '+d.moved+' 个位置变化':''}</small>`;};
  host.innerHTML=`<div class="candidate-list-head"><b>布局方案</b><span>${candidates.length} 个不同候选${requested?' / 请求 '+requested+' 个':''}</span></div><div class="candidate-list" tabindex="0" aria-label="候选布局，左右滚动浏览">${plans.map((p,i)=>`<button data-plan="${p.key}" aria-pressed="${activeCandidate===p.key}" class="candidate-card"><b>${p.name}</b><span>${fmt(p.summary.errors,0)} 项违例 · ${fmt(p.summary.unknowns,0)} 项缺失</span><small>加权线长 ${fmt(p.report.summary.weighted_wirelength_um,0)} wire·µm</small><small>峰值拥塞 ${fmt(p.report.summary.peak_congestion,3)}</small>${difference(p,i)}</button>`).join('')}</div><div class="candidate-scroll" hidden><button data-candidate-prev aria-label="向左浏览方案">←</button><input data-candidate-slider type="range" min="0" max="1000" value="0" aria-label="左右浏览候选方案"><button data-candidate-next aria-label="向右浏览方案">→</button><output></output></div><p class="compact-note">${esc(searchCompletion(searchResult,candidates.length,requested))}</p>`;
  candidateBrowser.bind(activeStorage?.run_id||searchResult);
  for(const b of host.querySelectorAll('[data-plan]'))b.onclick=()=>selectCandidate(b.dataset.plan);
}
function renderResult(result,mode){
  activeStorage=result.storage||null;storageMode=mode;
  dirty=!activeStorage;
  const count=(mode==='optimize'?result.baseline||result.candidates[0]:result)?.project?.search?.candidates;
  if(count)$('search-count').value=count;
  if(mode==='optimize'){
    searchResult=result;baseline=result.baseline;$('candidate').innerHTML=(baseline?'<option value="base">寻优前布局</option>':'')+distinctCandidates(result).map(c=>`<option value="${c.id}">${c.name} · ${c.report.candidate.accepted?'通过当前模型约束':'需修改 / 数据不全'}</option>`).join('');
    if(result.candidates.length){activeCandidate=savedCandidate='0';$('candidate').value='0';show(result.candidates[0],true);}else if(baseline){activeCandidate=savedCandidate='base';$('candidate').value='base';show(baseline,true);}
  }else{searchResult=null;baseline=result;activeCandidate=savedCandidate='current';$('candidate').innerHTML='<option value="current">给定布局</option>';show(result,true);}updateFiles();
}
async function loadHistory(runId){
  const payload=await api(`projects/${currentProjectId}/runs/${runId}/result`),response=await fetch(`/api/projects/${currentProjectId}/runs/${runId}/input`);if(!response.ok)throw new Error('读取历史输入失败');
  clearResult();$('yaml').value=await response.text();
  const storage=payload.result.storage;
  if(storage?.batch_id){const data=await api(`projects/${currentProjectId}/batches/${storage.batch_id}`);batchContext=newBatch(readYaml(data.base_yaml),data.batch.kind,data.batch.search_metadata);Object.assign(batchContext,{id:storage.batch_id,name:data.batch.name,persisted:true,saved:new Map(data.batch.plans.map(p=>[p.source_key,true]))});}
  renderResult(payload.result,payload.mode);planParent=report?{record:storage?.run_id,key:storage?.source_key||planKey(report)}:null;
  if(report)await syncYaml();$('history').value=runId;updateHistoryDetails();notice('正在查看历史方案；修改并应用预览后，可以在所属批次中另存新版本。');
}
async function loadProject(id){
  if(!id)return;
  structureDirty=false;$('output-dir').value='';
  setBusy(true);
  try{const response=await fetch(`/api/projects/${id}/input`);if(!response.ok)throw new Error('项目输入读取失败');const input=await response.text();currentProjectId=id;creationMode=null;creationFieldsOpen=false;localStorage.setItem('resim-project',id);
    const items=await refreshProjects(id),meta=items.find(p=>p.id===id);$('project-name').value=meta?.name||id;$('output-dir').value=meta?.project_dir||'';$('project-name').disabled=true;clearResult();$('yaml').value=input;
    const runs=await refreshHistory(),latest=runs.find(r=>r.status==='completed');
    if(latest?.batch_id){await loadHistory(latest.run_id);setView(report.dies.length===1?'2d':'3d');return;}
    const working=await api('preview',{yaml:input});
    if(latest){
      const payload=await api(`projects/${id}/runs/${latest.run_id}/result`),match=matchingSavedCandidate(payload.result,payload.mode,working.report);
      if(match!==null){renderResult(payload.result,payload.mode);activeCandidate=savedCandidate=match;$('candidate').value=match;show(working.report,true);$('history').value=latest.run_id;updateHistoryDetails();notice('已载入工程当前输入，对应已保存方案。');}
      else{dirty=true;activeCandidate='draft';$('candidate').innerHTML='<option value="draft">当前工程输入 · 未保存预览</option>';show(working.report,true);notice('已按当前工程输入重新预览。当前输入或计算版本与最近报告不同，点击“保存评估结果”生成新记录；历史报告可单独查看。');}
    }else{dirty=true;activeCandidate='draft';$('candidate').innerHTML='<option value="draft">当前工程输入 · 未保存预览</option>';show(working.report,true);notice('已预览当前输入，点击“保存评估结果”创建运行记录。');}
    $('yaml').value=working.yaml;$('storage-path').textContent=activeStorage?.run_dir||`ResimProjects/${id}/inputs/architecture.yml`;setView(report.dies.length===1?'2d':'3d');
  }catch(e){openWorkspace('inputs');$('architecture-input-step').open=true;$('editor-panel').hidden=false;$('editor-toggle').setAttribute('aria-expanded','true');notice('当前输入尚不能展示：'+e.message+'。可在输入编辑器中修改；没有完整布局时可运行自动规划。',true);}finally{setBusy(false);}
}
function newProject(name='',mode=null){ openWorkspace('inputs');creationMode=mode;creationFieldsOpen=mode!==null;structureDirty=false;$('structure-rows').replaceChildren();$('output-dir').value=''; $('project-options-panel').hidden=true;$('project-options').setAttribute('aria-expanded','false');$('editor-panel').hidden=true;$('editor-toggle').setAttribute('aria-expanded','false');$('architecture-input-step').open=false;$('technology-input-step').open=false;inputEditor.setMode(null);inputEditor.setTechnologyMode(null);currentProjectId=null;clearResult();$('project').value='';$('project-name').disabled=false;$('project-name').value=name;$('history').innerHTML='<option value="">暂无结果</option>';updateHistoryDetails();$('storage-path').textContent='项目文件夹内保存 inputs、项目配置和命名结果子文件夹。';updateControls();notice(mode?'填写项目名称，再选择架构和工艺库的输入方式。':'载入已有项目，或点击“新建项目”开始。');}
function toggleProjectCreation(mode){
  if(currentProjectId||creationMode!==mode)return false;
  creationFieldsOpen=!creationFieldsOpen;updateControls();
  if(creationFieldsOpen)$('project-name').focus();
  return true;
}
async function syncYaml(){if(report&&!rawEdited){const token=revision,project=clone(report.project);project.name=$('project-name').value||project.name;const response=await fetch('/api/yaml',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({yaml:JSON.stringify(project)})});if(!response.ok)throw new Error('当前布局输入校验失败');const text=await response.text();if(token===revision&&!rawEdited)$('yaml').value=text;}}
async function execute(mode){
  if(busy)return;
  if(mode==='evaluate')return savePlans('current');
  if(mode==='optimize'&&rawEdited){notice('完整输入尚未应用，请先应用预览，再生成布局方案。',true);return;}
  if(inputEditor?.hasPending()){notice('输入区仍有未应用修改，请先应用预览或撤销。',true);openWorkspace('inputs');return;}
  if(structureDirty){notice('Die 表格有未应用修改，请先应用结构并预览。',true);return;}
  if(previewPending){notice('正在重算布局，请稍候。');return;}
  if(previewFailed&&!rawEdited){notice('预览计算失败，请重试或撤销后再保存。',true);return;}
  if(mode==='optimize'&&unsavedSearch()&&!await canLeaveDraft())return;
  setBusy(true);if(mode==='optimize')taskProgress.start('正在自动分区与布局');else if(mode==='evaluate')taskProgress.reset();
  $('optimize').textContent=mode==='optimize'?'正在生成方案…':'自动分区与布局';
  $('evaluate').textContent=mode==='evaluate'?'正在保存…':'保存评估结果';
  notice(mode==='optimize'?'正在生成候选布局，请等待完成。':mode==='validate'?'正在校验输入…':'正在计算并保存当前布局…');
  try{
    await syncYaml();const project=readYaml($('yaml').value);assertStack(project);let yaml=$('yaml').value;
    if(mode==='optimize'){
      project.search={...project.search,candidates:candidateCount($('search-count').value)};yaml=JSON.stringify(project);
      taskProgress.phase(`正在搜索并复核候选 · 请求 ${project.search.candidates} 个 · 求解预算 ${project.search.time_limit_s??12} 秒，准备与评估另计。`);
    }
    const result=await api(mode==='optimize'?'optimize/preview':mode,{yaml});
    if(mode==='validate'){notice(`输入有效：${result.dies} 个 die，${result.modules} 个模块。`);return;}
    if(mode==='optimize'){
      clearResult();batchContext=newBatch(project,'optimize',{search_status:result.search_status,solver_statuses:result.solver_statuses,elapsed_s:result.elapsed_s,generated_candidates:result.candidates.length,message:result.message});renderResult(result,'optimize');await syncYaml();
      const count=distinctCandidates(result).length;
      taskProgress.finish(count?'布局生成完成':'搜索结束 · 未生成候选',searchCompletion(result,count,project.search.candidates)+(count?' 选定方案后到结果管理命名并保存。':' 请检查输入资源和约束，或调整搜索预算。'),{review:count>0});
      notice(count?`已生成 ${count} 个不同候选，尚未保存。`:'本次未生成候选，未写入历史记录。');
      return;
    }
  }catch(e){
    if(mode==='optimize')taskProgress.finish('布局生成失败',e.message,{error:true});
    notice(e.message,true);
  }finally{setBusy(false);$('optimize').textContent='自动分区与布局';}
}

async function savePlans(mode){
  if(busy)return;
  if(document.body.dataset.workspace!=='reports'){openWorkspace('reports');return;}
  const blocked=saveBlockedReason({rawEdited,pendingInput:inputEditor?.hasPending(),structureDirty,previewPending,previewFailed});
  if(blocked){notice(blocked,true);return;}
  if(!report)return;
  updateFiles();
  let name,targets;
  const candidates=searchResult?distinctCandidates(searchResult):[],choices=new Map(batchPanel.choices().map(c=>[c.key,c]));
  try{
    name=resultFolderName($('result-name').value);
    if(mode==='current'){
      const fallback=activeCandidate==='draft'?'手工调整方案':$('candidate').selectedOptions[0]?.textContent.split(' · ')[0]||'当前方案';
      targets=[{report:clone(report),name:resultFolderName($('plan-name').value.trim()||fallback),parent:planParent?.key!==planKey(report)?planParent:null}];
    }else targets=candidates.filter(c=>mode==='all'||choices.get(planKey(c.report))?.selected).map(c=>({report:clone(c.report),name:resultFolderName(choices.get(planKey(c.report))?.name||c.name)}));
    targets=targets.filter(t=>!batchContext.saved.has(planKey(t.report)));
    if(!targets.length){notice(mode==='selected'?'请选择尚未保存的候选方案。':'所选方案已经保存，无需重复创建。');return;}
  }catch(e){notice(e.message,true);return;}
  setBusy(true);taskProgress.reset();let completed=0,lastId;
  try{
    for(const target of targets){
      notice(`正在保存 ${completed+1} / ${targets.length}：${target.name}`);
      const result=await api('batches/save-plan',{project_id:currentProjectId,project_name:$('project-name').value||null,...(!currentProjectId?{project_dir:$('output-dir').value.trim()}:{}),
        batch_id:batchContext.id,batch_name:batchContext.persisted?batchContext.name:name,kind:batchContext.kind,base_yaml:JSON.stringify(batchContext.base),search_metadata:batchContext.search,
        plan_name:target.name,yaml:JSON.stringify(target.report.project),preview_plan_id:target.report.plan_id,source_key:planKey(target.report),
        candidate_metadata:target.report.candidate||null,parent_record_id:target.parent?.record||null,parent_source_key:target.parent?.key||null});
      const saved=result.report,storage=saved.storage;
      currentProjectId=storage.project_id;creationMode=null;creationFieldsOpen=false;localStorage.setItem('resim-project',currentProjectId);$('output-dir').value=storage.project_dir;$('project-name').value=storage.project_name;
      batchContext.name=result.batch.name;batchContext.persisted=true;batchContext.saved.set(planKey(saved),saved);lastId=storage.run_id;
      const original=candidates.find(c=>c.report.plan_id===saved.plan_id);if(original)candidateSaves.set(original.id,saved);
      if(report.plan_id===saved.plan_id){report=saved;activeStorage=storage;storageMode='evaluate';dirty=false;draftChanged=false;planParent={record:storage.run_id,key:storage.source_key};savedCandidate=activeCandidate;if(activeCandidate==='draft')$('candidate').selectedOptions[0].textContent=storage.run_name;}
      completed++;renderSavePanel();
    }
    notice(`已保存 ${completed} 个方案到批次“${batchContext.name}”。`);
  }catch(e){notice(`已保存 ${completed} / ${targets.length} 个方案。${e.message}；其余方案仍未保存，可重试。`,true);}
  finally{
    setBusy(false);updateFiles();
    if(currentProjectId)try{await refreshProjects();await refreshHistory(lastId);}catch(e){notice(`保存完成，但历史列表刷新失败：${e.message}`,true);}
  }
}
function updateAssessment(){
  const pendingInput=structureDirty||inputEditor?.hasPending();
  const state=assessment(displaySummary()),stale=rawEdited||pendingInput||previewPending||previewFailed;
  $('assessment').className='assessment '+(stale?'unknown':state.tone);
  $('assessment-title').textContent=rawEdited||pendingInput?'输入尚未应用，画面与指标仍是旧结果':previewFailed?'预览失败，当前指标不可用':previewPending?'正在重算移动后的布局':state.title;
  $('assessment-note').textContent=stale?'请完成预览后再判断布局；当前不能导出为新结果。':state.detail;
  $('viewport-state').textContent=rawEdited||pendingInput?'旧布局 · 输入待应用':previewFailed?'预览失败 · 指标不可用':previewPending?'正在重算…':dirty?'未保存预览':report?'已保存结果':'等待输入';
}
function renderIssues(){
  if(!report)return;const filter=$('issue-filter').value,items=allIssues().map((issue,index)=>({...issue,index})).filter(i=>filter==='all'||i.severity===filter);
  $('issue-count').textContent=`${items.length} / ${allIssues().length} 项`;
  $('issues').innerHTML=items.length?items.map(i=>`<button class="issue ${esc(i.severity)}" data-issue="${i.index}"><b>${esc(i.subject)} <small>${{error:'违例',unknown:'数据缺失',warning:'提示'}[i.severity]||esc(i.severity)}</small></b>${esc(i.reason)}<span>${esc(i.suggestion)}</span></button>`).join(''):'<p>当前分类没有问题。</p>';
  $('issues').querySelectorAll('[data-issue]').forEach(button=>button.onclick=()=>{
    setInspector(true);$('inspector-diagnostics').open=true;const issue=allIssues()[Number(button.dataset.issue)];selectedIssue=issue;
    const link=report.project.architecture.links.find(l=>l.id===issue.subject),ids=issue.subject.split(/\s*\/\s*|,\s*/),m=report.modules.find(m=>ids.includes(m.id));
    if(link){$('layer').value='all';connectionPane.select(link.id);}
    else if(m){inspect(m);$('layer').value=m.die;}
    else{if(issue.code==='STACK_GEOMETRY'){const d=report.dies.find(d=>d.id===issue.subject);if(d)showDie(d.id);else{const p=stackModel(report.project).pairs.find(p=>issue.subject===p.lower+' ↔ '+p.upper);if(p)showInterface(p.lower);}}const channel=report.routing_channels?.find(c=>c.id===issue.subject);const d=report.dies.find(d=>issue.subject===d.id||issue.subject.startsWith(d.id+':')||d.id===channel?.die);if(d)$('layer').value=d.id;if(issue.code==='METAL_CAPACITY')$('metal-layer').value=issue.subject.slice(issue.subject.indexOf(':')+1);}
    setInspector(true);$('inspector-diagnostics').open=true;$('focused-issue').textContent=`${issue.subject}：${issue.reason}。建议：${issue.suggestion}`;$('focused-issue').hidden=false;
    viewer?.draw(report,previewPending||previewFailed);viewer?.reset();
  });
}
function show(value,fit=false){
  report=clone(value);renderStackStrip(report,showDie,showInterface);inputEditor?.update(report.project);renderStructure();renderDifficulties();$('edit-spacing').value=report.project.constraints.min_module_spacing_um||0;$('nav-links').textContent=report.links.length;const s=displaySummary();$('s-dies').textContent=`${s.die_count} 层`;$('s-dies').title=report.dies.some(d=>d.kind==='dram')?'含 DRAM ×8 封装抽象层':'';$('s-modules').textContent=`${s.module_count} 个模块 · 已定义 die 面积 ${area(s.total_die_area_mm2)} mm²${s.signal_hb_sites?' · HB '+fmt(s.signal_hb_sites,0)+' bit':''}`;
  $('s-power').textContent=fmt(s.power_W)+(s.power_W==null?'':' W');$('s-tsv').textContent=fmt(s.signal_via_segments,0);$('s-congestion').textContent=fmt(s.peak_congestion,4);$('s-errors').textContent=s.errors;$('s-errors').style.color=s.errors?'#f28d7f':s.unknowns?'#e3c57e':'#76d6c4';$('s-status').textContent=s.unknowns?`${s.unknowns} 项缺失 · 不能确认可行`:s.errors?'查看约束检查':'在当前模型约束内通过';
  for(const card of document.querySelectorAll('.stats>div'))card.title=card.innerText+' '+(card.querySelector('small')?.textContent||'');
  $('plan-id').textContent=(dirty?'DRAFT ':'PLAN ')+report.plan_id;$('scene-title').textContent=`${s.die_count}-DIE EXPLORATION`;
  const layer=$('layer').value;$('layer').innerHTML='<option value="all">所有 die</option>'+report.dies.map(d=>`<option value="${esc(d.id)}">${esc(d.id)} · ${esc(d.kind)}</option>`).join('');if([...$('layer').options].some(o=>o.value===layer))$('layer').value=layer;
  const oldSceneCore=$('scene-core').value;$('scene-core').innerHTML=report.project.architecture.cores.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}</option>`).join('');if(report.project.architecture.cores.some(c=>c.id===oldSceneCore))$('scene-core').value=oldSceneCore;
  refreshSceneUI();
  const oldCore=$('connection-core').value;$('connection-core').innerHTML='<option value="">全部 core</option>'+report.project.architecture.cores.map(c=>`<option value="${esc(c.id)}">${esc(c.id)}</option>`).join('');if(report.project.architecture.cores.some(c=>c.id===oldCore))$('connection-core').value=oldCore;
  const metal=$('metal-layer').value;$('metal-layer').innerHTML='<option value="all">所有金属层</option>'+report.project.resources.metals.map(m=>`<option value="${esc(m.name)}">${esc(m.name)} · ${m.direction==='HORIZONTAL'?'水平':'垂直'}</option>`).join('');if([...$('metal-layer').options].some(o=>o.value===metal))$('metal-layer').value=metal;
  renderIssues();$('focused-issue').hidden=true;
  const previousPort=$('edit-supply-port').value;
  $('edit-supply-port').innerHTML=report.ports.map(p=>`<option value="${esc(p.id)}">${esc(p.die)} / ${esc(p.core||p.id)}</option>`).join('');
  if(report.ports.some(p=>p.id===previousPort))$('edit-supply-port').value=previousPort;
  fillSupplyEditor();
  const owned=report.supply_groups||[];
  $('supply-port-details').innerHTML='<table><thead><tr><th>端口 / 核</th><th>Die / 电压域</th><th>位置 µm</th><th>接入方式</th><th>电压 V / 能力 A</th><th>本核需求 / 余量 A</th></tr></thead><tbody>'+report.ports.map(p=>{const g=owned.find(g=>g.ports.includes(p.id));return `<tr data-port-die="${esc(p.die)}"><td>${esc(p.id)}<small>${esc(p.core||'共享入口')}</small></td><td>${esc(p.die)} / ${esc(p.domain)}</td><td>${fmt(p.x_um)}, ${fmt(p.y_um)}</td><td>${p.feed==='stack_base'?'从底层经 TSV 接入':'外部供电入口'}</td><td>${fmt(p.voltage_V)} / ${fmt(p.max_current_A)}</td><td>${fmt(g?.demand_A)} / ${fmt(g?.margin_A)}<small>${esc(p.provenance||'未填写入口依据')}</small></td></tr>`;}).join('')+'</tbody></table>';
  const timing=report.timing;
  $('timing-summary').innerHTML=(timing?.model?`<p>${timing.model.calibrated?'输入标记为已校准':'未校准 · 仅用于方案比较'}：${esc(timing.model.provenance)}</p><p>平面 ${fmt(timing.model.planar_ps_per_um,5)} ps/µm + 跨层 ${fmt(timing.model.tier_ps)} ps/接口；加权总延迟 ${fmt(timing.weighted_delay_ps)} ps，最长单连接 ${fmt(timing.max_link_delay_ps)} ps。</p><p>${esc(timing.scope)} 加权总和不是模型执行时间。</p>`:'<p>未提供延迟系数，不把线长或带宽当作真实传输时间。</p>');

  connectionPane?.update(report,previewPending||previewFailed);inspect(report.modules.find(m=>m.id===selectedId)||null,false);updateLive();viewer?.draw(report,previewPending||previewFailed);if(fit)viewer?.reset();updateFiles();
}
function updateLive(){
  if(!report)return;const s=report.summary,b=editBase,metrics=[['互联金属面积',s.wiring_metal_area_um2,b?.wiring_metal_area_um2,'µm²'],['加权线长',s.weighted_wirelength_um,b?.weighted_wirelength_um,'wire·µm'],['峰值拥塞',s.peak_congestion,b?.peak_congestion,''],['信号 TSV',s.signal_via_segments,b?.signal_via_segments,''],['全部 TSV',s.total_via_segments,b?.total_via_segments,''],['总功耗',s.power_W,b?.power_W,'W']];
  $('live-metrics').innerHTML=metrics.map(([label,v,old,unit])=>`<span>${label} <b>${previewPending?'重算中…':fmt(v,4)+(v==null?'':' '+unit)}</b>${!previewPending&&b&&old!=null&&v!=null?`<small>相对编辑前 ${v-old>0?'+':''}${fmt(v-old,4)}</small>`:''}</span>`).join('');
  $('preview-changes').hidden=!dirty;
  $('draft-status').textContent=rawEdited?'输入待应用':previewFailed?'预览失败，可重试或撤销':previewPending?'移动后重算中':dirty?'未保存预览 · 保存评估结果为新版本':'已评估布局';updateControls();
  // Never present a stale evaluated metric as the value of a moving layout.
  const stale=previewPending||previewFailed||rawEdited;
  showResourceWorkspace(report,stale,id=>{connectionPane.select(id);openWorkspace('connections');},id=>{
    const module=report.modules.find(m=>m.id===id);if(!module)return;
    openWorkspace('layout');$('layer').value=module.die;$('scene-scope').value='core';$('scene-core').value=module.core;refreshSceneUI();inspect(module);viewer?.draw(report,stale);viewer?.reset();
  });
  connectionPane?.update(report,stale);
  for(const id of ['issues'])$(id).classList.toggle('pending',stale);
  if(previewPending||previewFailed){for(const id of ['s-congestion','s-tsv','s-errors'])$(id).textContent='—';$('s-status').textContent=previewFailed?'计算失败':'重算中';if(previewFailed)$('live-metrics').textContent='指标计算失败，重试成功前不显示旧数值。';}
  updateAssessment();
}
function inspect(m,filter=true){
  $('module-editor').hidden=!m;if(viewer)viewer.selectedCore=null;
  if(!m){$('edit-mode').checked=false;if(viewer?.navigation==='edit')viewer.setNavigation('pan');}
  setInspector(Boolean(m));if(viewer){viewer.selectedDie=null;viewer.selectedTSV=null;viewer.selectedPort=null;}
  if(filter)connectionPane?.filter(m?.id||'');
  $('selection-banner').hidden=!m;
  if(m){$('selection-name').textContent=m.id;$('selection-info').textContent=`占地 ${area(m.footprint_um2/1e6)} mm² · 功耗 ${fmt(m.power_W)} W · 容量 ${fmt(m.metrics.capacity_KiB)} KiB`; $('selection-meta').textContent=`${m.die} · ${m.core} · ${report.project.architecture.links.filter(l=>l.source===m.id||l.target===m.id).length} 条关联连接`;}

  if(viewer)viewer.selectedModule=m?.id||null;
  $('edit-halo').disabled=!m;$('edit-halo').value=m?(report.project.architecture.modules.find(x=>x.id===m.id)?.halo_um||0):'';
  selectedId=m?.id||null;if(!m){$('detail').innerHTML='<h3>选择模块或连线</h3><p>点击模块或连线查看详情。</p>';$('edit-die').innerHTML='';$('edit-x').value='';$('edit-y').value='';updateControls();return;}
  const definition=report.project.architecture.modules.find(x=>x.id===m.id);$('edit-die').innerHTML=report.dies.map(d=>`<option value="${esc(d.id)}">${esc(d.id)}${definition.allowed_dies.includes(d.id)?'':' · 约束不允许'}</option>`).join('');$('edit-die').value=m.die;$('edit-x').value=m.x_um;$('edit-y').value=m.y_um;
  $('edit-help').textContent=definition.fixed?'固定模块；请先在架构输入中解除固定。':'';
  if(definition.fixed){$('edit-mode').checked=false;if(viewer?.navigation==='edit')viewer.setNavigation('pan');}
  const row=([k,v])=>`<div class="detail-row"><span>${k}</span><b>${esc(v)}</b></div>`;
  const brief=[['类型 / Core',m.kind+' / '+m.core],['长 × 宽',fmt(m.width_um)+' × '+fmt(m.height_um)+' µm'],['模块占地',area(m.footprint_um2/1e6)+' mm²'],['功耗',fmt(m.power_W)+(m.power_W==null?'':' W')]];
  const resources=[['外围预留',fmt(definition.halo_um||0)+' µm / 边'],['标准单元面积',definition.area_known===false?'未知':area(m.stdcell_area_um2/1e6)+' mm²'],['硬宏面积',definition.area_known===false?'未知':area(m.macro_area_um2/1e6)+' mm²'],['实际标准单元利用率',m.cell_utilization==null?'未知':fmt(m.cell_utilization*100,1)+'%'],['目标单元利用率',fmt(definition.target_cell_utilization*100,1)+'% · 输入设定'],['功耗密度',fmt(m.power_density_W_mm2)+(m.power_density_W_mm2==null?'':' W/mm²')],['局部峰值拥塞',previewPending?'重算中…':fmt(m.peak_congestion,4)],['容量',fmt(m.metrics.capacity_KiB)+' KiB']];
  $('detail').innerHTML=`<h3>${esc(m.id)} <span class="pill">${esc(m.die)}</span></h3>`+brief.map(row).join('')+`<details class="object-section"><summary>资源明细</summary>${resources.map(row).join('')}<p>利用率依据：${esc(definition.utilization_basis||'待确认')}</p><p>${esc(m.provenance)}</p></details>`+corePeers(report,m.core,m.id)+`<button id="inspect-core" class="text-button">${esc(m.core)} 的布局与外部接口 ↗</button>`;
  $('inspect-core').onclick=()=>showCore(m.core,m.die);bindPeerLinks();
  updateControls();
}
function rememberMove(){undo.push(clone(report.project));redo=[];if(undo.length>60)undo.shift();}
function setDraft(project,remember=true){
  if(activeCandidate!=='draft')planParent={record:activeStorage?.batch_id===batchContext?.id?activeStorage.run_id:null,key:planKey(report)};
  report=clone(report);
  if(remember)rememberMove();if(!editBase)editBase=clone(report.summary);if(!dirty)savedCandidate=activeCandidate;dirty=true;draftChanged=true;rawEdited=false;previewFailed=false;revision++;previewController?.abort();previewPending=true;report.project=project;
  for(const m of report.modules){const p=project.floorplan.placements.find(p=>p.module===m.id);Object.assign(m,{die:p.die,x_um:p.x_um,y_um:p.y_um});}
  if(!$('candidate').querySelector('[value="draft"]'))$('candidate').insertAdjacentHTML('beforeend','<option value="draft">手动编辑 · 未保存</option>');$('candidate').value=activeCandidate='draft';$('wires').checked=true;
  connectionPane?.update(report,true);inspect(report.modules.find(m=>m.id===selectedId));updateLive();updateFiles();viewer?.draw(report,true);
}
async function preview(){
  clearTimeout(previewTimer);if(!report)return;const token=revision;previewController?.abort();previewController=new AbortController();previewPending=true;previewFailed=false;updateLive();updateFiles();
  try{const response=await api('layout/preview',clone(report.project),previewController.signal);if(token!==revision)return;previewPending=false;$('yaml').value=response.yaml;show(response.report);notice(`布局预览已更新：${response.report.summary.errors} 项违例，${response.report.summary.unknowns} 项缺失。保存评估结果后生成新结果。`);}
  catch(e){if(token!==revision||e.name==='AbortError')return;previewPending=false;previewFailed=true;updateLive();updateFiles();notice('布局预览失败：'+e.message+'。可重试或撤销，当前修改仍保留。',true);}
}
async function applyMove(){
  if(busy||!report||!selectedId)return;if(rawEdited){notice('请先评估修改后的 YAML，再移动模块。',true);return;}
  try{const x=$('edit-x').value,y=$('edit-y').value;if(x===''||y==='')throw new Error('请填写 X 和 Y 坐标');const target=$('edit-die').value;const halo=Number($('edit-halo').value);if($('edit-halo').value===''||!Number.isFinite(halo)||halo<0)throw new Error('外围预留必须是非负数');const next=movePlacement(report.project,selectedId,target,Number(x),Number(y));next.architecture.modules.find(m=>m.id===selectedId).halo_um=halo;setDraft(next);if($('layer').value!=='all')$('layer').value=target;viewer?.draw(report,true);await preview();}catch(e){notice(e.message,true);}
}
let viewer;
try{viewer=new Viewer({selectCore:showCore,selectDie:showDie,selectInterface:showInterface,selectPort:showPort,selectTSV:showTSV,select:id=>{if(viewer)viewer.selectedLink=null;if(connectionPane)connectionPane.selected=null;inspect(report.modules.find(m=>m.id===id));viewer.draw(report,previewPending||previewFailed);},selectLink:id=>connectionPane?.select(id),editable:()=>Boolean(report&&!busy&&!rawEdited&&$('edit-mode').checked),start:rememberMove,move:(id,die,x,y)=>{try{setDraft(movePlacement(report.project,id,die,x,y),false);clearTimeout(previewTimer);previewTimer=setTimeout(preview,180);}catch(e){notice(e.message,true);}},finish:preview,error:message=>notice(message,true)});}catch(e){$('render-error').hidden=false;$('render-error').textContent='3D 渲染不可用：'+e.message;}
connectionPane=new Connections(id=>{
  if(id){
    inspect(null,false);setInspector(true);$('port-popover').hidden=true;$('wires').checked=true;const link=report.project.architecture.links.find(l=>l.id===id),count=linkBudget(link);
    $('detail').innerHTML=`<h3>${esc(link.source)} → ${esc(link.target)}</h3><p>${esc(id)}</p>`+[['源 core',report.project.architecture.modules.find(m=>m.id===link.source)?.core||'未知'],['目标 core',report.project.architecture.modules.find(m=>m.id===link.target)?.core||'未知'],['原始速率上限',fmt(transferBudget(link).rawGBps)+' GB/s（配置值，不含损耗）'],['逻辑位宽',count.bus_width_bits==null?'未提供':count.bus_width_bits+' bit'],['并行数据线',count.data_wires+' 根'],['控制 / 冗余',count.control_wires+' / '+count.spare_wires+' 根'],['合计线数',count.wires+' 根'],['每线速率',fmt(link.lane_rate_Gbps)+' Gbit/s']].map(([key,value])=>`<div class="detail-row"><span>${key}</span><b>${esc(value)}</b></div>`).join('')+'<p>逻辑视图粗细按总位宽示意；金属视图按分层线数示意，实际单线宽见金属明细。</p><a href="#connection-panel">查看连线和金属层明细 ↓</a>';
  }
  else if(report)inspect(report.modules.find(m=>m.id===selectedId)||null,false);
  if(viewer){viewer.selectedLink=id;viewer.draw(report,previewPending||previewFailed);}
},async(id,routingLayers)=>{if(busy||!report||rawEdited)return;const next=clone(report.project);next.architecture.links.find(l=>l.id===id).routing_layers=routingLayers;setDraft(next);await preview();});
$('apply-spacing').onclick=async()=>{if(busy||!report||rawEdited)return;try{const gap=Number($('edit-spacing').value);if($('edit-spacing').value===''||!Number.isFinite(gap)||gap<0)throw new Error('间距必须是非负数');const next=clone(report.project);next.constraints.min_module_spacing_um=gap;setDraft(next);await preview();}catch(e){notice(e.message,true);}};
$('project').onchange=updateControls;
$('load').onclick=async()=>{if(busy||!$('project').value)return;if(await canLeaveDraft())await loadProject($('project').value);};
$('hide-project-create').onclick=()=>{if(busy)return;creationFieldsOpen=false;updateControls();$('web-new-project').focus();};
$('load-run').onclick=async()=>{if(busy||!currentProjectId||!$('history').value||!await canLeaveDraft())return;setBusy(true);try{await loadHistory($('history').value);}catch(e){notice(e.message,true);}finally{setBusy(false);}};
$('editor-toggle').onclick=async()=>{openWorkspace('inputs');$('architecture-input-step').open=true;$('editor-panel').hidden=!$('editor-panel').hidden;$('editor-toggle').setAttribute('aria-expanded',String(!$('editor-panel').hidden));if(!$('editor-panel').hidden)try{await syncYaml();}catch(e){notice(e.message,true);}};
$('yaml').oninput=()=>{if(!rawEdited&&report)planParent={record:activeStorage?.batch_id===batchContext?.id?activeStorage.run_id:null,key:planKey(report)};rawEdited=true;revision++;previewController?.abort();clearTimeout(previewTimer);previewPending=false;previewFailed=false;$('edit-mode').checked=false;updateFiles();updateLive();notice('输入已修改，请先点击“应用输入并预览”；当前画面仍是上次布局，暂不能保存。');};
$('preview-input').onclick=async()=>{
  if(inputEditor?.hasPending()||structureDirty){notice('请先应用或撤销网页表单修改，再应用完整输入。',true);return;}if(busy)return;setBusy(true);revision++;previewController?.abort();clearTimeout(previewTimer);
  try{assertStack(readYaml($('yaml').value));const response=await api('preview',{yaml:$('yaml').value});if(!editBase&&report)editBase=clone(report.summary);rawEdited=false;dirty=true;draftChanged=true;previewPending=false;previewFailed=false;undo=[];redo=[];activeCandidate='draft';$('candidate').innerHTML='<option value="draft">输入预览 · 未保存</option>';searchResult=null;$('yaml').value=response.yaml;show(response.report,true);notice('输入已应用并预览，尚未写入工程。确认布局后保存评估结果。');}
  catch(e){notice('输入预览失败：'+e.message,true);}finally{setBusy(false);}
};
for(const mode of ['validate','optimize'])$(mode).onclick=()=>execute(mode);
$('save-result-form').onsubmit=event=>{event.preventDefault();execute('evaluate');};
$('save-selected').onclick=()=>savePlans('selected');
$('save-all').onclick=()=>savePlans('all');
$('history').onchange=updateHistoryDetails;
async function selectCandidate(next){
  if(busy||!searchResult||next==='draft')return;
  $('candidate').value=activeCandidate;if(!await canLeaveDraft(false))return;$('candidate').value=next;
  const saved=candidateSaves.get(next);
  revision++;previewController?.abort();clearTimeout(previewTimer);dirty=!searchResult.storage&&!saved;draftChanged=false;rawEdited=false;previewPending=false;previewFailed=false;undo=[];redo=[];editBase=null;activeCandidate=savedCandidate=next;
  activeStorage=saved?.storage||searchResult.storage||null;storageMode=saved?'evaluate':'optimize';
  $('plan-name').value='';planParent={record:saved?.storage?.run_id||null,key:planKey(saved||(next==='base'?baseline:searchResult.candidates[Number(next)]))};
  $('candidate').querySelector('[value="draft"]')?.remove();structureDirty=false;inputEditor.reset();show(saved||(next==='base'?baseline:searchResult.candidates[Number(next)]),true);try{await syncYaml();}catch(e){notice(e.message,true);}
}
$('candidate').onchange=()=>selectCandidate($('candidate').value);
for(const id of ['connection-view','connection-color','connection-scope','connection-core','layer','metal-layer','clearances','tsv','ports','wires','labels','wire-labels'])$(id).onchange=()=>{if(id==='ports'&&!$('ports').checked)showPort(null);if(id==='wire-labels'&&$(id).checked)$('wires').checked=true;viewer?.draw(report,previewPending||previewFailed);if(['layer','connection-view'].includes(id)){showPort(null);viewer?.reset();}};
$('metal-explode').oninput=()=>{viewer?.draw(report,previewPending||previewFailed);viewer?.reset();};
$('explode').oninput=()=>{viewer?.draw(report,previewPending||previewFailed);viewer?.reset();};$('reset').onclick=()=>viewer?.reset();
function setView(mode){if(mode!=='3d'&&report&&$('layer').value==='all')$('layer').value=report.modules.find(m=>m.id===selectedId)?.die||report.dies[0].id;if(mode==='3d')$('layer').value='all';if(mode!=='2d')$('edit-mode').checked=false;viewer?.setView(mode,report,previewPending||previewFailed);}
$('view3d').onclick=()=>setView('3d');$('view2d').onclick=()=>setView('2d');$('viewback').onclick=()=>{clearSelection();setView('back');};
$('edit-mode').onchange=()=>{if($('edit-mode').checked){if(rawEdited){$('edit-mode').checked=false;notice('请先评估修改后的 YAML，再拖动。',true);return;}$('wires').checked=true;setView('2d');}viewer?.setNavigation($('edit-mode').checked?'edit':'pan');};
$('apply-move').onclick=applyMove;
$('undo-move').onclick=async()=>{if(busy||rawEdited||!undo.length)return;redo.push(clone(report.project));setDraft(undo.pop(),false);if(selectedId&&$('layer').value!=='all')$('layer').value=report.modules.find(m=>m.id===selectedId).die;await preview();};
$('redo-move').onclick=async()=>{if(busy||rawEdited||!redo.length)return;undo.push(clone(report.project));setDraft(redo.pop(),false);if(selectedId&&$('layer').value!=='all')$('layer').value=report.modules.find(m=>m.id===selectedId).die;await preview();};
$('retry-preview').onclick=preview;$('issue-filter').onchange=renderIssues;
$('input-export').onclick=async()=>{try{await syncYaml();download('resim-input.yml',$('yaml').value,'application/yaml');}catch(e){notice(e.message,true);}};
$('open-results').onclick=async()=>{try{await api(`projects/${activeStorage.project_id}/runs/${activeStorage.run_id}/open-folder?candidate=${encodeURIComponent(dirty?savedCandidate:activeCandidate)}`,{});}catch(e){notice(e.message,true);}};
$('copy-results').onclick=async()=>{try{await navigator.clipboard.writeText(currentFolder());notice('当前方案的结果路径已复制。');}catch{notice('复制受浏览器限制，请选择并复制上方路径。');}};
window.addEventListener('beforeunload',event=>{if(busy||unsavedSearch()||draftChanged||rawEdited||structureDirty||inputEditor?.hasPending()){event.preventDefault();event.returnValue='';}});
const outputFolders=new OutputFolders({notice,openProject:async path=>{
  setBusy(true);
  try{const meta=await api('projects/open',{project_dir:path});await loadProject(meta.id);}
  finally{setBusy(false);}
}});
$('open-project').onclick=async()=>{if(busy||!await canLeaveDraft())return;await outputFolders.open(false,'existing');};
inputEditor=new InputEditor({notice,download,onDirty:()=>{updateAssessment();renderSavePanel();},apply:applyInputProject});
historyComparison=new HistoryComparison({api,download});
async function applyInputProject(project,{asNew=false,accepted}={}){
  if(busy||previewPending)throw new Error('正在计算，请稍后应用输入');
  if(structureDirty||rawEdited)throw new Error('请先应用或撤销 Die 表格 / 完整 YAML 修改');
  setBusy(true);notice('正在校验输入并计算预览…');
  try{
    assertStack(project);const result=await api('layout/preview',project);
    if(asNew&&draftChanged&&!await canLeaveDraft())return;
    accepted?.();
    if(asNew)newProject(project.name);else if(report){
      if(activeCandidate!=='draft')planParent={record:activeStorage?.batch_id===batchContext?.id?activeStorage.run_id:null,key:planKey(report)};
      rememberMove();
    }
    revision++;previewController?.abort();clearTimeout(previewTimer);previewPending=false;previewFailed=false;
    dirty=true;draftChanged=true;rawEdited=false;searchResult=null;activeCandidate='draft';
    $('candidate').innerHTML='<option value="draft">输入预览 · 未保存</option>';
    $('yaml').value=result.yaml;show(result.report,true);$('editor-panel').hidden=true;
    notice('输入已应用，资源与实现难点已重新计算。保存评估结果后生成独立历史结果。');
  }finally{setBusy(false);}
}
try{const items=await refreshProjects(),last=localStorage.getItem('resim-project'),initial=items.find(p=>p.id===last||p.previous_ids?.includes(last))||items.find(p=>p.id==='gcd16-nangate45')||items[0];if(initial)await loadProject(initial.id);else newProject();}catch(e){notice(e.message,true);}

function fillSupplyEditor(){
  const p=report?.project.floorplan.supply_ports.find(p=>p.id===$('edit-supply-port').value);
  $('supply-x').value=p?.x_um??'';$('supply-y').value=p?.y_um??'';$('supply-capacity').value=p?.max_current_A??'';$('supply-feed').value=p?.feed||'external';
  $('apply-supply').disabled=!p||busy||rawEdited||previewPending;
}
$('edit-supply-port').onchange=fillSupplyEditor;
$('apply-supply').onclick=()=>{
  if(!report||busy||rawEdited||previewPending)return;
  const x=Number($('supply-x').value),y=Number($('supply-y').value),text=$('supply-capacity').value.trim(),capacity=text===''?null:Number(text);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||(capacity!==null&&(!Number.isFinite(capacity)||capacity<=0))){notice('请输入有效非负坐标；电流能力必须为正数或留空。',true);return;}
  const project=clone(report.project),port=project.floorplan.supply_ports.find(p=>p.id===$('edit-supply-port').value);if(!port)return;
  Object.assign(port,{x_um:x,y_um:y,max_current_A:capacity,feed:$('supply-feed').value});setDraft(project);preview();
};

function showTSV(id){
  const v=report?.interfaces.find(v=>v.id===id);if(!v)return;
  inspect(null,false);setInspector(true);viewer.selectedLink=null;viewer.selectedPort=null;viewer.selectedTSV=id;
  $('port-popover').hidden=true;
  $('detail').innerHTML='<h3>跨层接口</h3><b>'+esc(v.id)+'</b>'+[
    ['连接层',v.lower_die+' ↔ '+v.upper_die],['接口 / 键合',(v.interconnect||'TSV')+' / '+(stackModel(report.project).pairs.find(p=>p.lower===v.lower_die&&p.upper===v.upper_die)?.orientation||'未定义')],['通路预算说明',(v.budget_paths||[]).join('；')||'见关联连接'],['所属 core',v.region?.core||'共享'],
    ['区域尺寸',v.interconnect==='HB'?'不计独立占地':fmt(v.region?.width_um)+' × '+fmt(v.region?.height_um)+' µm'],
    ['信号 / 电源 / 地',fmt(v.signal_vias,0)+' / '+fmt(v.power_vias,0)+' / '+fmt(v.ground_vias,0)],
    ['总需求 / 容量',fmt(v.total_vias,0)+' / '+fmt(v.capacity,0)],['余量',fmt(v.margin,0)],['关联连接数',v.links.length]
  ].map(([k,x])=>`<div class="detail-row"><span>${esc(k)}</span><b>${esc(x)}</b></div>`).join('')+(v.interconnect==='HB'?'<p>HB 面接点；不绘制穿硅柱，不计独立预留面积。</p>':'<p>柱体为 TSV 区域示意，显示柱数不代表实际数量。</p>');
  viewer.draw(report,previewPending||previewFailed);
}
function showPort(id){
  if(viewer)viewer.selectedTSV=null;
  if(viewer)viewer.selectedPort=id;
  const p=report?.ports.find(p=>p.id===id);$('port-popover').hidden=!p;
  if(p){
    inspect(null,false);setInspector(true);viewer.selectedPort=id;$('port-popover').hidden=true;
    const group=report.supply_groups?.find(g=>g.ports.includes(id));
    $('detail').innerHTML=`<h3>供电端口</h3><b>${esc(p.id)}</b>`+[['所属 die / core',p.die+' / '+(p.core||'共享')],['电压域 / 电压',p.domain+' / '+fmt(p.voltage_V)+' V'],['位置',fmt(p.x_um)+', '+fmt(p.y_um)+' µm'],['接入方式',p.feed==='stack_base'?'从本核底层经 TSV 接入':'外部入口'],['入口能力',fmt(p.max_current_A)+' A'],['本核需求 / 余量',fmt(group?.demand_A)+' / '+fmt(group?.margin_A)+' A']].map(([key,value])=>`<div class="detail-row"><span>${esc(key)}</span><b>${esc(value)}</b></div>`).join('')+`<p>${esc(p.provenance||'未提供能力依据')}</p><p>预算接入点；不是焊盘尺寸或已完成的电源网。</p>`;
  }
  viewer?.draw(report,previewPending||previewFailed);
}
$('close-port').onclick=()=>showPort(null);

function refreshSceneUI(){
  if(!report)return;
  const multiple=report.project.architecture.cores.length>1;
  if(!multiple)$('scene-scope').value='array';
  $('scene-scope').hidden=!multiple;
  const single=multiple&&$('scene-scope').value==='core',core=single?$('scene-core').value:null;
  $('external-control').hidden=!single||!peerConnections(report.project,core).length;
  if($('external-control').hidden)$('show-external').checked=false;
  $('scene-core').hidden=!single;$('related-core-control').hidden=single||!multiple;
  $('scene-scope').options[0].textContent=`整体 · ${report.project.architecture.cores.length} core 多层`;
  const count=single?report.modules.filter(m=>m.core===core).length:report.modules.length;
  $('scene-context').textContent=`${single?core:'全部 core'} · ${count} 个模块 · 顶部指标仍为全工程`;
  $('scene-title').textContent=single?`单 CORE · ${core}`:`${report.project.architecture.cores.length} CORE · 整体堆叠`;
  if(report.project.architecture.chip==='blx_scheme1')$('scene-context').textContent=single?core+' · 局部布局':'16 core 重复堆叠';

}
function changeScene(){
  if(!report)return;$('show-external').checked=false;
  $('layer').value='all';$('connection-scope').value='all';$('connection-core').value='';
  inspect(null);if(viewer)viewer.selectedLink=null;showPort(null);refreshSceneUI();viewer?.setView('3d',report,previewPending||previewFailed);
}
$('show-external').onchange=()=>{inspect(null);viewer.selectedLink=null;viewer.draw(report,previewPending||previewFailed);viewer.reset();};
$('nav-pan').onclick=()=>{$('edit-mode').checked=false;viewer?.setNavigation('pan');};
$('nav-rotate').onclick=()=>{$('edit-mode').checked=false;if(viewer?.view!=='3d')viewer.setView('3d',report,previewPending||previewFailed);viewer?.setNavigation('rotate');};
$('scene-scope').onchange=changeScene;$('scene-core').onchange=changeScene;
$('clear-selection').onclick=clearSelection;$('close-inspector').onclick=clearSelection;$('open-diagnostics').onclick=()=>{setInspector(true);$('inspector-diagnostics').open=true;};
$('locate-module').onclick=()=>{const m=report?.modules.find(m=>m.id===selectedId);if(!m)return;$('scene-scope').value='core';$('scene-core').value=m.core;$('layer').value=m.die;$('connection-scope').value='all';$('connection-core').value='';refreshSceneUI();viewer?.draw(report,previewPending||previewFailed);viewer?.reset();};

function renderStructure(){
  if(structureDirty||!report)return;
  $('structure-rows').innerHTML=report.project.architecture.dies.slice().sort((a,b)=>a.order-b.order).map(d=>dieRow(d)).join('');
  $('structure-count').textContent=report.project.architecture.dies.length+' 层（自下而上）';
  $('structure-state').textContent='已应用';
  renderInterfaceInputs(report.project);
}
function dieRow(d,isNew=false){
  const input=(key,value,type='number')=>`<input data-field="${key}" type="${type}" ${type==='number'?'min="0" step="any"':''} value="${esc(value??'')}" aria-label="${esc(d.id)} ${key}">`;
  return `<tr data-original-id="${isNew?'':esc(d.id)}"><td>${input('id',d.id,'text')}</td><td><select data-field="kind" aria-label="${esc(d.id)} 类型">${['logic','dram','other'].map(k=>`<option ${k===d.kind?'selected':''}>${k}</option>`).join('')}</select>${d.display_platform?'平台':''}</td><td><select data-field="face" aria-label="${esc(d.id)} 正面朝向">${['up','down','unknown'].map(f=>`<option value="${f}" ${(isNew?'unknown':stackModel(report.project).faces.get(d.id)?.face==='conflict'?'unknown':stackModel(report.project).faces.get(d.id)?.face)===f?'selected':''}>${faceText(f)}</option>`).join('')}</select></td><td>${input('area',d.width_um*d.height_um/1e6)}</td><td>${input('width',d.width_um/1000)}</td><td>${input('height',d.height_um/1000)}</td><td>${input('thickness',d.thickness_um)}</td><td>${input('power',d.power_budget_W)}</td><td><button data-remove-die>移除</button></td></tr>`;
}
function structureState(){
  structureDirty=true;
  const names=[...$('structure-rows').querySelectorAll('[data-field=id]')],counts=new Map();
  for(const e of names){const id=e.value.trim();counts.set(id,(counts.get(id)||0)+1);}
  let invalid=false;
  for(const e of names){const id=e.value.trim(),error=!id?'Die ID 不能为空':counts.get(id)>1?'Die ID 不可重复':'';e.setCustomValidity(error);e.setAttribute('aria-invalid',String(Boolean(error)));invalid ||= Boolean(error);}
  $('structure-state').textContent=invalid?'Die ID 不可为空或重复':'修改待应用';updateAssessment();
}
$('stack-interface-inputs').onchange=structureState;
$('structure-rows').oninput=e=>{
  const tr=e.target.closest('tr');if(!tr)return;
  const field=e.target.dataset.field,area=tr.querySelector('[data-field=area]'),width=tr.querySelector('[data-field=width]'),height=tr.querySelector('[data-field=height]');
  const positive=e=>e.value!==''&&Number.isFinite(Number(e.value))&&Number(e.value)>0;
  if(field==='area'&&positive(area)&&positive(width))height.value=String(Number((Number(area.value)/Number(width.value)).toPrecision(12)));
  else if((field==='width'||field==='height')&&positive(width)&&positive(height))area.value=String(Number((Number(width.value)*Number(height.value)).toPrecision(12)));
  structureState();
};
$('structure-rows').onclick=e=>{if(e.target.closest('[data-remove-die]')){e.target.closest('tr').remove();structureState();}};
$('add-die').onclick=()=>{if(!report){notice('请先载入或创建工程。',true);return;}const used=new Set([...$('structure-rows').querySelectorAll('[data-field=id]')].map(e=>e.value.trim()));let i=0;while(used.has('die_'+i))i++;$('structure-rows').insertAdjacentHTML('beforeend',dieRow({id:'die_'+i,kind:'logic',width_um:10000,height_um:10000,thickness_um:100},true));structureState();};
$('reset-structure').onclick=()=>{structureDirty=false;renderStructure();updateAssessment();};
$('apply-structure').onclick=async()=>{
  if(busy||!report)return;if(rawEdited){notice('请先应用 YAML 修改，再编辑 Die 表格。',true);return;}
  try{const rows=[...$('structure-rows').rows].map(tr=>{const v=k=>tr.querySelector(`[data-field="${k}"]`).value;return {id:v('id'),originalId:tr.dataset.originalId||null,kind:v('kind'),face:v('face'),area:Number(v('area')),width:Number(v('width')),height:Number(v('height')),thickness:Number(v('thickness')),power:v('power')===''?null:Number(v('power'))};});const project=updateStructure(report.project,rows,interfaceInputValues());
    // Validate and evaluate before accepting the form so a rejected edit leaves the draft intact.
    setBusy(true);assertStack(project);const result=await api('layout/preview',project);rememberMove();inputEditor.renameDies(new Map(rows.filter(r=>r.originalId).map(r=>[r.originalId,r.id.trim()])),project.architecture.dies);structureDirty=false;dirty=true;draftChanged=true;rawEdited=false;previewFailed=false;previewPending=false;revision++;previewController?.abort();clearTimeout(previewTimer);$('yaml').value=result.yaml;activeCandidate='draft';$('candidate').innerHTML='<option value="draft">结构预览 · 未保存</option>';searchResult=null;show(result.report,true);notice('结构已更新，引用已同步。检查布局后评估保存。');
  }catch(e){notice(e.message,true);}finally{setBusy(false);}
};
$('output-dir').onchange=()=>notice('项目文件夹已设置，首次保存时写入架构、工艺和结果子文件夹。');
function renderDifficulties(){
  const issues=allIssues(),counts={error:0,warning:0,unknown:0};
  for(const issue of issues)counts[issue.severity]=(counts[issue.severity]||0)+1;
  $('difficulty-errors').textContent=fmt(counts.error,0);$('difficulty-warnings').textContent=fmt(counts.warning,0);$('difficulty-unknowns').textContent=fmt(counts.unknown,0);
  document.querySelectorAll('[data-difficulty]').forEach(b=>{b.disabled=!report;b.setAttribute('aria-expanded',String(b.dataset.difficulty===difficultySelection));});
  $('difficulty-panel').hidden=!difficultySelection;
  if(!difficultySelection)return;
  const page=difficultyPage(issues,difficultySelection,difficultyPageIndex);difficultyPageIndex=page.page;
  $('difficulty-title').textContent=SEVERITIES[difficultySelection]+' · '+page.total+' 项';
  $('difficulty-summary').innerHTML=page.items.map(i=>`<article class="difficulty-item"><div class="difficulty-category"><strong>${esc(i.subject)}</strong><code>${esc(i.code)}</code><button data-difficulty-index="${i.index}">定位对象 →</button></div><div class="difficulty-content"><h3>${esc(i.reason)}</h3>${i.suggestion?'<p>建议：'+esc(i.suggestion)+'</p>':''}</div></article>`).join('')||'<p class="difficulty-empty">当前没有'+SEVERITIES[difficultySelection]+'。</p>';
  $('difficulty-pages').hidden=page.pages===1;$('difficulty-page-number').textContent=(page.page+1)+' / '+page.pages;
  $('difficulty-prev').disabled=page.page===0;$('difficulty-next').disabled=page.page===page.pages-1;
  $('difficulty-summary').querySelectorAll('[data-difficulty-index]').forEach(button=>button.onclick=()=>{
    openWorkspace('layout');$('issue-filter').value=difficultySelection;renderIssues();
    $('issues').querySelector(`[data-issue="${button.dataset.difficultyIndex}"]`)?.click();
    $('focused-issue').scrollIntoView({block:'nearest'});
  });
}
document.querySelectorAll('[data-difficulty]').forEach(button=>button.onclick=()=>{
  difficultySelection=difficultySelection===button.dataset.difficulty?null:button.dataset.difficulty;difficultyPageIndex=0;renderDifficulties();
});
$('close-difficulties').onclick=()=>{difficultySelection=null;renderDifficulties();};
$('difficulty-prev').onclick=()=>{difficultyPageIndex--;renderDifficulties();$('difficulty-title').scrollIntoView({block:'start'});};
$('difficulty-next').onclick=()=>{difficultyPageIndex++;renderDifficulties();$('difficulty-title').scrollIntoView({block:'start'});};

$('web-new-project').onclick=async()=>{if(busy||toggleProjectCreation('new')||!await canLeaveDraft())return;setBusy(true);try{const data=await api('starter');newProject('新架构工程','new');$('yaml').value=data.yaml;dirty=true;draftChanged=true;show(data.report,true);$('editor-panel').hidden=true;notice('新项目已准备好，请填写名称，再选择架构和工艺库的输入方式。');}catch(e){notice(e.message,true);}finally{setBusy(false);}};

document.addEventListener('pointerdown',event=>{if(!$('display-settings').contains(event.target))$('display-settings').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('display-settings').open=false;});
