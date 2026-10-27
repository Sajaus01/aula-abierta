import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/security.mjs';
import {createAccessModel} from '../server/access-model.mjs';
import {summarizeActivityEvaluation,summarizeCourseEvaluation,createActivityEvaluation} from '../server/activity-evaluation.mjs';

const activity={id:'task',title:'Task',status:'published',maxPoints:10};
const response=(student,extra={})=>({id:student+'-response',student_id:student,state:'submitted',attempt:1,points:null,published:0,payload:'{}',updated_at:'2026-10-27T10:00:00.000Z',...extra});
const counts=(state,submitted,evaluated,pending,unreleased,returned)=>({state,submitted,evaluated,pending,unreleased,returned});

test('evaluation uses the latest delivery while unsent new drafts do not hide previous grading work',()=>{
 const sent=response('one',{points:8,published:1}),draft=response('one',{id:'new-draft',state:'draft',attempt:2,updated_at:'2026-10-27T11:00:00.000Z'});
 assert.deepEqual(summarizeActivityEvaluation(activity,[sent,draft]),counts('evaluated',1,1,0,0,0));
 assert.deepEqual(summarizeActivityEvaluation(activity,[sent,{...draft,state:'submitted'}]),counts('pending',1,0,1,0,0));
 assert.deepEqual(summarizeActivityEvaluation(activity,[sent,{...draft,returned_at:'2026-10-27T11:00:00.000Z'}]),counts('correction',0,0,0,0,1));
 assert.deepEqual(summarizeActivityEvaluation(activity,[sent,{...draft,state:'submitted',superseded:1}]),counts('evaluated',1,1,0,0,0));
 assert.deepEqual(summarizeActivityEvaluation(activity,[{...sent,eligible:false},draft]),counts('empty',0,0,0,0,0));
});

test('a saved private grade counts as evaluated, while null, invalid points and pending procedures remain pending',()=>{
 const privateZero=response('one',{points:7,published:1,payload:JSON.stringify({teacherGradeDraft:{points:0,feedback:'Private'}})});
 assert.deepEqual(summarizeActivityEvaluation(activity,[privateZero]),counts('evaluated',1,1,0,1,0));
 assert.deepEqual(summarizeActivityEvaluation(activity,[{...privateZero,payload:JSON.stringify({teacherGradeDraft:{points:null}})}]),counts('pending',1,0,1,0,0));
 for(const points of [null,-1,11,'5',NaN])assert.deepEqual(summarizeActivityEvaluation(activity,[response('one',{points})]),counts('pending',1,0,1,0,0));
 assert.deepEqual(summarizeActivityEvaluation(activity,[response('one',{points:5,payload:JSON.stringify({procedureReviewPending:true})})]),counts('pending',1,0,1,0,0));
 assert.deepEqual(summarizeActivityEvaluation({...activity,maxPoints:5},[response('one',{points:8,payload:JSON.stringify({previousActivity:{maxPoints:10}})})]),counts('evaluated',1,1,0,1,0));
 assert.deepEqual(summarizeActivityEvaluation(activity,[response('one',{points:5,payload:'invalid-json'})]),counts('pending',1,0,1,0,0));
});

test('corrections prevent green even beside evaluated work, and closure-only records do not become submissions',()=>{
 const evaluated=response('one',{points:5}),returned=response('two',{state:'returned',returned_at:'2026-10-27T11:00:00.000Z'});
 assert.deepEqual(summarizeActivityEvaluation(activity,[evaluated,returned]),counts('correction',1,1,0,1,1));
 assert.deepEqual(summarizeActivityEvaluation(activity,[evaluated,returned,response('three')]),counts('pending',2,1,1,1,1));
 assert.deepEqual(summarizeActivityEvaluation(activity,[response('one',{state:'missing',points:0,closure:{closed:true}}),response('two',{state:'draft'})]),counts('empty',0,0,0,0,0));
 assert.deepEqual(summarizeActivityEvaluation({...activity,status:'draft'},[evaluated]),counts('draft',1,1,0,1,0));
 assert.deepEqual(summarizeActivityEvaluation({...activity,status:'archived'},[evaluated]),counts('archived',1,1,0,1,0));
});

test('course totals count only published work and keep activity counts distinct from response counts',()=>{
 const entries=[{status:'published',evaluation:counts('evaluated',2,2,0,1,0)},{status:'published',evaluation:counts('correction',0,0,0,0,1)},{status:'draft',evaluation:counts('draft',5,1,4,1,0)},{status:'archived',evaluation:counts('archived',2,2,0,0,0)}];
 assert.deepEqual(summarizeCourseEvaluation(entries),{...counts('correction',2,2,0,1,1),activityCounts:{evaluated:1,pending:0,empty:0,correction:1,draft:1,archived:1}});
});

