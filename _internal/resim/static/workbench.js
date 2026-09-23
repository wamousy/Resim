// Workspace navigation changes presentation only; drafts and selections stay in memory.
const names=['inputs','layout','connections','resources','difficulties','reports'];
const titles={inputs:['ARCHITECTURE','架构输入'],layout:['FLOORPLAN / PARTITION','布局规划'],difficulties:['FEASIBILITY','实现难点'],connections:['INTERCONNECT','连接与布线'],resources:['RESOURCE BUDGET','资源与计算'],reports:['RESULTS','结果管理']};
export function openWorkspace(name,{scroll=false}={}){
  if(!names.includes(name))return;
  const changed=document.body.dataset.workspace!==name;
  document.body.dataset.workspace=name;
  document.getElementById('workspace-kicker').textContent=titles[name][0];
  document.getElementById('workspace-title').textContent=titles[name][1];
  document.getElementById('project-options').setAttribute('aria-expanded',String(name==='inputs'));
  for(const key of names){
    document.getElementById('page-'+key).hidden=key!==name;
    const tab=document.getElementById('tab-'+key);
    tab.setAttribute('aria-selected',String(key===name));tab.tabIndex=key===name?0:-1;
  }
  if(scroll||changed)window.scrollTo({top:0,behavior:'instant'});
  if(name!=='layout')document.body.classList.remove('focused-view');
  const focused=document.body.classList.contains('focused-view');
  const focusButton=document.getElementById('focus-view');
  focusButton.setAttribute('aria-pressed',String(focused));focusButton.textContent=focused?'退出专注视图':'专注视图';
}
export function initWorkbench(){
  document.querySelector('.difficulty-shortcut').addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();openWorkspace('difficulties');}
  });
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-workspace]:not(body),a[href="#connection-panel"],a[href="#result-files"],a[href="#calculation-panel"]');
    if(!target)return;
    const name=target.dataset.workspace||{'#connection-panel':'connections','#result-files':'reports','#calculation-panel':'resources'}[target.getAttribute('href')];
    if(name){event.preventDefault();openWorkspace(name,{scroll:!target.closest('.workspace-tabs')});}
  });
  document.querySelector('.workspace-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const current=names.indexOf(event.target.dataset.workspace);if(current<0)return;
    const next=event.key==='Home'?0:event.key==='End'?names.length-1:(current+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+names.length)%names.length;
    event.preventDefault();openWorkspace(names[next]);document.getElementById('tab-'+names[next]).focus();
  });
  document.getElementById('project-options').onclick=()=>{
    openWorkspace('inputs',{scroll:true});
    document.getElementById('project-options-panel').hidden=false;
    document.getElementById('project-options').setAttribute('aria-expanded','true');
  };
  document.getElementById('focus-view').onclick=()=>{
    const focused=document.body.classList.toggle('focused-view');
    const button=document.getElementById('focus-view');button.setAttribute('aria-pressed',String(focused));button.textContent=focused?'退出专注视图':'专注视图';
    if(focused)openWorkspace('layout',{scroll:true});
  };
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&document.body.classList.contains('focused-view'))document.getElementById('focus-view').click();
  });
}
