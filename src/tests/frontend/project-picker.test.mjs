import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../../frontend/app.js',import.meta.url),'utf8');
const handler=app.slice(app.indexOf('async function refreshProjects('),app.indexOf('function updateHistoryDetails('));
async function select(items,id){
 const picker={innerHTML:'',value:''};
 const c={currentProjectId:null,api:async()=>items,$:()=>picker,esc:s=>s,historyComparison:null,updateControls(){},notice(){}};
 await vm.runInNewContext(handler+'\nrefreshProjects;',c)(id);
 return picker;
}
test('existing project picker contains only projects and keeps valid selection',async()=>{
 const items=[{id:'one',name:'芯片一'},{id:'two',name:'芯片二'}];
 const current=await select(items,'two');assert.equal(current.value,'two');
 assert.equal((current.innerHTML.match(/<option/g)||[]).length,2);
 assert.doesNotMatch(current.innerHTML,/选择已有项目|value=""/);
 assert.equal((await select(items,'missing')).value,'one');
});
test('empty project picker has no selectable fake project',async()=>{
 const empty=await select([]);assert.equal(empty.value,'');assert.match(empty.innerHTML,/disabled>暂无已有项目/);
});
