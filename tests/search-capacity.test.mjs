import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {minimalProject} from './fixtures/minimal-project.mjs';
import {readYaml,writeYaml} from '../app/_internal/resim/static/architecture-io.js';
import {readStack,writeStack,stackModel} from '../app/_internal/resim/static/stack-model.js';
import {assessedReport} from '../app/_internal/resim/static/report-assessment.js';
import {splitInputFiles} from '../app/_internal/resim/static/architecture-io.js';
import {layoutSignature} from '../app/_internal/resim/static/layout-variants.js';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'../app');
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
 const schema=JSON.parse(await readFile(new URL('../docs/contracts/chip-architecture.schema.json',import.meta.url),'utf8'));
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
