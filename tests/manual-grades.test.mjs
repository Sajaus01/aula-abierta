import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/security.mjs';

const iso=offset=>new Date(Date.now()+offset).toISOString();

async function fixture(t,{legacy=false,staff=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'aula-manual-grades-')),password='Manual-Grades-2026!';
 const app=await createApp({dataDir:dir,activityClosureIntervalMs:3600000,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'99770001',ADMIN_PASSWORD:password,...(legacy?{}:{AULA_MODEL_V2:'1'})}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-manual-grades-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;}});
 const master=client();await master.call('/auth/login',{document:'99770001',password});
 let course;
 if(legacy)course=await master.call('/admin/courses',{title:'Legacy manual grade group',published:true,accessMode:'password'},'POST',201);
 else{const template=await master.call('/admin/courses',{title:'Manual grade template'},'POST',201);course=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Manual grade group',cohort:'2026',code:'MG'},'POST',201);await master.call('/platform/courses/'+course.id+'/state',{state:'active'});}
 const people=[];
 for(const [document,name] of [['99770003','Unsent learner'],['99770004','Second learner'],['99770005','Draft learner']]){
  let id;
  if(legacy){id=randomUUID();const at=iso(0);app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES(?,?,?,'student',?,?,?)").run(id,document,name,await hashPassword(password),at,at);await master.call('/admin/enrollments',{courseId:course.id,studentId:id},'POST',201);}
  else{await master.call('/admin/courses/'+course.id+'/enrollments/bulk',{students:[{document,name}]},'POST',201);id=app.db.prepare('SELECT id FROM users WHERE document=?').get(document).id;}
  const session=client();await session.call('/auth/login',{document,password:legacy?password:document});if(!legacy)await session.call('/auth/first-password',{newPassword:password,confirmPassword:password});people.push({id,session});
 }
 let grader=master,viewer=null,outsider=null;
 if(staff&&!legacy){for(const [document,name,scope]of [['99770006','Grade-only teacher','grade'],['99770007','Edit-only teacher','edit'],['99770008','Unassigned teacher','none']]){const user=await master.call('/platform/users',{document,name,roles:['teacher']},'POST',201),session=client();await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:password,confirmPassword:password});if(scope!=='none')await master.call('/platform/courses/'+course.id+'/staff',{userId:user.id,edit:scope==='edit',grade:scope==='grade',manage:false});if(scope==='grade')grader=session;else if(scope==='edit')viewer=session;else outsider=session;}}
 const path=a=>'/academics/activities/'+a.id;
 const gradePath=(a,student=people[0])=>path(a)+'/students/'+student.id;
 const activity=body=>master.call('/academics/courses/'+course.id+'/activities',{title:'Manual assessment',kind:'task',status:'published',maxPoints:10,maxAttempts:2,weight:100,...body},'POST',201);
 const submit=(a,body={},who=people[0].session,status=201)=>who.call(path(a)+'/submit',{requestId:randomUUID(),activityRevision:a.revision,action:'submit',text:'Actual student response',...body},'POST',status);
 const grade=(a,points,body={},student=people[0],who=grader,status=200)=>who.call(gradePath(a,student)+'/grade',{version:0,points,feedback:'Private teacher assessment',publish:false,...body},'PATCH',status);
 const release=(a,s,student=people[0],who=grader,status=200)=>who.call(gradePath(a,student)+'/release',{version:s.version},'POST',status);
 const own=(a,student=people[0])=>student.session.call(path(a));
 const roster=(a,who=grader)=>who.call(path(a)+'/submissions');
 const book=(who=grader)=>who.call('/academics/courses/'+course.id+'/gradebook');
 const cell=(data,a,student=people[0])=>data.students.find(row=>row.id===student.id).cells.find(row=>row.activityId===a.id);
 const realCount=a=>app.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n;
 return {...app,master,grader,viewer,outsider,course,people,path,gradePath,activity,submit,grade,release,own,roster,book,cell,realCount};
}

