import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticZeroHTML,closedActivityResultHTML,publishedManualGrade} from '../public/activity-state.js';
import {studentActivityWorkspace,studentResponseContext} from '../public/activity-workspace.js';
import {activityCompleted,activityFinalized} from '../public/learning.js';
import {activityOutcome} from '../server/chapter-outcomes.mjs';
import {summarizeActivityEvaluation} from '../server/activity-evaluation.mjs';
import {activityEvaluationPresentation} from '../public/activity-evaluation.js';

const activity={id:'task',courseId:'group',title:'Práctica',kind:'task',status:'published',maxPoints:5,maxAttempts:1,weight:100,questions:[],attachments:[],allowLate:false,dueAt:'2026-01-01T00:00:00Z',closure:{closed:true,points:0,version:1}};
const manual={id:'manual',manualGrade:true,published:true,points:4,gradingMaxPoints:5,feedback:'Evaluación presencial <aprobada>',version:2};
const render=(grade=manual)=>studentActivityWorkspace({activity,mine:[],manualGrade:grade},{questionMedia:()=>'',questionPreview:()=>''});

test('a published teacher mark replaces the visible automatic zero without implying a delivery or reopening',()=>{
 const item={...activity,manualGrade:manual},html=render();
 assert.match(html,/Calificación docente · sin entrega/);assert.match(html,/Evaluación presencial &lt;aprobada&gt;/);assert.match(html,/El plazo permanece cerrado/);
 assert.doesNotMatch(html,/Entrega enviada|id="academic-submit"|<strong>0 /);
 assert.equal(studentResponseContext(item,[]).editable,false);assert.equal(activityCompleted(item),false);assert.equal(activityFinalized(item),true);
 assert.match(automaticZeroHTML(item),/Nota docente: 4 \/ 5/);assert.doesNotMatch(closedActivityResultHTML(item),/0 <small>/);
});

test('an unpublished manual grade never replaces the automatic public result or leaks its comment',()=>{
 const privateGrade={...manual,published:false,points:3,feedback:'Secret comment'};
 assert.equal(publishedManualGrade({...activity,manualGrade:privateGrade}),null);
 assert.match(closedActivityResultHTML({...activity,manualGrade:privateGrade}),/0 <small>/);
 assert.doesNotMatch(render(privateGrade),/Secret comment|Calificación docente · sin entrega/);
 const changed={...manual,gradeDraft:true,points:1,feedback:'Private edit',publishedPoints:4,publishedFeedback:'Official comment'};
 assert.equal(publishedManualGrade({...activity,manualGrade:changed}).points,4);
 assert.match(closedActivityResultHTML({...activity,manualGrade:changed}),/Official comment/);
 assert.doesNotMatch(closedActivityResultHTML({...activity,manualGrade:changed}),/Private edit/);
});

test('official manual marks can satisfy chapter results while private edits cannot approve a chapter',()=>{
 const cell={manualGrade:true,state:'graded',points:4,maxPoints:5,published:true};
 assert.deepEqual(activityOutcome(null,cell,{scaleMax:5,passMark:3}),{state:'gradedPass',satisfactory:true});
 assert.deepEqual(activityOutcome(null,{...cell,points:0},{scaleMax:5,passMark:3}),{state:'gradedBelow',satisfactory:false});
 assert.deepEqual(activityOutcome(null,{...cell,published:false},{scaleMax:5,passMark:3}),{state:'pending',satisfactory:false});
});

test('evaluation distinguishes teacher marks from real submissions and gives actual deliveries precedence',()=>{
 const record={id:'manual',activity_id:'task',student_id:'student',manualGrade:true,state:'graded',points:4,published:0,payload:JSON.stringify({gradingMaxPoints:5})};
 const summary=summarizeActivityEvaluation(activity,[record]);
 assert.equal(summary.state,'evaluated');assert.equal(summary.submitted,0);assert.equal(summary.evaluated,1);assert.equal(summary.manualEvaluated,1);assert.equal(summary.unreleased,1);
 const presentation=activityEvaluationPresentation({...activity,evaluation:summary});assert.match(presentation.description,/nota docente sin entrega/);assert.doesNotMatch(presentation.description,/1 de 0/);
 const actual={id:'real',student_id:'student',state:'submitted',attempt:1,payload:'{}',points:null,published:0};
 const withDelivery=summarizeActivityEvaluation(activity,[record,actual]);assert.equal(withDelivery.submitted,1);assert.equal(withDelivery.pending,1);assert.equal(withDelivery.evaluated,0);assert.equal(withDelivery.manual,undefined);
});