async function fixture(t,{legacy=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'aula-activity-evaluation-')),password='Activity-Evaluation-2026!',app=await createApp({dataDir:dir,activityClosureIntervalMs:3600000,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'99790001',ADMIN_PASSWORD:password,...(legacy?{}:{AULA_MODEL_V2:'1'})}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-activity-evaluation-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;}});
 const master=client(),login=await master.call('/auth/login',{document:'99790001',password}),masterId=login.user.id;
 let course,grader=master,viewer;const people=[];
 if(!legacy){
  const template=await master.call('/admin/courses',{title:'Evaluation template'},'POST',201);course=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Evaluation group',cohort:'2026',code:'E'},'POST',201);await master.call('/platform/courses/'+course.id+'/state',{state:'active'});
  await master.call('/admin/courses/'+course.id+'/enrollments/bulk',{students:[{document:'99790003',name:'Active learner'},{document:'99790004',name:'Second learner'},{document:'99790005',name:'Third learner'}]},'POST',201);
  for(const document of ['99790003','99790004','99790005']){const session=client(),result=await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:password,confirmPassword:password});people.push({id:result.user.id,session});}
  for(const [document,grade]of [['99790006',true],['99790007',false]]){const user=await master.call('/platform/users',{document,name:grade?'Grading teacher':'Editing teacher',roles:['teacher']},'POST',201),session=client();await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:password,confirmPassword:password});await master.call('/platform/courses/'+course.id+'/staff',{userId:user.id,edit:!grade,grade,manage:false});if(grade)grader=session;else viewer=session;}
 }else{
  course=await master.call('/admin/courses',{title:'Legacy evaluation',published:true,accessMode:'password'},'POST',201);const id=randomUUID(),at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES(?,?,?,'student',?,?,?)").run(id,'99790003','Legacy learner',await hashPassword(password),at,at);await master.call('/admin/enrollments',{courseId:course.id,studentId:id},'POST',201);const session=client();await session.call('/auth/login',{document:'99790003',password});people.push({id,session});
 }
 const activity=body=>master.call('/academics/courses/'+course.id+'/activities',{title:'Evaluation activity',kind:'task',status:'published',maxPoints:10,maxAttempts:3,...body},'POST',201);
 const submit=(a,body={},who=people[0].session)=>who.call('/academics/activities/'+a.id+'/submit',{requestId:randomUUID(),activityRevision:a.revision,action:'submit',text:'Private response must not enter the aggregate',...body},'POST',201);
 const grade=(s,points,published=false)=>master.call('/academics/submissions/'+s.id+'/grade',{version:s.version,points,published,feedback:'Private feedback'},'PATCH');
 const detail=(a,who=grader,headers={})=>who.call('/academics/activities/'+a.id,undefined,'GET',200,headers);
 return {...app,master,masterId,grader,viewer,people,client,course,activity,submit,grade,detail};
}

test('all teacher course and academic DTOs share a private aggregate that students, previews and editors cannot request',async t=>{
 const f=await fixture(t),a=await f.activity({title:'Privately evaluated'}),s=await f.submit(a);let saved=await f.grade(s,0);
 const expected=counts('evaluated',1,1,0,1,0),coursePath='/academics/courses/'+f.course.id;
 assert.deepEqual((await f.detail(a)).activity.evaluation,expected);
 for(const [path,key]of [['/courses/'+f.course.id,'activities'],[coursePath,'activities'],[coursePath+'/gradebook','activities']])assert.deepEqual((await f.grader.call(path))[key].find(row=>row.id===a.id).evaluation,expected);
 const global=(await f.grader.call('/academics/courses')).find(row=>row.id===f.course.id);assert.deepEqual(global.activities[0].evaluation,expected);assert.equal(global.evaluation.activityCounts.evaluated,1);assert.equal(global.evaluation.evaluated,1);
 for(const who of [f.people[0].session,f.viewer]){assert.equal(Object.hasOwn((await f.detail(a,who)).activity,'evaluation'),false);const page=await who.call('/courses/'+f.course.id);assert.ok(page.activities.every(row=>!Object.hasOwn(row,'evaluation')));const list=await who.call('/academics/courses');assert.ok(list.every(row=>!Object.hasOwn(row,'evaluation')&&(row.activities||[]).every(item=>!Object.hasOwn(item,'evaluation'))));assert.ok((await who.call(coursePath)).activities.every(row=>!Object.hasOwn(row,'evaluation')));}
 const preview={'X-Aula-Preview':f.course.id};assert.equal(Object.hasOwn((await f.detail(a,f.grader,preview)).activity,'evaluation'),false);assert.ok((await f.grader.call('/courses/'+f.course.id,undefined,'GET',200,preview)).activities.every(row=>!Object.hasOwn(row,'evaluation')));
 const publicShape=JSON.stringify(expected);assert.doesNotMatch(publicShape,/student|Private|points|answers|feedback|submissionId/);
 saved=await f.grade(saved,6,true);saved=await f.grade(saved,null,false);assert.deepEqual((await f.detail(a)).activity.evaluation,counts('pending',1,0,1,0,0),'A saved null draft withdraws the effective teacher grade even if an older public score remains');
 assert.equal((await f.detail(a,f.people[0].session)).mine[0].points,6,'Student visibility continues to use the official published grade');
});

