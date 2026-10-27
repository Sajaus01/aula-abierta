import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {createApp,validateFile} from '../server/index.mjs';
import {createAcademics} from '../server/academics.mjs';
import {createAccessModel} from '../server/access-model.mjs';
import {resolveActivityDeadline,validateExtensionDueAt} from '../server/activity-deadlines.mjs';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const iso=offset=>new Date(Date.now()+offset).toISOString();
const pdf={name:'procedimiento.pdf',base64:Buffer.from('%PDF-1.4\nProcedimiento conservado').toString('base64')};
const questions=[{id:'q',type:'single',prompt:'Dos más dos',options:['4','5'],correct:[0],points:1}];

test('individual deadlines validate real calendar instants and use the last explicit correction or extension',()=>{
 const at='2026-10-27T12:00:00.000Z',activity={dueAt:'2026-10-26T12:00:00.000Z',closesAt:'2026-10-26T18:00:00.000Z',allowLate:true,opensAt:null};
 assert.equal(resolveActivityDeadline(activity,null,null,at).closed,true);
 const extension={active:true,dueAt:null,updatedAt:'2026-10-27T11:00:00.000Z',version:1};
 assert.deepEqual([resolveActivityDeadline(activity,extension,null,at).source,resolveActivityDeadline(activity,extension,null,at).closed],['extension',false]);
 const correction={state:'draft',returned_at:'2026-10-27T11:30:00.000Z',return_due_at:'2026-10-27T11:45:00.000Z'};
 assert.deepEqual([resolveActivityDeadline(activity,extension,correction,at).source,resolveActivityDeadline(activity,extension,correction,at).closed],['correction',true]);
 assert.equal(resolveActivityDeadline(activity,{...extension,updatedAt:correction.returned_at},correction,at).source,'extension');
 assert.equal(resolveActivityDeadline(activity,{...extension,active:false,updatedAt:at},correction,at).source,'correction');
 const deadline=resolveActivityDeadline(activity,{...extension,dueAt:at},null,at);assert.equal(deadline.closed,true,'The deadline is closed at its exact instant');
 assert.equal(validateExtensionDueAt('2028-02-29T07:30:00-05:00',activity,fail,at),'2028-02-29T12:30:00.000Z');
 assert.equal(validateExtensionDueAt(null,activity,fail,at),null);
 for(const value of ['2027-02-29T12:00:00Z','2028-02-30T12:00:00Z','2027-04-31T12:00:00Z','2027-01-01T24:00:00Z','2027-01-01T12:60:00Z','2027-01-01T12:00:60Z','2027-01-01T12:00:00+14:01','2027-01-01T12:00:00',at,undefined])assert.throws(()=>validateExtensionDueAt(value,activity,fail,at),error=>error.status===400);
 assert.throws(()=>validateExtensionDueAt('2027-01-01T12:00:00Z',{opensAt:'2027-01-02T12:00:00.000Z'},fail,at),error=>error.status===400);
});

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-activity-deadlines-')),app=await createApp({dataDir:dir,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99660001',ADMIN_PASSWORD:'Deadline-Master-2026!'}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-activity-deadlines-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;}});
 const master=client();await master.call('/auth/login',{document:'99660001',password:'Deadline-Master-2026!'});
 const people={};
 for(const [key,document,name,role]of [['grader','99660002','Grading teacher','teacher'],['editor','99660003','Editing teacher','teacher'],['student','99660004','Alpha learner','student'],['second','99660005','Beta learner','student'],['foreign','99660006','Foreign learner','student']]){const user=await master.call('/platform/users',{document,name,roles:[role]},'POST',201),session=client();await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:'Deadline-Person-2026!',confirmPassword:'Deadline-Person-2026!'});people[key]={...user,session};}
 const template=await master.call('/admin/courses',{title:'Deadline template'},'POST',201),group=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Deadline group A',cohort:'2026',code:'A'},'POST',201),other=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Deadline group B',cohort:'2026',code:'B'},'POST',201);
 for(const course of [group,other])await master.call('/platform/courses/'+course.id+'/state',{state:'active'});
 await master.call('/platform/courses/'+group.id+'/staff',{userId:people.grader.id,edit:false,grade:true,manage:false});
 await master.call('/platform/courses/'+group.id+'/staff',{userId:people.editor.id,edit:true,grade:false,manage:false});
 for(const key of ['student','second'])await master.call('/admin/enrollments',{studentId:people[key].id,courseId:group.id},'POST',201);
 await master.call('/admin/enrollments',{studentId:people.foreign.id,courseId:other.id},'POST',201);
 const activity=body=>master.call('/academics/courses/'+group.id+'/activities',{title:'Individual deadline activity',kind:'task',status:'published',maxPoints:10,maxAttempts:1,...body},'POST',201);
 const submit=(a,body={},who=people.student.session,status=201)=>who.call('/academics/activities/'+a.id+'/submit',{activityRevision:a.revision,requestId:randomUUID(),action:'submit',text:'A documented answer',...body},'POST',status);
 const extensionPath=(a,id=people.student.id)=>'/academics/activities/'+a.id+'/extensions/'+id;
 const grant=(a,dueAt=null,version=0,id=people.student.id,status=200)=>people.grader.session.call(extensionPath(a,id),{dueAt,version},'PUT',status);
 const book=()=>master.call('/academics/courses/'+group.id+'/gradebook');
 return {...app,base,people,group,other,master,client,activity,submit,extensionPath,grant,book};
}

