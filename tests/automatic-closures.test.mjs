import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {openDatabase} from '../server/database.mjs';
import {createAccessModel} from '../server/access-model.mjs';
import {createActivityDeadlines,resolveActivityDeadline} from '../server/activity-deadlines.mjs';
import {createAutomaticClosures} from '../server/automatic-closures.mjs';

const iso=offset=>new Date(Date.now()+offset).toISOString();
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const pdf={name:'borrador.pdf',base64:Buffer.from('%PDF-1.4\nBorrador que se conserva').toString('base64')};

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-automatic-closures-')),app=await createApp({dataDir:dir,activityClosureIntervalMs:3600000,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99780001',ADMIN_PASSWORD:'Automatic-Closures-2026!'}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-automatic-closures-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;}});
 const teacher=client(),login=await teacher.call('/auth/login',{document:'99780001',password:'Automatic-Closures-2026!'}),teacherId=login.user.id;
 const template=await teacher.call('/admin/courses',{title:'Automatic closure template'},'POST',201),course=await teacher.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Automatic closure group',cohort:'2026',code:'C'},'POST',201);await teacher.call('/platform/courses/'+course.id+'/state',{state:'active'});
 await teacher.call('/admin/courses/'+course.id+'/enrollments/bulk',{students:[{document:'99780003',name:'Target learner'},{document:'99780004',name:'Peer learner'}]},'POST',201);
 const people=[];for(const document of ['99780003','99780004']){const session=client(),result=await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:'Automatic-Student-2026!',confirmPassword:'Automatic-Student-2026!'});people.push({id:result.user.id,session});}
 const activity=body=>teacher.call('/academics/courses/'+course.id+'/activities',{title:'Automatic closure task',kind:'task',status:'published',maxPoints:10,maxAttempts:1,...body},'POST',201);
 const submit=(a,body={},who=people[0].session,status=201,headers={})=>who.call('/academics/activities/'+a.id+'/submit',{requestId:randomUUID(),activityRevision:a.revision,action:'submit',text:'A real response',...body},'POST',status,headers);
 const close=async a=>teacher.call('/academics/activities/'+a.id,{version:a.version,dueAt:iso(-7200000),closesAt:iso(-3600000)},'PATCH');
 const own=a=>people[0].session.call('/academics/activities/'+a.id);
 const book=()=>teacher.call('/academics/courses/'+course.id+'/gradebook');
 const accessModel=createAccessModel(app.db,fail),extensions=createActivityDeadlines({db:app.db,fail});
 const audit=(actor,action,target,context)=>app.db.prepare('INSERT INTO audit(actor_id,action,target_id,created_at,context) VALUES(NULL,?,?,?,?)').run(action,target,new Date().toISOString(),JSON.stringify(context));
 const core=createAutomaticClosures({db:app.db,accessModel,studentDeadline:(a,id,latest,at)=>resolveActivityDeadline(a,extensions.get(a.id,id),latest,at),audit});
 const raw=a=>{const row=app.db.prepare('SELECT * FROM activities WHERE id=?').get(a.id);return {...JSON.parse(row.config),id:row.id,courseId:row.course_id,moduleId:row.module_id,revision:row.revision};};
 return {...app,teacher,teacherId,people,client,course,activity,submit,close,own,book,core,raw};
}

test('a closure stores an official zero once, independently of missingAsZero, preserving a draft and its files',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100}),draft=await f.submit(a,{action:'draft',files:[pdf]});await f.close(a);
 const before=f.db.prepare('SELECT payload,attempt,version FROM submissions WHERE id=?').get(draft.id),page=await f.own(a),closure=page.activity.closure;
 assert.equal(closure.closed,true);assert.equal(closure.automatic,true);assert.equal(closure.points,0);assert.equal(closure.version,1);assert.equal(closure.history.length,1);assert.equal(page.mine[0].state,'draft');assert.equal(page.mine[0].files.length,1);
 const book=await f.book(),cell=book.students.find(student=>student.id===f.people[0].id).cells[0];assert.equal(book.settings.missingAsZero,false);assert.equal(cell.state,'missing');assert.equal(cell.points,0);assert.equal(cell.published,true);assert.equal(cell.ready,true);assert.equal(cell.submissionId,null);
 for(let index=0;index<3;index++){await f.own(a);f.core.reconcile({courseId:f.course.id});}
 assert.equal(f.db.prepare('SELECT version,points,active FROM activity_auto_closures WHERE activity_id=? AND student_id=?').get(a.id,f.people[0].id).version,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_auto_closure_history WHERE activity_id=? AND student_id=?').get(a.id,f.people[0].id).n,1);
 assert.deepEqual({...f.db.prepare('SELECT payload,attempt,version FROM submissions WHERE id=?').get(draft.id)},{...before});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n,1,'The peer has a closure, not a fabricated submission');
 const review=await f.teacher.call('/academics/activities/'+a.id+'/submissions');assert.equal(review.submissions.length,1);assert.equal(review.closures.length,2);assert.ok(review.closures.every(row=>row.studentId&&row.closure.points===0&&!Object.hasOwn(row,'id')));
 const stored=openDatabase(f.dataDir);try{assert.equal(stored.prepare('SELECT points,active FROM activity_auto_closures WHERE activity_id=? AND student_id=?').get(a.id,f.people[0].id).points,0);}finally{stored.close();}
});

