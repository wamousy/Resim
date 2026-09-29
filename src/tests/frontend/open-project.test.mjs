import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../../frontend/output-folders.js',import.meta.url),'utf8').replace('export class OutputFolders','class OutputFolders');
function fixture(openProject){
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,
      classList:{toggle(){}},addEventListener(){},replaceChildren(){},querySelectorAll(){return [];},
      showModal(){this.open=true;},close(){this.open=false;},focus(){},dispatchEvent(){}});
    return nodes.get(id);
  };
  const Folder=vm.runInNewContext(source+'\nOutputFolders;',{
    document:{getElementById:node},Event:class{},
    fetch:async()=>({ok:true,json:async()=>({path:'C:/projects',parent:'C:/',root:'C:/',folders:[]})}),
  });
  const notices=[];
  return {folder:new Folder({notice:message=>notices.push(message),openProject}),node,notices};
}

test('open existing project uses the selected path and does not change new-project location',async()=>{
  const calls=[];const {folder,node,notices}=fixture(async path=>calls.push(path));
  node('output-dir').value='C:/new-project';
  await folder.open(false,'existing');
  assert.equal(node('folder-title').textContent,'打开项目文件夹');
  assert.equal(node('folder-new-toggle').hidden,true);
  assert.equal(node('folder-new-section').hidden,true);
  assert.match(node('folder-status').textContent,/下次启动/);
  await folder.use('C:/external/chip',false);
  assert.deepEqual(calls,['C:/external/chip']);
  assert.equal(node('output-dir').value,'C:/new-project');
  assert.equal(node('output-folder-dialog').open,false);
  assert.deepEqual(notices,[]);
});

test('invalid project keeps chooser open with an error and can be cancelled',async()=>{
  const {folder,node}=fixture(async()=>{throw new Error('没有 project.json');});
  await folder.open(false,'existing');await folder.use('C:/wrong',false);
  assert.equal(node('output-folder-dialog').open,true);
  assert.match(node('folder-status').textContent,/没有 project.json/);
  assert.equal(folder.creating,false);
  folder.close();assert.equal(node('output-folder-dialog').open,false);
});

test('returning to new-project folder selection restores creation controls',async()=>{
  const {folder,node,notices}=fixture(async()=>{});
  await folder.open(false,'existing');folder.close();await folder.open(true);
  assert.equal(node('folder-title').textContent,'选择项目文件夹');
  assert.equal(node('folder-new-toggle').hidden,false);
  assert.equal(node('folder-new-section').hidden,false);
  await folder.use('C:/new-project',true);
  assert.equal(node('output-dir').value,'C:/new-project');
  assert.match(notices[0],/已创建项目文件夹/);
});

test('project opening is guarded for unsaved changes and disabled during work',()=>{
  const app=readFileSync(new URL('../../frontend/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
  assert.match(html,/id="open-project">打开项目文件夹/);
  assert.match(app,/\$\('open-project'\)\.onclick=async\(\)=>\{if\(busy\|\|!await canLeaveDraft\(\)\)return/);
  assert.match(app,/\['web-new-project','open-project',/);
});
