// An indeterminate wait indicator: elapsed time is real, not a completion estimate.
export function elapsedLabel(milliseconds){
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  return seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
}
export function resultName(value){
  const raw=String(value??'');
  if(!raw.trim()||raw.length>120||/[\x00-\x1f\x7f]/.test(raw))throw new Error('请填写 1–120 个字符的结果名称，不能包含换行。');
  return raw.trim();
}
export function resultFolderName(value){
  const name=resultName(value);
  if(/[<>:"/\\|?*]/.test(name)||name.endsWith('.')||[...name].some(c=>c.length===1&&/[\uD800-\uDFFF]/.test(c)))
    throw new Error('文件夹名称不能包含 < > : " / \\ | ? *、无效字符，或以句点结尾。');
  if(/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(name.split('.')[0].trimEnd()))
    throw new Error('文件夹名称不能使用系统保留名称。');
  return name;
}
export class TaskProgress {
  constructor(host,{clock=()=>performance.now(),repeat=(fn,ms)=>setInterval(fn,ms),cancel=id=>clearInterval(id)}={}){
    this.host=host;this.clock=clock;this.repeat=repeat;this.cancel=cancel;this.running=false;
    this.el=name=>host.querySelector('[data-task-'+name+']');
    this.el('close').onclick=()=>this.reset();
  }
  start(title){
    if(this.running)return;
    this.reset();this.running=true;this.started=this.clock();this.host.hidden=false;this.host.dataset.state='running';
    this.host.setAttribute('aria-busy','true');this.el('title').textContent=title;
    this.el('detail').textContent='正在准备输入，请稍候…';this.el('bar').hidden=false;
    this.el('close').hidden=true;this.el('results').hidden=true;
    this.tick();this.timer=this.repeat(()=>this.tick(),1000);
  }
  tick(){this.el('elapsed').textContent='已用时 '+elapsedLabel(this.clock()-this.started);}
  phase(detail){this.el('detail').textContent=detail;}
  finish(title,detail,{error=false,review=false}={}){
    this.tick();this.cancel(this.timer);this.timer=null;this.running=false;
    this.host.dataset.state=error?'error':'complete';this.host.setAttribute('aria-busy','false');
    this.el('title').textContent=title;this.el('detail').textContent=detail;
    this.el('bar').hidden=true;this.el('close').hidden=false;this.el('results').hidden=!review;
  }
  reset(){
    if(this.running)return;
    this.cancel(this.timer);this.timer=null;this.host.hidden=true;
  }
}
