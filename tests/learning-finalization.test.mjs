import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCompleted,activityFinalized,summarizeCourseLearning} from '../public/learning.js';

const closure={closed:true,automatic:true,points:0,closedAt:'2035-02-01T15:00:00.000Z',deadlineAt:'2035-02-01T14:00:00.000Z',version:1,revision:1};
const closed={id:'closed',kind:'quiz',status:'published',responseState:'missing',submitted:false,closure};
const submitted={id:'sent',kind:'task',status:'published',responseState:'submitted',submitted:true};
const exempt={id:'exempt',kind:'task',status:'published',responseState:'pending',outcome:{state:'exempt',satisfactory:true}};
const now=Date.parse('2035-02-02T15:00:00.000Z');

test('automatic closure finalizes continuity without manufacturing a delivery or an approval',()=>{
 assert.equal(activityCompleted(closed),false);assert.equal(activityFinalized(closed),true);
 assert.equal(activityCompleted(exempt),false);assert.equal(activityFinalized(exempt),true);
 assert.equal(activityFinalized(submitted),true);
 for(const activity of [{id:'old',state:'missing',points:0,finished:true,ready:true},{...closed,closure:null},{...closed,closure:{...closure,closed:false,reopenedAt:'2035-02-02T14:00:00.000Z'}},{id:'expired',responseState:'draft',dueAt:'2000-01-01T00:00:00.000Z'}])assert.equal(activityFinalized(activity),false,'only an active durable closure can finalize an absent response');
});

test('summary keeps real-action percentage while reporting distinct continuity counters and recommendations',()=>{
 const resources=[{id:'material',published:true}],progress=[{resourceId:'material',completed:true}],draft={id:'draft',kind:'task',responseState:'draft'},future={id:'future',kind:'quiz',opensAt:'2035-02-05T15:00:00.000Z'},legacyMissing={id:'old',kind:'task',responseState:'missing',finished:true};
 const summary=summarizeCourseLearning(resources,[closed,exempt,submitted,draft,future,legacyMissing],progress,{now});
 assert.equal(summary.total,7);assert.equal(summary.completed,2);assert.equal(summary.percent,29);assert.equal(summary.pending,5);
 assert.equal(summary.finalized,4);assert.equal(summary.openPending,3);assert.equal(summary.activities.completed,1);
 assert.deepEqual([summary.activities.finalized,summary.activities.closedMissing,summary.activities.missing,summary.activities.exempt,summary.activities.openPending],[3,1,1,1,3]);
 assert.equal(summary.tasksCompleted,1);assert.equal(summary.quizzesCompleted,0);
 assert.equal(summary.next.item.id,'closed','legacy action accounting remains explicit for callers');
 assert.equal(summary.continueNext.item.id,'draft');assert.equal(summary.activities.continueNext.id,'draft');
 assert.equal(summary.continueNext.scheduled,false);
});

test('closure reopening and later real submission replace continuity state without double counting',()=>{
 const before=summarizeCourseLearning([],[closed],[],{now});assert.equal(before.percent,0);assert.equal(before.finalized,1);assert.equal(before.continueNext,null);
 const reopened={...closed,responseState:'draft',closure:{...closure,closed:false,points:null,reopenedAt:'2035-02-02T14:00:00.000Z'}};
 const during=summarizeCourseLearning([],[reopened],[],{now});assert.equal(during.finalized,0);assert.equal(during.openPending,1);assert.equal(during.activities.closedMissing,0);assert.equal(during.continueNext.item.id,'closed');
 const sent={...reopened,responseState:'submitted',submitted:true};const after=summarizeCourseLearning([],[sent],[],{now});assert.equal(after.percent,100);assert.equal(after.activities.completed,1);assert.equal(after.activities.finalized,1);assert.equal(after.activities.closedMissing,0);assert.equal(after.continueNext,null);
 const both={...submitted,exempt:true,closure};const one=summarizeCourseLearning([],[both],[],{now});assert.equal(one.activities.finalized,1);assert.equal(one.activities.closedMissing,0);
});

test('continuity skips hidden and duplicate requirements, preserves scheduled work and does not mutate history',()=>{
 const future={id:'future',kind:'task',opensAt:'2035-02-05T15:00:00.000Z'},items=[closed,closed,{...closed,id:'hidden',hidden:true},{id:'draft-publication',status:'draft'},future],before=JSON.stringify(items);
 const summary=summarizeCourseLearning([],items,[],{now});assert.equal(summary.activities.total,2);assert.equal(summary.activities.finalized,1);assert.equal(summary.activities.openPending,1);assert.equal(summary.continueNext.item.id,'future');assert.equal(summary.continueNext.scheduled,true);assert.equal(JSON.stringify(items),before);
 assert.equal(summarizeCourseLearning().continueNext,null);assert.equal(summarizeCourseLearning().finalized,0);
});
