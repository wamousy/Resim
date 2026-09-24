import {OutputFolders} from './output-folders.js?v=1';
import {InputEditor} from './input-editor.js?v=8';
import {HistoryComparison} from './multi-comparison.js?v=2';
import {distinctCandidates,layoutDifference} from './layout-variants.js';
import {updateStructure} from './structure-editor.js?v=4';
import {stackModel,faceText,assertStack} from './stack-model.js?v=2';
import {renderInterfaceInputs,interfaceInputValues,renderStackStrip,dieDetails,pairDetails} from './stack-panel.js?v=2';
import {readYaml} from './architecture-io.js?v=2';
import {peerConnections} from './core-view.js?v=19';
import {chipDimensions,coreDetails,corePeers} from './object-details.js?v=2';
import {connectionScope,SCOPE_NAMES,transferBudget} from './connection-view.js?v=19';
import {showRoutingResources} from './routing-resources.js?v=19';
import {number as fmt,area,movePlacement,linkBudget} from './layout-model.js?v=19';
import {Viewer} from './viewer.js?v=24';
import {Connections} from './connections.js?v=20';
import {assessment,candidateFolder,matchingSavedCandidate,runLabel} from './ui-state.js?v=19';
import {showMethods} from './methods.js?v=21';
import {showCalculations} from './calculations.js?v=19';
import {initWorkbench,openWorkspace} from './workbench.js?v=workflow-6';
initWorkbench();
const $=id=>document.getElementById(id),clone=x=>structuredClone(x);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let report,searchResult,baseline,activeStorage,currentProjectId=null,selectedId=null;
let busy=false,dirty=false,draftChanged=false,rawEdited=false,revision=0,previewPending=false,previewFailed=false,previewTimer,editBase=null,undo=[],redo=[];
let storageMode='evaluate',activeCandidate='current',savedCandidate='current',previewController,selectedIssue=null;
let connectionPane;let structureDirty=false;let inputEditor,historyComparison;
function meter(value,limit=1){return value==null||!Number.isFinite(value)?'':`<span class="resource-meter ${value>limit?'danger':value>limit*.85?'warn':''}" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,value*100))}%"></i></span>`;}
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function allIssues(){return report?[...report.issues,...stackModel(report.project).issues]:[];}
function displaySummary(value=report){if(!value)return undefined;const s={...value.summary};for(const i of stackModel(value.project).issues){const key={error:'errors',unknown:'unknowns',warning:'warnings'}[i.severity];s[key]=(s[key]||0)+1;}return s;}
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
async function canLeaveDraft(){
  if(!(draftChanged||rawEdited||structureDirty||inputEditor?.hasPending()))return true;
  const dialog=$('discard-dialog');dialog.showModal();
  return new Promise(resolve=>{
    const finish=value=>{dialog.close();dialog.oncancel=null;resolve(value);};
    $('keep-draft').onclick=()=>finish(false);$('discard-draft').onclick=()=>finish(true);
    dialog.oncancel=event=>{event.preventDefault();finish(false);};
  });
}
async function api(path,body,signal){const response=await fetch('/api/'+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal});if(!response.ok){let message=`请求失败（${response.status}）`;try{const error=await response.json();message=typeof error.detail==='string'?error.detail:JSON.stringify(error.detail);}catch{}throw new Error(message);}return response.json();}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function updateControls(){
  inputEditor?.busy(busy);
  $('search-count').disabled=busy;
  for(const button of $('layout-candidates').querySelectorAll('button'))button.disabled=busy;
  const m=report?.project.architecture.modules.find(m=>m.id===selectedId);
  for(const id of ['web-new-project','apply-structure','add-die','reset-structure','output-dir','browse-output','new-output-folder','load','evaluate','optimize','validate','preview-input','candidate','new-project','load-run','project','history','editor-toggle','input-export','yaml'])$(id).disabled=busy;
  for(const id of ['apply-move','edit-die','edit-x','edit-y'])$(id).disabled=busy||rawEdited||!m||m.fixed;
  $('apply-spacing').disabled=busy||rawEdited||!report;$('edit-spacing').disabled=busy||rawEdited||!report;$('edit-halo').disabled=busy||rawEdited||!m;
  if($('apply-routing'))$('apply-routing').disabled=busy||rawEdited||previewPending;
  $('apply-supply').disabled=busy||rawEdited||previewPending||!report?.ports.length;
  for(const id of ['edit-supply-port','supply-x','supply-y','supply-capacity','supply-feed'])$(id).disabled=busy||rawEdited||previewPending||!report?.ports.length;
  $('edit-mode').disabled=busy||rawEdited||!m||m.fixed;
  $('undo-move').disabled=busy||rawEdited||!undo.length;$('redo-move').disabled=busy||rawEdited||!redo.length;
  $('retry-preview').hidden=!previewFailed;$('retry-preview').disabled=busy;
  $('project-name').disabled=busy||Boolean(currentProjectId);
}
function setBusy(value){busy=value;updateControls();}
function clearResult(){
  inputEditor?.reset();
  structureDirty=false;
  showPort(null);
  showRoutingResources(null);
  revision++;previewController?.abort();clearTimeout(previewTimer);previewPending=false;previewFailed=false;dirty=false;draftChanged=false;rawEdited=false;undo=[];redo=[];editBase=null;report=null;renderStackStrip(null);searchResult=null;baseline=null;activeStorage=null;selectedId=null;selectedIssue=null;activeCandidate=savedCandidate='current';
  $('result-files').hidden=true;$('nav-links').textContent='—';showMethods(null);for(const id of ['ledger','issues','live-metrics','difficulty-summary'])$(id).innerHTML='';
  for(const id of ['s-dies','s-modules','s-power','s-tsv','s-congestion','s-errors','s-status','plan-id','difficulty-errors','difficulty-warnings','difficulty-unknowns'])$(id).textContent='—';
  $('supply-rows').innerHTML='';$('calculation-detail').innerHTML='';$('calculation-die').innerHTML='';$('issue-filter').value='all';$('edit-x').value='';$('edit-y').value='';$('candidate').innerHTML='<option value="current">当前输入</option>';$('edit-mode').checked=false;
  $('edit-die').innerHTML='';$('undo-move').disabled=true;connectionPane?.clear();if(viewer){viewer.selectedLink=null;viewer.selectedModule=null;}inspect(null);viewer?.clear();updateAssessment();updateFiles();
}
async function refreshProjects(id=currentProjectId){const items=await api('projects');$('project').innerHTML='<option value="">新项目（尚未保存）</option>'+items.map(p=>`<option value="${esc(p.id)}" title="${esc(p.id)}">${esc(p.name)}</option>`).join('');$('project').value=id||'';historyComparison?.refresh(items,id).catch(e=>notice(e.message,true));return items;}
async function refreshHistory(runId){if(!currentProjectId){$('history').innerHTML='<option value="">暂无运行</option>';return [];}const runs=await api(`projects/${currentProjectId}/runs`);$('history').innerHTML='<option value="">选择运行记录</option>'+runs.map(r=>`<option value="${esc(r.run_id)}" title="${esc(r.run_id)}">${esc(runLabel(r))}</option>`).join('');if(runId)$('history').value=runId;return runs;}
function currentFolder(){return candidateFolder(activeStorage,storageMode,dirty?savedCandidate:activeCandidate);}
function resultUrl(format){return `/api/projects/${activeStorage.project_id}/runs/${activeStorage.run_id}/export/${format}?candidate=${encodeURIComponent($('candidate').value)}`;}
function updateFiles(){
  const saved=Boolean(activeStorage);$('result-files').hidden=!saved&&!dirty&&!rawEdited;$('reports-empty').hidden=saved||dirty||rawEdited;$('unsaved-dot').hidden=!dirty&&!rawEdited;
  $('result-state').textContent=rawEdited?'输入已修改 · 图中仍是上次布局':dirty?'未保存预览 · 请保存评估结果':report?'正在查看已保存结果':'已保存搜索记录 · 没有可展示的布局';
  $('result-location').textContent=saved?currentFolder():'尚未保存到工程';
  $('result-note').textContent=dirty||rawEdited?'路径指向上次结果。点击“保存评估结果”保存当前输入及新报告。':'implementation-difficulties.md 为实现难点清单，report.html 为完整报告，layout-plan.yml 为规划方案；output-manifest.json 说明文件及单位。';
  if(saved)$('storage-path').textContent=activeStorage.run_dir;
  for(const id of ['result-json','result-yaml','export-json','export-yaml'])$(id).disabled=!report||!saved||dirty||rawEdited||previewPending||previewFailed;
  $('open-results').disabled=!saved;$('copy-results').disabled=!saved;$('html-report').hidden=!report||!saved||dirty||rawEdited;
  if(report&&saved&&!dirty&&!rawEdited)$('html-report').href=resultUrl('report.html');
  $('active-context').textContent=`当前工程：${$('project-name').value||'新工程'} · ${rawEdited?'输入待应用':dirty?'未保存预览':report?'已保存方案':'等待评估'}`;
  showMethods(report,searchResult);renderCandidates();updateControls();updateAssessment();
}
function renderCandidates(){
  const host=$('layout-candidates');host.hidden=!searchResult;
  if(!searchResult){host.replaceChildren();return;}
  const candidates=distinctCandidates(searchResult),requested=searchResult.baseline?.project.search?.candidates||candidates[0]?.report.project.search?.candidates;
  const plans=candidates.map(c=>({...c,key:c.id,summary:displaySummary(c.report)}));
  const difference=(p,i)=>{if(plans.length<2)return '';const other=plans[i===0?1:0],d=layoutDifference(other.report,p.report);return `<small class="candidate-difference">与${other.name}相比：${d.changed} 个模块不同${d.migrated?' · '+d.migrated+' 个跨层迁移':''}${d.moved?' · '+d.moved+' 个位置变化':''}</small>`;};
  host.innerHTML=`<div class="candidate-list-head"><b>布局方案</b><span>${candidates.length} 个不同候选${requested?' / 目标 '+requested+' 个':''} · 已保存</span></div><div class="candidate-list">${plans.map((p,i)=>`<button data-plan="${p.key}" aria-pressed="${activeCandidate===p.key}" class="candidate-card"><b>${p.name}</b><span>${fmt(p.summary.errors,0)} 项违例 · ${fmt(p.summary.unknowns,0)} 项缺失</span><small>加权线长 ${fmt(p.report.summary.weighted_wirelength_um,0)} wire·µm</small><small>峰值拥塞 ${fmt(p.report.summary.peak_congestion,3)}</small>${difference(p,i)}</button>`).join('')}</div><p class="compact-note">按模块归属、位置和尺寸检查差异。${candidates.length<(requested||0)?'当前约束或时限下未找到足够的不同方案，不以重复布局补足。':''}选择方案查看评估；搜索结果不代表全局最优。</p>`;
  for(const b of host.querySelectorAll('[data-plan]'))b.onclick=()=>selectCandidate(b.dataset.plan);
}
function renderResult(result,mode){
  activeStorage=result.storage||null;storageMode=mode;
  if(mode==='optimize'){
    searchResult=result;baseline=result.baseline;$('candidate').innerHTML=(baseline?'<option value="base">原始布局</option>':'')+distinctCandidates(result).map(c=>`<option value="${c.id}">${c.name} · ${c.report.candidate.accepted?'通过当前模型约束':'需修改 / 数据不全'}</option>`).join('');
    if(result.candidates.length){activeCandidate=savedCandidate='0';$('candidate').value='0';show(result.candidates[0],true);}else if(baseline){activeCandidate=savedCandidate='base';$('candidate').value='base';show(baseline,true);}
  }else{searchResult=null;baseline=result;activeCandidate=savedCandidate='current';$('candidate').innerHTML='<option value="current">给定布局</option>';show(result,true);}updateFiles();
}
async function loadHistory(runId){
  const payload=await api(`projects/${currentProjectId}/runs/${runId}/result`),response=await fetch(`/api/projects/${currentProjectId}/runs/${runId}/input`);if(!response.ok)throw new Error('读取历史输入失败');
  clearResult();$('yaml').value=await response.text();renderResult(payload.result,payload.mode);if(report)await syncYaml();$('history').value=runId;notice('正在查看历史结果，数值保留当时的计算版本。评估将使用当前版本生成新记录。');
}
async function loadProject(id){
  structureDirty=false;$('output-dir').value=localStorage.getItem('resim-output-'+id)||'';
  if(!id){newProject();return;}setBusy(true);
  try{const response=await fetch(`/api/projects/${id}/input`);if(!response.ok)throw new Error('项目输入读取失败');const input=await response.text();currentProjectId=id;localStorage.setItem('resim-project',id);
    const items=await refreshProjects(id);$('project-name').value=items.find(p=>p.id===id)?.name||id;$('project-name').disabled=true;clearResult();$('yaml').value=input;
    const runs=await refreshHistory(),latest=runs.find(r=>r.status==='completed');
    const working=await api('preview',{yaml:input});
    if(latest){
      const payload=await api(`projects/${id}/runs/${latest.run_id}/result`),match=matchingSavedCandidate(payload.result,payload.mode,working.report);
      if(match!==null){renderResult(payload.result,payload.mode);activeCandidate=savedCandidate=match;$('candidate').value=match;show(working.report,true);$('history').value=latest.run_id;notice('已载入工程当前输入，对应已保存方案。');}
      else{dirty=true;activeCandidate='draft';$('candidate').innerHTML='<option value="draft">当前工程输入 · 未保存预览</option>';show(working.report,true);notice('已按当前工程输入重新预览。当前输入或计算版本与最近报告不同，点击“保存评估结果”生成新记录；历史报告可单独查看。');}
    }else{dirty=true;activeCandidate='draft';$('candidate').innerHTML='<option value="draft">当前工程输入 · 未保存预览</option>';show(working.report,true);notice('已预览当前输入，点击“保存评估结果”创建运行记录。');}
    $('yaml').value=working.yaml;$('storage-path').textContent=activeStorage?.run_dir||`ResimProjects/${id}/inputs/architecture.yml`;setView(report.dies.length===1?'2d':'3d');
  }catch(e){openWorkspace('inputs');$('architecture-input-step').open=true;$('editor-panel').hidden=false;$('editor-toggle').setAttribute('aria-expanded','true');notice('当前输入尚不能展示：'+e.message+'。可在输入编辑器中修改；没有完整布局时可运行自动规划。',true);}finally{setBusy(false);}
}
function newProject(name=''){ openWorkspace('inputs');structureDirty=false;$('structure-rows').replaceChildren();$('output-dir').value=''; $('project-options-panel').hidden=true;$('project-options').setAttribute('aria-expanded','false');$('editor-panel').hidden=true;$('editor-toggle').setAttribute('aria-expanded','false');$('architecture-input-step').open=false;$('technology-input-step').open=false;inputEditor.setMode(null);inputEditor.setTechnologyMode(null);currentProjectId=null;clearResult();$('project').value='';$('project-name').disabled=false;$('project-name').value=name;$('history').innerHTML='<option value="">暂无运行</option>';$('storage-path').textContent='新工程将保存到 ResimProjects/<工程ID>/runs/<运行ID>/';notice('填写项目名称，再选择架构和工艺库的输入方式。');}
async function syncYaml(){if(report&&!rawEdited){const token=revision,project=clone(report.project);project.name=$('project-name').value||project.name;const response=await fetch('/api/yaml',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({yaml:JSON.stringify(project)})});if(!response.ok)throw new Error('当前布局输入校验失败');const text=await response.text();if(token===revision&&!rawEdited)$('yaml').value=text;}}
async function execute(mode){
  if(busy)return;if(inputEditor?.hasPending()){notice('输入区仍有未应用修改，请先应用预览或撤销。',true);openWorkspace('inputs');return;}if(structureDirty){notice('Die 表格有未应用修改，请先应用结构并预览。',true);return;}if(previewPending){notice('正在重算布局，请稍候；也可继续调整位置。');return;}if(previewFailed&&!rawEdited){notice('预览计算失败，请重试或撤销后再保存。',true);return;}setBusy(true);notice(mode==='optimize'?'正在搜索分区与布局，时间上限由输入配置决定…':mode==='validate'?'正在校验输入…':'正在计算并保存当前布局…');
  try{await syncYaml();const project=readYaml($('yaml').value);assertStack(project);let yaml=$('yaml').value;if(mode==='optimize'){const count=Number($('search-count').value);if(!Number.isInteger(count)||count<2||count>10)throw new Error('候选数量须为 2–10 的整数');project.search={...project.search,candidates:count};yaml=JSON.stringify(project);}const result=await api(mode,{yaml,project_id:currentProjectId,project_name:$('project-name').value||null,output_dir:$('output-dir').value.trim()||null});
    if(mode==='validate'){notice(`输入有效：${result.dies} 个 die，${result.modules} 个模块。`);return;}
    currentProjectId=result.storage.project_id;localStorage.setItem('resim-project',currentProjectId);localStorage.setItem('resim-output-'+currentProjectId,$('output-dir').value.trim());$('project-name').value=result.storage.project_name;$('project-name').disabled=true;clearResult();renderResult(result,mode);await refreshProjects();await refreshHistory(result.storage.run_id);
    notice(mode==='optimize'?`已保存 ${distinctCandidates(result).length} 个不同候选。${result.message||''}`:`评估已保存：${result.summary.errors} 项违例，${result.summary.unknowns} 项数据缺失。报告和结果目录见“结果管理”。`);
  }catch(e){notice(e.message,true);}finally{setBusy(false);}
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
  $('ledger').innerHTML=report.dies.map(d=>{const via=report.interfaces.find(v=>v.lower_die===d.id);return `<tr><td><b>${esc(d.id)}</b><small>${esc(d.kind)}</small><button class="calc-link" data-calc="${esc(d.id)}">怎么算的？</button></td><td>${area(d.area_mm2)}<small class="dimension">${fmt(d.width_um)} × ${fmt(d.height_um)} µm<br>${fmt(d.area_mm2*1e6)} µm²</small></td><td>${d.footprint_utilization==null?'未知':fmt(d.footprint_utilization*100,2)+'%'}${meter(d.footprint_utilization,d.max_utilization)}<small class="dimension">模块面积 ${area(d.module_area_mm2)} mm²</small></td><td>${area(d.reserved_area_mm2)}</td><td>${fmt(d.power_W)} / ${fmt(d.power_margin_W)}</td><td>${fmt(d.peak_congestion,4)}${meter(d.peak_congestion)}</td><td>${via?`${fmt(via.total_vias,0)} / ${fmt(via.capacity,0)}<small>信号 ${via.signal_vias} · 电源 ${fmt(via.power_vias,0)} · 地 ${fmt(via.ground_vias,0)}</small>`:'顶部'}</td><td>${fmt(d.wire_area?.metal_area_um2,5)} / ${fmt(d.wire_area?.track_area_um2,5)}</td></tr>`;}).join('');
  $('ledger').querySelectorAll('[data-calc]').forEach(button=>button.onclick=()=>{$('calculation-die').value=button.dataset.calc;showCalculations(report,previewPending||previewFailed||rawEdited);openWorkspace('resources');$('calculation-panel').scrollIntoView({behavior:'smooth',block:'start'});});
  $('supply-rows').innerHTML=report.supply.map(s=>`<tr><td>${esc(s.die)} / ${esc(s.domain)}</td><td>${fmt(s.local_current_A,4)}</td><td>${fmt(s.injection_current_A,4)}</td><td>${fmt(s.capacity_A,4)}</td><td class="${s.margin_A<0?'negative':''}">${fmt(s.margin_A,4)}</td></tr>`).join('');
  const previousPort=$('edit-supply-port').value;
  $('edit-supply-port').innerHTML=report.ports.map(p=>`<option value="${esc(p.id)}">${esc(p.die)} / ${esc(p.core||p.id)}</option>`).join('');
  if(report.ports.some(p=>p.id===previousPort))$('edit-supply-port').value=previousPort;
  fillSupplyEditor();
  const owned=report.supply_groups||[];
  $('supply-port-details').innerHTML='<table><thead><tr><th>端口 / 核</th><th>Die / 电压域</th><th>位置 µm</th><th>接入方式</th><th>电压 V / 能力 A</th><th>本核需求 / 余量 A</th></tr></thead><tbody>'+report.ports.map(p=>{const g=owned.find(g=>g.ports.includes(p.id));return `<tr><td>${esc(p.id)}<small>${esc(p.core||'共享入口')}</small></td><td>${esc(p.die)} / ${esc(p.domain)}</td><td>${fmt(p.x_um)}, ${fmt(p.y_um)}</td><td>${p.feed==='stack_base'?'从底层经 TSV 接入':'外部供电入口'}</td><td>${fmt(p.voltage_V)} / ${fmt(p.max_current_A)}</td><td>${fmt(g?.demand_A)} / ${fmt(g?.margin_A)}<small>${esc(p.provenance||'未填写入口依据')}</small></td></tr>`;}).join('')+'</tbody></table>';
  const timing=report.timing;
  $('timing-summary').innerHTML='<h2>数据通路延迟估算</h2>'+(timing?.model?`<p>${timing.model.calibrated?'输入标记为已校准':'未校准 · 仅用于方案比较'}：${esc(timing.model.provenance)}</p><p>平面 ${fmt(timing.model.planar_ps_per_um,5)} ps/µm + 跨层 ${fmt(timing.model.tier_ps)} ps/接口；加权总延迟 ${fmt(timing.weighted_delay_ps)} ps，最长单连接 ${fmt(timing.max_link_delay_ps)} ps。</p><p>${esc(timing.scope)} 加权总和不是模型执行时间。</p>`:'<p>未提供延迟系数，不把线长或带宽当作真实传输时间。</p>');

  connectionPane?.update(report,previewPending||previewFailed);inspect(report.modules.find(m=>m.id===selectedId)||null,false);updateLive();viewer?.draw(report,previewPending||previewFailed);if(fit)viewer?.reset();updateFiles();
}
function updateLive(){
  if(!report)return;const s=report.summary,b=editBase,metrics=[['互联金属面积',s.wiring_metal_area_um2,b?.wiring_metal_area_um2,'µm²'],['加权线长',s.weighted_wirelength_um,b?.weighted_wirelength_um,'wire·µm'],['峰值拥塞',s.peak_congestion,b?.peak_congestion,''],['信号 TSV',s.signal_via_segments,b?.signal_via_segments,''],['全部 TSV',s.total_via_segments,b?.total_via_segments,''],['总功耗',s.power_W,b?.power_W,'W']];
  $('live-metrics').innerHTML=metrics.map(([label,v,old,unit])=>`<span>${label} <b>${previewPending?'重算中…':fmt(v,4)+(v==null?'':' '+unit)}</b>${!previewPending&&b&&old!=null&&v!=null?`<small>相对编辑前 ${v-old>0?'+':''}${fmt(v-old,4)}</small>`:''}</span>`).join('');
  $('preview-changes').hidden=!dirty;
  $('draft-status').textContent=rawEdited?'输入待应用':previewFailed?'预览失败，可重试或撤销':previewPending?'移动后重算中':dirty?'未保存预览 · 保存评估结果为新版本':'已评估布局';updateControls();
  // Never present a stale evaluated metric as the value of a moving layout.
  const stale=previewPending||previewFailed||rawEdited;
  showRoutingResources(report,stale,id=>{connectionPane.select(id);openWorkspace('connections');});
  showCalculations(report,stale);connectionPane?.update(report,stale);
  for(const id of ['ledger','issues','supply-rows'])$(id).classList.toggle('pending',stale);
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
$('load').onclick=async()=>{if(await canLeaveDraft())loadProject($('project').value);};$('new-project').onclick=async()=>{if(inputEditor?.hasPending()||structureDirty||rawEdited){notice('请先应用输入修改，再复制工程。',true);return;}try{const original=report?clone(report):null,name=$('project-name').value+' / 副本';await syncYaml();newProject(name);if(original){original.project.name=name;dirty=true;draftChanged=true;show(original,true);inputEditor.setMode('custom');$('editor-panel').hidden=true;await syncYaml();}else rawEdited=true;updateFiles();}catch(e){notice(e.message,true);}};
$('load-run').onclick=async()=>{if(busy||!currentProjectId||!$('history').value||!await canLeaveDraft())return;setBusy(true);try{await loadHistory($('history').value);}catch(e){notice(e.message,true);}finally{setBusy(false);}};
$('editor-toggle').onclick=async()=>{openWorkspace('inputs');$('architecture-input-step').open=true;$('editor-panel').hidden=!$('editor-panel').hidden;$('editor-toggle').setAttribute('aria-expanded',String(!$('editor-panel').hidden));if(!$('editor-panel').hidden)try{await syncYaml();}catch(e){notice(e.message,true);}};
$('yaml').oninput=()=>{rawEdited=true;revision++;previewController?.abort();clearTimeout(previewTimer);previewPending=false;previewFailed=false;$('edit-mode').checked=false;updateFiles();updateLive();notice('输入已修改。点击“应用输入并预览”查看效果，或保存评估结果；当前画面仍为上次结果。');};
$('preview-input').onclick=async()=>{
  if(inputEditor?.hasPending()||structureDirty){notice('请先应用或撤销网页表单修改，再应用完整输入。',true);return;}if(busy)return;setBusy(true);revision++;previewController?.abort();clearTimeout(previewTimer);
  try{assertStack(readYaml($('yaml').value));const response=await api('preview',{yaml:$('yaml').value});if(!editBase&&report)editBase=clone(report.summary);rawEdited=false;dirty=true;draftChanged=true;previewPending=false;previewFailed=false;undo=[];redo=[];activeCandidate='draft';$('candidate').innerHTML='<option value="draft">输入预览 · 未保存</option>';searchResult=null;$('yaml').value=response.yaml;show(response.report,true);notice('输入已应用并预览，尚未写入工程。确认布局后保存评估结果。');}
  catch(e){notice('输入预览失败：'+e.message,true);}finally{setBusy(false);}
};
for(const mode of ['validate','evaluate','optimize'])$(mode).onclick=()=>execute(mode);
async function selectCandidate(next){
  if(busy||!searchResult||next==='draft')return;
  $('candidate').value=activeCandidate;if(!await canLeaveDraft())return;$('candidate').value=next;
  revision++;previewController?.abort();clearTimeout(previewTimer);dirty=false;draftChanged=false;rawEdited=false;previewPending=false;previewFailed=false;undo=[];redo=[];editBase=null;activeCandidate=savedCandidate=next;
  $('candidate').querySelector('[value="draft"]')?.remove();structureDirty=false;inputEditor.reset();show(next==='base'?baseline:searchResult.candidates[Number(next)],true);try{await syncYaml();}catch(e){notice(e.message,true);}
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
function exportResult(format){if(!report||!activeStorage||dirty||rawEdited||previewPending||previewFailed)return;const a=document.createElement('a');a.href=resultUrl(format);a.download='';a.click();}
$('export-json').onclick=$('result-json').onclick=()=>exportResult('report.json');$('export-yaml').onclick=$('result-yaml').onclick=()=>exportResult('layout.yml');
$('open-results').onclick=async()=>{try{await api(`projects/${activeStorage.project_id}/runs/${activeStorage.run_id}/open-folder?candidate=${encodeURIComponent(dirty?savedCandidate:activeCandidate)}`,{});}catch(e){notice(e.message,true);}};
$('copy-results').onclick=async()=>{try{await navigator.clipboard.writeText(currentFolder());notice('当前方案的结果路径已复制。');}catch{notice('复制受浏览器限制，请选择并复制上方路径。');}};
window.addEventListener('beforeunload',event=>{if(draftChanged||rawEdited||structureDirty||inputEditor?.hasPending()){event.preventDefault();event.returnValue='';}});
new OutputFolders({notice});
inputEditor=new InputEditor({notice,download,onDirty:()=>{updateAssessment();},apply:applyInputProject});
historyComparison=new HistoryComparison({api,download});
async function applyInputProject(project,{asNew=false,accepted}={}){
  if(busy||previewPending)throw new Error('正在计算，请稍后应用输入');
  if(structureDirty||rawEdited)throw new Error('请先应用或撤销 Die 表格 / 完整 YAML 修改');
  setBusy(true);notice('正在校验输入并计算预览…');
  try{
    assertStack(project);const result=await api('layout/preview',project);
    if(asNew&&draftChanged&&!await canLeaveDraft())return;
    accepted?.();
    if(asNew)newProject(project.name);else if(report)rememberMove();
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
$('output-dir').onchange=()=>{localStorage.setItem('resim-output-'+(currentProjectId||'new'),$('output-dir').value.trim());notice('结果保存位置已设置，下次评估或寻优时生效；旧结果保持原位置。');};
function renderDifficulties(){
  const groups=new Map(),counts={error:0,warning:0,unknown:0};
  for(const [index,i] of allIssues().entries()){
    const key=i.severity+'|'+i.code;counts[i.severity]=(counts[i.severity]||0)+1;
    if(!groups.has(key))groups.set(key,{...i,count:0,index,subjects:new Set()});
    const group=groups.get(key);group.count++;group.subjects.add(i.subject);
  }
  $('difficulty-errors').textContent=fmt(counts.error,0);$('difficulty-warnings').textContent=fmt(counts.warning,0);$('difficulty-unknowns').textContent=fmt(counts.unknown,0);
  $('difficulty-summary').innerHTML=[...groups.values()].sort((a,b)=>({error:0,warning:1,unknown:2}[a.severity]-{error:0,warning:1,unknown:2}[b.severity])).map(i=>`<article><div class="difficulty-category"><span class="severity-tag ${esc(i.severity)}">${esc({error:'实现性违例',warning:'风险与提示',unknown:'待补数据'}[i.severity])}</span><strong>${fmt(i.count,0)} 项 · ${i.subjects.size} 个对象</strong><code>${esc(i.code)}</code></div><div class="difficulty-content"><h3>${esc(i.reason)}</h3><p>建议：${esc(i.suggestion)}</p><small>涉及 ${[...i.subjects].slice(0,3).map(esc).join('、')}${i.subjects.size>3?' 等对象':''}</small><button data-difficulty-index="${i.index}" data-severity="${esc(i.severity)}">在布局中查看首项 →</button></div></article>`).join('')||'<p class="hint">在当前模型范围内未发现问题；不等于后端签核通过。</p>';
  $('difficulty-summary').querySelectorAll('[data-difficulty-index]').forEach(button=>button.onclick=()=>{
    openWorkspace('layout');$('issue-filter').value=button.dataset.severity;renderIssues();
    $('issues').querySelector(`[data-issue="${button.dataset.difficultyIndex}"]`)?.click();
    $('focused-issue').scrollIntoView({block:'nearest'});
  });
}

$('web-new-project').onclick=async()=>{if(busy||!await canLeaveDraft())return;setBusy(true);try{const data=await api('starter');newProject('新架构工程');$('yaml').value=data.yaml;dirty=true;draftChanged=true;show(data.report,true);$('editor-panel').hidden=true;notice('新项目已准备好，请填写名称，再选择架构和工艺库的输入方式。');}catch(e){notice(e.message,true);}finally{setBusy(false);}};

document.addEventListener('pointerdown',event=>{if(!$('display-settings').contains(event.target))$('display-settings').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('display-settings').open=false;});
