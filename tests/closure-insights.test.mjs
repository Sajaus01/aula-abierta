import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-closure-insights-')),password='Closure-Insights-2026!';
 const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99882001',ADMIN_PASSWORD:password}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-closure-insights-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 function client(view='teaching'){let cookie='';return async(path,body,method=body===undefined?'GET':'POST',status=200)=>{
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Aula-View':view},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(value));return value.data;
 };}
 const master=client();await master('/auth/login',{document:'99882001',password});const people={};
 for(const [key,document,role] of [['teacher','99882002','teacher'],['viewer','99882003','teacher'],['student','99882004','student'],['peer','99882005','student']]){
  const user=await master('/platform/users',{document,name:'Synthetic '+key,roles:[role]},'POST',201),call=client(role==='student'?'learning':'teaching');await call('/auth/login',{document,password:document});await call('/auth/first-password',{newPassword:password,confirmPassword:password});people[key]={...user,call};
 }
 const template=await master('/admin/courses',{title:'Synthetic closure course'},'POST',201),group=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Synthetic closure group',cohort:'2026',code:'C'},'POST',201);
 await master('/platform/courses/'+group.id+'/state',{state:'active'});
 for(const key of ['teacher','viewer'])await master('/platform/courses/'+group.id+'/staff',{userId:people[key].id,edit:key==='teacher',grade:key==='teacher',manage:false});
 for(const key of ['student','peer'])await master('/admin/enrollments',{studentId:people[key].id,courseId:group.id},'POST',201);
 const module=await master('/admin/courses/'+group.id+'/modules',{title:'Synthetic chapter',published:true},'POST',201),material=await master('/admin/modules/'+module.id+'/resources',{title:'Synthetic material',kind:'html',content:'<p>Test content.</p>',published:true},'POST',201);
 const activities={};for(const key of ['closed','delivered','draft','exempt'])activities[key]=await master('/academics/courses/'+group.id+'/activities',{title:'Synthetic '+key,kind:'task',moduleId:module.id,weight:25,maxPoints:10,maxAttempts:2,status:'published',dueAt:'2099-01-01T00:00:00.000Z'},'POST',201);
 async function submit(key,{draft=false}={}){const activity=activities[key];return people.student.call('/academics/activities/'+activity.id+'/submit',{requestId:randomUUID(),activityRevision:activity.revision,action:draft?'draft':'submit',text:'Synthetic student response'},'POST',201);}
 const delivered=await submit('delivered');await master('/academics/submissions/'+delivered.id+'/grade',{version:delivered.version,points:8,published:true,feedback:'Synthetic public feedback'},'PATCH');
 const draft=await submit('draft',{draft:true});await people.student.call('/progress/'+material.id,{completed:true},'PUT');
 await master('/grade-policy/'+group.id,{activityId:activities.exempt.id,studentId:people.student.id,exempt:true,reason:'Synthetic exemption'});
 for(const key of ['closed','draft','exempt'])app.db.prepare("UPDATE activities SET config=json_set(config,'$.dueAt','2000-01-01T00:00:00.000Z','$.closesAt','2000-01-02T00:00:00.000Z') WHERE id=?").run(activities[key].id);
 const report=(person='')=>people.teacher.call('/analytics/'+group.id+(person?'?student='+person:''));
 return {...app,master,people,group,activities,draft,report,submit};
}