test('grade authority and current same-group enrollment protect the roster and every extension mutation',async t=>{
 const f=await fixture(t),a=await f.activity({dueAt:iso(-7200000),closesAt:iso(-3600000)}),listPath='/academics/activities/'+a.id+'/extensions';
 let roster=await f.people.grader.session.call(listPath);assert.deepEqual(roster.students.map(s=>s.id).sort(),[f.people.student.id,f.people.second.id].sort());assert.ok(roster.students.every(s=>s.submissionState==='pending'&&s.extension===null&&s.extensionVersion===0));
 for(const who of [f.people.editor.session,f.people.student.session,f.people.foreign.session]){await who.call(listPath,undefined,'GET',403);await who.call(f.extensionPath(a),{dueAt:null,version:0},'PUT',403);await who.call(f.extensionPath(a),{version:0},'DELETE',403);}
 await f.people.grader.session.call(listPath,undefined,'GET',403,{'X-Aula-Preview':f.group.id});
 await f.grant(a,null,0,f.people.foreign.id,403);
 f.db.prepare("UPDATE enrollments SET expires_at=? WHERE course_id=? AND student_id=?").run(iso(-1000),f.group.id,f.people.second.id);
 roster=await f.people.grader.session.call(listPath);assert.deepEqual(roster.students.map(s=>s.id),[f.people.student.id]);await f.grant(a,null,0,f.people.second.id,403);
 const granted=await f.grant(a);assert.equal(granted.extension.active,true,'A teacher with grade but no edit authority can grant');
 const audit=f.db.prepare("SELECT context FROM audit WHERE action='activity.extension.grant' AND target_id=?").get(a.id);assert.ok(audit);assert.match(audit.context,new RegExp(f.people.student.id));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n,0,'Authorizing a deadline never creates a submission or a stored zero');
});

