import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {gradeCalculation} from '../server/academic-policy.mjs';
import {createApp} from '../server/index.mjs';

const activity=(id,weight,extra={})=>({id,title:id,weight,maxPoints:5,...extra});
const graded=(points,extra={})=>({id:'submission',state:'graded',points,published:1,payload:'{}',...extra});
function calculate(activities,records={},settings={},extra={}){
 return gradeCalculation(activities,'student',{scaleMax:5,missingAsZero:false,finalPublished:false,...settings},false,{rows:id=>records[id]||[],closed:()=>true,override:()=>false,...extra});
}

test('a grade of 4 on a 40 percent activity contributes 1.6 while the unassigned 60 percent remains zero',()=>{
 const result=calculate([activity('graded',40)],{graded:[graded(4)]},{finalPublished:true});
 assert.equal(result.accumulated,1.6);assert.equal(result.provisional,4);
 assert.equal(result.gradedWeight,40);assert.equal(result.weightTotal,40);
 assert.equal(result.ready,false);assert.equal(result.final,null);
 const pending=calculate([activity('graded',40),activity('pending',60)],{graded:[graded(4)]},{finalPublished:true});
 assert.equal(pending.accumulated,1.6);assert.equal(pending.provisional,4);assert.equal(pending.gradedWeight,40);
 assert.deepEqual(pending.cells.map(cell=>[cell.activityId,cell.state,cell.points]),[['graded','graded',4],['pending','pending',null]]);
 assert.equal(pending.final,null);
});

test('an accumulation of zero preserves unsubmitted, draft, submitted and returned work without assigning a grade',()=>{
 const empty=calculate([]);assert.equal(empty.accumulated,0);assert.equal(empty.allExempt,false);assert.equal(empty.ready,false);
 const activities=['pending','draft','submitted','returned'].map(id=>activity(id,25));
 const records={draft:[graded(null,{state:'draft',published:0})],submitted:[graded(null,{state:'submitted',published:0})],returned:[graded(null,{state:'returned',published:0,returned_at:'2026-10-01T00:00:00.000Z'})]};
 const before=structuredClone(records),result=calculate(activities,records);
 assert.equal(result.accumulated,0);assert.equal(result.provisional,null);assert.equal(result.gradedWeight,0);
 assert.deepEqual(result.cells.map(cell=>[cell.state,cell.points]),[['pending',null],['pending',null],['submitted',null],['returned',null]]);
 assert.deepEqual(records,before);assert.equal(result.ready,false);assert.equal(result.final,null);
 const actualZero=calculate([activity('zero',40)],{zero:[graded(0)]});
 assert.equal(actualZero.accumulated,0);assert.equal(actualZero.gradedWeight,40);
 assert.equal(actualZero.cells[0].state,'graded');assert.equal(actualZero.cells[0].points,0);
});

test('private points contribute to the teacher estimate while the student accumulation uses published points only',()=>{
 const activities=[activity('private',40)],records={private:[graded(4,{published:0})]};
 const student=calculate(activities,records),teacher=gradeCalculation(activities,'student',{scaleMax:5},true,{rows:id=>records[id],closed:()=>true,override:()=>false});
 assert.equal(student.accumulated,0);assert.equal(student.gradedWeight,0);assert.equal(student.cells[0].points,null);assert.equal(student.cells[0].state,'submitted');
 assert.equal(teacher.accumulated,1.6);assert.equal(teacher.gradedWeight,40);assert.equal(teacher.cells[0].points,4);assert.equal(teacher.ready,false);
});

test('partial cuts preserve both the semester weight and the effective percentage actually evaluated',()=>{
 const periods=[{id:'one',title:'First cut',weight:40},{id:'two',title:'Second cut',weight:60}];
 const result=calculate([activity('first',40,{periodId:'one',maxPoints:10})],{first:[graded(8)]},{periods,finalPublished:true});
 assert.equal(result.periods[0].accumulated,1.6);assert.equal(result.periods[0].gradedWeight,40);
 assert.equal(result.periods[1].accumulated,0);assert.equal(result.periods[1].gradedWeight,0);assert.equal(result.periods[1].allExempt,false);
 assert.equal(result.accumulated,0.64);assert.equal(result.gradedWeight,16);assert.equal(result.ready,false);assert.equal(result.final,null);
 assert.equal(result.provisional,4,'the older evaluated-only average remains available separately');
});