test('a teacher can assess closed missing work privately and return it without reopening or fabricating a delivery',async t=>{
 const f=await fixture(t),a=await f.activity({dueAt:iso(-10000)}),before=(await f.own(a)).activity.closure;
 assert.equal(before.closed,true);assert.equal((await f.own(a)).manualGrade,null);
 const baselineInsights=(await f.master.call('/analytics/'+f.course.id)).students.find(student=>student.id===f.people[0].id),inbox=await f.people[0].session.call('/notifications');
 const saved=await f.grade(a,7.5);
 assert.equal(saved.manualGrade,true);assert.equal(saved.points,7.5);assert.equal(saved.published,false);assert.equal(saved.attempt,0);assert.equal(saved.submittedAt,null);assert.deepEqual(saved.answers,{});assert.deepEqual(saved.files,[]);assert.equal(f.realCount(a),0);
 const privateCell=f.cell(await f.book(),a);assert.equal(privateCell.points,7.5);assert.equal(privateCell.manualGrade,true);assert.equal(privateCell.manualGradeId,saved.id);assert.equal(privateCell.submissionId,null);
 const hidden=await f.own(a);assert.equal(hidden.manualGrade,null);assert.deepEqual(hidden.mine,[]);assert.equal(hidden.activity.closure.closed,true);assert.equal((await f.people[0].session.call('/academics/courses/'+f.course.id)).grade.accumulated,0);
 assert.equal((await f.people[0].session.call('/notifications?after='+inbox.cursor)).items.filter(item=>item.kind==='grade').length,0);
 const evaluation=(await f.master.call(f.path(a))).activity.evaluation;assert.equal(evaluation.submitted,0);assert.equal(evaluation.evaluated,1);assert.equal(evaluation.manualEvaluated,1);assert.equal(evaluation.unreleased,1);
 await f.submit(a,{},f.people[0].session,403);
 const published=await f.release(a,saved),visible=await f.own(a);assert.equal(published.published,true);assert.equal(visible.manualGrade.points,7.5);assert.equal(visible.manualGrade.feedback,'Private teacher assessment');assert.equal(Object.hasOwn(visible.manualGrade,'gradeDraft'),false);assert.deepEqual(visible.mine,[]);assert.deepEqual(visible.activity.closure,before);
 const notices=(await f.people[0].session.call('/notifications?after='+inbox.cursor)).items.filter(item=>item.kind==='grade');assert.equal(notices.length,1);assert.equal(notices[0].personal,true);assert.equal(notices[0].href,'#actividad/'+a.id);assert.ok(!JSON.stringify(notices).includes('Private teacher assessment'));assert.ok(!(await f.people[1].session.call('/notifications')).items.some(item=>item.kind==='grade'));
 const history=(await f.master.call('/grade-policy/'+f.course.id)).history;assert.ok(history.some(row=>row.manualGrade===1&&row.submission_id===saved.id&&row.student_id===f.people[0].id&&row.activity_id===a.id));assert.equal(f.realCount(a),0);
 const studentCourse=await f.people[0].session.call('/academics/courses/'+f.course.id);assert.equal(studentCourse.grade.accumulated,3.75);assert.equal(studentCourse.grade.cells[0].submissionId,null);
 const course=await f.people[0].session.call('/courses/'+f.course.id),item=course.activities.find(row=>row.id===a.id);assert.equal(item.submitted,false);assert.equal(item.closure.closed,true);assert.equal(item.manualGrade.points,7.5);assert.equal(item.outcome.state,'gradedPass');
 const insights=(await f.master.call('/analytics/'+f.course.id)).students.find(student=>student.id===f.people[0].id);assert.equal(insights.current.gradeAccumulated,3.75);assert.equal(insights.current.submitted,0);assert.equal(insights.period.submittedActivities,0);assert.equal(insights.current.progress,baselineInsights.current.progress);assert.equal(insights.activityStates[0].manualGrade,true);assert.equal(insights.activityStates[0].submissionId,null);
 const revised=await f.grade(a,0,{version:published.version,feedback:'Updated private assessment'});assert.equal((await f.own(a)).manualGrade.points,7.5);assert.equal((await f.own(a)).manualGrade.feedback,'Private teacher assessment');assert.equal(f.cell(await f.book(),a).points,0);
 await f.release(a,revised);assert.equal((await f.own(a)).manualGrade.points,0);assert.equal((await f.people[0].session.call('/academics/courses/'+f.course.id)).grade.accumulated,0);assert.equal((await f.own(a)).activity.closure.closed,true);assert.equal(f.realCount(a),0);await f.submit(a,{},f.people[0].session,403);
});

