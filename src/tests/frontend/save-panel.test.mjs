// State-level DOM adapter; this does not exercise browser rendering or real clicks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {newBatch,planKey} from '../../frontend/batch-save.js';
import {minimalProject} from '../fixtures/minimal-project.mjs';

function fixture(){
 const nodes=new Map();
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,dataset:{},rows:[],
   replaceChildren(){this.rows=[];},
   set innerHTML(html){this.html=html;if(id==='batch-plan-list')this.rows=[...html.matchAll(/<div class="batch-plan-row" data-save-key="([^"]+)">([\s\S]*?)<\/div>/g)].map(([,key,body])=>{
    const fields=[...body.matchAll(/<input ([^>]+)>/g)].map(([,attrs])=>({type:attrs.match(/type="([^"]+)"/)[1],value:attrs.match(/value="([^"]*)"/)?.[1]||'',disabled:attrs.includes('disabled'),checked:attrs.includes('checked')}));
    return {dataset:{saveKey:key},querySelector:q=>fields.find(f=>q===`input[type=${f.type}]`),querySelectorAll:()=>fields};
   });},
   querySelectorAll(q){return q==='[data-save-key]'?this.rows:q==='input[type=checkbox]'?this.rows.map(r=>r.querySelector(q)):[];}});
  return nodes.get(id);
 };
 const source=readFileSync(new URL('../../frontend/batch-save.js',import.meta.url),'utf8').replaceAll('export ','');
 const Panel=vm.runInNewContext(source+'\nBatchSavePanel;',{structuredClone,crypto,document:{getElementById:node,querySelectorAll:()=>node('batch-plan-list').rows}});
 const panel=new Panel(),batch=newBatch(minimalProject(),'optimize');
 const candidates=[1,2,3].map(n=>({id:String(n),name:'方案'+n,report:{plan_id:String(n)}}));
 const render=(index=0,busy=false,blocked='')=>panel.render(batch,candidates[index].report,candidates,busy,blocked,{options:candidates.map(c=>({value:c.id,label:c.name})),active:candidates[index].id});
 return {panel,batch,candidates,node,render};
}

test('single and batch actions are peers and selecting a subset does not disable single save',()=>{
 const h=fixture();h.render();
 assert.equal(h.node('evaluate').disabled,false);assert.equal(h.node('save-batch').disabled,false);
 assert.equal(h.panel.choices().filter(c=>c.selected).length,3);
 for(const row of h.node('batch-plan-list').rows)row.querySelector('input[type=checkbox]').checked=false;
 h.node('batch-plan-list').rows[0].querySelector('input[type=checkbox]').onchange();
 assert.equal(h.node('save-batch').disabled,true);assert.equal(h.node('evaluate').disabled,false);
});

test('saving one candidate locks only that candidate and next remains available',()=>{
 const h=fixture();h.render();
 h.batch.persisted=true;h.batch.name='评估批次';h.batch.saved.set(planKey(h.candidates[0].report),{storage:{run_name:'短线方案'}});h.render();
 assert.equal(h.node('evaluate').disabled,true);assert.equal(h.node('plan-name').value,'短线方案');
 assert.equal(h.node('result-name').disabled,true);assert.equal(h.node('result-name').value,'评估批次');
 assert.equal(h.node('save-next-plan').hidden,false);assert.equal(h.node('save-next-plan').dataset.candidate,'2');
 assert.equal(h.node('save-batch').disabled,false);assert.match(h.node('save-batch').textContent,/2 个/);
 h.render(1);assert.equal(h.node('evaluate').disabled,false);assert.equal(h.node('result-candidate').value,'2');
 assert.equal(h.node('plan-name').disabled,false);
});

test('unsaved names survive candidate switching; busy and pending input block both save paths',()=>{
 const h=fixture();h.render();h.node('plan-name').value='方案甲';h.node('plan-name').oninput();
 h.render(1);assert.equal(h.node('plan-name').value,'');h.render();assert.equal(h.node('plan-name').value,'方案甲');
 for(const [busy,reason] of [[true,''],[false,'输入待应用']]){
  h.render(0,busy,reason);assert.equal(h.node('evaluate').disabled,true);assert.equal(h.node('save-batch').disabled,true);
 }
 h.render();assert.equal(h.node('evaluate').disabled,false);assert.equal(h.node('save-batch').disabled,false);
});

test('a complete batch offers no duplicate save or next unsaved candidate',()=>{
 const h=fixture();for(const c of h.candidates)h.batch.saved.set(planKey(c.report),true);h.render();
 assert.equal(h.node('save-batch').disabled,true);assert.equal(h.node('evaluate').disabled,true);
 assert.equal(h.node('save-next-plan').hidden,true);assert.equal(h.node('save-batch').textContent,'本批次已保存');
});
