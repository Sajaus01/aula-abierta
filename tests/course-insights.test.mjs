import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {insightsFilters} from '../server/course-insights.mjs';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const iso=value=>new Date(value).toISOString();
const day=value=>iso(value-5*3600000).slice(0,10);

test('insight date filters use real Bogota calendar days and an explicit thirty-day default',()=>{
 const at=Date.parse('2026-10-27T03:30:00.000Z'),defaults=insightsFilters(new URLSearchParams(),fail,at);
 assert.equal(defaults.to,'2026-10-26');assert.equal(defaults.from,'2026-09-27');assert.equal(defaults.defaultPeriod,true);
 const explicit=insightsFilters(new URLSearchParams('from=2024-02-29&to=2024-03-01'),fail,at);
 assert.equal(explicit.startAt,'2024-02-29T05:00:00.000Z');assert.equal(explicit.endAt,'2024-03-02T04:59:59.999Z');
 assert.equal(explicit.timezone,'America/Bogota');assert.equal(explicit.defaultPeriod,false);
 for(const query of ['from=2025-02-29','to=2026-04-31','from=2026-13-01','from=2026-10-28&to=2026-10-27'])assert.throws(()=>insightsFilters(new URLSearchParams(query),fail,at),error=>error.status===400);
});

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-course-insights-')),app=await createApp({dataDir:dir,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99640001',ADMIN_PASSWORD:'Insights-Master-2026!'}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-course-insights-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>{let cookie='';return async(path,body,method=body===undefined?'GET':'POST',status=200)=>{const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;};};
 const master=client();await master('/auth/login',{document:'99640001',password:'Insights-Master-2026!'});
 const people={};
 for(const [key,document,name,role]of [['teacher','99640002','Insights teacher','teacher'],['student','99640003','Alpha learner','student'],['second','99640004','Beta learner','student'],['outsider','99640005','Foreign teacher','teacher'],['viewer','99640006','View-only teacher','teacher']]){const user=await master('/platform/users',{document,name,roles:[role]},'POST',201),call=client();await call('/auth/login',{document,password:document});await call('/auth/first-password',{newPassword:'Insights-Person-2026!',confirmPassword:'Insights-Person-2026!'});people[key]={...user,call};}
 const template=await master('/admin/courses',{title:'Insights template'},'POST',201),group=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Insights group A',cohort:'2026-2',code:'A'},'POST',201),other=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Insights group B',cohort:'2026-2',code:'B'},'POST',201);
 await master('/platform/courses/'+group.id+'/state',{state:'active'});await master('/platform/courses/'+other.id+'/state',{state:'active'});
 await master('/platform/courses/'+group.id+'/staff',{userId:people.teacher.id,edit:true,grade:true,manage:false});
 await master('/platform/courses/'+group.id+'/staff',{userId:people.viewer.id,edit:true,grade:false,manage:false});
 await master('/platform/courses/'+other.id+'/staff',{userId:people.teacher.id,edit:true,grade:false,manage:false});
 for(const key of ['student','second'])await master('/admin/enrollments',{studentId:people[key].id,courseId:group.id},'POST',201);
 const module=await master('/admin/courses/'+group.id+'/modules',{title:'Visible chapter',published:true},'POST',201),hidden=await master('/admin/courses/'+group.id+'/modules',{title:'Hidden chapter',published:false},'POST',201);
 const addMaterial=(module,title,published=true)=>master('/admin/modules/'+module.id+'/resources',{title,kind:'html',content:'<p>Synthetic material.</p>',published},'POST',201);
 const materials=[await addMaterial(module,'Visible one'),await addMaterial(module,'Visible two')];await addMaterial(module,'Hidden material',false);await addMaterial(hidden,'Hidden chapter material');
 for(const resource of materials)await people.student.call('/progress/'+resource.id,{completed:true},'PUT');
 const addActivity=body=>master('/academics/courses/'+group.id+'/activities',{title:'Synthetic task',kind:'task',status:'published',moduleId:module.id,maxPoints:5,maxAttempts:3,...body},'POST',201);
 const submit=(activity,action='submit')=>people.student.call('/academics/activities/'+activity.id+'/submit',{activityRevision:activity.revision,requestId:randomUUID(),action,text:'Synthetic answer.'},'POST',201);
 const delivered=await addActivity({title:'Graded activity',weight:40});
 let first=await submit(delivered);await master('/academics/submissions/'+first.id+'/grade',{version:first.version,points:5,published:true},'PATCH');
 const latest=await submit(delivered);await master('/academics/submissions/'+latest.id+'/grade',{version:latest.version,points:4,published:true},'PATCH');
 const awaiting=await addActivity({title:'Awaiting grade',weight:20});await submit(awaiting);
 const overdue=await addActivity({title:'Overdue without response',weight:20,dueAt:iso(Date.now()-3600000)});
 const returned=await addActivity({title:'Correction without new deadline',weight:20,dueAt:iso(Date.now()-3600000),allowLate:true}),sent=await submit(returned);
 const correction=await master('/academics/submissions/'+sent.id+'/return',{version:sent.version,reason:'Correct the units.',returnDueAt:null},'PATCH');
 await addActivity({title:'Hidden chapter task',weight:0,moduleId:hidden.id});await addActivity({title:'Draft task',weight:0,status:'draft'});
 for(let index=0;index<3;index++)await people.student.call('/courses/'+group.id);
 const started=Date.now()-10*86400000;app.db.prepare("UPDATE learning_measurement_meta SET value=? WHERE key='startedAt'").run(iso(started));
 for(const [index,offset,active]of [[1,7200000,900],[2,2400000,180]]){const start=Date.now()-offset,id='insights-session-'+index;app.db.prepare('INSERT INTO learning_work_sessions VALUES(?,?,?,?,?,?)').run(id,people.student.id,group.id,iso(start),iso(start+active*1000),iso(start+active*1000));app.db.prepare('INSERT INTO learning_active_intervals(session_id,started_at,ended_at) VALUES(?,?,?)').run(id,iso(start),iso(start+active*1000));}
 const query='?from='+day(Date.now()-3*86400000)+'&to='+day(Date.now());
 return {...app,master,people,group,other,module,materials,activities:{delivered,awaiting,overdue,returned},correction,query,submit,report:(extra='')=>people.teacher.call('/analytics/'+group.id+query+extra)};
}