test('a manual assessment preserves an unsent learner draft and an actual later submission takes precedence',async t=>{
 const f=await fixture(t),a=await f.activity(),draft=await f.submit(a,{action:'draft'}),raw=f.db.prepare('SELECT * FROM submissions WHERE id=?').get(draft.id);
 const saved=await f.grade(a,8,{publish:true});assert.equal(saved.published,true);assert.deepEqual(f.db.prepare('SELECT * FROM submissions WHERE id=?').get(draft.id),raw);assert.equal((await f.own(a)).mine[0].state,'draft');assert.equal((await f.own(a)).manualGrade.points,8);
 const sent=await f.submit(a,{requestId:draft.requestId,version:draft.version});assert.equal(sent.id,draft.id);assert.equal(sent.attempt,1);assert.equal(f.realCount(a),1);assert.equal((await f.own(a)).manualGrade,null);
 const cell=f.cell(await f.book(),a);assert.equal(cell.submissionId,sent.id);assert.equal(cell.points,null);assert.equal(Boolean(cell.manualGrade),false);
 await f.grade(a,5,{version:saved.version},f.people[0],f.grader,409);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit WHERE action=? AND target_id=?').get('submission.submit',sent.id).n,1);
});

test('activity and group bulk return publish numeric manual grades, preserve nulls and reject stale selections atomically',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',questions:[{id:'explain',type:'text',prompt:'Explain your procedure',points:10}],dueAt:iso(-10000),weight:50}),other=await f.activity({dueAt:iso(-10000),weight:50});
 const first=await f.grade(a,6),zero=await f.grade(a,0,{},f.people[1]),waiting=await f.grade(a,null,{},f.people[2]),last=await f.grade(other,9);
 const actual=await f.activity({title:'Actual delivery in the same group',weight:0}),sent=await f.submit(actual,{},f.people[1].session);await f.master.call('/academics/submissions/'+sent.id+'/grade',{version:sent.version,points:4,published:false,feedback:'Actual work'},'PATCH');
 await f.master.call(f.path(a)+'/release',{submissions:[{id:first.id,version:first.version},{id:zero.id,version:zero.version+1}]},'POST',409);assert.equal((await f.own(a)).manualGrade,null);assert.equal((await f.own(a,f.people[1])).manualGrade,null);
 const returned=await f.master.call(f.path(a)+'/release',{});assert.equal(returned.releasedCount,2);assert.equal((await f.own(a)).manualGrade.points,6);assert.equal((await f.own(a,f.people[1])).manualGrade.points,0);assert.equal((await f.own(a,f.people[2])).manualGrade,null);
 const roster=await f.roster(a);assert.equal(roster.submissions.length,0);assert.equal(roster.manualGrades.find(row=>row.id===waiting.id).points,null);assert.equal(roster.manualGrades.find(row=>row.id===waiting.id).published,false);
 const group=await f.master.call('/academics/courses/'+f.course.id+'/release',{});assert.equal(group.releasedCount,2);assert.equal((await f.own(other)).manualGrade.points,9);assert.equal((await f.own(actual,f.people[1])).mine[0].points,4);assert.equal((await f.own(actual,f.people[1])).mine[0].published,true);assert.equal(f.realCount(actual),1);assert.equal(f.realCount(a)+f.realCount(other),0);assert.equal((await f.own(a)).activity.closure.closed,true);assert.equal((await f.master.call('/academics/courses/'+f.course.id+'/release',{})).releasedCount,0);
});

