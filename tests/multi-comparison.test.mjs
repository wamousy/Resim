import test from 'node:test';
import assert from 'node:assert/strict';
import {compareSelections} from '../_internal/resim/static/multi-comparison.js';
import {layoutSignature,layoutDifference,distinctCandidates} from '../_internal/resim/static/layout-variants.js';
const report=()=>({summary:{power_W:5,errors:0,unknowns:0},simulator_version:'1',plan_id:'id',project:{resources:{pitch:1},floorplan:{placements:[{module:'a',die:'B',x_um:0,y_um:0,width_um:20,height_um:30},{module:'b',die:'L',x_um:20,y_um:30,width_um:10,height_um:10}]}},issues:[]});
const selection=(i,r=report())=>({project_id:'project',run_id:'run'+i,candidate:'0',candidate_name:'候选 1',report:r});
test('geometry identity ignores score, plan ID and placement order, not actual location',()=>{
  const a=report(),b=report();b.plan_id='another';b.summary.power_W=100;b.project.floorplan.placements.reverse();
  assert.equal(layoutSignature(a),layoutSignature(b));b.project.floorplan.placements[0].x_um+=1;assert.notEqual(layoutSignature(a),layoutSignature(b));
});
test('migration, resizing and moved coordinates distinguish plans and explain differences',()=>{
  const a=report(),b=report();Object.assign(b.project.floorplan.placements[0],{die:'X',width_um:21,x_um:1});
  assert.deepEqual(layoutDifference(a,b),{changed:1,migrated:1,moved:1,resized:1,added:0,removed:0});
  assert.equal(distinctCandidates({candidates:[a,b,a]}).length,2);
});
test('comparison supports any number of peer selections and preserves unknowns and explicit zero',()=>{
  const picks=Array.from({length:7},(_,i)=>selection(i));picks[0].report.summary.power_W=null;picks[1].report.summary.power_W=0;
  const c=compareSelections(picks);assert.equal(c.selections.length,7);assert.deepEqual(c.metrics.find(m=>m.id==='power_W').values,[null,0,5,5,5,5,5]);
  assert.equal('baseline' in c,false);assert.equal('candidate' in c,false);
});
test('same persisted selection cannot be compared with itself; fewer than two is invalid',()=>{
  assert.throws(()=>compareSelections([selection(0)]));assert.throws(()=>compareSelections([selection(0),selection(0)]),/重复/);
});
test('all selected columns participate in layout and constraint differences',()=>{
  const picks=[selection(0),selection(1),selection(2)];picks[2].report.project.floorplan.placements[0].die='X';picks[1].report.project.floorplan.placements.pop();
  picks[1].report.issues=[{severity:'error',code:'OVERFLOW',subject:'M2',reason:'full'},{severity:'error',code:'OVERFLOW',subject:'M2',reason:'full'}];
  const c=compareSelections(picks);assert.equal(c.changes.length,2);assert.equal(c.changes.find(x=>x.id==='a').placements[2].die,'X');assert.equal(c.changes.find(x=>x.id==='b').placements[1],null);
  assert.equal(c.issues.length,1);assert.deepEqual(c.issues[0].occurrences,[null,{reason:'full',suggestion:''},null]);
});
test('all selected versions and technologies checked; key order is not a technology change',()=>{
  const a=selection(0),b=selection(1),c=selection(2);a.report.project.resources={x:1,y:2};b.report.project.resources={y:2,x:1};c.report.project.resources={y:2,x:1};
  assert.equal(compareSelections([a,b,c]).warnings.some(w=>w.includes('工艺')),false);
  c.report.simulator_version='2';c.report.project.resources.x=3;c.report.summary.unknowns=2;
  const result=compareSelections([a,b,c]);for(const text of ['版本','工艺','缺失'])assert.ok(result.warnings.some(w=>w.includes(text)));
});