test('extensions replace only the selected derived missing grade, preserve manual grades, version revocation and global dates',async t=>{
 const f=await fixture(t),dueAt=iso(-7200000),closesAt=iso(-3600000),a=await f.activity({dueAt,closesAt,weight:100});
 await f.master.call('/academics/courses/'+f.group.id+'/settings',{missingAsZero:true},'PUT');
 let book=await f.book();assert.ok(book.students.every(s=>s.cells[0].state==='missing'));
 const future=iso(3600000),granted=await f.grant(a,future);assert.equal(granted.extension.version,1);assert.equal(granted.deadline.source,'extension');assert.equal(granted.effectiveClosesAt,future);
 book=await f.book();assert.equal(book.students.find(s=>s.id===f.people.student.id).cells[0].state,'pending');assert.equal(book.students.find(s=>s.id===f.people.second.id).cells[0].state,'missing');
 const mine=await f.people.student.session.call('/academics/activities/'+a.id);assert.equal(mine.activity.dueAt,dueAt);assert.equal(mine.activity.closesAt,closesAt);assert.equal(mine.activity.effectiveDueAt,future);assert.equal(mine.activity.extension.version,1);
 const overview=await f.people.student.session.call('/academics/courses');assert.equal(overview[0].activities[0].effectiveDueAt,future);
 await f.grant(a,null,0,f.people.student.id,409);await f.people.grader.session.call(f.extensionPath(a),{version:0},'DELETE',409);
 const revoked=await f.people.grader.session.call(f.extensionPath(a),{version:1},'DELETE');assert.equal(revoked.extension.active,false);assert.equal(revoked.extension.version,2);assert.equal(revoked.deadline.source,'activity');
 assert.equal((await f.book()).students.find(s=>s.id===f.people.student.id).cells[0].state,'missing');await f.submit(a,{},f.people.student.session,403);
 const unlimited=await f.grant(a,null,2);assert.equal(unlimited.extension.createdAt,granted.extension.createdAt);assert.equal(unlimited.extension.version,3);assert.equal(unlimited.effectiveDueAt,null);assert.equal(unlimited.effectiveClosesAt,null);
 const draft=await f.submit(a,{action:'draft',files:[pdf]});assert.equal(draft.state,'draft');assert.equal(draft.files.length,1);
 const sent=await f.submit(a,{requestId:draft.requestId,version:draft.version,retainFileIds:draft.files.map(file=>file.id)});assert.equal(sent.attempt,1);assert.equal(sent.late,false);await f.submit(a,{},f.people.student.session,403);await f.submit(a,{},f.people.second.session,403);
 const graded=await f.master.call('/academics/submissions/'+sent.id+'/grade',{version:sent.version,points:0,published:true,feedback:'Cero asignado manualmente'},'PATCH');assert.equal(graded.points,0);
 await f.grant(a,iso(7200000),3);const grade=(await f.book()).students.find(s=>s.id===f.people.student.id).cells[0];assert.equal(grade.state,'graded');assert.equal(grade.points,0);assert.equal(grade.submissionId,sent.id);
 const global=await f.master.call('/academics/activities/'+a.id);assert.equal(global.activity.dueAt,dueAt);assert.equal(global.activity.closesAt,closesAt);assert.equal(global.activity.maxAttempts,1);
});

test('individual authorization respects opening, hidden chapters and strict server dates',async t=>{
 const f=await fixture(t),a=await f.activity({opensAt:iso(3600000),dueAt:iso(7200000)});
 for(const dueAt of ['2028-02-30T12:00:00Z','2028-01-01T12:00:00',iso(-1000),iso(1800000)])await f.grant(a,dueAt,0,f.people.student.id,400);
 await f.people.grader.session.call(f.extensionPath(a),{dueAt:null},'PUT',400);
 await f.grant(a);await f.submit(a,{},f.people.student.session,403);assert.equal((await f.people.student.session.call('/academics/activities/'+a.id)).activity.materialsAvailable,false);
 const module=await f.master.call('/admin/courses/'+f.group.id+'/modules',{title:'Hidden chapter',published:false},'POST',201),hidden=await f.activity({moduleId:module.id});await f.grant(hidden);await f.submit(hidden,{},f.people.student.session,404);
 const draft=await f.activity({status:'draft'});await f.grant(draft);await f.submit(draft,{},f.people.student.session,404);
});

