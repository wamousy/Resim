import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {InputEditor} from '../../frontend/input-editor.js';

const source=readFileSync(new URL('../../frontend/app.js',import.meta.url),'utf8');
const startCode=source.slice(source.indexOf('async function initializeWorkspace(){'),source.indexOf('function fillSupplyEditor(){'));
test('startup reads only the project list, including when a previous project exists',async()=>{
 for(const projects of [[],[{id:'chip',name:'上次工程'}]]){
  const events=[],state={newProject:()=>events.push('empty'),setBusy:b=>events.push(b),notice:()=>{},
   refreshProjects:async()=>{events.push('list');return projects;},loadProject:()=>{throw new Error('must not load a plan');},
   localStorage:{getItem:()=>{throw new Error('must not restore last project');}}};
  await vm.runInNewContext(startCode+'\ninitializeWorkspace;',state)();
  assert.deepEqual(events,['empty',true,'list',false]);
 }
});
test('project list failure leaves startup controls usable for manual opening',async()=>{
 const calls=[],state={newProject(){},setBusy:b=>calls.push(b),notice:s=>calls.push(s),refreshProjects:async()=>{throw new Error('网络故障');}};
 await vm.runInNewContext(startCode+'\ninitializeWorkspace;',state)();
 assert.equal(calls.at(-1),false);assert.ok(calls.some(s=>typeof s==='string'&&s.includes('网络故障')));
});
test('failed project input read preserves the current project and does not blank its location',async()=>{
 const nodes={'output-dir':{value:'C:/old'}},phases=[];
 const state={currentProjectId:'old',structureDirty:true,$:id=>nodes[id],openWorkspace(){},notice(){},
  withLoading:async(_,op)=>op(async text=>phases.push(text)),fetch:async()=>({ok:false}),
  clearResult:()=>{throw new Error('must preserve previous model');}};
 const code=source.slice(source.indexOf('async function loadProject(id){'),source.indexOf('function newProject('));
 const result=await vm.runInNewContext(code+'\nloadProject;',state)('missing');
 assert.equal(result,false);assert.equal(state.currentProjectId,'old');assert.equal(state.structureDirty,true);
 assert.equal(nodes['output-dir'].value,'C:/old');assert.equal(phases.length,1);
});
test('loading always restores controls after success or rejection',async()=>{
 const code=source.slice(source.indexOf('async function withLoading('),source.indexOf('function clearResult(){'));
 for(const fail of [false,true]){
  const calls=[],state={setBusy:b=>calls.push(b),taskProgress:{run:async()=>{if(fail)throw new Error('failed');return 'ok';}}};
  const run=vm.runInNewContext(code+'\nwithLoading;',state);
  if(fail)await assert.rejects(run('载入',()=>{}),/failed/);else assert.equal(await run('载入',()=>{}),'ok');
  assert.deepEqual(calls,[true,false]);
 }
});
test('architecture and technology validation failures preserve unapplied form state',async()=>{
 for(const kind of ['import','technology']){
  const editor=Object.create(InputEditor.prototype),pending=kind==='import'?'chip':'technology',messages=[];
  Object.assign(editor,{pending:new Set([pending]),notice:s=>messages.push(s),status:()=>assert.fail('must not clear draft'),
   apply:async()=>{throw new Error('工艺或引用关系无效');}});
  await editor.commit(kind,()=>({architecture:{},resources:{}}));
  assert.equal(editor.pending.has(pending),true);assert.match(messages[0],/无效/);
 }
});
test('successful technology validation clears only its own pending changes',async()=>{
 const editor=Object.create(InputEditor.prototype);
 Object.assign(editor,{pending:new Set(['technology','module']),notice:()=>assert.fail(),status(){},apply:async(project,{accepted})=>accepted()});
 await editor.commit('technology',()=>({resources:{technology:'test'}}));
 assert.deepEqual([...editor.pending],['module']);
});