test('course reports count latest work once and share integral progress, current accumulation and measured participation',async t=>{
 const f=await fixture(t),started=performance.now(),report=await f.report(),student=report.students.find(row=>row.id===f.people.student.id),second=report.students.find(row=>row.id===f.people.second.id);
 t.diagnostic('Group report for two students and six activities: '+Math.round(performance.now()-started)+' ms.');
 assert.equal(report.filters.timezone,'America/Bogota');assert.equal(report.measurement.available,true);
 assert.deepEqual([student.current.submitted,student.current.pending,student.current.overdue,student.current.awaitingGrade,student.current.pendingTotal],[2,1,1,1,2]);
 assert.equal(student.current.activitiesTotal,4);assert.equal(student.current.materialsTotal,2);assert.equal(student.current.materialsCompleted,2);assert.equal(student.current.progress,67);
 assert.equal(student.current.gradeAccumulated,1.6);assert.equal(student.current.gradeFinal,null);assert.equal(student.grade.accumulated,1.6);
 assert.deepEqual([student.period.visits,student.period.sessions,student.period.activeSeconds,student.period.averageSessionSeconds],[2,2,1080,540]);
 assert.equal(student.period.legacyGroupReads,3,'automatic course reads are not measured visits');
 assert.equal(second.period.activeSeconds,0);assert.equal(second.period.visits,0);
 assert.equal(report.summary.group.students,2);assert.equal(report.summary.group.gradeAccumulated,0.8);assert.equal(report.summary.group.activeSeconds,1080);assert.equal(report.summary.group.averageActiveSeconds,540);
 assert.equal(report.ranking[0].studentId,student.id);assert.equal(report.daily.reduce((sum,row)=>sum+row.activeSeconds,0),1080);
 const book=await f.people.teacher.call('/academics/courses/'+f.group.id+'/gradebook');assert.equal(student.current.gradeAccumulated,book.students.find(row=>row.id===student.id).accumulated);
 assert.equal(f.db.prepare('SELECT count(*) count FROM submissions WHERE points=0').get().count,0);assert.equal((await f.people.student.call('/academics/courses/'+f.group.id)).settings.missingAsZero,false);
});

