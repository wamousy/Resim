import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCount,searchCompletion} from '../_internal/resim/static/candidate-browser.js';
import {difficultyPage} from '../_internal/resim/static/difficulty-view.js';
test('candidate requests have no fixed 10-item ceiling, retaining positive integer validation',()=>{
  for(const count of [1,3,11,50,1000000])assert.equal(candidateCount(String(count)),count);
  for(const input of ['',0,-1,1.5,'12x','Infinity','9007199254740992'])assert.throws(()=>candidateCount(input));
});
test('only solver exhaustion is described as the total, never timeout or requested count',()=>{
  assert.match(searchCompletion({solver_statuses:['OPTIMAL','INFEASIBLE']},1,500),/已穷尽/);
  assert.match(searchCompletion({solver_statuses:['UNKNOWN']},3,500),/尚未确定/);
  assert.match(searchCompletion({solver_statuses:['OPTIMAL']},12,12),/未穷尽/);
});
test('difficulty categories preserve each reason and global index across pages',()=>{
  const issues=Array.from({length:99},(_,i)=>({severity:i%2?'unknown':'error',reason:'reason '+i,subject:'module '+i}));
  const first=difficultyPage(issues,'unknown'),second=difficultyPage(issues,'unknown',1);
  assert.equal(first.total,49);assert.equal(first.items.length,30);assert.equal(second.items.length,19);
  assert.equal(second.items[0].index,61);assert.equal(second.items[0].reason,'reason 61');
  assert.equal(difficultyPage(issues,'warning',8).page,0);assert.deepEqual(difficultyPage(issues,'warning').items,[]);
});