test('an individual reopening preserves peers published finals, keeps the original attempt and lets a real grade replace the zero',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100}),draft=await f.submit(a,{action:'draft',files:[pdf]});await f.close(a);await f.book();
 await f.teacher.call('/academics/courses/'+f.course.id+'/settings',{finalPublished:true},'PUT');
 const path='/academics/activities/'+a.id+'/extensions/'+f.people[0].id,grant=await f.teacher.call(path,{dueAt:null,version:0},'PUT');assert.equal(grant.closure.closed,false);assert.equal(grant.closure.points,null);assert.equal(grant.submissionState,'draft');assert.equal(grant.closure.history.at(-1).reason,'extension');
 let book=await f.book();assert.equal(book.settings.finalPublished,true);assert.equal(book.students.find(s=>s.id===f.people[0].id).final,null);assert.equal(book.students.find(s=>s.id===f.people[1].id).final,0);
 const sent=await f.submit(a,{requestId:draft.requestId,version:draft.version,retainFileIds:draft.files.map(file=>file.id)});assert.equal(sent.id,draft.id);assert.equal(sent.attempt,1);assert.equal(sent.state,'submitted');
 let page=await f.own(a);assert.equal(page.activity.closure.closed,false);assert.equal(page.activity.closure.history.at(-1).reason,'submission');book=await f.book();assert.equal(book.students.find(s=>s.id===f.people[0].id).cells[0].state,'submitted');assert.equal(book.students.find(s=>s.id===f.people[0].id).cells[0].points,null);
 await f.teacher.call('/academics/submissions/'+sent.id+'/grade',{version:sent.version,points:8,published:true},'PATCH');await f.teacher.call(path,{version:grant.extensionVersion},'DELETE');
 book=await f.book();const cell=book.students.find(s=>s.id===f.people[0].id).cells[0];assert.equal(cell.state,'graded');assert.equal(cell.points,8);assert.equal(cell.submissionId,sent.id);assert.equal(cell.closure.closed,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND student_id=?').get(a.id,f.people[0].id).n,1);
 const replacements=f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='activity.auto-replace' AND target_id=?").get(a.id).n;await f.own(a);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='activity.auto-replace' AND target_id=?").get(a.id).n,replacements);
});

test('delivered work, private grading, returned corrections and exemptions never receive an automatic zero',async t=>{
 const f=await fixture(t),waiting=await f.activity(),privateGrade=await f.activity(),returned=await f.activity(),exempt=await f.activity();
 const delivered=await f.submit(waiting),privateSent=await f.submit(privateGrade),sentBack=await f.submit(returned);
 await f.teacher.call('/academics/submissions/'+privateSent.id+'/grade',{version:privateSent.version,points:7,published:false},'PATCH');await f.teacher.call('/academics/submissions/'+sentBack.id+'/return',{version:sentBack.version,reason:'Correction requested',returnDueAt:iso(3600000)},'PATCH');f.db.prepare('UPDATE submissions SET return_due_at=? WHERE id=?').run(iso(-1000),sentBack.id);
 await f.teacher.call('/grade-policy/'+f.course.id,{activityId:exempt.id,studentId:f.people[0].id,exempt:true,reason:'Authorized exception'});
 for(const a of [waiting,privateGrade,returned,exempt])await f.close(a);f.core.reconcile({courseId:f.course.id});
 for(const a of [waiting,privateGrade,returned,exempt])assert.equal((await f.own(a)).activity.closure,null,'No closure for an actual delivery or exemption');
 const cells=(await f.book()).students.find(s=>s.id===f.people[0].id).cells;assert.equal(cells.find(c=>c.activityId===waiting.id).points,null);assert.equal(cells.find(c=>c.activityId===returned.id).state,'returned');assert.equal(cells.find(c=>c.activityId===exempt.id).state,'exempt');assert.equal(f.db.prepare('SELECT points FROM submissions WHERE id=?').get(delivered.id).points,null);assert.equal(f.db.prepare('SELECT points FROM submissions WHERE id=?').get(privateSent.id).points,null);
});

