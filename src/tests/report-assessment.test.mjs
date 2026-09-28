import test from 'node:test';
import assert from 'node:assert/strict';
import {assessedReport} from '../web/report-assessment.js';
import {compareSelections} from '../web/multi-comparison.js';
import {minimalProject} from './fixtures/minimal-project.mjs';
import {writeStack} from '../web/stack-model.js';

test('display and history comparison include the same additional stack findings',()=>{
 const project=minimalProject(),raw={project,summary:{errors:0,unknowns:0,warnings:0},issues:[]};
 const checked=assessedReport(raw);
 assert.equal(checked.summary.unknowns,1);assert.equal(checked.issues[0].code,'STACK_GEOMETRY');
 assert.equal(raw.summary.unknowns,0);assert.equal(raw.issues.length,0);
 assert.deepEqual(assessedReport(checked),checked);
 const fixed={...raw,project:writeStack(project,{die_faces:{die0:'up'}})};
 const result=compareSelections([{project_id:'p',run_id:'a',candidate:'current',report:raw},{project_id:'p',run_id:'b',candidate:'current',report:fixed}]);
 assert.deepEqual(result.metrics.find(m=>m.id==='unknowns').values,[1,0]);
 assert.equal(result.issues.length,1);assert.equal(result.issues[0].occurrences[1],null);
 assert.match(result.assessment_scope,/web-stack/);
});
