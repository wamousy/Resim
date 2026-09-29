import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,stat,readFile,rm,writeFile,rename,readdir} from 'node:fs/promises';
import {join,resolve,dirname,basename,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {minimalProject} from '../fixtures/minimal-project.mjs';
import {layoutSignature,distinctCandidates} from '../../frontend/layout-variants.js';
const app=process.env.RESIM_APP_DIR||resolve(dirname(fileURLToPath(import.meta.url)),'../../../app');
const launcher=process.env.RESIM_HOST_EXE||(existsSync(join(app,'Resim.Host.test.exe'))?join(app,'Resim.Host.test.exe'):join(app,'Resim.exe'));
let root,projects,output,child,url,logs='';
const headers={'X-Resim-Local':'1','Content-Type':'application/json'};
const sampleProject=async()=>minimalProject();
const call=async(path,body,extra={})=>{
 const r=await fetch(url+path,{method:body?'POST':'GET',headers:{...headers,...extra},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json()};
};
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'resim-output-check-'));projects=join(root,'projects');output=join(root,'results');
 await mkdir(projects);await mkdir(output);
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 url='http://127.0.0.1:'+port;
 child=spawn(launcher,['serve','--port',String(port),'--projects-dir',projects],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);child.on('error',e=>logs+=e.message);
 for(let i=0;i<100;i++){
  try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(700)});if(r.ok)return;}catch{}
  if(child.exitCode!==null)throw new Error(logs);await new Promise(r=>setTimeout(r,150));
 }
 throw new Error('Host startup failed: '+logs);
});
after(async()=>{
 if(child&&child.exitCode===null){const closed=new Promise(r=>child.once('close',r));child.kill();await closed;}
 // Only this test's freshly allocated temporary tree is removed.
 if(root&&dirname(resolve(root))===resolve(tmpdir())&&basename(root).startsWith('resim-output-check-'))await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
});
test('directory listing starts in the configured project root and excludes files',async()=>{
 const r=await call('/api/output-folders');assert.equal(r.status,200);assert.equal(resolve(r.data.path),resolve(projects));
 await writeFile(join(output,'not-a-folder.txt'),'test');
 const listed=await call('/api/output-folders?path='+encodeURIComponent(output));assert.equal(listed.status,200);assert.deepEqual(listed.data.folders,[]);
});
test('repeated launch reuses the same desktop service and preserves its project root',async()=>{
 const second=spawnSync(launcher,['serve','--port',new URL(url).port,'--projects-dir',projects],{windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(second.status,0,second.stderr);assert.match(second.stdout,/already running/);
 assert.equal((await call('/api/health')).data.projects_dir,projects);
 assert.equal(child.exitCode,null);
});
test('a launch for a different project root cannot silently reuse the current service',async()=>{
 const second=spawnSync(launcher,['serve','--port',new URL(url).port,'--projects-dir',join(root,'other-projects')],{windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(second.status,1);assert.equal((await call('/api/health')).data.projects_dir,projects);
 assert.equal(child.exitCode,null);
});
test('only local, same-origin UI requests can browse or create directories',async()=>{
 assert.equal((await fetch(url+'/api/output-folders')).status,403);
 assert.equal((await call('/api/output-folders',null,{Origin:'https://unrelated.example'})).status,403);
 assert.equal((await call('/api/output-folders',null,{Origin:url})).status,200);
});
test('Unicode/spaced folder is created immediately; duplicate name cannot overwrite it',async()=>{
 const r=await call('/api/output-folders/create',{parent:output,name:'方案 A 结果'});assert.equal(r.status,200);assert.equal(r.data.created,true);
 assert.equal((await stat(r.data.path)).isDirectory(),true);
 const reopened=await call('/api/output-folders?path='+encodeURIComponent(r.data.path));assert.equal(reopened.status,200);assert.equal(reopened.data.path,r.data.path);
 assert.equal((await call('/api/output-folders/create',{parent:output,name:'方案 A 结果'})).status,409);
 const listed=await call('/api/output-folders?path='+encodeURIComponent(output));assert.equal(listed.data.folders[0].name,'方案 A 结果');
});
test('traversal, reserved names, missing parent and application-directory writes are rejected',async()=>{
 for(const name of ['../escape','a/b','a\\b','CON','nul.txt','COM1','trailing.',' space','..'])assert.equal((await call('/api/output-folders/create',{parent:output,name})).status,400,name);
 assert.equal((await call('/api/output-folders/create',{parent:join(root,'missing'),name:'test'})).status,404);
 assert.equal((await call('/api/output-folders/create',{parent:app,name:'should-not-be-created'})).status,400);
});
test('actual evaluation writes results into the folder selected through the new API',async()=>{
 const p=await sampleProject();
 p.name='目录功能隔离测试';
 const selected=join(output,'方案 A 结果');
 const result=await call('/api/evaluate',{yaml:JSON.stringify(p),project_name:p.name,output_dir:selected});
 assert.equal(result.status,200,JSON.stringify(result.data));
 const run=resolve(result.data.storage.run_dir);assert.ok(run.startsWith(resolve(selected)+sep),run);
 assert.equal((await stat(run)).isDirectory(),true);assert.equal(result.data.summary.module_count,2);
 assert.equal((await call('/api/health')).data.projects_dir,projects);
});
test('existing web assets, validation errors and report APIs pass through unchanged',async()=>{
 const r=await fetch(url+'/static/output-folders.js?v=test');assert.equal(r.status,200);assert.match(await r.text(),/class OutputFolders/);
 assert.equal((await call('/api/validate',{yaml:'invalid: data'})).status,422);
});

test('named project folder survives rename and external opening without registry directories',async()=>{
 const folder=join(projects,'自定义工程名称'),renamed=join(projects,'Moved Chip');
 const saved=await call('/api/evaluate',{yaml:JSON.stringify(await sampleProject()),project_dir:folder,result_folder_name:'结果'});
 assert.equal(saved.status,200,JSON.stringify(saved.data));
 const pid=saved.data.storage.project_id;
 assert.equal(existsSync(join(projects,pid)),false);
 await rename(folder,renamed);
 let items=(await call('/api/projects')).data;
 assert.equal(items.find(p=>p.id===pid).project_dir,renamed);
 const external=join(root,'外部芯片工程');await rename(renamed,external);
 items=(await call('/api/projects')).data;assert.equal(items.some(p=>p.id===pid),false);
 const before=await readdir(projects);
 assert.equal((await call('/api/projects/open',{project_dir:external},{Origin:'https://unrelated.example'})).status,403);
 assert.equal((await fetch(url+'/api/projects/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project_dir:external})})).status,403);
 const opened=await call('/api/projects/open',{project_dir:external});
 assert.equal(opened.status,200,JSON.stringify(opened.data));assert.equal(opened.data.id,pid);
 assert.equal((await call('/api/projects')).data.find(p=>p.id===pid).project_dir,external);
 assert.equal((await fetch(url+`/api/projects/${pid}/input`)).status,200);
 const historical=await call(`/api/projects/${pid}/runs/${saved.data.storage.run_id}/result`);
 assert.equal(historical.status,200,JSON.stringify(historical.data));
 assert.equal(historical.data.result.storage.results_dir,join(external,'结果'));
 assert.deepEqual(await readdir(projects),before);
 const next=await call('/api/evaluate',{yaml:JSON.stringify(await sampleProject()),project_id:pid,result_folder_name:'新结果'});
 assert.equal(next.status,200,JSON.stringify(next.data));
 assert.equal(next.data.storage.results_dir,join(external,'新结果'));
 const page=await (await fetch(url)).text();assert.match(page,/id="open-project">打开项目文件夹/);
});

test('optimizer persists physically different candidates and never pads a fixed layout',async()=>{
 const p=await sampleProject();
 p.search={...p.search,candidates:3,time_limit_s:8};p.name='Distinct layout integration check';
 const result=await call('/api/optimize',{yaml:JSON.stringify(p),project_name:p.name,output_dir:output});
 assert.equal(result.status,200,JSON.stringify(result.data));
 const candidates=result.data.candidates;assert.equal(candidates.length,3);
 assert.equal(new Set(candidates.map(layoutSignature)).size,3,'Candidates must differ in real placement, not score or ID');
 const stored=await call(`/api/projects/${result.data.storage.project_id}/runs/${result.data.storage.run_id}/result`);
 assert.equal(stored.status,200);assert.deepEqual(stored.data.result.candidates.map(layoutSignature),candidates.map(layoutSignature));
 const pinned=structuredClone(candidates[0].project);pinned.architecture.modules.forEach(m=>m.fixed=true);pinned.search.candidates=3;
 const fixed=await call('/api/optimize',{yaml:JSON.stringify(pinned),project_name:'Fixed layout integration check',output_dir:output});
 assert.equal(fixed.status,200,JSON.stringify(fixed.data));assert.equal(fixed.data.candidates.length,1);
 assert.equal(distinctCandidates(fixed.data).length,1,'Original reference layout must not count as a second candidate');
});