test('closing uses the effective hard deadline and respects future openings, unlimited windows and current enrollment',async t=>{
 const f=await fixture(t),lateOpen=await f.activity({dueAt:iso(-7200000),allowLate:true,closesAt:iso(3600000)}),unlimited=await f.activity({dueAt:iso(-7200000),allowLate:true}),lateClosed=await f.activity({dueAt:iso(-7200000),allowLate:true,closesAt:iso(-3600000)}),scheduled=await f.activity({opensAt:iso(3600000),dueAt:iso(7200000)}),extended=await f.activity({dueAt:iso(-7200000)});
 await f.teacher.call('/academics/activities/'+extended.id+'/extensions/'+f.people[0].id,{dueAt:null,version:0},'PUT');
 f.db.prepare("UPDATE enrollments SET expires_at=? WHERE student_id=? AND course_id=?").run(iso(-1000),f.people[1].id,f.course.id);
 f.core.reconcile({courseId:f.course.id});
 for(const a of [lateOpen,unlimited,scheduled])assert.equal(f.core.get(f.raw(a),f.people[0].id,{reconcile:false}),null);assert.equal(f.core.get(f.raw(lateClosed),f.people[0].id,{reconcile:false}).closed,true);assert.equal(f.core.get(f.raw(extended),f.people[0].id,{reconcile:false})?.closed,false);assert.equal(f.core.get(f.raw(lateClosed),f.people[1].id,{reconcile:false}),null,'Expired enrollment cannot receive a new zero');
 const future=await f.activity({dueAt:iso(3600000)}),at=iso(7200000);f.core.reconcile({courseId:f.course.id,studentId:f.people[0].id,at});const timed=f.core.get(f.raw(future),f.people[0].id,{reconcile:false});assert.equal(timed.closedAt,at);assert.equal(timed.deadlineAt,future.dueAt);
});

test('sweep skips hidden and suspended scopes, participates in an existing transaction and keeps revision history',async t=>{
 const f=await fixture(t),module=await f.teacher.call('/admin/courses/'+f.course.id+'/modules',{title:'Hidden chapter',published:false},'POST',201),hidden=await f.activity({moduleId:module.id,dueAt:iso(-10000)}),draft=await f.activity({status:'draft',dueAt:iso(-10000)}),active=await f.activity({dueAt:iso(-10000)});
 f.db.prepare("UPDATE users SET account_status='suspended' WHERE id=?").run(f.people[1].id);f.db.exec('BEGIN IMMEDIATE');f.core.reconcile({courseId:f.course.id});assert.ok(f.core.get(f.raw(active),f.people[0].id,{reconcile:false}));f.db.exec('ROLLBACK');assert.equal(f.core.get(f.raw(active),f.people[0].id,{reconcile:false}),null);
 f.core.reconcile({courseId:f.course.id});for(const a of [hidden,draft])assert.equal(f.core.get(f.raw(a),f.people[0].id,{reconcile:false}),null);assert.equal(f.core.get(f.raw(active),f.people[1].id,{reconcile:false}),null);
 const open=await f.activity(),response=await f.submit(open,{action:'draft',files:[pdf]});const closed=await f.close(open);await f.own(open);const revised=await f.teacher.call('/academics/activities/'+open.id,{version:closed.version,maxPoints:20,changeKind:'evaluated',revisionPolicy:'repeat'},'PATCH');assert.equal(revised.revision,2);assert.equal((await f.own(open)).activity.closure,null);const old=f.db.prepare('SELECT active FROM activity_auto_closures WHERE activity_id=? AND student_id=? AND revision=1').get(open.id,f.people[0].id);assert.equal(old.active,0);assert.equal(f.db.prepare('SELECT superseded FROM submissions WHERE id=?').get(response.id).superseded,1);
});

test('preview academic lists and details cannot read personal grades, drafts or create closures for a dual-role teacher',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'student')").run(f.teacherId);await f.teacher.call('/admin/enrollments',{courseId:f.course.id,studentId:f.teacherId},'POST',201);
 const answered=await f.activity(),pending=await f.activity({dueAt:iso(-10000)}),sent=await f.submit(answered,{},f.teacher,201,{'X-Aula-View':'learning'});await f.teacher.call('/academics/submissions/'+sent.id+'/grade',{version:sent.version,points:9,published:true},'PATCH');
 const headers={'X-Aula-Preview':f.course.id};const list=await f.teacher.call('/academics/courses',undefined,'GET',200,headers);assert.ok(list[0].activities.every(a=>!Object.hasOwn(a,'closure')&&a.responseState==='pending'));
 const course=await f.teacher.call('/academics/courses/'+f.course.id,undefined,'GET',200,headers);assert.equal(course.grade,null);assert.ok(course.activities.every(a=>a.mine.length===0&&!Object.hasOwn(a,'closure')));
 const detail=await f.teacher.call('/academics/activities/'+answered.id,undefined,'GET',200,headers);assert.deepEqual(detail.mine,[]);assert.deepEqual(detail.previous,[]);assert.equal(Object.hasOwn(detail.activity,'closure'),false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_auto_closures WHERE student_id=? AND activity_id=?').get(f.teacherId,pending.id).n,0);
});

