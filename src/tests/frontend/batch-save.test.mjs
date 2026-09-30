import test from 'node:test';
import assert from 'node:assert/strict';
import {family,newBatch,saveBlockedReason,nextUnsaved,planKey} from '../../frontend/batch-save.js';
import {minimalProject} from '../fixtures/minimal-project.mjs';

test('layout variants share input family but technology, architecture and constraints do not',()=>{
 const p=minimalProject(),q=structuredClone(p);q.floorplan.placements[0].x_um+=100;q.name='另一个显示名';
 assert.equal(family(p),family(q));
 for(const field of ['constraints','resources','architecture','search']){const r=structuredClone(p);r[field]={...r[field],changed:true};assert.notEqual(family(p),family(r));}
 const a=newBatch(p),b=newBatch(p);assert.notEqual(a.id,b.id);p.floorplan.placements[0].x_um+=50;assert.notDeepEqual(a.base,p);
});
test('saving cannot bypass unapplied editor or form input and failed previews',()=>{
 for(const flag of ['rawEdited','pendingInput','structureDirty','previewPending','previewFailed'])assert.ok(saveBlockedReason({[flag]:true}));
 assert.equal(saveBlockedReason({}), '');
});

test('next candidate skips saved plans, wraps around and stops when complete',()=>{
 const candidates=[1,2,3].map(n=>({id:String(n),report:{plan_id:String(n)}}));
 const batch=newBatch(minimalProject());
 batch.saved.set(planKey(candidates[1].report),true);
 assert.equal(nextUnsaved(candidates,batch,'layout-1').id,'3');
 assert.equal(nextUnsaved(candidates,batch,'layout-3').id,'1');
 assert.equal(nextUnsaved(candidates,batch,'layout-manual').id,'1');
 batch.saved.set('layout-1',true);batch.saved.set('layout-3',true);
 assert.equal(nextUnsaved(candidates,batch,'layout-1'),null);
 assert.equal(nextUnsaved([],batch,'layout-1'),null);
});
