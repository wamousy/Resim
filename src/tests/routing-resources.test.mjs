import test from 'node:test';
import assert from 'node:assert/strict';
import {spacingPage} from '../web/routing-resources.js';
const rows=Array.from({length:26500},(_,i)=>({modules:['core'+Math.floor(i/100)+'__a','m'+i],passed:i%3!==0}));
test('large spacing ledger is capped per page without discarding rows',()=>{
  const first=spacingPage(rows),last=spacingPage(rows,{page:10000});
  assert.equal(first.total,26500);assert.equal(first.items.length,50);assert.equal(last.page,529);
  assert.equal(last.items.at(-1),rows.at(-1));assert.equal(spacingPage(rows,{size:100000}).size,50);
});
test('spacing query and violation filter compose; page is clamped after filtering',()=>{
  const filtered=spacingPage(rows,{query:'CORE0__A',status:'failed',page:90});
  assert.equal(filtered.total,34);assert.equal(filtered.page,0);
  assert.ok(filtered.items.every(r=>!r.passed&&r.modules[0]==='core0__a'));
  assert.deepEqual(spacingPage(rows,{query:'missing'}).items,[]);
  assert.equal(rows.length,26500);
});
