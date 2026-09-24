import test from 'node:test';
import assert from 'node:assert/strict';
import {stackModel,applyStack,readStack,writeStack,plainDescription,contactOrientation,assertStack,surfaceOffset} from '../_internal/resim/static/stack-model.js';
import {splitInputFiles,mergeInputFiles} from '../_internal/resim/static/architecture-io.js';
import {updateStructure} from '../_internal/resim/static/structure-editor.js';
const fixture=()=>({schema_version:'resim/0.1',name:'stack-test',architecture:{description:'Keep this engineering note.',dies:[{id:'X',order:0},{id:'L',order:1},{id:'B',order:2},{id:'D',order:3,display_platform:true}],modules:[]},floorplan:{placements:[],tsv_regions:[{id:'XL',lower_die:'X',upper_die:'L',orientation:'B2B',interconnect:'TSV',signal_budget_bits:44700,x_um:25,y_um:40,width_um:100,height_um:500,core:'c0'},{id:'LB',lower_die:'L',upper_die:'B',orientation:'F2F',interconnect:'HB',signal_budget_bits:44700},{id:'BD',lower_die:'B',upper_die:'D',orientation:'unspecified',interconnect:'TSV',signal_budget_bits:29200}]},constraints:{},resources:{metals:[]}});
test('face-down module and metal planes sit below silicon, while standalone views normalize the face',()=>{
  assert.equal(surfaceOffset('down',100,20),-120);assert.equal(surfaceOffset('up',100,20),20);
  assert.equal(surfaceOffset('down',100,20,'2d'),20);assert.equal(surfaceOffset('down',100,20,'back'),20);
});
test('contact orientation uses lower top and upper bottom for all four combinations',()=>{
  assert.equal(contactOrientation('up','down'),'F2F');assert.equal(contactOrientation('down','up'),'B2B');assert.equal(contactOrientation('up','up'),'F2B');assert.equal(contactOrientation('down','down'),'B2F');assert.equal(contactOrientation('unknown','up'),'unspecified');
});
test('legacy BLX infers B/L/X faces but does not invent the abstract DRAM package orientation',()=>{
  const p=fixture(),before=structuredClone(p),m=stackModel(p);
  assert.deepEqual([...m.faces].map(([id,v])=>[id,v.face]),[['X','down'],['L','up'],['B','down'],['D','unknown']]);
  assert.deepEqual(m.pairs.map(p=>p.kind),['TSV','HB','TSV']);assert.equal(m.issues.length,0);assert.deepEqual(p,before);
});
test('conflicting legacy face constraints and HB on opposite-facing surfaces cannot pass',()=>{
  const p=fixture();p.floorplan.tsv_regions[0].orientation='F2F';assert.equal(stackModel(p).faces.get('L').face,'conflict');assert.throws(()=>assertStack(p),/冲突/);
  assert.throws(()=>applyStack(fixture(),{X:'down',L:'down',B:'up',D:'unknown'}),/HB/);
});
test('changing both faces and interface kind is atomic and keeps position, ownership and demand intact',()=>{
  const p=fixture(),q=applyStack(p,{X:'down',L:'down',B:'up',D:'unknown'},[{lower:'L',upper:'B',kind:'TSV'}]);
  assert.equal(q.floorplan.tsv_regions[1].orientation,'B2B');assert.equal(q.floorplan.tsv_regions[1].interconnect,'TSV');
  assert.equal(q.floorplan.tsv_regions[0].orientation,'unspecified');assert.equal(stackModel(q).pairs[0].orientation,'B2F');
  for(let i=0;i<3;i++)assert.equal(q.floorplan.tsv_regions[i].signal_budget_bits,p.floorplan.tsv_regions[i].signal_budget_bits);
  assert.equal(q.floorplan.tsv_regions[0].x_um,25);assert.equal(q.floorplan.tsv_regions[0].core,'c0');assert.equal(p.floorplan.tsv_regions[1].interconnect,'HB');
});
test('chip YAML has explicit stack mapping; old-engine snapshots round-trip without losing description',()=>{
  const p=applyStack(fixture(),{X:'down',L:'up',B:'down',D:'unknown'}),files=splitInputFiles(p),q=mergeInputFiles(files.chip,files.technology);
  assert.match(files.chip,/stack:/);assert.doesNotMatch(files.chip,/\[resim-stack/);assert.equal(plainDescription(q),'Keep this engineering note.');assert.deepEqual(q,p);
  assert.deepEqual(readStack(JSON.parse(JSON.stringify(q))),readStack(p));
});
test('rename Die IDs remaps explicit face keys in the same transaction',()=>{
  const p=applyStack(fixture(),{X:'down',L:'up',B:'down',D:'unknown'}),rows=p.architecture.dies.map(d=>({id:d.id+'new',originalId:d.id,kind:'logic',area:800,width:25,height:32,thickness:100,power:null})),q=updateStructure(p,rows);
  assert.deepEqual(readStack(q).die_faces,{Xnew:'down',Lnew:'up',Bnew:'down',Dnew:'unknown'});assert.equal(q.floorplan.tsv_regions[1].upper_die,'Bnew');
});
test('unknown faces and undefined interfaces are missing-data issues; non-adjacent/reversed interfaces are errors',()=>{
  const p=fixture();p.floorplan.tsv_regions=[];assert.ok(stackModel(p).issues.some(i=>i.severity==='unknown'));assert.doesNotThrow(()=>assertStack(p));
  p.floorplan.tsv_regions=[{id:'skip',lower_die:'X',upper_die:'B',interconnect:'TSV'}];assert.throws(()=>assertStack(p),/相邻层/);
});
test('malformed metadata, misspelled face values and references to missing layers fail explicitly',()=>{
  assert.throws(()=>writeStack(fixture(),{die_faces:{X:'upp'}}),/up\/down/);assert.throws(()=>writeStack(fixture(),{die_faces:{fake:'up'}}),/不存在/);
  const p=fixture();p.architecture.description+='\n[resim-stack/1]\nnot-json\n[/resim-stack]';assert.throws(()=>readStack(p),/无效/);
});
