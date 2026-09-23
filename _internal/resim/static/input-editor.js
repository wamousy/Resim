import {mergeInputFiles,splitInputFiles,readYaml,technologyDocument,updateModule,removeModule,updateLink} from './architecture-io.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(prefix,key,title,type='number')=>`<label>${title}<input id="${prefix}-${key}" aria-label="${title}" type="${type}" ${type==='number'?'min="0" step="any"':''}></label>`;
const select=(prefix,key,title)=>`<label>${title}<select id="${prefix}-${key}" aria-label="${title}"></select></label>`;
const option=(value,label=value)=>`<option value="${esc(value)}">${esc(label)}</option>`;

export class InputEditor{
  constructor({apply,notice,download,onDirty}){
    Object.assign(this,{apply,notice,download,onDirty,project:null,moduleId:null,linkId:null});
    this.pending=new Set();
    $('input-workflow').innerHTML=`<div class="input-mode-bar"><div role="group" aria-label="架构输入方式"><button id="input-mode-import" aria-pressed="false">导入 YAML</button><button id="input-mode-custom" aria-pressed="true">自定义</button></div><span id="input-pending" role="status"></span><button id="export-chip">下载芯片架构</button><button id="export-technology">下载工艺库</button></div>
    <section id="import-input-pane" class="panel input-card" hidden><div class="section-label">01 / CHIP ARCHITECTURE</div><h2>芯片架构文件</h2><p>芯片层级、模块、连接与布局约束。</p><label class="file-field">选择芯片架构 YAML<input id="chip-file" type="file" accept=".yml,.yaml"></label><label class="yaml-label">芯片架构 YAML<textarea id="chip-yaml" spellcheck="false" aria-label="芯片架构 YAML"></textarea></label><div class="input-actions"><button id="apply-import" class="primary">导入为新工程并预览</button><button id="reset-import">恢复当前架构文本</button><span>兼容旧版完整 YAML。</span></div></section>
    <div id="custom-input-pane"><div id="die-editor-slot"></div><details class="panel input-card" id="module-input" open><summary><b>模块定义与资源需求</b><span>大小、类型、归属与功耗</span></summary><div class="form-selector">${select('module','select','选择要编辑的模块')}<button id="new-module">新增模块</button><span id="module-count"></span></div><div class="input-form-grid" id="module-form">
    ${field('module','id','模块 ID','text')}${field('module','core','Core ID','text')}${field('module','kind','模块类型','text')}${select('module','die','所属 Die')}${field('module','allowed','允许分配的 Die（逗号分隔）','text')}
    ${field('module','width','模块宽度 / µm')}${field('module','height','模块高度 / µm')}${field('module','x','布局 X / µm')}${field('module','y','布局 Y / µm')}${field('module','power','模块功耗 / W')}${field('module','stdcell','标准单元面积 / µm²')}${field('module','macro','硬宏面积 / µm²')}${field('module','utilization','目标单元利用率（0–1）')}
    ${field('module','compute','算力需求 / TOPS')}${field('module','bandwidth','带宽需求 / GB/s')}${field('module','capacity','容量需求 / KiB')}${field('module','frequency','频率 / MHz')}${field('module','bitwidth','计算位宽 / bit')}${field('module','precision','计算精度','text')}${field('module','provenance','资源数据依据','text')}<label class="check"><input id="module-fixed" type="checkbox">固定模块位置</label></div><p class="hint">功耗、资源面积留空表示未知；外框面积与资源面积分别输入。</p><div class="input-actions"><button id="apply-module" class="primary">应用模块并预览</button><button id="reset-module">撤销模块表单修改</button><button id="remove-module">删除模块</button></div></details>
    <details class="panel input-card" id="link-input"><summary><b>模块连接与传输需求</b><span>发送 → 接收；双向用两条连接</span></summary><div class="form-selector">${select('link','select','选择要编辑的连接')}<button id="new-link">新增连接</button></div><div class="input-form-grid" id="link-form">${field('link','id','连接 ID','text')}${select('link','source','发送模块')}${select('link','target','接收模块')}${field('link','sourcePort','发送端口','text')}${field('link','targetPort','接收端口','text')}${field('link','width','逻辑位宽 / bit')}${field('link','bandwidth','传输带宽需求 / GB/s')}${field('link','rate','每线速率 / Gbit/s')}${field('link','wires','物理数据线数（空白自动推算）')}${field('link','control','控制线数')}${field('link','spare','冗余比例（0–1）')}</div><div class="input-actions"><button id="apply-link" class="primary">应用连接并预览</button><button id="reset-link">撤销连接表单修改</button><button id="remove-link">删除连接</button></div></details></div>
    <section class="panel input-card technology-input"><div class="section-label">02 / TECHNOLOGY LIBRARY</div><h2>工艺库与连线资源</h2><p>金属层线宽、pitch、可用比例及 TSV / 键合参数。</p><div id="technology-summary" class="technology-summary"></div><label class="file-field">选择工艺库 YAML<input id="technology-file" type="file" accept=".yml,.yaml"></label><details id="technology-editor"><summary>查看或编辑工艺库 YAML</summary><textarea id="technology-yaml" spellcheck="false" aria-label="工艺库 YAML"></textarea></details><div class="input-actions"><button id="apply-technology">应用工艺库并预览</button><button id="reset-technology">恢复当前工艺库</button><span>可独立更换工艺库。</span></div></section>`;
    $('die-editor-slot').append($('structure-panel'));
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
    $('apply-import').onclick=()=>this.commit('import',()=>mergeInputFiles($('chip-yaml').value,$('technology-yaml').value),true);
    $('apply-technology').onclick=()=>this.commit('technology',()=>({...structuredClone(this.requireProject()),resources:technologyDocument(readYaml($('technology-yaml').value))}));
    $('reset-import').onclick=()=>{this.pending.delete('chip');if(this.project)$('chip-yaml').value=splitInputFiles(this.project).chip;this.status();};
    $('reset-technology').onclick=()=>{this.pending.delete('technology');if(this.project)$('technology-yaml').value=splitInputFiles(this.project).technology;this.technologySummary();this.status();};
    for(const [id,key] of [['export-chip','chip'],['export-technology','technology']])$(id).onclick=()=>{try{if(this.hasPending())throw new Error('请先应用或撤销未应用的输入修改，再下载文件');const files=splitInputFiles(this.requireProject());this.download(key==='chip'?'chip-architecture.yml':'technology.yml',files[key],'application/yaml');}catch(e){this.notice(e.message,true);}};
    this.setMode('custom');
  }
  setMode(mode){this.mode=mode;$('import-input-pane').hidden=mode!=='import';$('custom-input-pane').hidden=mode!=='custom';for(const m of ['import','custom'])$('input-mode-'+m).setAttribute('aria-pressed',String(m===mode));$('apply-technology').hidden=mode==='import';}
  renameDies(renames,dies){
    if(!this.pending.has('module'))return;
    const selected=$('module-die').value;
    $('module-die').innerHTML=dies.map(d=>option(d.id)).join('');$('module-die').value=renames.get(selected)||selected;
    $('module-allowed').value=$('module-allowed').value.split(',').map(id=>renames.get(id.trim())||id.trim()).filter(Boolean).join(', ');
  }
  requireProject(){if(!this.project)throw new Error('请先网页新建工程或载入工程');return {...this.project,name:$('project-name').value||this.project.name};}
  hasPending(){return this.pending.size>0;}
  mark(kind){this.pending.add(kind);this.status();}
  status(){$('input-pending').textContent=this.hasPending()?'修改待应用':'';$('input-pending').classList.toggle('pending',this.hasPending());this.onDirty?.();}
  reset(){this.pending.clear();this.project=null;this.moduleId=null;this.linkId=null;this.status();}
  busy(value){for(const e of $('input-workflow').querySelectorAll('input,select,textarea,button'))e.disabled=value;}
  async loadFile(event,kind){const file=event.target.files[0];event.target.value='';if(!file)return;try{if(file.size>4_000_000)throw new Error('文件超过 4 MB');const text=await file.text(),doc=readYaml(text);if(kind==='chip'){
      if(!doc.architecture||!doc.name)throw new Error('请选择芯片架构文件，工艺库请在下方导入');
      if(doc.resources){const files=splitInputFiles({...doc,schema_version:'resim/0.1'});$('chip-yaml').value=files.chip;$('technology-yaml').value=files.technology;this.mark('technology');}else $('chip-yaml').value=text;
    }else{technologyDocument(doc);$('technology-yaml').value=text;}
    this.mark(kind);this.notice('已读取 '+file.name+'，应用预览后生效。');if(kind==='technology')this.technologySummary(true);
  }catch(e){this.notice(e.message,true);}}
  async commit(kind,build,asNew=false){try{
    const allowed=kind==='import'?['chip','technology']:[kind];
    if((asNew||this.pending.has('chip'))&&[...this.pending].some(p=>!allowed.includes(p)))throw new Error('其他输入表单仍有未应用修改，请先应用或撤销，避免互相覆盖');
    const p=build();await this.apply(p,{asNew,accepted:()=>{for(const key of allowed)this.pending.delete(key);if(kind==='module')this.moduleId=$('module-id').value;if(kind==='link')this.linkId=$('link-id').value;this.status();}});
  }catch(e){this.notice(e.message,true);}}
  update(project){this.project=project;const files=splitInputFiles(project);
    if(!this.pending.has('chip'))$('chip-yaml').value=files.chip;
    if(!this.pending.has('technology')){$('technology-yaml').value=files.technology;this.technologySummary();}
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
      const l=item;v={id:l?.id||'',source:l?.source||a.modules[0]?.id,target:l?.target||a.modules[1]?.id,sourcePort:l?.source_port||'out',targetPort:l?.target_port||'in',width:l?.bus_width_bits??'',bandwidth:l?.bandwidth_GBps??0,rate:l?.lane_rate_Gbps??1,wires:l?.data_wires??'',control:l?.control_wires??8,spare:l?.spare_fraction??.1};
    }
    for(const [key,value] of Object.entries(v)){const e=$(kind+'-'+key);if(e.type==='checkbox')e.checked=value;else e.value=value??'';}
    $(kind+'-id').readOnly=Boolean(item);
  }
  technologySummary(pending=false){try{const r=technologyDocument(readYaml($('technology-yaml').value));$('technology-summary').innerHTML=`<b>${esc(r.technology||'未命名工艺')}</b><span>${r.metals?.length||0} 个金属层 · ${pending?'待应用':'当前输入'}</span><small>${esc(r.technology_provenance||'未提供数据来源')}</small><div class="technology-metals">${(r.metals||[]).map(m=>`<span>${esc(m.name)} · ${esc(m.width_um)} µm / pitch ${esc(m.pitch_um)} µm</span>`).join('')}</div>`;}catch(e){$('technology-summary').textContent=e.message;}}
}