test('manual assessments enforce grade scope, student identity, current enrollment, score bounds and optimistic versions',async t=>{
 const f=await fixture(t,{staff:true}),a=await f.activity({dueAt:iso(-10000)});
 await f.grade(a,6,{},f.people[0],f.viewer,403);await f.grade(a,6,{},f.people[0],f.outsider,403);await f.grade(a,6,{},f.people[0],f.people[0].session,403);
 await f.grader.call(f.gradePath(a)+'/grade',{version:0,points:5},'PATCH',403,{'X-Aula-Preview':f.course.id});
 for(const points of [-1,11,'5'])await f.grade(a,points,{},f.people[0],f.grader,400);
 const saved=await f.grade(a,5);await f.grade(a,6,{version:0},f.people[0],f.grader,409);await f.release(a,{version:saved.version+1},f.people[0],f.grader,409);
 const visible=await f.roster(a);assert.equal(visible.manualGrades[0].points,5);assert.ok(visible.students.some(row=>row.id===f.people[0].id));
 const panoramaPath='/platform/overview?group='+f.course.id+'&category=grades',teacherEvents=await f.grader.call(panoramaPath),viewerEvents=await f.viewer.call(panoramaPath);assert.ok(teacherEvents.events.some(event=>event.action==='activity.manual-grade.grade-draft'&&event.category==='grades'&&event.context.student.id===f.people[0].id));assert.equal(viewerEvents.events.length,0);assert.equal(viewerEvents.total,0);
 await f.viewer.call('/grade-policy/'+f.course.id,undefined,'GET',403);
 await f.master.call('/grade-policy/'+f.course.id,{activityId:a.id,studentId:f.people[1].id,exempt:true,reason:'Assessment exemption'});await f.grade(a,5,{},f.people[1],f.grader,409);await f.master.call('/grade-policy/'+f.course.id,{activityId:a.id,studentId:f.people[1].id,exempt:false,reason:'Resume assessment'});
 const unpublished=await f.activity({status:'draft',weight:0}),archived=await f.activity({status:'archived',weight:0});for(const item of [unpublished,archived])await f.grade(item,5,{},f.people[0],f.grader,409);
 await f.master.call('/platform/courses/'+f.course.id+'/state',{state:'archived'});await f.grade(a,6,{version:saved.version},f.people[0],f.grader,409);await f.master.call('/platform/courses/'+f.course.id+'/state',{state:'active'});
 f.db.prepare("UPDATE enrollments SET status='revoked' WHERE course_id=? AND student_id=?").run(f.course.id,f.people[0].id);await f.grade(a,6,{version:saved.version},f.people[0],f.grader,403);await f.release(a,saved,f.people[0],f.grader,403);
 f.db.prepare("UPDATE enrollments SET status='active',expires_at=? WHERE course_id=? AND student_id=?").run(iso(-1000),f.course.id,f.people[1].id);await f.grade(a,5,{},f.people[1],f.grader,403);
 f.db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(f.people[2].id);await f.grade(a,5,{},f.people[2],f.grader,403);
 assert.equal(f.realCount(a),0);
});

test('scale changes convert published and private manual scores proportionally and repeat preserves the old assessment as history',async t=>{
 const f=await fixture(t),a=await f.activity({maxPoints:100,dueAt:iso(-10000)});let saved=await f.grade(a,80,{publish:true});saved=await f.grade(a,60,{version:saved.version});
 const before=f.db.prepare('SELECT * FROM activity_manual_grades WHERE id=?').get(saved.id);
 const updated=await f.master.call(f.path(a),{version:a.version,maxPoints:5,changeKind:'evaluated',revisionPolicy:'keep'},'PATCH');
 const privateGrade=(await f.roster(updated)).manualGrades.find(row=>row.id===saved.id);assert.equal(privateGrade.points,3);assert.equal(privateGrade.publishedPoints,4);assert.equal(privateGrade.gradingMaxPoints,5);assert.equal((await f.own(updated)).manualGrade.points,4);assert.equal((await f.own(updated)).manualGrade.gradingMaxPoints,5);assert.equal((await f.people[0].session.call('/academics/courses/'+f.course.id)).grade.accumulated,4);assert.equal((await f.own(updated)).activity.closure.closed,true);
 await f.release(updated,privateGrade);assert.equal((await f.own(updated)).manualGrade.points,3);
 const repeat=await f.master.call(f.path(updated),{version:updated.version,maxPoints:10,changeKind:'evaluated',revisionPolicy:'repeat'},'PATCH');assert.equal(repeat.resubmissionRequired,true);assert.equal((await f.own(repeat)).manualGrade,null);assert.equal(f.cell(await f.book(),repeat).points,null);assert.equal(f.realCount(repeat),0);
 const historical=f.db.prepare('SELECT * FROM activity_manual_grades WHERE id=?').get(saved.id);assert.ok(historical);assert.equal(historical.superseded,1);assert.equal(historical.points,3);assert.notDeepEqual(historical,before);
 const replacement=await f.grade(repeat,6);assert.notEqual(replacement.id,saved.id);assert.equal(replacement.points,6);assert.equal(replacement.revision,repeat.revision);assert.equal(f.realCount(repeat),0);
});