test('API aggregation excludes inactive enrollment and exemptions, counts corrections, and never treats an automatic zero as evaluated',async t=>{
 const f=await fixture(t),a=await f.activity(),first=await f.submit(a),second=await f.submit(a,{},f.people[1].session);await f.grade(first,8);await f.grade(second,5,true);
 const newDraft=await f.submit(a,{action:'draft'});assert.equal(newDraft.attempt,2);assert.deepEqual((await f.detail(a)).activity.evaluation,counts('evaluated',2,2,0,1,0));
 const returned=await f.master.call('/academics/submissions/'+second.id+'/return',{version:2,reason:'Fix the response',returnDueAt:null},'PATCH');await f.submit(a,{requestId:returned.requestId,version:returned.version,action:'draft'},f.people[1].session);assert.deepEqual((await f.detail(a)).activity.evaluation,counts('correction',1,1,0,1,1));
 await f.master.call('/grade-policy/'+f.course.id,{activityId:a.id,studentId:f.people[1].id,exempt:true,reason:'Excused correction'});assert.deepEqual((await f.detail(a)).activity.evaluation,counts('evaluated',1,1,0,1,0));
 f.db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(f.people[0].id);assert.deepEqual((await f.detail(a)).activity.evaluation,counts('empty',0,0,0,0,0));
 f.db.prepare("UPDATE users SET account_status='active',active=0 WHERE id=?").run(f.people[0].id);assert.deepEqual((await f.detail(a)).activity.evaluation,counts('empty',0,0,0,0,0));
 f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(f.people[0].id);for(const change of ["status='revoked'","status='active',expires_at='2000-01-01T00:00:00.000Z'","expires_at=NULL,starts_at='2999-01-01T00:00:00.000Z'"]){f.db.exec("UPDATE enrollments SET "+change+" WHERE course_id='"+f.course.id+"' AND student_id='"+f.people[0].id+"'");assert.equal((await f.detail(a)).activity.evaluation.submitted,0);}
 const closed=await f.activity({dueAt:new Date(Date.now()-10000).toISOString()});await f.people[2].session.call('/academics/activities/'+closed.id);assert.deepEqual((await f.detail(closed)).activity.evaluation,counts('empty',0,0,0,0,0));
 const archived=await f.activity({status:'archived'}),draft=await f.activity({status:'draft'});assert.equal((await f.detail(archived)).activity.evaluation.state,'archived');assert.equal((await f.detail(draft)).activity.evaluation.state,'draft');
});

test('batched grading aggregation keeps a constant number of data queries as activity count grows',async t=>{
 const f=await fixture(t),a=await f.activity(),s=await f.submit(a);await f.grade(s,7);
 const queries=[],db={prepare(sql){queries.push(sql);return f.db.prepare(sql);}},service=createActivityEvaluation({db,accessModel:createAccessModel(f.db,(status,message)=>{throw Object.assign(Error(message),{status});})}),auth={user:{id:f.masterId,role:'admin'},assurance:'password'};
 service.summaries([f.course.id],auth);const baseline=queries.length;assert.equal(baseline,3);queries.length=0;
 const raw=f.db.prepare('SELECT config FROM activities WHERE id=?').get(a.id);for(let index=0;index<40;index++)f.db.prepare('INSERT INTO activities(id,course_id,config,created_at) VALUES(?,?,?,?)').run(randomUUID(),f.course.id,raw.config,new Date().toISOString());
 const result=service.summaries([f.course.id],auth);assert.equal(queries.length,baseline);assert.equal(result.get(f.course.id).activities.length,41);assert.ok(result.get(f.course.id).activities.every(row=>Object.keys(row.evaluation).sort().join(',')==='evaluated,pending,returned,state,submitted,unreleased'));
 queries.length=0;assert.equal(service.summaries([f.course.id],{...auth,preview:f.course.id}).size,0);assert.equal(queries.length,0,'Preview does not even read grading payloads');
});

test('legacy administrators receive the same summary using current enrollment and private numeric grades',async t=>{
 const f=await fixture(t,{legacy:true}),a=await f.activity(),s=await f.submit(a);await f.grade(s,0);assert.deepEqual((await f.detail(a)).activity.evaluation,counts('evaluated',1,1,0,1,0));assert.equal(Object.hasOwn((await f.detail(a,f.people[0].session)).activity,'evaluation'),false);
});