test('a partial exemption cannot exempt the unassigned remainder or remove a still-incomplete cut',()=>{
 const activities=[activity('exempt',40)],result=calculate(activities,{}, {},{override:()=>true});
 assert.equal(result.accumulated,0);assert.equal(result.allExempt,false);assert.equal(result.ready,false);
 const periods=[{id:'one',title:'First cut',weight:30},{id:'two',title:'Second cut',weight:70}];
 const cutActivities=[activity('exempt',40,{periodId:'one'}),activity('complete',100,{periodId:'two'})];
 const cuts=calculate(cutActivities,{complete:[graded(5)]},{periods,finalPublished:true},{override:id=>id==='exempt'});
 assert.equal(cuts.periods[0].allExempt,false);assert.equal(cuts.periods[0].accumulated,0);
 assert.equal(cuts.accumulated,3.5);assert.equal(cuts.gradedWeight,70);assert.equal(cuts.ready,false);assert.equal(cuts.final,null);
});

test('exempt activities redistribute only their exempt weight, preserving pending and unassigned percentages',()=>{
 const activities=[activity('exempt',20),activity('graded',40)],result=calculate(activities,{graded:[graded(4)]},{},{override:id=>id==='exempt'});
 assert.equal(result.accumulated,2);assert.equal(result.provisional,4);assert.equal(result.gradedWeight,50);
 assert.equal(result.ready,false);assert.equal(result.final,null);
 const fullyExempt=calculate([activity('exempt',100)],{},{finalPublished:true},{override:()=>true});
 assert.equal(fullyExempt.allExempt,true);assert.equal(fullyExempt.accumulated,null);
});

test('a genuinely exempt full cut retains the established final-grade policy',()=>{
 const periods=[{id:'one',title:'First cut',weight:30},{id:'two',title:'Second cut',weight:70}];
 const activities=[activity('graded',100,{periodId:'one'}),activity('exempt',100,{periodId:'two'})];
 const result=calculate(activities,{graded:[graded(5)]},{periods,finalPublished:true},{override:id=>id==='exempt'});
 assert.equal(result.periods[1].allExempt,true);assert.equal(result.periods[1].accumulated,null);
 assert.equal(result.accumulated,5);assert.equal(result.gradedWeight,100);assert.equal(result.ready,true);assert.equal(result.final,5);
});

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aula-accumulated-grade-'));
 const app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99730001',ADMIN_PASSWORD:'Accumulation-Master-2026!'}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-accumulated-grade-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 function client(){let cookie='';return async(path,body,method=body?'POST':'GET',status=200)=>{
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;
 };}
 const master=client();await master('/auth/login',{document:'99730001',password:'Accumulation-Master-2026!'});
 const template=await master('/admin/courses',{title:'Accumulation template'},'POST',201);
 const group=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Accumulation group',cohort:'2026-2',code:'A'},'POST',201);
 await master('/platform/courses/'+group.id+'/state',{state:'active'});
 await master('/admin/courses/'+group.id+'/enrollments/bulk',{students:[{document:'99730003',name:'Accumulation learner'}]},'POST',201);
 const student=client();await student('/auth/login',{document:'99730003',password:'99730003'});await student('/auth/first-password',{newPassword:'Accumulation-Learner-2026!',confirmPassword:'Accumulation-Learner-2026!'});
 const createActivity=body=>master('/academics/courses/'+group.id+'/activities',{title:'Contribution activity',kind:'task',status:'published',maxPoints:5,maxAttempts:3,...body},'POST',201);
 const submit=(activity,action='submit')=>student('/academics/activities/'+activity.id+'/submit',{activityRevision:activity.revision,requestId:randomUUID(),action,text:'Synthetic answer'},'POST',201);
 const mine=()=>student('/academics/courses/'+group.id);
 const book=async()=>(await master('/academics/courses/'+group.id+'/gradebook')).students[0];
 const grade=(submission,points)=>master('/academics/submissions/'+submission.id+'/grade',{version:submission.version,points,feedback:'Private teacher feedback',published:false},'PATCH');
 const release=submission=>master('/academics/submissions/'+submission.id+'/release',{version:submission.version});
 return {...app,master,student,group,createActivity,submit,mine,book,grade,release};
}