test('an uneventful open activity does not scan the roster during periodic reconciliation',async t=>{
 const f=await fixture(t),a=await f.activity({dueAt:iso(3600000)}),queries=[];
 const db={prepare(sql){queries.push(sql);return f.db.prepare(sql);},exec(sql){return f.db.exec(sql);},get isTransaction(){return f.db.isTransaction;}};
 const core=createAutomaticClosures({db,accessModel:createAccessModel(f.db,fail),studentDeadline:()=>{throw Error('Open activity should be skipped before inspecting learners');}});core.reconcile({courseId:f.course.id});assert.ok(!queries.some(sql=>sql.includes('FROM users u')));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_auto_closures WHERE activity_id=?').get(a.id).n,0);
});

test('a closed automatic record permits a draft backup but cannot be submitted, even with an expired quiz timer',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',timeLimitMinutes:1,questions:[{id:'q',type:'text',prompt:'Explain the result',points:10}],procedureSupport:{enabled:true,required:false,reviewRequired:false}});await f.own(a);
 const draft=await f.submit(a,{action:'draft',text:'',answers:{q:'First working draft'}});await f.close(a);f.db.prepare('UPDATE attempt_starts SET started_at=? WHERE activity_id=? AND student_id=?').run(iso(-120000),a.id,f.people[0].id);
 const backedUp=await f.submit(a,{requestId:draft.requestId,version:draft.version,action:'draft',text:'',answers:{q:'The final unsent edits'},files:[pdf]});assert.equal(backedUp.state,'draft');assert.equal(backedUp.id,draft.id);assert.equal(backedUp.attempt,1);assert.equal(backedUp.closure.closed,true);assert.equal(backedUp.closure.points,0);assert.equal(backedUp.files.length,1);
 await f.submit(a,{requestId:draft.requestId,version:backedUp.version,action:'submit',text:'',answers:{q:'Attempt to send after closing'}},f.people[0].session,403);
 const page=await f.own(a);assert.equal(page.mine[0].answers.q,'The final unsent edits');assert.equal(page.activity.closure.closed,true);assert.equal(page.activity.closure.history.length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND student_id=?').get(a.id,f.people[0].id).n,1);assert.equal((await f.book()).students.find(s=>s.id===f.people[0].id).cells[0].points,0);
 const returned=await f.activity(),sent=await f.submit(returned),correction=await f.teacher.call('/academics/submissions/'+sent.id+'/return',{version:sent.version,reason:'Correction required',returnDueAt:iso(3600000)},'PATCH');f.db.prepare('UPDATE submissions SET return_due_at=? WHERE id=?').run(iso(-1000),sent.id);
 await f.submit(returned,{requestId:sent.requestId,version:correction.version,action:'draft'},f.people[0].session,403);assert.equal((await f.own(returned)).activity.closure,null,'The backup exception does not apply to a real correction');
});

test('incomplete inherited activity metadata stays readable without inventing a maximum or persisting a zero',async t=>{
 const f=await fixture(t),invalid=[];
 for(const maximum of [undefined,null,0,-1,'10']){const id=randomUUID(),config={title:'Inherited activity metadata',kind:'task',status:'published',weight:0,opensAt:null,dueAt:iso(-10000),questions:[]};if(maximum!==undefined)config.maxPoints=maximum;f.db.prepare('INSERT INTO activities(id,course_id,config,created_at) VALUES(?,?,?,?)').run(id,f.course.id,JSON.stringify(config),iso(-20000));invalid.push(id);}
 const valid=await f.activity({title:'Valid graded scale',dueAt:iso(-10000)});assert.doesNotThrow(()=>f.core.reconcile({courseId:f.course.id}));
 const course=await f.people[0].session.call('/courses/'+f.course.id),learning=await f.people[0].session.call('/learning');assert.ok(learning.courses.some(item=>item.courseId===f.course.id));
 for(const id of invalid){const item=course.activities.find(activity=>activity.id===id);assert.ok(item);assert.equal(item.closure,null);assert.equal(item.submitted,false);assert.equal(item.outcome.satisfactory,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_auto_closures WHERE activity_id=?').get(id).n,0);}
 assert.equal(f.db.prepare('SELECT active FROM activity_auto_closures WHERE activity_id=? AND student_id=?').get(valid.id,f.people[0].id).active,1,'One incomplete record must not block other valid closures');
});
