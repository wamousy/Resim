// Execute the real save handler against a small UI adapter; no browser or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {newBatch,planKey,saveBlockedReason} from '../../frontend/batch-save.js';
import {resultFolderName} from '../../frontend/task-progress.js';
import {minimalProject} from '../fixtures/minimal-project.mjs';

const app=readFileSync(new URL('../../frontend/app.js',import.meta.url),'utf8');
const handler=app.slice(app.indexOf('async function savePlans(mode){'),app.indexOf('function updateAssessment(){'));
function setup(){
 const reports=[1,2,3].map(n=>{const project=minimalProject();project.floorplan.placements[0].x_um+=n*100;return {plan_id:String(n),project};});
 const candidates=reports.map((report,i)=>({id:String(i),name:'方案'+(i+1),report}));
 const fields={'result-name':{value:'本次探索'},'plan-name':{value:'自定义方案'},candidate:{selectedOptions:[{textContent:'方案2'}]},'project-name':{value:'项目'},'output-dir':{value:''}};
 const calls=[],notices=[];
 const c={busy:false,report:reports[1],searchResult:{candidates:reports},batchContext:newBatch(reports[0].project,'optimize'),planParent:null,
   rawEdited:false,structureDirty:false,previewPending:false,previewFailed:false,inputEditor:{hasPending:()=>false},
   candidateSaves:new Map(),activeCandidate:'1',currentProjectId:null,dirty:true,draftChanged:true,
   document:{body:{dataset:{workspace:'reports'}}},$:id=>fields[id],clone:structuredClone,
   saveBlockedReason,planKey,resultFolderName,distinctCandidates:()=>candidates,updateFiles(){},renderSavePanel(){},
   batchPanel:{choices:()=>candidates.map(p=>({key:planKey(p.report),name:p.name,selected:p.id!=='1'}))},
   setBusy:b=>{c.busy=b;},taskProgress:{reset(){}},localStorage:{setItem(){}},notice:(...args)=>notices.push(args),
   refreshProjects:async()=>{},refreshHistory:async()=>{},openWorkspace(){},
   api:async(path,body)=>{
     calls.push(body);if(c.failAt===calls.length)throw new Error('simulated failure');
     return {batch:{name:body.batch_name},report:{plan_id:body.preview_plan_id,project:JSON.parse(body.yaml),storage:{project_id:'chip',project_name:'项目',project_dir:'D:/chip',run_id:'record-'+body.preview_plan_id,run_name:body.plan_name,batch_id:body.batch_id,source_key:body.source_key}}};
   }};
 const save=vm.runInNewContext(handler+'\nsavePlans;',c);
 return {c,calls,notices,save,reports,fields,candidates};
}
test('current save persists only the report being viewed, preserving the other candidates',async()=>{
 const h=setup();await h.save('current');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].preview_plan_id,'2');
 assert.equal(h.calls[0].plan_name,'自定义方案');assert.deepEqual(JSON.parse(h.calls[0].yaml),h.reports[1].project);
 assert.equal(h.c.searchResult.candidates.length,3);assert.equal(h.c.candidateSaves.size,1);assert.equal(h.c.dirty,false);
});
test('selected save shares a batch and does not replace the unselected viewed layout',async()=>{
 const h=setup();await h.save('selected');
 assert.deepEqual(h.calls.map(c=>c.preview_plan_id),['1','3']);assert.equal(h.calls[0].batch_id,h.calls[1].batch_id);
 assert.equal(h.calls[1].project_id,'chip');assert.equal(h.c.report.plan_id,'2');assert.equal(h.c.dirty,true);
});
test('all save resumes after a partial failure without resaving committed plans',async()=>{
 const h=setup();h.c.failAt=2;await h.save('all');
 assert.equal(h.c.batchContext.saved.size,1);assert.ok(h.notices.some(([s])=>s.includes('1 / 3')));
 h.c.failAt=null;await h.save('all');
 assert.deepEqual(h.calls.map(c=>c.preview_plan_id),['1','2','2','3']);assert.equal(h.c.batchContext.saved.size,3);
 assert.equal(new Set(h.calls.map(c=>c.batch_id)).size,1);
});
test('unapplied raw YAML blocks all three save entry points',async()=>{
 for(const mode of ['current','selected','all']){const h=setup();h.c.rawEdited=true;await h.save(mode);assert.equal(h.calls.length,0);assert.match(h.notices[0][0],/先应用预览/);}
});
test('an unchanged candidate is not its own parent; manual edits retain the source',async()=>{
 const h=setup();h.c.planParent={record:null,key:planKey(h.c.report)};await h.save('current');
 assert.equal(h.calls[0].parent_source_key,null);
 const edited=setup();edited.c.planParent={record:'record-1',key:'layout-1'};await edited.save('current');
 assert.equal(edited.calls[0].parent_record_id,'record-1');assert.equal(edited.calls[0].parent_source_key,'layout-1');
});

test('consecutive single saves reuse the first batch without removing candidates',async()=>{
 const h=setup();h.fields['result-name'].value='';await h.save('current');
 h.c.report=h.reports[2];h.c.activeCandidate='2';h.c.dirty=true;
 h.fields['plan-name'].value='第二个已选方案';h.fields['result-name'].value='不应另建批次';
 await h.save('current');
 assert.deepEqual(h.calls.map(c=>c.preview_plan_id),['2','3']);
 assert.deepEqual(h.calls.map(c=>c.batch_name),['布局批次','布局批次']);
 assert.equal(h.calls[0].batch_id,h.calls[1].batch_id);
 assert.equal(h.calls[1].project_id,'chip');assert.equal(h.calls[1].plan_name,'第二个已选方案');
 assert.equal(h.c.batchContext.saved.size,2);assert.equal(h.c.searchResult.candidates.length,3);
 await h.save('current');assert.equal(h.calls.length,2);
});

test('single then batch saves only the remaining selected plans and preserves current view',async()=>{
 const h=setup();await h.save('current');const viewed=h.c.report;
 await h.save('selected');
 assert.deepEqual(h.calls.map(c=>c.preview_plan_id),['2','1','3']);
 assert.equal(new Set(h.calls.map(c=>c.batch_id)).size,1);assert.equal(h.c.batchContext.saved.size,3);
 assert.equal(h.c.report,viewed);assert.equal(h.c.activeCandidate,'1');assert.equal(h.c.candidateSaves.size,3);
 await h.save('selected');assert.equal(h.calls.length,3);
});

test('batch save can be followed by saving an unselected candidate individually',async()=>{
 const h=setup();await h.save('selected');await h.save('current');
 assert.deepEqual(h.calls.map(c=>c.preview_plan_id),['1','3','2']);
 assert.equal(new Set(h.calls.map(c=>c.batch_id)).size,1);assert.equal(h.c.dirty,false);
 assert.equal(h.c.report.storage.run_name,'自定义方案');
});

test('cancelling a candidate switch restores the result picker and keeps draft state',async()=>{
 const h=setup();h.fields.candidate.value='2';let renders=0;
 h.c.renderSavePanel=()=>{renders++;};h.c.canLeaveDraft=async()=>false;
 const source=app.slice(app.indexOf('async function selectCandidate(next){'),app.indexOf("$('candidate').onchange="));
 await vm.runInNewContext(source+'\nselectCandidate;',h.c)('2');
 assert.equal(h.fields.candidate.value,'1');assert.equal(h.c.activeCandidate,'1');
 assert.equal(h.c.report,h.reports[1]);assert.equal(h.c.dirty,true);assert.equal(renders,1);
});
