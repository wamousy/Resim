import test from 'node:test';
import assert from 'node:assert/strict';
import {updateStructure,dieDisplayRoles} from '../_internal/resim/static/structure-editor.js';

const project=()=>({architecture:{chip:'blx_scheme1',dies:[{id:'B',kind:'logic',voltage_V:.8,max_utilization:.72,metrics:{frequency_MHz:1000}},{id:'L',kind:'logic',voltage_V:1}],modules:[{id:'compute',allowed_dies:['B','L']}]},floorplan:{placements:[{module:'compute',die:'B',x_um:100,y_um:200}],tsv_regions:[{id:'bond',lower_die:'L',upper_die:'B',interconnect:'HB',orientation:'F2F'}],supply_ports:[{id:'power',die:'B'}]},constraints:{blockages:[{id:'keepout',die:'B'}],routing_channels:[{id:'channel',die:'L'}]}});
const row=(id,originalId=id)=>({id,originalId,kind:'logic',width:25,height:32,area:800,thickness:100,power:null});
test('rename updates every Die reference and preserves physical parameters, source project and module coordinates',()=>{
  const p=project(),q=updateStructure(p,[row(' Compute ','B'),row(' Logic ','L')]);
  assert.deepEqual(q.architecture.dies.map(d=>d.id),['Compute','Logic']);assert.deepEqual(q.architecture.modules[0].allowed_dies,['Compute','Logic']);assert.equal(q.floorplan.placements[0].die,'Compute');assert.equal(q.floorplan.placements[0].x_um,100);
  assert.equal(q.floorplan.tsv_regions[0].lower_die,'Logic');assert.equal(q.floorplan.tsv_regions[0].upper_die,'Compute');assert.equal(q.floorplan.supply_ports[0].die,'Compute');assert.equal(q.constraints.blockages[0].die,'Compute');assert.equal(q.constraints.routing_channels[0].die,'Logic');assert.equal(q.architecture.dies[0].voltage_V,.8);assert.equal(q.architecture.dies[0].metrics.frequency_MHz,1000);assert.equal(p.architecture.dies[0].id,'B');
});
test('swap two IDs simultaneously without merging references or physical properties',()=>{
  const q=updateStructure(project(),[row('L','B'),row('B','L')]);assert.equal(q.floorplan.placements[0].die,'L');assert.equal(q.floorplan.tsv_regions[0].lower_die,'B');assert.equal(q.architecture.dies[0].voltage_V,.8);
});
test('IDs are trimmed and empty or duplicate names rejected before mutation',()=>{
  for(const rows of [[row('same','B'),row(' same ','L')],[row(' ','B'),row('L')]])assert.throws(()=>updateStructure(project(),rows),/ID/);
  assert.throws(()=>updateStructure(project(),[row('B'),row('new','B')]),/原始记录/);
});
test('height sets real dimensions; invalid or inconsistent geometry cannot be applied',()=>{
  const q=updateStructure(project(),[{...row('B'),height:30,area:750},row('L')]);assert.equal(q.architecture.dies[0].height_um,30000);assert.equal(q.architecture.dies[0].width_um,25000);
  for(const changes of [{height:0},{height:NaN},{width:-1},{area:0},{height:20,area:800}])assert.throws(()=>updateStructure(project(),[{...row('B'),...changes},row('L')]));
});
test('referenced layers cannot be deleted or replaced with an unrelated new layer',()=>{
  assert.throws(()=>updateStructure(project(),[row('B')]),/不能删除/);
  assert.throws(()=>updateStructure(project(),[row('B',null),row('L')]),/不能删除/);
  const p=project();p.architecture.dies.push({id:'empty'});assert.equal(updateStructure(p,[row('B'),row('L')]).architecture.dies.length,2);
});
test('renamed BLX layers retain visual roles from the bonding topology',()=>{
  const q=updateStructure(project(),[row('Compute','B'),row('Logic','L')]),roles=dieDisplayRoles(q);assert.equal(roles.get('Compute'),'bdie');assert.equal(roles.get('Logic'),'ldie');
  q.architecture.dies.push({id:'Memory',kind:'dram',package_layers:8});assert.equal(dieDisplayRoles(q).get('Memory'),'dram_8layers');
});
