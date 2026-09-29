import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {minimalProject} from '../fixtures/minimal-project.mjs';
import {readYaml,writeYaml} from '../../frontend/architecture-io.js';
import {readStack,writeStack,stackModel} from '../../frontend/stack-model.js';
import {assessedReport} from '../../frontend/report-assessment.js';
import {splitInputFiles} from '../../frontend/architecture-io.js';
import {layoutSignature} from '../../frontend/layout-variants.js';
const app=process.env.RESIM_APP_DIR||resolve(dirname(fileURLToPath(import.meta.url)),'../../../app');
let root,child,url,logs='',project,engine;
const request=async(path,p)=>{
 const r=await fetch(url+'/api/'+path,{method:p?'POST':'GET',headers:{'Content-Type':'application/json'},...(p?{body:JSON.stringify({yaml:JSON.stringify(p),project_name:p.name})}:{})});
 return {status:r.status,data:await r.json()};
};
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'resim-search-check-'));
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));url='http://127.0.0.1:'+port;
 engine=join(app,existsSync(join(app,'Resim.Engine.next.exe'))?'Resim.Engine.next.exe':'Resim.Engine.exe');
 child=spawn(engine,['serve','--port',String(port),'--projects-dir',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);child.on('error',e=>logs+=e.message);
 project=minimalProject();
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
test('packaged preview does not create history and explicit saves persist custom names',async()=>{
 const before=(await request('projects')).data;
 const p=structuredClone(project);p.search.candidates=2;
 const preview=await request('optimize/preview',p);
 assert.equal(preview.status,200);assert.equal(preview.data.candidates.length,2);assert.equal(preview.data.storage,undefined);
 assert.deepEqual((await request('projects')).data,before);
 const saved=await fetch(url+'/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({yaml:JSON.stringify(preview.data.candidates[0].project),run_name:'布线方案 A（集成）'})});
 assert.equal(saved.status,200);const info=(await saved.json()).storage;
 assert.equal(info.run_name,'布线方案 A（集成）');
 const rows=(await request(`projects/${info.project_id}/runs`)).data;
 assert.equal(rows[0].run_name,'布线方案 A（集成）');
 const html=await fetch(url+`/api/projects/${info.project_id}/runs/${info.run_id}/export/report.html`);
 assert.equal(html.status,200);assert.match(await html.text(),/布线方案 A（集成）/);
});

test('packaged app writes named output folders and reopens reports through stable history IDs',async()=>{
 const body={yaml:JSON.stringify(project),result_folder_name:'物理目录 A',run_name:'物理目录 A'};
 const post=payload=>fetch(url+'/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const first=await post(body);assert.equal(first.status,200);
 const a=(await first.json()).storage;
 assert.equal(basename(a.results_dir),'物理目录 A');assert.equal(a.results_dir,a.run_dir);
 const bytes=await readFile(join(a.results_dir,'resource-report.json'),'utf8');
 const second=await post({...body,project_id:a.project_id});assert.equal(second.status,200);
 const b=(await second.json()).storage;assert.equal(basename(b.results_dir),'物理目录 A (2)');
 assert.equal(await readFile(join(a.results_dir,'resource-report.json'),'utf8'),bytes);
 const base=`projects/${a.project_id}/runs/${a.run_id}`;
 assert.equal((await request(base+'/result')).data.result.storage.results_dir,a.results_dir);
 assert.equal((await fetch(url+'/api/'+base+'/export/report.html')).status,200);
 const rejected=await post({...body,result_folder_name:'../escape'});assert.equal(rejected.status,422);
});

test('selected directory contains the whole project and named result children',async()=>{
 const folder=join(root,'selected-project');
 const post=payload=>fetch(url+'/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const first=await post({yaml:JSON.stringify(project),project_dir:folder,result_folder_name:'方案 A'});
 assert.equal(first.status,200);const a=(await first.json()).storage;
 assert.equal(a.project_dir,folder);assert.equal(a.results_dir,join(folder,'方案 A'));
 for(const file of ['project.json','inputs/chip-architecture.yml','inputs/technology.yml','方案 A/report.html'])assert.ok(existsSync(join(folder,file)),file);
 assert.equal((await request('projects')).data.find(p=>p.id===a.project_id).project_dir,folder);
 const second=await post({yaml:JSON.stringify(project),project_id:a.project_id,result_folder_name:'方案 B'});
 assert.equal(second.status,200);assert.equal((await second.json()).storage.results_dir,join(folder,'方案 B'));
 const redirect=await post({yaml:JSON.stringify(project),project_id:a.project_id,project_dir:join(root,'wrong'),result_folder_name:'方案 C'});
 assert.equal(redirect.status,422);assert.ok(!existsSync(join(root,'wrong')));
});

test('explicit batch saves only the requested preview and appends siblings without overwriting',async()=>{
 const p=structuredClone(project);p.search.candidates=3;
 const preview=await request('optimize/preview',p);assert.equal(preview.status,200);assert.equal(preview.data.candidates.length,3);
 const bid='batch-'+crypto.randomUUID(),plans=preview.data.candidates;
 const body={batch_id:bid,batch_name:'集成探索',kind:'optimize',base_yaml:JSON.stringify(p),plan_name:'候选二',
   yaml:JSON.stringify(plans[1].project),preview_plan_id:plans[1].plan_id,source_key:'candidate-2',candidate_metadata:plans[1].candidate};
 const save=async b=>{const r=await fetch(url+'/api/batches/save-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 const a=await save(body),s=a.report.storage;
 assert.equal(layoutSignature(a.report),layoutSignature(plans[1]));
 assert.equal(dirname(s.results_dir),s.batch_dir);assert.equal(basename(s.batch_dir),'集成探索');
 assert.equal((await request(`projects/${s.project_id}/runs`)).data.length,1);
 assert.deepEqual((await readdir(s.project_dir)).sort(),['inputs','project.json','集成探索'].sort());
 assert.equal(existsSync(join(s.batch_dir,'inputs')),false);
 assert.ok(existsSync(join(s.results_dir,'inputs/technology.yml')));
 assert.ok(existsSync(join(s.results_dir,'floorplan.svg')));
 const picture=await fetch(url+`/api/projects/${s.project_id}/runs/${s.run_id}/export/floorplan.svg`);assert.equal(picture.status,200);assert.match(await picture.text(),/data-module=/);
 const original=await readFile(join(s.results_dir,'resource-report.json'),'utf8');
 const b=await save({...body,project_id:s.project_id,plan_name:'候选一',yaml:JSON.stringify(plans[0].project),preview_plan_id:plans[0].plan_id,source_key:'candidate-1',candidate_metadata:plans[0].candidate});
 assert.equal(b.report.storage.batch_id,s.batch_id);assert.equal(b.batch.plans.length,2);
 const restored=(await request(`projects/${s.project_id}/runs/${s.run_id}/result`)).data.result;
 assert.deepEqual(restored.project,a.report.project);assert.deepEqual(restored.summary,a.report.summary);
 assert.equal(await readFile(join(s.results_dir,'resource-report.json'),'utf8'),original);
 const frozen=(await request(`projects/${s.project_id}/batches/${bid}`)).data;
 assert.equal(frozen.batch.plans.length,2);assert.equal(readYaml(frozen.base_yaml).search.candidates,3);
 const retry=await save({...body,project_id:s.project_id});assert.equal(retry.reused,true);assert.equal(retry.report.storage.run_id,s.run_id);
 const bad=await fetch(url+'/api/batches/save-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,project_id:s.project_id,preview_plan_id:'stale-preview'})});
 assert.equal(bad.status,422);
});

test('all input endpoints accept count >10 and still reject invalid requests',async()=>{
 const p=structuredClone(project);p.search.candidates=1000000;
 for(const path of ['validate','preview']){const r=await request(path,p);assert.equal(r.status,200,JSON.stringify(r.data));}
 for(const count of [0,-1,2.5]){p.search.candidates=count;assert.equal((await request('validate',p)).status,422);}
 const wrong=minimalProject();wrong.schema_version='resim/999';assert.equal((await request('validate',wrong)).status,422);
 for(const bad of [null,[],42]){const invalid=minimalProject();invalid.architecture=bad;assert.equal((await request('validate',invalid)).status,422);}
 const invalidDescription=minimalProject();invalidDescription.architecture.description=null;assert.equal((await request('validate',invalidDescription)).status,422);
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

test('stored split inputs expose stack, reload edited faces, and retain run snapshots',async()=>{
 const p=writeStack(minimalProject(),{die_faces:{die0:'up'}});
 const saved=await request('evaluate',p);assert.equal(saved.status,200,JSON.stringify(saved.data));
 const id=saved.data.storage.project_id,inputs=join(root,id,'inputs');
 const chipPath=join(inputs,'chip-architecture.yml'),chip=readYaml(await readFile(chipPath,'utf8'));
 assert.deepEqual(chip.stack,{die_faces:{die0:'up'}});
 assert.doesNotMatch(chip.architecture.description,/resim-stack/);
 assert.equal(existsSync(join(inputs,'architecture.yml')),false);
 const technology=readYaml(await readFile(join(inputs,'technology.yml'),'utf8'));
 assert.equal(technology.schema_version,'resim-technology/1');
 chip.stack.die_faces.die0='down';await writeFile(chipPath,writeYaml(chip));
 const input=await fetch(url+`/api/projects/${id}/input`);assert.equal(input.status,200);
 const loaded=readYaml(await input.text());assert.deepEqual(readStack(loaded),{die_faces:{die0:'down'}});
 const old=await request(`projects/${id}/runs/${saved.data.storage.run_id}/result`);
 assert.deepEqual(readStack(old.data.result.project),{die_faces:{die0:'up'}});
});

test('resource evaluation conserves geometry and power, flags overlap, and propagates unknown power',async()=>{
 const p=minimalProject(),base=(await request('preview',p)).data.report;
 const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
 near(base.dies[0].area_mm2,.01);near(base.dies[0].module_area_mm2,.0002);
 near(base.dies[0].free_area_mm2,.0098);near(base.dies[0].footprint_utilization,.02);
 near(base.dies[0].power_W,2);near(base.dies[0].power_margin_W,8);
 const moved=structuredClone(p);moved.floorplan.placements[1].x_um+=20;
 const farther=(await request('preview',moved)).data.report;
 assert.ok(farther.summary.wiring_metal_area_um2>base.summary.wiring_metal_area_um2);
 near(farther.dies[0].module_area_mm2,base.dies[0].module_area_mm2);near(farther.summary.power_W,2);
 const overlap=structuredClone(p);Object.assign(overlap.floorplan.placements[1],{x_um:10,y_um:10});
 const invalid=(await request('preview',overlap)).data.report;
 near(invalid.dies[0].module_area_mm2,.0001);assert.ok(invalid.summary.errors>base.summary.errors);
 p.architecture.modules[0].power_W=null;
 const unknown=(await request('preview',p)).data.report;
 assert.equal(unknown.summary.power_W,null);assert.equal(unknown.dies[0].power_margin_W,null);
});

const cli=(args)=>spawnSync(engine,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
test('native stack rules agree in API, saved JSON/HTML, CLI, and Web for invalid HB geometry',async()=>{
 const p=minimalProject();p.architecture.dies.push({...p.architecture.dies[0],id:'die1',order:1});
 p.floorplan.tsv_regions.push({id:'hb',lower_die:'die0',upper_die:'die1',interconnect:'HB',orientation:'F2F',x_um:70,y_um:70,width_um:10,height_um:10,signal_budget_bits:32,interface_pitch_um:1});
 p.stack={die_faces:{die0:'down',die1:'up'}};
 const preview=(await request('preview',p)).data.report;
 const expected=stackModel(p).issues;assert.ok(expected.some(i=>i.severity==='error'));
 assert.deepEqual(preview.issues.filter(i=>i.code==='STACK_GEOMETRY'),expected);
 assert.deepEqual(assessedReport(preview).summary,preview.summary);
 assert.equal(preview.status,'violations');assert.equal(preview.simulator_version,'0.12.0');
 assert.match(preview.provenance.engine_sha256,/^[a-f0-9]{64}$/);assert.equal(preview.provenance.technology,p.resources.technology);
 const saved=await request('evaluate',p);assert.equal(saved.status,200,JSON.stringify(saved.data));
 const savedDir=join(saved.data.storage.run_dir,'results');
 const json=JSON.parse(await readFile(join(savedDir,'resource-report.json'),'utf8'));
 assert.deepEqual(json.issues,preview.issues);assert.deepEqual(json.project.stack,p.stack);assert.doesNotMatch(json.project.architecture.description,/resim-stack/);
 const html=await readFile(join(savedDir,'report.html'),'utf8');assert.match(html,/当前直接 HB 模型/);
 const path=join(root,'cli-stack.yml');await writeFile(path,JSON.stringify(p));
 const projects=join(root,'cli-projects'),command=cli(['evaluate',path,'--projects-dir',projects]);
 assert.equal(command.status,0,command.stderr||command.stdout);
 const id=(await readdir(projects)).find(n=>!n.startsWith('.'));
 const run=(await readdir(join(projects,id,'runs')))[0];
 const cliReport=JSON.parse(await readFile(join(projects,id,'runs',run,'results/resource-report.json'),'utf8'));
 assert.deepEqual(cliReport.issues,preview.issues);assert.deepEqual(cliReport.summary,preview.summary);
});

test('legacy stack migrates and offline split validation reports field paths',async()=>{
 const p=minimalProject();p.architecture.description+='\n[resim-stack/1]\n{"die_faces":{"die0":"up"}}\n[/resim-stack]';
 const r=await request('preview',p);assert.equal(r.status,200);
 assert.deepEqual(r.data.report.project.stack,{die_faces:{die0:'up'}});assert.doesNotMatch(r.data.report.project.architecture.description,/resim-stack/);
 const files=splitInputFiles(r.data.report.project),chip=join(root,'chip.yml'),tech=join(root,'tech.yml');
 await writeFile(chip,files.chip);await writeFile(tech,files.technology);
 assert.equal(cli(['check-inputs','--architecture',chip,'--technology',tech]).status,0);
 const invalid=readYaml(files.chip);invalid.architecture.dies[0].width_um=-2;await writeFile(chip,writeYaml(invalid));
 const failure=cli(['check-inputs','--architecture',chip,'--technology',tech]);assert.equal(failure.status,1);
 assert.ok(JSON.parse(failure.stdout).errors.some(e=>e.path==='architecture.dies.0.width_um'));
 const schema=JSON.parse(await readFile(new URL('../../../docs/contracts/chip-architecture.schema.json',import.meta.url),'utf8'));
 assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.stack);assert.equal(schema.properties.resources,undefined);
});

test('portable bundle restores real external reports, snapshots and reusable split inputs',async()=>{
 const p=writeStack(minimalProject(),{die_faces:{die0:'up'}}),output=join(root,'external-runs');
 const response=await fetch(url+'/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({yaml:JSON.stringify(p),output_dir:output})});
 const saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));
 const id=saved.storage.project_id,run=saved.storage.run_id,archive=join(root,'portable.zip'),destination=join(root,'relocated');
 let command=cli(['pack-project','--project-dir',join(root,id),'--output',archive]);assert.equal(command.status,0,command.stderr||command.stdout);
 command=cli(['unpack-project','--archive',archive,'--projects-dir',destination]);assert.equal(command.status,0,command.stderr||command.stdout);
 const restored=JSON.parse(await readFile(join(destination,id,'runs',run,'results/resource-report.json'),'utf8'));
 assert.deepEqual(restored.summary,saved.summary);assert.deepEqual(restored.provenance,saved.provenance);
 assert.equal(restored.storage.run_dir,join(destination,id,'runs',run));
 const snapshot=await readFile(join(destination,id,'runs',run,'input.yml'),'utf8');assert.equal(snapshot,await readFile(join(saved.storage.run_dir,'input.yml'),'utf8'));
 command=cli(['evaluate','--project',id,'--projects-dir',destination]);assert.equal(command.status,0,command.stderr||command.stdout);
});

test('stale running records are recovered as interrupted rather than completed',async()=>{
 const saved=(await request('evaluate',minimalProject())).data,id=saved.storage.project_id,run=saved.storage.run_id;
 const path=join(saved.storage.run_dir,'run.json'),record=JSON.parse(await readFile(path,'utf8'));
 record.status='running';await writeFile(path,JSON.stringify(record));
 const result=await request(`projects/${id}/runs`);assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(JSON.parse(await readFile(path,'utf8')).status,'interrupted');
});
