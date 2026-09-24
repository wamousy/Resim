import test from 'node:test';
import assert from 'node:assert/strict';
import {readYaml,writeYaml,mergeInputFiles,splitInputFiles,updateModule,removeModule,updateLink} from '../_internal/resim/static/architecture-io.js';
import {historyDiff,savedCandidates} from '../_internal/resim/static/history-comparison.js';

const fixture=()=>({schema_version:'resim/0.1',name:'test',architecture:{chip:'test',dies:[{id:'logic0'},{id:'logic1'}],cores:[{id:'core0'}],modules:[{id:'compute',core:'core0',kind:'compute',allowed_dies:['logic0'],ports:['in','out'],metrics:{},halo_um:2},{id:'memory',core:'core0',allowed_dies:['logic0']}],links:[]},resources:{technology:'sample',technology_provenance:'test',metals:[{name:'M2',direction:'HORIZONTAL',width_um:.1,pitch_um:.2}],routing_availability:.15},floorplan:{placements:[{module:'compute',die:'logic0',x_um:0,y_um:0,width_um:100,height_um:100}]},constraints:{},search:{}});
const form=()=>({id:'compute',core:'core0',kind:'compute',die:'logic0',allowed:'logic0, logic1',width:'120',height:'100',x:'10',y:'20',stdcell:'',macro:'',power:'',utilization:'.65',fixed:false,provenance:'user',compute:'64',bandwidth:'128',capacity:'',frequency:'1000',bitwidth:'16',precision:'FP16'});
test('separate YAML files round-trip, preserve all architecture fields, keep resources exclusive',()=>{
  const p=fixture(),s=splitInputFiles(p);assert.equal(readYaml(s.chip).resources,undefined);assert.equal(readYaml(s.technology).architecture,undefined);assert.deepEqual(mergeInputFiles(s.chip,s.technology),p);
});
test('legacy complete YAML imports and explicit technology overrides legacy resources',()=>{
  const p=fixture(),s=splitInputFiles(p),other=readYaml(s.technology);other.resources.technology='replacement';assert.deepEqual(mergeInputFiles(writeYaml(p),''),p);assert.equal(mergeInputFiles(writeYaml(p),writeYaml(other)).resources.technology,'replacement');
});
test('wrong document kinds, missing tech, duplicate keys, cycles and multiple documents are rejected',()=>{
  const s=splitInputFiles(fixture());assert.throws(()=>mergeInputFiles(s.technology,s.chip));assert.throws(()=>mergeInputFiles(s.chip,''));assert.throws(()=>mergeInputFiles(s.chip,s.chip));assert.throws(()=>readYaml('name: a\nname: b'));assert.throws(()=>readYaml('a: &a\n  self: *a'));assert.throws(()=>readYaml('a: 1\n---\na: 2'));
});
test('module dimensions and placement change together; unknown resources stay unknown',()=>{
  const p=fixture(),updated=updateModule(p,form(),'compute');const m=updated.architecture.modules[0],placement=updated.floorplan.placements[0];assert.equal(m.area_known,false);assert.equal(m.power_W,null);assert.equal(m.halo_um,2);assert.equal(m.metrics.compute_TOPS,64);assert.equal(placement.width_um,m.width_um);assert.equal(placement.x_um,10);assert.equal(p.floorplan.placements[0].width_um,100);
});
test('explicit zero resources remain known, new core is created only once',()=>{
  const f={...form(),id:'new',core:'core1',stdcell:'0',macro:'0',power:'0'},p=updateModule(fixture(),f),m=p.architecture.modules.at(-1);assert.equal(m.area_known,true);assert.equal(m.power_W,0);assert.equal(p.architecture.cores.length,2);assert.equal(updateModule(p,f,'new').architecture.cores.length,2);
});
test('module mutation rejects duplicate IDs, invalid sizes and migration outside allowed dies',()=>{
  assert.throws(()=>updateModule(fixture(),form()));assert.throws(()=>updateModule(fixture(),{...form(),width:''},'compute'));assert.throws(()=>updateModule(fixture(),{...form(),utilization:'1.2'},'compute'));assert.throws(()=>updateModule(fixture(),{...form(),die:'logic1',allowed:'logic0'},'compute'));assert.throws(()=>updateModule(fixture(),{...form(),id:'renamed'},'compute'));
});
test('link input preserves implementation metadata; connected modules cannot be removed',()=>{
  const f={id:'data',source:'compute',target:'memory',sourcePort:'out',targetPort:'in',width:'256',bandwidth:'100',rate:'4',wires:'',control:'8',spare:'.1'};const p=updateLink(fixture(),f);p.architecture.links[0].routing_layers={horizontal:['M4']};const q=updateLink(p,{...f,bandwidth:'120'},'data');assert.deepEqual(q.architecture.links[0].routing_layers,{horizontal:['M4']});assert.equal(q.architecture.links[0].data_wires,null);assert.throws(()=>removeModule(q,'memory'));assert.throws(()=>updateLink(fixture(),{...f,rate:'0'}));assert.throws(()=>updateLink(fixture(),{...f,width:'2.5'}));
});
const report=(overrides={})=>({summary:{power_W:null,total_die_area_mm2:100,errors:1,unknowns:1},simulator_version:'0.11',project:fixture(),issues:[{severity:'error',code:'CAPACITY',subject:'M2',reason:'old'}],...overrides});
test('comparison uses B minus A and never turns missing data into zero',()=>{
  const a=report(),b=report({summary:{power_W:10,total_die_area_mm2:120,errors:0,unknowns:0}}),d=historyDiff(a,b);assert.equal(d.metrics.find(m=>m.key==='total_die_area_mm2').delta,20);assert.equal(d.metrics.find(m=>m.key==='power_W').delta,null);assert.equal(d.metrics.find(m=>m.key==='die_count').delta,null);
});
test('comparison finds migration, resizing, new modules and resolved/new issue identities',()=>{
  const a=report(),b=report();b.project.floorplan.placements[0].die='logic1';b.project.floorplan.placements[0].width_um=200;b.project.floorplan.placements.push({module:'new',die:'logic1',x_um:0,y_um:0,width_um:1,height_um:1});b.issues=[{severity:'warning',code:'CAPACITY',subject:'M2'}];const d=historyDiff(a,b);assert.equal(d.changes.length,2);assert.match(d.changes[0].type,/跨层迁移/);assert.match(d.changes[0].type,/尺寸变化/);assert.equal(d.issues.added.length,1);assert.equal(d.issues.resolved.length,1);
});
test('duplicate issue identities are grouped; engine/library changes are disclosed',()=>{
  const a=report(),b=report();b.issues.push({...b.issues[0]});b.simulator_version='0.12';b.project.resources.routing_availability=.3;const d=historyDiff(a,b);assert.equal(d.issues.persistent.length,1);assert.equal(d.warnings.length,3);
});
test('history lists unique candidate layouts, preserving stored IDs and excluding baseline',()=>{
  assert.deepEqual(savedCandidates({mode:'optimize',result:{candidates:[]}}),[]);assert.equal(savedCandidates({mode:'evaluate',result:report()})[0].id,'current');
  const moved=report();moved.project.floorplan.placements[0].x_um=50;
  const options=savedCandidates({mode:'optimize',result:{baseline:report(),candidates:[report(),report(),moved]}});assert.deepEqual(options.map(o=>o.id),['0','2']);
});
