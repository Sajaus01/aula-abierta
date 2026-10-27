import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionMaxPoints,submissionScaleAdjustment,questionPointsTotal} from '../public/grading-scale.js';
import {prepareScaleConversions} from '../server/activity-scales.mjs';
import {scaleOnlyChange,gradeCalculation} from '../server/academic-policy.mjs';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const record=(id,extra={})=>({id,student_id:id,points:null,state:'submitted',published:0,version:1,payload:'{}',...extra});

test('effective scale prefers its explicit value and keeps a positive authentic historical fallback',()=>{
 assert.equal(submissionMaxPoints({gradingMaxPoints:5,previousActivity:{maxPoints:100}},{maxPoints:10}),5);
 assert.equal(submissionMaxPoints({previousActivity:{maxPoints:100}},{maxPoints:5}),100);
 assert.equal(submissionMaxPoints({}, {maxPoints:5}),5);assert.equal(submissionMaxPoints({gradingMaxPoints:0},{maxPoints:5}),null);
 assert.deepEqual(submissionScaleAdjustment({gradingMaxPoints:5,previousActivity:{maxPoints:100}},{maxPoints:5}),{from:100,to:5});
 assert.equal(submissionScaleAdjustment({gradingMaxPoints:5,scaleAdjustment:{from:5,to:5}},{maxPoints:5}),null);
 assert.equal(questionPointsTotal([{points:1/3},{points:1/3},{points:1/3}]),1);assert.equal(questionPointsTotal([{points:1.6665}]),1.6665);
});

test('a proportional conversion preserves zero, null and private drafts without rounding the score before calculation',()=>{
 const activity={id:'a',kind:'task',status:'published',weight:100,maxPoints:3},raw=record('third',{points:1,published:1,payload:JSON.stringify({automaticPoints:1,teacherGradeDraft:{points:null,feedback:'Keep this'},previousActivity:{maxPoints:3}})});
 const converted=prepareScaleConversions([raw,record('zero',{points:0}),record('draft',{state:'draft'})],activity,5,fail,{at:'2026-10-27T12:00:00.000Z'});
 assert.equal(converted[0].points,1/3*5);assert.ok(converted[0].points!==1.67);assert.equal(converted[0].payload.automaticPoints,1/3*5);assert.equal(converted[0].payload.teacherGradeDraft.points,null);assert.equal(converted[0].payload.teacherGradeDraft.feedback,'Keep this');assert.equal(converted[0].payload.previousActivity.maxPoints,3);
 assert.equal(converted[1].points,0);assert.equal(converted[2].points,null);assert.equal(converted[2].payload.gradingMaxPoints,5);assert.equal(raw.points,1);assert.equal(JSON.parse(raw.payload).automaticPoints,1);
 const calculate=(a,s)=>gradeCalculation([a],'third',{scaleMax:5,missingAsZero:false},false,{rows:()=>[s],closed:()=>false,override:()=>false});
 assert.equal(calculate(activity,raw).accumulated,calculate({...activity,maxPoints:5},{...raw,points:converted[0].points,payload:JSON.stringify(converted[0].payload)}).accumulated);
});

test('each response converts from its own scale and invalid data prevents a partial conversion plan',()=>{
 const rows=[record('one',{points:80,payload:JSON.stringify({previousActivity:{maxPoints:100}})}),record('two',{points:4,payload:JSON.stringify({gradingMaxPoints:10})}),record('history',{points:70,superseded:1,payload:JSON.stringify({gradingMaxPoints:100})})];
 const converted=prepareScaleConversions(rows,{maxPoints:5},5,fail);assert.deepEqual(converted.map(row=>[row.id,row.from,row.points]),[['one',100,4],['two',10,2]]);
 assert.throws(()=>prepareScaleConversions([...rows,record('invalid',{points:200,payload:'{}'})],{maxPoints:100},5,fail),error=>error.status===409);
 assert.equal(prepareScaleConversions([record('same',{points:4,payload:JSON.stringify({gradingMaxPoints:5})})],{maxPoints:5},5,fail).length,0);
});

test('scale-only classification permits pure task or question-point changes but excludes rewritten content',()=>{
 const task={kind:'task',title:'Task',maxPoints:100,questions:[]},quiz={kind:'quiz',title:'Quiz',maxPoints:100,questions:[{id:'q',type:'text',prompt:'Explain',points:100}]};
 assert.equal(scaleOnlyChange(task,{...task,maxPoints:5}),true);assert.equal(scaleOnlyChange(quiz,{...quiz,maxPoints:5,questions:[{...quiz.questions[0],points:5}]}),true);
 assert.equal(scaleOnlyChange(task,task,false,{hasScaleMismatch:true}),true);assert.equal(scaleOnlyChange(task,task),false);
 const equal={...quiz,questions:[{...quiz.questions[0],id:'one',points:50},{...quiz.questions[0],id:'two',points:50}]};
 assert.equal(scaleOnlyChange(equal,{...equal,maxPoints:5,questions:equal.questions.map(question=>({...question,points:2.5}))}),true);
 assert.equal(scaleOnlyChange(equal,{...equal,maxPoints:140,questions:[{...equal.questions[0],points:90},equal.questions[1]]}),false);
 assert.equal(scaleOnlyChange(equal,{...equal,questions:[{...equal.questions[0],points:90},{...equal.questions[1],points:10}]},false,{hasScaleMismatch:true}),false);
 assert.equal(scaleOnlyChange(task,{...task,maxPoints:5,title:'Different task'}),false);assert.equal(scaleOnlyChange(quiz,{...quiz,maxPoints:5,questions:[{...quiz.questions[0],prompt:'Different question',points:5}]}),false);assert.equal(scaleOnlyChange(task,{...task,maxPoints:5},true),false);
});
