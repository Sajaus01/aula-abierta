import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/security.mjs';
import {activityOutcome} from '../server/chapter-outcomes.mjs';

const settings={scaleMax:5,passMark:3};
const submitted={id:'current',state:'submitted'};
const grade={submissionId:'current',state:'graded',published:true,points:6,maxPoints:10};
const pending={state:'pending',satisfactory:false};
const awaiting={state:'submitted-awaiting-grade',satisfactory:false};

test('an activity outcome uses its official published ratio, not semester weight or an unpublished score',()=>{
 assert.deepEqual(activityOutcome(submitted,grade,settings),{state:'gradedPass',satisfactory:true});
 assert.deepEqual(activityOutcome(submitted,{...grade,points:5.99},settings),{state:'gradedBelow',satisfactory:false});
 assert.deepEqual(activityOutcome(submitted,{...grade,points:0},settings),{state:'gradedBelow',satisfactory:false});
 assert.deepEqual(activityOutcome(submitted,{...grade,points:0},{scaleMax:10,passMark:0}),{state:'gradedPass',satisfactory:true});
 for(const points of [0,6,10])assert.deepEqual(activityOutcome(submitted,{...grade,published:false,points},settings),awaiting);
 assert.deepEqual(activityOutcome(submitted,{...grade,state:'submitted',points:null},settings),awaiting);
 assert.deepEqual(activityOutcome(submitted,{...grade,maxPoints:10},{scaleMax:100,passMark:60}),{state:'gradedPass',satisfactory:true});
});

test('a new draft, returned response, superseded grade and derived missing zero cannot produce a satisfactory chapter',()=>{
 assert.deepEqual(activityOutcome(null,{state:'missing',points:0,published:false},settings),pending);
 for(const state of ['draft','returned'])assert.deepEqual(activityOutcome({...submitted,state},grade,settings),pending);
 assert.deepEqual(activityOutcome({...submitted,returned_at:'2026-10-27T12:00:00.000Z'},grade,settings),pending);
 assert.deepEqual(activityOutcome(submitted,{...grade,submissionId:'older'},settings),awaiting);
 assert.deepEqual(activityOutcome(null,{state:'exempt'},settings),{state:'exempt',satisfactory:true});
 assert.deepEqual(activityOutcome({...submitted,state:'draft'},{state:'exempt'},settings),{state:'exempt',satisfactory:true});
 for(const cell of [{...grade,points:null},{...grade,maxPoints:0},{...grade,points:NaN}])assert.deepEqual(activityOutcome(submitted,cell,settings),awaiting);
 assert.deepEqual(activityOutcome(submitted,grade,{scaleMax:0,passMark:0}),awaiting);
 assert.deepEqual(Object.keys(activityOutcome(submitted,grade,settings)).sort(),['satisfactory','state']);
});

async function fixture(t,{legacy=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'aula-chapter-outcomes-')),password='Chapter-Outcomes-2026!';
 const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'99770001',ADMIN_PASSWORD:password,...(legacy?{}:{AULA_MODEL_V2:'1'})}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-chapter-outcomes-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;}});
 const master=client();await master.call('/auth/login',{document:'99770001',password});
 let course,viewer;
 const people=[];
 if(!legacy){
  const template=await master.call('/admin/courses',{title:'Outcome template'},'POST',201);course=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Outcome group',cohort:'2026',code:'O'},'POST',201);await master.call('/platform/courses/'+course.id+'/state',{state:'active'});
  await master.call('/admin/courses/'+course.id+'/enrollments/bulk',{students:[{document:'99770003',name:'Outcome learner'},{document:'99770004',name:'Outcome peer'}]},'POST',201);
  for(const document of ['99770003','99770004']){const session=client(),login=await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:password,confirmPassword:password});people.push({id:login.user.id,session});}
  const teacher=await master.call('/platform/users',{document:'99770005',name:'View-only teacher',roles:['teacher']},'POST',201);viewer=client();await viewer.call('/auth/login',{document:'99770005',password:'99770005'});await viewer.call('/auth/first-password',{newPassword:password,confirmPassword:password});await master.call('/platform/courses/'+course.id+'/staff',{userId:teacher.id,edit:false,grade:false,manage:false});
 }else{
  course=await master.call('/admin/courses',{title:'Legacy outcomes',published:true,accessMode:'password'},'POST',201);const hashed=await hashPassword(password);
  for(const document of ['99770003','99770004']){const id=randomUUID(),at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES(?,?,?,'student',?,?,?)").run(id,document,'Legacy learner',hashed,at,at);await master.call('/admin/enrollments',{courseId:course.id,studentId:id},'POST',201);const session=client();await session.call('/auth/login',{document,password});people.push({id,session});}
 }
 const activity=body=>master.call('/academics/courses/'+course.id+'/activities',{title:'Outcome activity',kind:'task',status:'published',maxPoints:10,maxAttempts:2,...body},'POST',201);
 const submit=(a,body={},who=people[0].session)=>who.call('/academics/activities/'+a.id+'/submit',{requestId:randomUUID(),activityRevision:a.revision,action:'submit',text:'A private response',...body},'POST',201);
 const grade=(submission,points,published=true)=>master.call('/academics/submissions/'+submission.id+'/grade',{version:submission.version,points,published,feedback:'Private feedback'},'PATCH');
 return {...app,course,master,client,people,viewer,activity,submit,grade,courseFor:(who=people[0].session,headers={})=>who.call('/courses/'+course.id,undefined,'GET',200,headers)};
}