test('grant and revoke recalculate only the selected final while preserving global publication and another manual zero',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100}),sent=await f.submit(a,{},f.people.second.session);
 const manual=await f.master.call('/academics/submissions/'+sent.id+'/grade',{version:sent.version,points:0,published:true,feedback:'Cero manual publicado'},'PATCH');
 await f.master.call('/academics/activities/'+a.id,{version:a.version,dueAt:iso(-7200000),closesAt:iso(-3600000)},'PATCH');
 await f.master.call('/academics/courses/'+f.group.id+'/settings',{missingAsZero:true,finalPublished:true},'PUT');
 let book=await f.book();assert.equal(book.settings.finalPublished,true);assert.ok(book.students.every(student=>student.ready&&student.final===0));
 const extension=await f.grant(a,iso(3600000));book=await f.book();
 const selected=book.students.find(student=>student.id===f.people.student.id),other=book.students.find(student=>student.id===f.people.second.id);
 assert.equal(book.settings.finalPublished,true);assert.equal(selected.ready,false);assert.equal(selected.final,null);assert.equal(selected.cells[0].state,'pending');assert.equal(other.ready,true);assert.equal(other.final,0);assert.equal(other.cells[0].state,'graded');assert.equal(other.cells[0].points,0);
 const visible=await f.people.second.session.call('/academics/courses/'+f.group.id);assert.equal(visible.grade.final,0,'Another student keeps the already published final');
 await f.people.grader.session.call(f.extensionPath(a),{version:extension.extensionVersion},'DELETE');book=await f.book();
 const restored=book.students.find(student=>student.id===f.people.student.id);assert.equal(book.settings.finalPublished,true);assert.equal(restored.ready,true);assert.equal(restored.final,0);assert.equal(restored.cells[0].state,'missing');
 const unchanged=f.db.prepare('SELECT points,published,version,feedback FROM submissions WHERE id=?').get(sent.id);assert.deepEqual({...unchanged},{points:0,published:1,version:manual.version,feedback:'Cero manual publicado'});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND student_id=?').get(a.id,f.people.student.id).n,0,'The restored missing zero remains derived');
});

test('returned responses use the most recent authorization and retain the same response and files',async t=>{
 const f=await fixture(t),a=await f.activity({dueAt:iso(-7200000),allowLate:true,maxAttempts:1}),sent=await f.submit(a,{files:[pdf]});
 let extension=await f.grant(a,null),returned=await f.master.call('/academics/submissions/'+sent.id+'/return',{version:sent.version,reason:'Corrige las unidades',returnDueAt:iso(3600000)},'PATCH');
 f.db.prepare('UPDATE submissions SET return_due_at=? WHERE id=?').run(iso(-1000),sent.id);
 await f.submit(a,{requestId:sent.requestId,version:returned.version},f.people.student.session,403);
 extension=await f.grant(a,null,extension.extensionVersion);let mine=await f.people.student.session.call('/academics/activities/'+a.id);assert.equal(mine.activity.deadline.source,'extension');assert.equal(mine.mine[0].files.length,1);
 const revoked=await f.people.grader.session.call(f.extensionPath(a),{version:extension.extensionVersion},'DELETE');assert.equal(revoked.deadline.source,'correction');assert.equal(revoked.deadline.closed,true);
 extension=await f.grant(a,iso(3600000),revoked.extensionVersion);const corrected=await f.submit(a,{requestId:sent.requestId,version:returned.version,retainFileIds:sent.files.map(file=>file.id)});assert.equal(corrected.id,sent.id);assert.equal(corrected.attempt,1);assert.equal(corrected.files.length,1);assert.equal(corrected.returnedAt,null);
});

test('grant resets only an expired unfinished timer and keeps live timers, files and attempt limits',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',questions,timeLimitMinutes:5,procedureSupport:{enabled:true,required:false,maxFiles:5,maxFileMB:10,reviewRequired:false}});
 await f.people.student.session.call('/academics/activities/'+a.id);await f.people.second.session.call('/academics/activities/'+a.id);
 const draft=await f.submit(a,{action:'draft',text:'',answers:{q:[0]},files:[pdf]});
 f.db.prepare('UPDATE attempt_starts SET started_at=? WHERE activity_id=? AND student_id=?').run(iso(-6*60000),a.id,f.people.student.id);
 await f.submit(a,{requestId:draft.requestId,version:draft.version,text:'',answers:{q:[0]}},f.people.student.session,403);
 const live=f.db.prepare('SELECT started_at FROM attempt_starts WHERE activity_id=? AND student_id=?').get(a.id,f.people.second.id).started_at;
 assert.equal((await f.grant(a)).timerReset,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attempt_starts WHERE activity_id=? AND student_id=?').get(a.id,f.people.student.id).n,0);
 assert.equal((await f.grant(a,null,0,f.people.second.id)).timerReset,false);assert.equal(f.db.prepare('SELECT started_at FROM attempt_starts WHERE activity_id=? AND student_id=?').get(a.id,f.people.second.id).started_at,live);
 const reopened=await f.people.student.session.call('/academics/activities/'+a.id);assert.ok(Date.parse(reopened.deadline)>Date.now());assert.equal(reopened.mine[0].id,draft.id);assert.equal(reopened.mine[0].files.length,1);
 const sent=await f.submit(a,{requestId:draft.requestId,version:draft.version,text:'',answers:{q:[0]},retainFileIds:draft.files.map(file=>file.id)});assert.equal(sent.id,draft.id);assert.equal(sent.attempt,1);
 await f.grant(a,null,1);await f.people.student.session.call('/academics/activities/'+a.id);await f.submit(a,{text:'',answers:{q:[0]}},f.people.student.session,403);
});