test('date and person filters preserve current state and the group baseline while detailing the selected student',async t=>{
 const f=await fixture(t),whole=await f.report(),selected=await f.report('&student='+f.people.student.id);
 assert.equal(selected.students.length,1);assert.equal(selected.studentOptions.length,2);assert.equal(selected.summary.group.gradeAccumulated,whole.summary.group.gradeAccumulated);assert.equal(selected.summary.selection.gradeAccumulated,1.6);
 assert.equal(selected.detail.studentId,f.people.student.id);assert.equal(selected.detail.sessions.length,2);assert.equal(selected.detail.intervals.length,2);assert.ok(selected.detail.events.length>0);assert.ok(selected.detail.events.every(event=>event.userId===f.people.student.id));
 const historical=await f.people.teacher.call('/analytics/'+f.group.id+'?from=2020-01-01&to=2020-01-02&student='+f.people.student.id);
 assert.deepEqual(historical.students[0].current,selected.students[0].current,'a period filter does not pretend to reconstruct historical grades or progress');
 assert.equal(historical.students[0].period.activeSeconds,0);assert.equal(historical.students[0].period.visits,0);assert.equal(historical.measurement.available,false);assert.equal(historical.measurement.partialCoverage,true);assert.deepEqual(historical.daily,[]);
 await f.people.teacher.call('/analytics/'+f.group.id+'?student='+f.people.outsider.id,undefined,'GET',400);
 await f.people.teacher.call('/analytics/'+f.group.id+'?from=2026-02-30',undefined,'GET',400);
 const insert=f.db.prepare('INSERT INTO learning_work_sessions VALUES(?,?,?,?,?,NULL)');
 for(let index=0;index<101;index++){const started=iso(Date.now()-(index+1)*31*60000);insert.run('bounded-session-'+index,f.people.student.id,f.group.id,started,started);}
 const bounded=await f.report('&student='+f.people.student.id);assert.equal(bounded.detail.sessions.length,100);assert.equal(bounded.detail.totalSessions,103);assert.equal(bounded.detail.truncated,true);assert.equal(bounded.students[0].period.sessions,103);
});

test('corrections, newer drafts and exemptions remain distinct from delivered and overdue work',async t=>{
 const f=await fixture(t);
 let report=await f.report(),student=report.students.find(row=>row.id===f.people.student.id);
 assert.equal(student.activityStates.find(row=>row.id===f.activities.returned.id).overdue,false,'an unlimited correction does not inherit the original expired due date');
 await f.submit(f.activities.delivered,'draft');
 report=await f.report();student=report.students.find(row=>row.id===f.people.student.id);
 assert.equal(student.current.submitted,1);assert.equal(student.current.pending,2);assert.equal(student.current.overdue,1);assert.equal(student.current.progress,50);
 f.db.prepare('UPDATE submissions SET return_due_at=? WHERE id=?').run(iso(Date.now()-3600000),f.correction.id);
 student=(await f.report()).students.find(row=>row.id===f.people.student.id);assert.equal(student.current.overdue,2);assert.equal(student.current.pending,1);
 await f.master('/grade-policy/'+f.group.id,{activityId:f.activities.overdue.id,studentId:student.id,exempt:true,reason:'Individual exemption.'});
 student=(await f.report()).students.find(row=>row.id===f.people.student.id);assert.equal(student.current.overdue,1);assert.equal(student.current.exempt,1);
 assert.equal(f.db.prepare('SELECT count(*) count FROM submissions WHERE points=0').get().count,0);
});

test('overview exposes only grade-authorized groups and shares the same selected-student metrics',async t=>{
 const f=await fixture(t),overview=await f.people.teacher.call('/analytics'+f.query);
 assert.deepEqual(overview.groups.map(group=>group.id),[f.group.id]);assert.deepEqual(overview.groupOptions.map(group=>group.id),[f.group.id]);assert.equal(overview.groups[0].summary.gradeAccumulated,0.8);
 const personal=await f.people.teacher.call('/analytics'+f.query+'&group='+f.group.id+'&student='+f.people.student.id);assert.equal(personal.groups[0].summary.gradeAccumulated,1.6);assert.equal(personal.groups[0].groupSummary.gradeAccumulated,0.8);assert.equal(personal.summary.students,1);assert.equal(personal.summary.distinctStudents,1);
 await f.people.teacher.call('/analytics/'+f.other.id,undefined,'GET',403);await f.people.teacher.call('/analytics?group='+f.other.id,undefined,'GET',403);
 await f.people.teacher.call('/analytics?student='+f.people.outsider.id,undefined,'GET',400);
 await f.people.viewer.call('/analytics/'+f.group.id,undefined,'GET',403);assert.deepEqual((await f.people.viewer.call('/analytics')).groups,[]);
 await f.people.outsider.call('/analytics/'+f.group.id,undefined,'GET',403);assert.deepEqual((await f.people.outsider.call('/analytics')).studentOptions,[]);
 await f.people.student.call('/analytics',undefined,'GET',403);await f.people.student.call('/analytics/'+f.group.id,undefined,'GET',403);
});