test('course DTO exposes only the learner official outcome and preserves individual deadlines without grade leakage',async t=>{
 const f=await fixture(t),passed=await f.activity({title:'Passed'}),below=await f.activity({title:'Below'}),privateGrade=await f.activity({title:'Unpublished'}),waiting=await f.activity({title:'Awaiting'}),returned=await f.activity({title:'Returned'}),draft=await f.activity({title:'New draft'}),exempt=await f.activity({title:'Exempt'}),missing=await f.activity({title:'Derived missing',dueAt:new Date(Date.now()-10000).toISOString()});
 await f.grade(await f.submit(passed),6);await f.grade(await f.submit(below),0);await f.grade(await f.submit(privateGrade),10,false);await f.submit(waiting);
 const correction=await f.submit(returned);await f.master.call('/academics/submissions/'+correction.id+'/return',{version:correction.version,reason:'Fix the work',returnDueAt:null},'PATCH');
 await f.grade(await f.submit(draft),10);await f.submit(draft,{action:'draft'});
 await f.master.call('/grade-policy/'+f.course.id,{activityId:exempt.id,studentId:f.people[0].id,exempt:true,reason:'Authorized exemption'});
 await f.master.call('/academics/courses/'+f.course.id+'/settings',{missingAsZero:true},'PUT');
 await f.master.call('/academics/activities/'+waiting.id+'/extensions/'+f.people[0].id,{dueAt:null,version:0},'PUT');
 let own=await f.courseFor(),byId=new Map(own.activities.map(a=>[a.id,a]));
 assert.deepEqual(byId.get(passed.id).outcome,{state:'gradedPass',satisfactory:true});assert.deepEqual(byId.get(below.id).outcome,{state:'gradedBelow',satisfactory:false});assert.deepEqual(byId.get(privateGrade.id).outcome,awaiting);assert.deepEqual(byId.get(waiting.id).outcome,awaiting);
 for(const a of [returned,draft,missing])assert.deepEqual(byId.get(a.id).outcome,pending);
 assert.deepEqual(byId.get(exempt.id).outcome,{state:'exempt',satisfactory:true});assert.equal(byId.get(waiting.id).deadline.source,'extension');assert.equal(byId.get(waiting.id).effectiveDueAt,null);
 for(const row of own.activities){for(const key of ['points','maxPoints','feedback','answers','questions','correct','gradeDraft','automaticPoints','studentId','submissionId','payload'])assert.equal(Object.hasOwn(row,key),false,'Course DTO must not expose '+key);assert.deepEqual(Object.keys(row.outcome).sort(),['satisfactory','state']);}
 const peer=await f.courseFor(f.people[1].session);assert.ok(peer.activities.every(row=>row.outcome.state==='pending'&&!row.outcome.satisfactory));assert.ok(peer.activities.every(row=>row.extension===null));
 for(const who of [f.master,f.viewer])assert.ok((await f.courseFor(who)).activities.every(row=>!Object.hasOwn(row,'outcome')),'Staff listings do not reveal learner evaluations');
 const preview=await f.courseFor(f.master,{'X-Aula-Preview':f.course.id});assert.ok(preview.activities.every(row=>!Object.hasOwn(row,'outcome')&&!row.submitted&&row.responseState===null&&!Object.hasOwn(row,'extension')));
 const draftGrade=await f.master.call('/academics/activities/'+passed.id+'/submissions');await f.master.call('/academics/submissions/'+draftGrade.submissions[0].id+'/grade',{version:draftGrade.submissions[0].version,points:0,published:false,feedback:'Pending teacher edit'},'PATCH');
 own=await f.courseFor();assert.deepEqual(own.activities.find(row=>row.id===passed.id).outcome,{state:'gradedPass',satisfactory:true},'A private teacher edit cannot replace the official public result');
});

test('retained activity scales and changed pass marks follow the existing grade policy rather than the current maximum',async t=>{
 const f=await fixture(t),a=await f.activity(),sent=await f.submit(a);await f.grade(sent,6);
 await f.master.call('/academics/activities/'+a.id,{version:a.version,maxPoints:20,changeKind:'evaluated',revisionPolicy:'keep'},'PATCH');
 assert.deepEqual((await f.courseFor()).activities[0].outcome,{state:'gradedPass',satisfactory:true},'The published 6/10 remains approved after retaining an old-scale response');
 await f.master.call('/academics/courses/'+f.course.id+'/settings',{scaleMax:5,passMark:4},'PUT');assert.deepEqual((await f.courseFor()).activities[0].outcome,{state:'gradedBelow',satisfactory:false});
});

test('legacy course outcomes use existing published grades and remain absent for document-only access',async t=>{
 const f=await fixture(t,{legacy:true}),a=await f.activity(),sent=await f.submit(a);await f.grade(sent,6);
 assert.deepEqual((await f.courseFor()).activities[0].outcome,{state:'gradedPass',satisfactory:true});
 await f.master.call('/admin/courses/'+f.course.id,{accessMode:'document'},'PATCH');const documentOnly=f.client();await documentOnly.call('/auth/login',{document:'99770003'});
 const metadata=await f.courseFor(documentOnly);assert.ok(metadata.activities.every(row=>!Object.hasOwn(row,'outcome')&&!row.submitted&&row.responseState===null));
 const book=await f.people[0].session.call('/academics/courses/'+f.course.id);assert.equal(book.grade.cells[0].points,6);assert.equal(book.grade.accumulated,0,'Unassigned semester weight remains unchanged');
});