test('failed manual publication or scale conversion rolls back marks, drafts, audit, notifications and activity history',async t=>{
 const f=await fixture(t),a=await f.activity({maxPoints:100,dueAt:iso(-10000)});await f.own(a);let saved=await f.grade(a,80);
 const original=f.db.prepare('SELECT * FROM activity_manual_grades WHERE id=?').get(saved.id),auditBefore=f.db.prepare('SELECT count(*) n FROM grade_audit').get().n;
 f.db.exec("CREATE TRIGGER fail_manual_release BEFORE INSERT ON grade_audit WHEN NEW.submission_id='"+saved.id+"' BEGIN SELECT RAISE(ABORT,'Synthetic manual release failure'); END");
 await f.release(a,saved,f.people[0],f.grader,500);assert.deepEqual(f.db.prepare('SELECT * FROM activity_manual_grades WHERE id=?').get(saved.id),original);assert.equal(f.db.prepare('SELECT count(*) n FROM grade_audit').get().n,auditBefore);assert.equal(f.db.prepare("SELECT count(*) n FROM notification_events WHERE kind='grade'").get().n,0);assert.equal((await f.own(a)).manualGrade,null);
 f.db.exec('DROP TRIGGER fail_manual_release');saved=await f.release(a,saved);saved=await f.grade(a,60,{version:saved.version});
 const before=f.db.prepare('SELECT * FROM activity_manual_grades WHERE id=?').get(saved.id),activityBefore=f.db.prepare('SELECT * FROM activities WHERE id=?').get(a.id),scaleAuditBefore=f.db.prepare('SELECT count(*) n FROM grade_audit').get().n;
 f.db.exec("CREATE TRIGGER fail_manual_scale BEFORE UPDATE ON activity_manual_grades WHEN NEW.max_points<>OLD.max_points BEGIN SELECT RAISE(ABORT,'Synthetic manual scale failure'); END");
 await f.master.call(f.path(a),{version:a.version,maxPoints:5,changeKind:'evaluated',revisionPolicy:'keep'},'PATCH',500);assert.deepEqual(f.db.prepare('SELECT * FROM activity_manual_grades WHERE id=?').get(saved.id),before);assert.deepEqual(f.db.prepare('SELECT * FROM activities WHERE id=?').get(a.id),activityBefore);assert.equal(f.db.prepare('SELECT count(*) n FROM grade_audit').get().n,scaleAuditBefore);assert.equal(f.db.prepare('SELECT count(*) n FROM activity_versions WHERE activity_id=?').get(a.id).n,0);assert.equal((await f.own(a)).manualGrade.points,80);assert.equal((await f.own(a)).activity.closure.closed,true);assert.equal(f.realCount(a),0);
 f.db.exec('DROP TRIGGER fail_manual_scale');await f.master.call(f.path(a),{version:a.version,maxPoints:5,changeKind:'evaluated',revisionPolicy:'keep'},'PATCH');const converted=(await f.roster(a)).manualGrades.find(row=>row.id===saved.id);assert.equal(converted.points,3);assert.equal(converted.publishedPoints,4);
});

test('legacy administration can publish a manual grade while keeping a closed learner unable to submit',async t=>{
 const f=await fixture(t,{legacy:true}),a=await f.activity({dueAt:iso(-10000)}),saved=await f.grade(a,9,{publish:true});assert.equal(saved.published,true);assert.equal((await f.own(a)).manualGrade.points,9);assert.equal((await f.own(a)).activity.closure.closed,true);assert.equal(f.cell(await f.book(),a).points,9);assert.equal((await f.people[0].session.call('/academics/courses/'+f.course.id)).grade.accumulated,4.5);assert.equal(f.realCount(a),0);await f.submit(a,{},f.people[0].session,403);
});
