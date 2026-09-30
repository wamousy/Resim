import test from 'node:test';
import assert from 'node:assert/strict';
import {transferBudget,logicalCaption} from '../../frontend/connection-view.js';
import {linkBudget} from '../../frontend/layout-model.js';
import {referenceDetails} from '../../frontend/object-details.js';
import {wiringState} from '../../frontend/resource-model.js';

test('Width-only connections display unknown speed and retain actual wire count',()=>{
  const link={data_wires:8500,control_wires:0,spare_fraction:0,bus_width_bits:8000,bandwidth_GBps:null,lane_rate_Gbps:null};
  assert.equal(transferBudget(link).rawGBps,null);
  assert.equal(transferBudget(link).laneRate,null);
  assert.equal(linkBudget(link).wires,8500);
  assert.match(logicalCaption(link),/未知/);
});

test('Subsystem reference appears only on its members, escapes source text, and keeps dimensions separate',()=>{
  const report={project:{architecture:{reference_groups:[{id:'r',modules:['a','b'],label:'<source>',source:'diagram',width_um:3000,height_um:7689,area_estimate_um2:11691935,cell_count:1000000,pin_counts:{right:4740},notes:['No power']}]}},reference_groups:[{id:'r',minimum_area_fits:false}]};
  const html=referenceDetails(report,'a');
  assert.match(html,/11.692/);
  assert.match(html,/&lt;source&gt;/);
  assert.match(html,/需要调整布局/);
  assert.equal(referenceDetails(report,'c'),'');
});

test('Incomplete topology is not shown as a complete uncongested die',()=>{
  const state=wiringState({project:{architecture:{links:[{id:'result'}]}},interfaces:[{lower_die:'b',upper_die:'l',unallocated_signal_budget:36500}],metal_routing:{layers:[{die:'b'}],unassigned:[]}},'b');
  assert.equal(state.known,true);
  assert.equal(state.partial,true);
  assert.equal(state.incompleteConnections,true);
  assert.equal(state.unassigned,0);
});
