import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {readYaml} from '../_internal/resim/static/architecture-io.js';
import {layoutSignature} from '../_internal/resim/static/layout-variants.js';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let root,child,url,logs='',project;
const request=async(path,p)=>{
 const r=await fetch(url+'/api/'+path,{method:p?'POST':'GET',headers:{'Content-Type':'application/json'},...(p?{body:JSON.stringify({yaml:JSON.stringify(p),project_name:p.name})}:{})});
 return {status:r.status,data:await r.json()};
};
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'resim-search-check-'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));url='http://127.0.0.1:'+port;
 const engine=join(app,existsSync(join(app,'Resim.Engine.next.exe'))?'Resim.Engine.next.exe':'Resim.Engine.exe');
 child=spawn(engine,['serve','--port',String(port),'--projects-dir',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);child.on('error',e=>logs+=e.message);
 project=readYaml(await readFile(join(app,'..','ResimProjects','gcd16-nangate45','inputs','architecture.yml'),'utf8'));
 for(let i=0;i<100;i++){
  try{if((await fetch(url+'/api/health',{signal:AbortSignal.timeout(500)})).ok)return;}catch{}
  if(child.exitCode!==null)throw new Error(logs);await new Promise(r=>setTimeout(r,100));
 }
 throw new Error('Server failed: '+logs);
});
after(async()=>{
 if(child&&child.exitCode===null){const done=new Promise(r=>child.once('close',r));child.kill();await done;}
 if(root&&dirname(resolve(root))===resolve(tmpdir())&&basename(root).startsWith('resim-search-check-'))await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
});
test('all input endpoints accept count >10 and still reject invalid requests',async()=>{
 const p=structuredClone(project);p.search.candidates=1000000;
 for(const path of ['validate','preview']){const r=await request(path,p);assert.equal(r.status,200,JSON.stringify(r.data));}
 for(const count of [0,-1,2.5]){p.search.candidates=count;assert.equal((await request('validate',p)).status,422);}
});
test('requesting 12 yields 12 distinct persisted layouts; fixed model exhausts at one',async()=>{
 const p=structuredClone(project);p.name='Candidate capacity isolated test';p.search={...p.search,candidates:12,time_limit_s:20};
 const result=await request('optimize',p);assert.equal(result.status,200,JSON.stringify(result.data));
 const {candidates,storage}=result.data;assert.equal(candidates.length,12);assert.equal(new Set(candidates.map(layoutSignature)).size,12);
 const saved=await request(`projects/${storage.project_id}/runs/${storage.run_id}/result`);assert.equal(saved.data.result.candidates.length,12);
 const fixed=structuredClone(candidates[0].project);fixed.name='Exhausted space isolated test';fixed.search.candidates=100;fixed.architecture.modules.forEach(m=>m.fixed=true);
 const exhausted=await request('optimize',fixed);assert.equal(exhausted.status,200,JSON.stringify(exhausted.data));
 assert.equal(exhausted.data.candidates.length,1);assert.equal(exhausted.data.solver_statuses.at(-1),'INFEASIBLE');
});
