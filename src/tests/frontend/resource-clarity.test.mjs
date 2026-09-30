import test from 'node:test';
import assert from 'node:assert/strict';
import {areaBudget,wiringState,resourceData} from '../../frontend/resource-model.js';
import {calculationMarkup} from '../../frontend/calculations.js';

const fixture=()=>({
  dies:[{id:'logic',area_mm2:100,reserved_area_mm2:20,usable_module_area_mm2:70,module_area_mm2:75,reserved_overlap_mm2:5,free_area_mm2:10,footprint_utilization:.875,max_utilization:.8,power_W:null,power_budget_W:30,power_margin_W:null,peak_congestion:0,wire_area:{metal_area_um2:0,track_area_um2:0}}],
  modules:[{id:'a',die:'logic',required_footprint_um2:null,power_W:null},{id:'b',die:'logic',required_footprint_um2:0,power_W:0},{id:'c',die:'logic',required_footprint_um2:30,power_W:12},{id:'other',die:'upper',required_footprint_um2:null,power_W:null}],
  project:{architecture:{links:[]}},interfaces:[{signal_vias:29200}],routing_status:'aggregate_budget_only',
  metal_routing:{layers:[{die:'logic',metal:'M2',zero_capacity_demand:false}],unassigned:[]},
  issues:[{code:'RESERVED_OVERLAP',subject:'a'},{code:'OUT_OF_BOUNDS',subject:'other'}],
  calculations:{dies:[{die:'logic',metrics:[{key:'wire_area',title:'wire',substitution:'FALSE_ZERO_SENTINEL'},{key:'congestion',title:'congestion',substitution:'FALSE_ZERO_SENTINEL'}]}]}
});

test('geometric free space may be positive while utilization headroom is negative',()=>{
  const r=fixture(),b=areaBudget(r.dies[0]);
  assert.equal(b.effective,80);assert.equal(b.limit,64);assert.equal(b.headroom,-6);
  assert.equal(r.dies[0].free_area_mm2,10);
  assert.equal(areaBudget({...r.dies[0],max_utilization:null}).headroom,null);
  assert.equal(areaBudget({...r.dies[0],usable_module_area_mm2:null}).headroom,null);
  const html=calculationMarkup(r,false,{die:'logic'});
  assert.match(html,/利用率上限内余量/);assert.match(html,/class="negative">-6/);
  assert.match(html,/1 项重叠或越界/);
});

test('missing resources are counted per die without treating explicit zero as missing',()=>{
  const r=fixture(),d=resourceData(r,'logic');
  assert.deepEqual(d.areaMissing.map(m=>m.id),['a']);
  assert.deepEqual(d.powerMissing.map(m=>m.id),['a']);
  assert.equal(d.knownPower,12);assert.equal(d.geometryIssues.length,1);
  const html=calculationMarkup(r,false,{die:'logic',group:'power'});
  assert.match(html,/1 \/ 3 个模块未提供功耗/);assert.match(html,/已知部分合计 12 W/);
  assert.match(html,/待补数据/);
});

test('aggregate interface budgets and legacy reports never show zero evaluated wiring',()=>{
  const r=fixture();
  assert.equal(wiringState(r,'logic').known,false);
  for(const legacy of [false,true]){
    if(legacy)delete r.routing_status;
    const html=calculationMarkup(r,false,{die:'logic',group:'wiring'});
    assert.match(html,/仅有跨层接口总位宽/);assert.match(html,/未评估/);
    assert.doesNotMatch(html,/FALSE_ZERO_SENTINEL|<strong[^>]*>0<\/strong>/);
  }
  r.interfaces=[];assert.match(wiringState(r,'logic').reason,/未定义模块连接/);
});

test('zero capacity with positive demand is a failure even when stored peak ratio is zero',()=>{
  const r=fixture();delete r.routing_status;r.project.architecture.links=[{id:'link'}];
  r.metal_routing.layers[0].zero_capacity_demand=true;
  r.metal_routing.unassigned=[{die:'logic'},{die:'upper'}];
  assert.equal(wiringState(r,'logic').unassigned,1);
  const html=calculationMarkup(r,false,{die:'logic',group:'wiring'});
  assert.match(html,/class="negative">零容量有需求/);assert.match(html,/1 个线段未完成/);
  r.metal_routing.layers[0].zero_capacity_demand=false;r.metal_routing.unassigned=[];
  assert.match(calculationMarkup(r,false,{die:'logic',group:'wiring'}),/<strong[^>]*>0<\/strong>/);
});

test('pending and abstract-platform views do not expose stale or internal results',()=>{
  const r=fixture();
  const pending=calculationMarkup(r,true,{die:'logic',group:'power'});
  assert.match(pending,/等待重新计算/);assert.doesNotMatch(pending,/12 W|30|resource-metric/);
  r.dies[0].display_platform=true;
  for(const group of ['area','wiring','power']){
    const html=calculationMarkup(r,false,{die:'logic',group});
    assert.match(html,/封装抽象平台/);assert.doesNotMatch(html,/resource-metric/);
  }
});