test('insights separate durable closure, real delivery, progress and continuity, including reopening and replacement',async t=>{
 const f=await fixture(t),studentId=f.people.student.id,before=f.db.prepare('SELECT count(*) n FROM submissions').get().n;
 let report=await f.report(),student=report.students.find(row=>row.id===studentId);
 assert.deepEqual([student.current.submitted,student.current.pending,student.current.overdue,student.current.pendingTotal],[1,0,2,2]);
 assert.deepEqual([student.current.closedMissing,student.current.finalized,student.current.openPending,student.current.exempt],[2,4,0,1]);
 assert.equal(student.current.progress,40);assert.equal(student.current.completedElements,2);assert.equal(student.period.visits,0);assert.equal(student.period.activeSeconds,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM submissions').get().n,before,'closing never inserts a fake submission');
 assert.equal(f.db.prepare('SELECT state FROM submissions WHERE id=?').get(f.draft.id).state,'draft','the saved response remains recoverable');
 const closed=student.activityStates.find(row=>row.id===f.activities.closed.id);assert.equal(closed.responseState,'missing');assert.equal(closed.submitted,false);assert.equal(closed.finalized,true);assert.equal(closed.overdue,true);assert.equal(closed.closure.closed,true);assert.equal(closed.submissionId,null);assert.equal(closed.points,0);
 assert.equal(report.summary.group.closedMissing,5);assert.equal(report.summary.group.submitted,1);assert.equal(report.summary.group.finalized,7);assert.equal(report.summary.group.openPending,1);
 const baselineActions=f.db.prepare("SELECT count(*) n FROM learning_events WHERE user_id=?").get(studentId).n;
 const extensionPath='/academics/activities/'+f.activities.closed.id+'/extensions/'+studentId;await f.master(extensionPath,{version:0,dueAt:null},'PUT');
 student=(await f.report(studentId)).students[0];assert.deepEqual([student.current.submitted,student.current.closedMissing,student.current.finalized,student.current.openPending,student.current.overdue],[1,1,3,1,1]);assert.equal(student.current.progress,40);
 const reopened=student.activityStates.find(row=>row.id===f.activities.closed.id);assert.equal(reopened.responseState,'pending');assert.equal(reopened.closure.closed,false);assert.equal(reopened.effectiveDueAt,null);assert.equal(reopened.overdue,false);
 await f.submit('closed');student=(await f.report(studentId)).students[0];assert.deepEqual([student.current.submitted,student.current.closedMissing,student.current.finalized,student.current.openPending,student.current.awaitingGrade],[2,1,4,0,1]);assert.equal(student.current.progress,60);
 assert.equal(f.db.prepare("SELECT count(*) n FROM learning_events WHERE user_id=?").get(studentId).n,baselineActions,'system finalization does not invent learner activity');
 assert.equal(f.db.prepare('SELECT count(*) n FROM submissions').get().n,before+1);
});

test('automatic events are system grading records, scoped by student and never exposed to view-only collaborators',async t=>{
 const f=await fixture(t),studentId=f.people.student.id;await f.report();
 const report=await f.report(studentId),automatic=report.events.filter(event=>event.action.startsWith('activity.auto-'));
 assert.equal(automatic.filter(event=>event.action==='activity.auto-close').length,2);assert.ok(automatic.every(event=>event.userId===studentId&&event.actorId===null));assert.equal(report.detail.events.filter(event=>event.action==='activity.auto-close').length,2);
 const q='?group='+f.group.id+'&category=grades&person='+studentId,teacher=await f.people.teacher.call('/platform/overview'+q),events=teacher.events.filter(event=>event.action.startsWith('activity.auto-'));
 assert.equal(events.length,2);assert.ok(events.every(event=>event.category==='grades'&&event.actor.name==='Sistema'&&event.context.student.id===studentId));assert.ok(events.every(event=>!event.context.submission),'an automatic closure is not a submitted attempt');
 const viewer=await f.people.viewer.call('/platform/overview'+q);assert.equal(viewer.events.length,0);assert.equal(viewer.total,0);
 const submissions=await f.people.teacher.call('/platform/overview?group='+f.group.id+'&category=submissions');assert.ok(submissions.events.every(event=>!event.action.startsWith('activity.auto-')));
 const before=f.db.prepare("SELECT count(*) n FROM audit WHERE action='activity.auto-close'").get().n;await f.report();await f.report();assert.equal(f.db.prepare("SELECT count(*) n FROM audit WHERE action='activity.auto-close'").get().n,before,'repeated reports do not journal another closure');
 await f.people.student.call('/platform/overview'+q,undefined,'GET',403);
});