test('a mutation rechecks grade authority after receiving a delayed request body',async t=>{
 const f=await fixture(t),a=await f.activity(),body=JSON.stringify({dueAt:null,version:0});
 let finish;
 const started=new Promise(resolveStarted=>{
  finish=new Promise((resolveResponse,reject)=>{
   const req=request(f.base+'/api'+f.extensionPath(a),{method:'PUT',headers:{Cookie:f.people.grader.session.cookie,Origin:f.base,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolveResponse({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.write(body.slice(0,8));req.flushHeaders();setTimeout(()=>resolveStarted(()=>req.end(body.slice(8))),40);
  });
 });
 const end=await started;await f.master.call('/platform/courses/'+f.group.id+'/staff',{userId:f.people.grader.id,edit:false,grade:false,manage:false});end();const response=await finish;assert.equal(response.status,403,JSON.stringify(response.body));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_deadline_extensions').get().n,0);
});

test('revoking an extension while an upload is being read prevents the pending submission',async t=>{
 const f=await fixture(t),a=await f.activity({dueAt:iso(-10000)}),extension=await f.grant(a),body=JSON.stringify({activityRevision:a.revision,requestId:randomUUID(),action:'submit',text:'Pending upload',files:[pdf]});
 let finish;
 const end=await new Promise(resolveStarted=>{
  finish=new Promise((resolveResponse,reject)=>{
   const req=request(f.base+'/api/academics/activities/'+a.id+'/submit',{method:'POST',headers:{Cookie:f.people.student.session.cookie,Origin:f.base,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolveResponse({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.write(body.slice(0,8));req.flushHeaders();setTimeout(()=>resolveStarted(()=>req.end(body.slice(8))),40);
  });
 });
 await f.people.grader.session.call(f.extensionPath(a),{version:extension.extensionVersion},'DELETE');end();const response=await finish;assert.equal(response.status,403,JSON.stringify(response.body));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n,0);assert.deepEqual(await readdir(join(f.dataDir,'uploads')),[]);
});

test('the final write rechecks a revoked window after file validation and removes newly written files',async t=>{
 const f=await fixture(t),a=await f.activity({dueAt:iso(-10000)});await f.grant(a);
 const accessModel=createAccessModel(f.db,fail),user=accessModel.decorate(f.db.prepare('SELECT * FROM users WHERE id=?').get(f.people.student.id)),auth={user,assurance:'password'};
 const body={activityRevision:a.revision,requestId:randomUUID(),action:'submit',text:'Validated upload',files:[pdf]},audit=()=>{};audit.capture=()=>({});
 const academics=createAcademics({db:f.db,fail,accessModel,env:{},uploadsDir:join(f.dataDir,'uploads'),audit,json:()=>{},readJson:async()=>body,readSession:()=>auth,requireAdmin:()=>fail(403,'Admin only'),requireStudent:session=>{if(session.user.id!==user.id)fail(403,'Invalid student');},requireCourse:id=>f.db.prepare('SELECT * FROM courses WHERE id=?').get(id),isEnrolled:()=>true,validateFile:(file,options)=>{const validated=validateFile(file,options);f.db.prepare('UPDATE activity_deadline_extensions SET active=0 WHERE activity_id=? AND student_id=?').run(a.id,user.id);return validated;}});
 await assert.rejects(academics.handler({}, {},'/api/academics/activities/'+a.id+'/submit','POST',auth),error=>error.status===403);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n,0);assert.deepEqual(await readdir(join(f.dataDir,'uploads')),[]);
});