test('API accumulation is private until returned and pending-work rows never receive stored zero grades',async t=>{
 const f=await fixture(t),first=await f.createActivity({weight:40});let submission=await f.submit(first);
 let student=(await f.mine()).grade;assert.equal(student.accumulated,0);assert.equal(student.cells[0].state,'submitted');assert.equal(student.cells[0].points,null);
 submission=await f.grade(submission,4);
 student=(await f.mine()).grade;assert.equal(student.accumulated,0);assert.equal(student.cells[0].points,null);assert.equal(student.provisional,null);
 let teacher=await f.book();assert.equal(teacher.accumulated,1.6);assert.equal(teacher.cells[0].points,4);
 submission=await f.release(submission);
 student=(await f.mine()).grade;assert.equal(student.accumulated,1.6);assert.equal(student.gradedWeight,40);assert.equal(student.provisional,4);assert.equal(student.final,null);
 const activityPreview=await f.master('/academics/activities/'+first.id,{version:first.version,weight:20,preview:true},'PATCH');
 assert.deepEqual(activityPreview.impact.map(row=>[row.before,row.after]),[[1.6,0.8]],'weight preview must use accumulated contributions even when the evaluated-only average stays4');
 assert.equal((await f.mine()).grade.accumulated,1.6,'preview must not change stored weights or grades');
 assert.equal((await f.student('/academics/activities/'+first.id)).activity.weight,40);
 const pending=await f.createActivity({title:'Pending 60 percent',weight:60});
 student=(await f.mine()).grade;assert.equal(student.accumulated,1.6);assert.equal(student.cells.find(cell=>cell.activityId===pending.id).state,'pending');
 const draft=await f.submit(pending,'draft');
 student=(await f.mine()).grade;assert.equal(student.accumulated,1.6);assert.equal(student.cells.find(cell=>cell.activityId===pending.id).points,null);
 assert.deepEqual({...f.db.prepare('SELECT state,points,published FROM submissions WHERE id=?').get(draft.id)},{state:'draft',points:null,published:0});
 submission=await f.grade(submission,5);
 teacher=await f.book();student=(await f.mine()).grade;
 assert.equal(teacher.accumulated,2);assert.equal(student.accumulated,1.6);assert.equal(student.cells.find(cell=>cell.activityId===first.id).points,4);
 const privateRevisionPreview=await f.master('/academics/activities/'+first.id,{version:first.version,weight:20,preview:true},'PATCH');
 assert.deepEqual(privateRevisionPreview.impact.map(row=>[row.before,row.after]),[[2,1]],'the activity preview must use the private revision consistently on both sides');
 assert.equal((await f.mine()).grade.accumulated,1.6,'previewing a private revision must not publish it');
 submission=await f.release(submission);assert.equal((await f.mine()).grade.accumulated,2);
 submission=await f.master('/academics/submissions/'+submission.id+'/return',{version:submission.version,reason:'Review the explanation',returnDueAt:null},'PATCH');
 student=(await f.mine()).grade;assert.equal(student.accumulated,0);assert.equal(student.cells.find(cell=>cell.activityId===first.id).state,'returned');
 assert.deepEqual({...f.db.prepare('SELECT state,points,published FROM submissions WHERE id=?').get(submission.id)},{state:'returned',points:null,published:0});
 assert.equal(f.db.prepare('SELECT COUNT(*) count FROM submissions WHERE points=0').get().count,0);
 assert.equal((await f.mine()).settings.missingAsZero,false);
});

test('evaluation settings preview compares the semester accumulation instead of an unchanged evaluated-only average',async t=>{
 const f=await fixture(t),periods=[{id:'one',title:'First cut',weight:40},{id:'two',title:'Second cut',weight:60}];
 await f.master('/academics/courses/'+f.group.id+'/settings',{periods},'PUT');
 const first=await f.createActivity({weight:100,periodId:'one'});
 await f.release(await f.grade(await f.submit(first),4));
 const before=(await f.mine()).grade;assert.equal(before.accumulated,1.6);assert.equal(before.provisional,4);
 const preview=await f.master('/academics/courses/'+f.group.id+'/settings',{periods:[{...periods[0],weight:20},{...periods[1],weight:80}],preview:true},'PUT');
 assert.deepEqual(preview.impact.map(row=>[row.before,row.after]),[[1.6,0.8]]);
 const after=await f.mine();assert.equal(after.grade.accumulated,1.6);assert.equal(after.grade.provisional,4);assert.deepEqual(after.settings.periods,periods);
});

test('activity impact preview retains private drafts belonging to other activities',async t=>{
 const f=await fixture(t),first=await f.createActivity({title:'Published grade with private revision',weight:40}),second=await f.createActivity({title:'Another private grade',weight:40});
 await f.createActivity({title:'Pending remainder',weight:20});
 let firstSubmission=await f.release(await f.grade(await f.submit(first),4));
 firstSubmission=await f.grade(firstSubmission,5);
 await f.grade(await f.submit(second),3);
 assert.equal((await f.book()).accumulated,3.2);assert.equal((await f.mine()).grade.accumulated,1.6);
 const preview=await f.master('/academics/activities/'+first.id,{version:first.version,weight:20,preview:true},'PATCH');
 assert.deepEqual(preview.impact.map(row=>[row.before,row.after]),[[3.2,2.2]],'the untouched activity must retain its private contribution in the after calculation');
 const another=await f.master('/academics/activities/'+second.id,{version:second.version,weight:20,preview:true},'PATCH');
 assert.deepEqual(another.impact.map(row=>[row.before,row.after]),[[3.2,2.6]]);
 assert.equal((await f.book()).accumulated,3.2);assert.equal((await f.mine()).grade.accumulated,1.6);
 assert.equal((await f.student('/academics/activities/'+first.id)).activity.weight,40);
 assert.equal((await f.student('/academics/activities/'+second.id)).activity.weight,40);
});
