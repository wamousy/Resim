import {TechnologyForm} from './technology-form.js?v=1';
import {mergeInputFiles,splitInputFiles,readYaml,writeYaml,technologyDocument,updateModule,removeModule,updateLink} from './architecture-io.js?v=2';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(prefix,key,title,type='number')=>`<label>${title}<input id="${prefix}-${key}" aria-label="${title}" type="${type}" ${type==='number'?'min="0" step="any"':''}></label>`;
const select=(prefix,key,title)=>`<label>${title}<select id="${prefix}-${key}" aria-label="${title}"></select></label>`;
const option=(value,label=value)=>`<option value="${esc(value)}">${esc(label)}</option>`;
const fileField=(kind,label)=>`<label class="file-field"><input id="${kind}-file" type="file" accept=".yml,.yaml" aria-label="选择${label}"><span class="file-field-copy"><b>${label}</b><span id="${kind}-file-name" class="selected-file-name" aria-live="polite">选择 YAML 文件</span></span><span class="file-field-action" aria-hidden="true">选择文件</span></label>`;

export class InputEditor{
  constructor({apply,notice,download,onDirty}){
    Object.assign(this,{apply,notice,download,onDirty,project:null,moduleId:null,linkId:null});
    this.pending=new Set();
    $('input-workflow').innerHTML=`<span id="input-pending" role="status"></span><details class="panel input-step" id="architecture-input-step"><summary class="input-step-head"><span class="step-number">02</span><div><h2>芯片架构与布局约束</h2><small id="architecture-input-summary">Die、模块与连接</small></div></summary><div class="input-step-body"><div class="input-mode-bar"><div role="group" aria-label="架构输入方式"><button id="input-mode-import" aria-pressed="false">导入 YAML</button><button id="input-mode-custom" aria-pressed="false">自定义</button></div></div>
    <section id="import-input-pane" class="panel input-card" hidden>${fileField('chip','芯片架构文件')}<details class="yaml-source"><summary>查看或编辑 YAML</summary><label class="yaml-label">芯片架构<textarea id="chip-yaml" spellcheck="false" aria-label="芯片架构 YAML"></textarea></label></details><div class="input-actions"><button id="apply-import" class="primary">校验并应用</button><button id="reset-import" class="text-button">撤销修改</button></div></section>
    <div id="custom-input-pane" hidden><div id="die-editor-slot"></div><details class="panel input-card" id="module-input"><summary><b>模块定义与资源需求</b><span>大小、类型、归属与功耗</span></summary><div class="form-selector">${select('module','select','选择要编辑的模块')}<button id="new-module">新增模块</button><span id="module-count"></span></div><div class="input-form-grid" id="module-form">
    <fieldset class="input-field-group"><legend>基本信息</legend>${field('module','id','模块 ID','text')}${field('module','core','Core ID','text')}${field('module','kind','模块类型','text')}${select('module','die','所属 Die')}</fieldset>
    <fieldset class="input-field-group"><legend>尺寸与位置</legend>${field('module','width','宽度 / µm')}${field('module','height','高度 / µm')}${field('module','x','X / µm')}${field('module','y','Y / µm')}${field('module','allowed','可分配 Die（逗号分隔）','text')}<label class="check"><input id="module-fixed" type="checkbox">固定位置</label></fieldset>
    <fieldset class="input-field-group"><legend>资源需求</legend>${field('module','power','功耗 / W')}${field('module','stdcell','标准单元面积 / µm²')}${field('module','macro','硬宏面积 / µm²')}${field('module','utilization','目标利用率（0–1）')}</fieldset>
    <details class="input-field-group optional-fields"><summary>性能参数与数据依据</summary><div class="optional-fields-grid">${field('module','compute','算力 / TOPS')}${field('module','bandwidth','带宽 / GB/s')}${field('module','capacity','容量 / KiB')}${field('module','frequency','频率 / MHz')}${field('module','bitwidth','位宽 / bit')}${field('module','precision','计算精度','text')}${field('module','provenance','资源数据依据','text')}</div></details></div><p class="hint">面积、功耗留空表示未知。</p><div class="input-actions"><button id="apply-module" class="primary">校验并应用</button><button id="reset-module" class="text-button">撤销修改</button><button id="remove-module" class="danger-button">删除模块</button></div></details>
    <details class="panel input-card" id="link-input"><summary><b>模块连接与传输需求</b><span>发送 → 接收；双向用两条连接</span></summary><div class="form-selector">${select('link','select','选择要编辑的连接')}<button id="new-link">新增连接</button></div><div class="input-form-grid" id="link-form">${field('link','id','连接 ID','text')}${select('link','source','发送模块')}${select('link','target','接收模块')}${field('link','sourcePort','发送端口','text')}${field('link','targetPort','接收端口','text')}${field('link','width','逻辑位宽 / bit')}${field('link','bandwidth','传输带宽需求 / GB/s')}${field('link','rate','每线速率 / Gbit/s')}${field('link','wires','物理数据线数（空白自动推算）')}${field('link','control','控制线数')}${field('link','spare','冗余比例（0–1）')}</div><div class="input-actions"><button id="apply-link" class="primary">校验并应用</button><button id="reset-link">撤销修改</button><button id="remove-link">删除连接</button></div></details></div>
    <div id="constraint-editor-slot"></div><div class="input-file-actions"><button id="export-chip" class="text-button">导出架构 YAML</button></div></div></details>
    <details class="panel input-step" id="technology-input-step"><summary class="input-step-head"><span class="step-number">03</span><div><h2>工艺库与连线资源</h2><small id="technology-input-summary">金属层、TSV 与键合参数</small></div></summary><div class="input-step-body"><div class="input-mode-bar"><div role="group" aria-label="工艺库输入方式"><button id="technology-mode-import" aria-pressed="false">导入 YAML</button><button id="technology-mode-custom" aria-pressed="false">自定义</button></div></div><div id="technology-input-body" hidden><div id="technology-summary" class="technology-summary"></div><div id="technology-import-pane" hidden>${fileField('technology','工艺库文件')}<details class="yaml-source"><summary>查看或编辑 YAML</summary><label class="yaml-label">工艺库<textarea id="technology-yaml" spellcheck="false" aria-label="工艺库 YAML"></textarea></label></details></div><div id="technology-custom-pane" hidden></div><div class="input-actions"><button id="apply-technology" class="primary">校验并应用</button><button id="reset-technology" class="text-button">撤销修改</button></div></div><div class="input-file-actions"><button id="export-technology" class="text-button">导出工艺 YAML</button></div></div></details>`;
    $('die-editor-slot').append($('structure-panel'));$('constraint-editor-slot').append($('layout-constraints-input'));
    this.technologyForm=new TechnologyForm($('technology-custom-pane'),()=>this.mark('technology'));
    for(const mode of ['import','custom'])$('technology-mode-'+mode).onclick=()=>this.setTechnologyMode(mode);
    for(const mode of ['import','custom'])$('input-mode-'+mode).onclick=()=>this.setMode(mode);
    for(const [area,host] of [['module','module-form'],['link','link-form'],['chip','chip-yaml'],['technology','technology-yaml']])$(host).addEventListener('input',()=>this.mark(area));
    for(const kind of ['module','link']){
      $(kind+'-select').onchange=()=>{if(this.pending.has(kind)){this.notice('请先应用或撤销当前表单修改，再选择其他'+(kind==='module'?'模块':'连接')+'。',true);$(kind+'-select').value=this[kind+'Id']||'';return;}this[kind+'Id']=$(kind+'-select').value||null;this.fill(kind);};
      $('new-'+kind).onclick=()=>{if(this.pending.has(kind)){this.notice('请先应用或撤销当前表单修改。',true);return;}this[kind+'Id']=null;this.fill(kind);this.mark(kind);$(kind+'-id').focus();};
      $('reset-'+kind).onclick=()=>{this.pending.delete(kind);if(!this[kind+'Id'])this[kind+'Id']=this.project?.architecture[kind==='module'?'modules':'links'][0]?.id||null;this.fill(kind);this.status();};
      $('apply-'+kind).onclick=()=>this.commit(kind,()=>kind==='module'?updateModule(this.requireProject(),this.values('module'),this.moduleId):updateLink(this.requireProject(),this.values('link'),this.linkId));
    }
    $('remove-module').onclick=()=>this.commit('module',()=>{if(!this.moduleId)throw new Error('请先选择已有模块');return removeModule(this.requireProject(),this.moduleId);});
    $('remove-link').onclick=()=>this.commit('link',()=>{if(!this.linkId)throw new Error('请先选择已有连接');const p=structuredClone(this.requireProject());p.architecture.links=p.architecture.links.filter(l=>l.id!==this.linkId);return p;});
    $('chip-file').onchange=event=>this.loadFile(event,'chip');
    $('technology-file').onchange=event=>this.loadFile(event,'technology');
    $('apply-import').onclick=()=>this.commit('import',()=>{const p=mergeInputFiles($('chip-yaml').value,this.technologyText());p.name=$('project-name').value.trim()||p.name;return p;});
    $('apply-technology').onclick=()=>this.commit('technology',()=>({...structuredClone(this.requireProject()),resources:this.technologyResources()}));
    $('reset-import').onclick=()=>{this.pending.delete('chip');$('chip-file-name').textContent='选择 YAML 文件';$('chip-yaml').value=this.project?splitInputFiles(this.project).chip:'';this.status();};
    $('reset-technology').onclick=()=>{this.pending.delete('technology');$('technology-file-name').textContent='选择 YAML 文件';if(this.project){$('technology-yaml').value=splitInputFiles(this.project).technology;this.technologyForm.fill(this.project.resources);}else $('technology-yaml').value='';this.technologySummary();this.status();};
    for(const [id,key] of [['export-chip','chip'],['export-technology','technology']])$(id).onclick=()=>{try{if(this.hasPending())throw new Error('请先应用或撤销未应用的输入修改，再下载文件');const files=splitInputFiles(this.requireProject());this.download(key==='chip'?'chip-architecture.yml':'technology.yml',files[key],'application/yaml');}catch(e){this.notice(e.message,true);}};
    this.setMode(null);this.setTechnologyMode(null);
  }
  setMode(mode){this.mode=mode;$('import-input-pane').hidden=mode!=='import';$('custom-input-pane').hidden=mode!=='custom';$('constraint-editor-slot').hidden=mode!=='custom';for(const m of ['import','custom'])$('input-mode-'+m).setAttribute('aria-pressed',String(m===mode));}
  technologyResources(){return this.technologyMode==='custom'?this.technologyForm.read():technologyDocument(readYaml($('technology-yaml').value));}
  technologyText(){return writeYaml({schema_version:'resim-technology/1',resources:this.technologyResources()});}
  setTechnologyMode(mode){try{
    if(mode===this.technologyMode)return;
    if(mode&&this.technologyMode==='custom')$('technology-yaml').value=this.technologyText();
    if(mode==='custom'&&$('technology-yaml').value.trim())this.technologyForm.fill(technologyDocument(readYaml($('technology-yaml').value)));
    this.technologyMode=mode;$('technology-summary').hidden=mode==='custom';$('technology-input-body').hidden=!mode;$('technology-import-pane').hidden=mode!=='import';$('technology-custom-pane').hidden=mode!=='custom';for(const m of ['import','custom'])$('technology-mode-'+m).setAttribute('aria-pressed',String(m===mode));
  }catch(e){this.notice(e.message,true);}}
  renameDies(renames,dies){
    if(!this.pending.has('module'))return;
    const selected=$('module-die').value;
    $('module-die').innerHTML=dies.map(d=>option(d.id)).join('');$('module-die').value=renames.get(selected)||selected;
    $('module-allowed').value=$('module-allowed').value.split(',').map(id=>renames.get(id.trim())||id.trim()).filter(Boolean).join(', ');
  }
  requireProject(){if(!this.project)throw new Error('请先在“定义项目”中新建或载入项目');return {...this.project,name:$('project-name').value||this.project.name};}
  hasPending(){return this.pending.size>0;}
  mark(kind){this.pending.add(kind);this.status();}
  status(){$('input-pending').textContent=this.hasPending()?'修改待应用':'';$('input-pending').classList.toggle('pending',this.hasPending());this.onDirty?.();}
  reset(){this.pending.clear();this.project=null;this.moduleId=null;this.linkId=null;for(const kind of ['chip','technology']){$(kind+'-file-name').textContent='选择 YAML 文件';$(kind+'-file').value='';}$('architecture-input-summary').textContent='Die、模块与连接';$('technology-input-summary').textContent='金属层、TSV 与键合参数';$('chip-yaml').value='';$('technology-yaml').value='';$('technology-summary').replaceChildren();this.status();}
  busy(value){for(const e of $('input-workflow').querySelectorAll('input,select,textarea,button'))e.disabled=value||e.dataset.unavailable==='true';}
  async loadFile(event,kind){const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>4_000_000)throw new Error('文件超过 4 MB');const text=await file.text(),doc=readYaml(text);if(kind==='chip'){
      if(!doc.architecture||!doc.name)throw new Error('请选择芯片架构文件，工艺库请在下方导入');
      if(doc.resources){const files=splitInputFiles({...doc,schema_version:'resim/0.1'});$('chip-yaml').value=files.chip;$('technology-yaml').value=files.technology;$('technology-file-name').textContent=file.name+'（内含工艺参数）';this.technologyForm.fill(doc.resources);this.mark('technology');}else $('chip-yaml').value=text;
    }else{const resources=technologyDocument(doc);$('technology-yaml').value=text;this.technologyForm.fill(resources);}
    $(kind+'-file-name').textContent=file.name;this.mark(kind);this.notice('已读取 '+file.name+'，应用后生效。');if(kind==='technology')this.technologySummary(true);
  }catch(e){this.notice(e.message,true);}}
  async commit(kind,build,asNew=false){try{
    const allowed=kind==='import'?['chip','technology']:[kind];
    if((asNew||kind==='import'||this.pending.has('chip'))&&[...this.pending].some(p=>!allowed.includes(p)))throw new Error('其他输入表单仍有未应用修改，请先应用或撤销，避免互相覆盖');
    const p=build();await this.apply(p,{asNew,accepted:()=>{for(const key of allowed)this.pending.delete(key);if(kind==='module')this.moduleId=$('module-id').value;if(kind==='link')this.linkId=$('link-id').value;this.status();}});
  }catch(e){this.notice(e.message,true);}}
  update(project){this.project=project;const files=splitInputFiles(project);
    $('architecture-input-summary').textContent=`${project.architecture.dies.length} 层 Die · ${project.architecture.modules.length} 个模块 · ${project.architecture.links?.length||0} 条连接`;
    $('technology-input-summary').textContent=`${project.resources.technology||'未定义工艺'} · ${project.resources.metals?.length||0} 个金属层`;
    if(!this.pending.has('chip'))$('chip-yaml').value=files.chip;
    if(!this.pending.has('technology')){$('technology-yaml').value=files.technology;this.technologyForm.fill(project.resources);this.technologySummary();}
    for(const kind of ['module','link'])if(!this.pending.has(kind)){
      const list=project.architecture[kind==='module'?'modules':'links'];if(!list.some(m=>m.id===this[kind+'Id']))this[kind+'Id']=list[0]?.id||null;this.fill(kind);
    }
    this.status();
  }
  values(kind){const result={};for(const e of $(kind+'-form').querySelectorAll('input,select'))result[e.id.slice(kind.length+1)]=e.type==='checkbox'?e.checked:e.value;return result;}
  fill(kind){if(!this.project)return;const a=this.project.architecture,list=a[kind==='module'?'modules':'links'],id=this[kind+'Id'],item=list.find(m=>m.id===id);
    $(kind+'-select').innerHTML=option('','新建 / 未选择')+list.map(m=>option(m.id)).join('');$(kind+'-select').value=id||'';
    let v;
    if(kind==='module'){
      const p=this.project.floorplan.placements.find(p=>p.module===id),m=item,metrics=m?.metrics||{};
      $('module-die').innerHTML=a.dies.map(d=>option(d.id)).join('');$('module-count').textContent=`${a.cores.length} 个 core · ${a.modules.length} 个模块`;
      v={id:m?.id||'',core:m?.core||a.cores[0]?.id||'core0',kind:m?.kind||'logic',die:p?.die||m?.allowed_dies[0]||a.dies[0]?.id,allowed:m?.allowed_dies.join(', ')||'',width:p?.width_um??m?.width_um??1000,height:p?.height_um??m?.height_um??1000,x:p?.x_um??0,y:p?.y_um??0,power:m?.power_W??'',stdcell:m?.area_known===false?'':m?.stdcell_area_um2??'',macro:m?.area_known===false?'':m?.macro_area_um2??'',utilization:m?.target_cell_utilization??.65,compute:metrics.compute_TOPS??'',bandwidth:metrics.bandwidth_GBps??'',capacity:metrics.capacity_KiB??'',frequency:metrics.frequency_MHz??'',bitwidth:metrics.bit_width??'',precision:metrics.precision||'',provenance:m?.provenance||'',fixed:m?.fixed||false};
    }else{
      for(const key of ['source','target'])$('link-'+key).innerHTML=a.modules.map(m=>option(m.id)).join('');
      const l=item;v={id:l?.id||'',source:l?.source||a.modules[0]?.id,target:l?.target||a.modules[1]?.id,sourcePort:l?.source_port||'out',targetPort:l?.target_port||'in',width:l?.bus_width_bits??'',bandwidth:l?.bandwidth_GBps??'',rate:l?.lane_rate_Gbps??'',wires:l?.data_wires??'',control:l?.control_wires??8,spare:l?.spare_fraction??.1};
    }
    for(const [key,value] of Object.entries(v)){const e=$(kind+'-'+key);if(e.type==='checkbox')e.checked=value;else e.value=value??'';}
    $(kind+'-id').readOnly=Boolean(item);
  }
  technologySummary(pending=false){try{const r=technologyDocument(readYaml($('technology-yaml').value));$('technology-summary').innerHTML=`<b>${esc(r.technology||'未命名工艺')}</b><span>${r.metals?.length||0} 个金属层 · ${pending?'待应用':'当前输入'}</span><details><summary>参数与数据依据</summary><small>${esc(r.technology_provenance||'未提供数据来源')}</small><div class="technology-metals">${(r.metals||[]).map(m=>`<span>${esc(m.name)} · 线宽 ${esc(m.width_um)} µm / pitch ${esc(m.pitch_um)} µm</span>`).join('')}</div></details>`;}catch(e){$('technology-summary').textContent=e.message;}}
}
