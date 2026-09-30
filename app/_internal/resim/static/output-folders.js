const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fileSize=n=>!Number.isFinite(n)?'':n<1024?n+' B':n<1024**2?(n/1024).toLocaleString('zh-CN',{maximumFractionDigits:1})+' KB':(n/1024**2).toLocaleString('zh-CN',{maximumFractionDigits:1})+' MB';
const fileType=name=>name.toLowerCase()==='project.json'?'项目入口':/\.ya?ml$/i.test(name)?'YAML 文件':/\.json$/i.test(name)?'JSON 文件':'文件';

// The local host selects the project folder; results are named children of it.
export class OutputFolders {
  constructor({notice,openProject}){
    this.notice=notice;this.openProject=openProject;this.current=null;this.serial=0;this.creating=false;this.mode='create';
    $('browse-output').onclick=()=>this.open(false);
    $('new-output-folder').onclick=()=>this.open(true);
    $('folder-close').onclick=$('folder-cancel').onclick=()=>this.close();
    $('output-folder-dialog').addEventListener('cancel',event=>{if(this.creating)event.preventDefault();else this.serial++;});
    $('folder-go').onclick=()=>this.load($('folder-path').value);
    $('folder-path').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.load(e.target.value);}};
    $('folder-name').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this.create();}};
    $('folder-parent').onclick=()=>this.load(this.current?.parent);
    $('folder-default').onclick=()=>this.load('');
    $('folder-root').onclick=()=>this.load(this.current?.root);
    $('folder-use').onclick=()=>{if(this.current)this.use(this.current.path,false);};
    $('folder-create').onclick=()=>this.create();
    $('folder-new-toggle').onclick=()=>{const section=$('folder-new-section');section.hidden=!section.hidden;if(!section.hidden)$('folder-name').focus();};
  }
  busy(value){$('output-folder-dialog').setAttribute('aria-busy',String(value));for(const e of $('output-folder-dialog').querySelectorAll('input,button'))e.disabled=value; if(!value){$('folder-parent').disabled=!this.current?.parent;$('folder-use').disabled=!this.current;$('folder-create').disabled=!this.current;}}
  status(text,error=false){$('folder-status').textContent=text;$('folder-status').classList.toggle('error',error);}
  async request(path,body){
    const r=await fetch('/api/output-folders'+path,{method:body?'POST':'GET',headers:{'X-Resim-Local':'1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json();if(!r.ok)throw new Error(data.detail==='Not Found'?'请重新启动 Resim.exe，以启用文件夹选择功能。':data.detail||'目录操作失败');return data;
  }
  async open(create,mode='create'){
    this.mode=mode;
    $('folder-title').textContent=mode==='existing'?'打开项目文件夹':'选择项目文件夹';
    $('folder-use').textContent=mode==='existing'?'打开此项目':'使用此文件夹';
    $('folder-new-toggle').hidden=mode==='existing';
    this.current=null;$('folder-list').replaceChildren();$('folder-name').value='';$('folder-path').value=$('output-dir').value.trim();
    $('folder-new-section').hidden=mode==='existing'||!create;$('output-folder-dialog').showModal();
    await this.load($('output-dir').value.trim());if(create&&this.current)$('folder-name').focus();
  }
  close(){if(this.creating)return;this.serial++;$('output-folder-dialog').close();}
  async load(path){
    if(this.creating)return;const serial=++this.serial;this.busy(true);this.status('正在读取文件夹与文件…');
    try{
      const data=await this.request('?path='+encodeURIComponent(path||''));if(serial!==this.serial)return;
      this.current=data;$('folder-path').value=data.path;
      const folders=data.folders||[],files=data.files||[];
      $('folder-list').innerHTML=folders.length||files.length?folders.map(d=>`<button class="folder-item" data-folder="${esc(d.path)}"><span class="folder-icon" aria-hidden="true">▱</span><span class="folder-entry-name">${esc(d.name)}</span><small>文件夹</small><span class="folder-arrow" aria-hidden="true">›</span></button>`).join('')+files.map(f=>`<div class="folder-item folder-file${f.name.toLowerCase()==='project.json'?' project-entry':''}" title="${esc(f.path)}"><span class="folder-icon" aria-hidden="true">▤</span><span class="folder-entry-name">${esc(f.name)}<small>${fileType(f.name)}</small></span><span class="folder-file-size">${fileSize(f.size_bytes)}</span></div>`).join(''):'<p class="folder-empty">此文件夹为空。</p>';
      for(const b of $('folder-list').querySelectorAll('[data-folder]'))b.onclick=()=>this.load(b.dataset.folder);
      const hint=this.mode==='existing'?(files.some(f=>f.name.toLowerCase()==='project.json')?'已找到 project.json，点击“打开此项目”载入。':'进入包含 project.json 的项目文件夹。')+' 外部项目在下次启动时需要重新打开。':'';
      this.status((data.truncated?'文件夹和文件各最多显示 500 项，可在上方输入完整路径。 ':'')+hint);
    }catch(e){if(serial===this.serial){this.current=null;$('folder-list').replaceChildren();this.status(e.message,true);}}
    finally{if(serial===this.serial)this.busy(false);}
  }
  async create(){
    if(this.mode==='existing'||this.creating||!this.current)return;const name=$('folder-name').value;
    if(!name.trim()){this.status('请填写新文件夹名称。',true);$('folder-name').focus();return;}
    this.creating=true;this.busy(true);this.status('正在创建文件夹…');
    try{const data=await this.request('/create',{parent:this.current.path,name});this.creating=false;this.use(data.path,true);}
    catch(e){this.status(e.message,true);}
    finally{this.creating=false;this.busy(false);}
  }
  async use(path,created){
    if(this.creating)return;
    if(this.mode==='existing'){
      this.creating=true;this.busy(true);this.status('正在载入项目…');
      try{await this.openProject(path);this.creating=false;this.close();}
      catch(e){this.status(e.message,true);}
      finally{this.creating=false;this.busy(false);}
      return;
    }
    $('output-dir').value=path;$('output-dir').dispatchEvent(new Event('change',{bubbles:true}));
    this.close();this.notice((created?'已创建项目文件夹：':'项目文件夹已选择：')+path+'。首次保存时写入项目文件和结果。');
  }
}
