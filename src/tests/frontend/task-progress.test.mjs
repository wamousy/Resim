import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskProgress,elapsedLabel,resultName,resultFolderName} from '../../frontend/task-progress.js';
import {runLabel,runDetails,runOptionLabel,candidateFolder} from '../../frontend/ui-state.js';

function fixture(){
  const nodes=Object.fromEntries(['title','detail','bar','close','results','elapsed'].map(k=>[k,{}]));
  const host={hidden:true,dataset:{},attributes:{},querySelector:s=>nodes[s.match(/data-task-(\w+)/)[1]],setAttribute(k,v){this.attributes[k]=v;}};
  let clock=0,callback=null;
  const task=new TaskProgress(host,{clock:()=>clock,repeat:fn=>(callback=fn,1),cancel:()=>{callback=null;}});
  return {task,host,nodes,advance(ms){clock+=ms;callback?.();},active:()=>Boolean(callback)};
}
test('waiting stays explicit beyond the search budget, then stops its timer on completion',()=>{
  const {task,host,nodes,advance,active}=fixture();
  task.start('正在自动分区与布局');task.phase('正在搜索并复核候选');advance(65000);
  assert.equal(host.attributes['aria-busy'],'true');assert.equal(nodes.elapsed.textContent,'已用时 1 分 5 秒');
  assert.equal(nodes.bar.hidden,false);assert.equal(nodes.results.hidden,true);assert.equal(task.running,true);
  task.finish('布局生成完成','共 3 个不同候选',{review:true});
  assert.equal(nodes.title.textContent,'布局生成完成');assert.equal(nodes.results.hidden,false);
  assert.equal(host.attributes['aria-busy'],'false');assert.equal(active(),false);assert.equal(nodes.bar.hidden,true);
  advance(2000);assert.equal(nodes.elapsed.textContent,'已用时 1 分 5 秒');
});
test('failure is visible, leaves no animation timer and allows the next attempt',()=>{
  const {task,host,nodes,active}=fixture();task.start('生成中');task.finish('生成失败','输入错误',{error:true});
  assert.equal(host.dataset.state,'error');assert.equal(nodes.detail.textContent,'输入错误');assert.equal(active(),false);
  task.start('再次生成');assert.equal(host.dataset.state,'running');assert.equal(nodes.results.hidden,true);
  task.finish('结束','未生成候选');nodes.close.onclick();assert.equal(host.hidden,true);
});
test('result names are validated and historical unnamed runs retain a useful label',()=>{
  assert.equal(resultName('  芯片 A / 低拥塞  '),'芯片 A / 低拥塞');
  for(const name of ['', ' ', 'a\nb', 'x'.repeat(121)])assert.throws(()=>resultName(name));
  const run={created_at:'2026-09-29T01:00:00Z',mode:'evaluate',status:'completed',run_id:'r1'};
  assert.match(runLabel(run),/^布局评估 · /);
  assert.match(runDetails(run),/布局评估.*已完成/);
  assert.equal(runLabel({...run,run_name:'自定义名称 · 含分隔符 · 第三段 · 第四段'}),'自定义名称 · 含分隔符 · 第三段 · 第四段');
  assert.equal(elapsedLabel(-1),'0 秒');
});

test('only repeated history names receive an option hint, without changing persisted names',()=>{
  const runs=[{run_id:'a',run_name:'方案 A'},{run_id:'b',run_name:'方案 A'},{run_id:'c',run_name:'方案 B'}];
  assert.equal(runOptionLabel(runs[0],runs),'方案 A（记录 1）');
  assert.equal(runOptionLabel(runs[1],runs),'方案 A（记录 2）');
  assert.equal(runOptionLabel(runs[2],runs),'方案 B');
  assert.equal(runLabel(runs[0]),'方案 A');
});

test('physical folder names allow Chinese and spaces, rejecting path and Windows name hazards',()=>{
  assert.equal(resultFolderName('  低拥塞 方案A  '),'低拥塞 方案A');
  for(const name of ['../outside','a/b','a\\b','C:folder','a*','a?','<对比>','a|b','name.','CON','aux.txt','COM1','lpt².txt','\ud800'])assert.throws(()=>resultFolderName(name),name);
  assert.equal(candidateFolder({run_dir:'C:\\legacy'},'evaluate','current'),'C:\\legacy\\results');
  const info={run_dir:'C:\\outputs\\方案 A',results_dir:'C:\\outputs\\方案 A'};
  assert.equal(candidateFolder(info,'evaluate','current'),info.results_dir);
  assert.equal(candidateFolder(info,'optimize','1'),info.results_dir+'\\candidate-2');
});
