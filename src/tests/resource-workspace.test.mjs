import test from 'node:test';
import assert from 'node:assert/strict';
import {interfaceGroups} from '../web/resource-workspace.js';

test('interfaces include all dedicated cores and MC regions without mixing HB with TSV',()=>{
  const regions=[];
  for(let core=0;core<16;core++){
    for(let mc=0;mc<4;mc++)regions.push({id:`c${core}-mc${mc}`,lower_die:'b',upper_die:'dram',interconnect:'TSV',signal_vias:7300,total_vias:null,capacity:null});
    regions.push({id:`hb${core}`,lower_die:'l',upper_die:'b',interconnect:'HB',signal_vias:44700,total_vias:44700,capacity:50000,margin:5300});
    regions.push({id:`tsv${core}`,lower_die:'x',upper_die:'l',interconnect:'TSV',signal_vias:44700,total_vias:45000,capacity:50000,margin:5000});
  }
  const b=interfaceGroups(regions,'b');
  assert.equal(b.length,2);
  assert.equal(b[0].items.length,64);assert.equal(b[0].signal_vias,467200);
  assert.equal(b[0].total_vias,null);assert.equal(b[0].capacity,null);
  assert.equal(b[1].kind,'HB');assert.equal(b[1].signal_vias,715200);
  assert.equal(interfaceGroups(regions,'x')[0].signal_vias,715200);
  assert.equal(interfaceGroups(regions,'dram')[0].signal_vias,467200);
  assert.deepEqual(interfaceGroups(regions,'missing'),[]);
});

test('partial unknown values remain unknown; zero and negative margins are preserved',()=>{
  const rows=[{lower_die:'x',upper_die:'l',signal_vias:0,total_vias:10,capacity:8,margin:-2},{lower_die:'x',upper_die:'l',signal_vias:4,total_vias:4,capacity:null,margin:null}];
  const [g]=interfaceGroups(rows,'x');
  assert.equal(g.kind,'TSV');assert.equal(g.signal_vias,4);assert.equal(g.total_vias,14);
  assert.equal(g.capacity,null);assert.equal(g.margin,null);
  assert.equal(interfaceGroups(rows.slice(0,1),'l')[0].margin,-2);
});
