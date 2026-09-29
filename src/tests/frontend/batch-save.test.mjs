import test from 'node:test';
import assert from 'node:assert/strict';
import {family,newBatch,saveBlockedReason} from '../../frontend/batch-save.js';
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