test('session averages distinguish an absent measurement from a recorded visit with zero active seconds',async t=>{
 const f=await fixture(t),studentId=f.people.second.id;
 let report=await f.report('&student='+studentId);
 assert.equal(report.students[0].period.sessions,0);assert.equal(report.students[0].period.activeSeconds,0);
 assert.equal(report.students[0].period.averageSessionSeconds,null);assert.equal(report.summary.selection.averageSessionSeconds,null);
 assert.equal(report.summary.group.averageSessionSeconds,540,'the complete group baseline still contains the measured sessions');
 const historical=await f.people.teacher.call('/analytics/'+f.group.id+'?from=2020-01-01&to=2020-01-02');
 assert.equal(historical.summary.group.averageSessionSeconds,null);assert.equal(historical.summary.selection.averageSessionSeconds,null);
 const started=iso(Date.now()-60000);f.db.prepare('INSERT INTO learning_work_sessions VALUES(?,?,?,?,?,NULL)').run('passive-session',studentId,f.group.id,started,started);
 report=await f.report('&student='+studentId);
 assert.equal(report.students[0].period.sessions,1);assert.equal(report.students[0].period.activeSeconds,0);
 assert.equal(report.students[0].period.averageSessionSeconds,0);assert.equal(report.summary.selection.averageSessionSeconds,0);
 const overview=await f.people.teacher.call('/analytics'+f.query+'&student='+studentId);
 assert.equal(overview.summary.averageSessionSeconds,0);assert.equal(overview.groups[0].summary.averageSessionSeconds,0);
});

test('advanced evidence applies student and activity filters before the two-hundred-row limit',async t=>{
 const f=await fixture(t),studentId=f.people.student.id,otherId=f.people.second.id;
 const ownSubmission=f.db.prepare('SELECT id FROM submissions WHERE student_id=? AND activity_id=? ORDER BY attempt DESC LIMIT 1').get(studentId,f.activities.delivered.id);
 const otherSubmission=await f.people.second.call('/academics/activities/'+f.activities.delivered.id+'/submit',{activityRevision:f.activities.delivered.revision,requestId:randomUUID(),action:'submit',text:'Another student answer.'},'POST',201);
 const actor=f.db.prepare("SELECT user_id FROM user_roles WHERE role='master' LIMIT 1").get().user_id;
 const changes=f.db.prepare('INSERT INTO grade_audit(submission_id,actor_id,before_value,after_value,reason,created_at) VALUES(?,?,?,?,?,?)');
 const ownReason='Selected student grade evidence',before=JSON.stringify({points:null}),after=JSON.stringify({points:4});
 changes.run(ownSubmission.id,actor,before,after,ownReason,iso(Date.now()-120000));
 const lab=await f.master('/admin/modules/'+f.module.id+'/resources',{title:'Evidence laboratory',kind:'lab',published:true,content:'<p>Synthetic laboratory.</p>'},'POST',201);
 const labs=f.db.prepare('INSERT INTO learning_events(user_id,course_id,object_id,action,details,created_at) VALUES(?,?,?,?,?,?)');
 labs.run(studentId,f.group.id,lab.id,'lab.result',JSON.stringify({result:'Selected student laboratory evidence'}),iso(Date.now()-120000));
 for(let index=0;index<205;index++){
  const at=iso(Date.now()-60000+index);
  changes.run(otherSubmission.id,actor,before,after,'Another student grade '+index,at);
  labs.run(otherId,f.group.id,lab.id,'lab.result',JSON.stringify({result:'Another student laboratory '+index}),at);
 }
 let report=await f.report('&student='+studentId);
 assert.ok(report.changes.some(change=>change.reason===ownReason),'more recent changes by other students cannot hide the selected student evidence');
 assert.ok(report.changes.every(change=>change.student_id===studentId));
 assert.deepEqual(report.labs.map(record=>record.result),['Selected student laboratory evidence']);
 for(let index=0;index<205;index++)changes.run(f.correction.id,actor,before,after,'Another activity '+index,iso(Date.now()-30000+index));
 report=await f.report('&student='+studentId+'&activity='+f.activities.delivered.id);
 assert.ok(report.changes.some(change=>change.reason===ownReason),'more recent changes in another activity cannot hide evidence for the selected activity');
 assert.ok(report.changes.every(change=>change.student_id===studentId&&change.activity_id===f.activities.delivered.id));
 assert.equal(report.labs[0].result,'Selected student laboratory evidence','laboratories remain scoped by person and period without inventing an activity association');
 const whole=await f.report();assert.equal(whole.changes.length,200);assert.equal(whole.labs.length,200);
 const historical=await f.people.teacher.call('/analytics/'+f.group.id+'?student='+studentId+'&from=2020-01-01&to=2020-01-02');
 assert.deepEqual(historical.changes,[]);assert.deepEqual(historical.labs,[]);
});
