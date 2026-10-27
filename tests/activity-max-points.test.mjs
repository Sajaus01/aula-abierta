import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/security.mjs';

async function fixture(t,{legacy=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'aula-max-points-')),password='Maximum-Points-2026!',app=await createApp({dataDir:dir,activityClosureIntervalMs:3600000,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'99780001',ADMIN_PASSWORD:password,...(legacy?{}:{AULA_MODEL_V2:'1'})}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-max-points-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200){const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;}});
 const master=client();await master.call('/auth/login',{document:'99780001',password});let course,editor;const people=[];
 if(!legacy){
  const template=await master.call('/admin/courses',{title:'Scale template'},'POST',201);course=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Scale group',cohort:'2026',code:'S'},'POST',201);await master.call('/platform/courses/'+course.id+'/state',{state:'active'});
  await master.call('/admin/courses/'+course.id+'/enrollments/bulk',{students:[{document:'99780003',name:'First learner'},{document:'99780004',name:'Second learner'},{document:'99780005',name:'Draft learner'}]},'POST',201);
  for(const document of ['99780003','99780004','99780005']){const session=client(),result=await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:password,confirmPassword:password});people.push({id:result.user.id,session});}
  const user=await master.call('/platform/users',{document:'99780006',name:'Editor without grades',roles:['teacher']},'POST',201);editor=client();await editor.call('/auth/login',{document:'99780006',password:'99780006'});await editor.call('/auth/first-password',{newPassword:password,confirmPassword:password});await master.call('/platform/courses/'+course.id+'/staff',{userId:user.id,edit:true,grade:false,manage:false});
 }else{
  course=await master.call('/admin/courses',{title:'Legacy scale',published:true,accessMode:'password'},'POST',201);const id=randomUUID(),at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES(?,?,?,'student',?,?,?)").run(id,'99780003','Legacy learner',await hashPassword(password),at,at);await master.call('/admin/enrollments',{courseId:course.id,studentId:id},'POST',201);const session=client();await session.call('/auth/login',{document:'99780003',password});people.push({id,session});
 }
 const path=a=>'/academics/activities/'+a.id;
 const activity=body=>master.call('/academics/courses/'+course.id+'/activities',{title:'Scale activity',kind:'task',status:'published',maxPoints:100,maxAttempts:3,...body},'POST',201);
 const submit=(a,body={},who=people[0].session)=>who.call(path(a)+'/submit',{requestId:randomUUID(),activityRevision:a.revision,action:'submit',text:'Student response',...body},'POST',201);
 const grade=(s,points,published=false)=>master.call('/academics/submissions/'+s.id+'/grade',{version:s.version,points,published,feedback:'Feedback retained'},'PATCH');
 const patch=(a,body={},who=master,status=200)=>who.call(path(a),{version:a.version,changeKind:'evaluated',revisionPolicy:'keep',...body},'PATCH',status);
 const raw=id=>app.db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
 const roster=a=>master.call(path(a)+'/submissions');
 const book=()=>master.call('/academics/courses/'+course.id+'/gradebook');
 return {...app,master,editor,people,course,activity,submit,grade,patch,raw,roster,book,path};
}

test('saving a new scale converts retained scores atomically and preserves publication, private nulls, drafts and authentic history',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100});let first=await f.submit(a),zero=await f.submit(a,{},f.people[1].session),draft=await f.submit(a,{action:'draft'},f.people[2].session);
 first=await f.grade(first,80,true);first=await f.grade(first,null,false);zero=await f.grade(zero,0,false);
 const original=f.raw(first.id),historyId=randomUUID();f.db.prepare("INSERT INTO submissions(id,activity_id,student_id,request_key,attempt,state,payload,submitted_at,points,published,version,updated_at,revision,superseded) VALUES(?,?,?,?,0,'graded',?,?,80,1,1,?,1,1)").run(historyId,a.id,f.people[0].id,randomUUID(),JSON.stringify({gradingMaxPoints:100}),original.submitted_at,original.updated_at);
 const payload={maxPoints:5,preview:true},preview=await f.patch(a,payload);
 assert.equal(preview.scaleOnly,true);assert.equal(preview.scaleConversions,3);assert.equal(preview.oldMaxPoints,100);assert.equal(preview.newMaxPoints,5);assert.ok(preview.impact.every(row=>row.before===row.after));assert.equal(f.raw(first.id).points,80);
 const privatePreview=await f.patch(a,payload,f.editor);assert.deepEqual(privatePreview.impact,[]);assert.equal(typeof privatePreview.scaleConversions,'number');assert.doesNotMatch(JSON.stringify(privatePreview),/First learner|Second learner|Draft learner|studentId|publishedPoints/);
 const updated=await f.patch(a,{maxPoints:5});assert.equal(updated.maxPoints,5);assert.equal(updated.resubmissionRequired,false);assert.equal(updated.scaleOnly,true);
 const converted=f.raw(first.id),p=JSON.parse(converted.payload);assert.equal(converted.points,4);assert.equal(converted.published,1);assert.equal(converted.version,original.version+1);assert.equal(p.teacherGradeDraft.points,null);assert.equal(p.gradingMaxPoints,5);assert.equal(p.previousActivity.maxPoints,100);assert.deepEqual([p.scaleAdjustment.from,p.scaleAdjustment.to],[100,5]);
 assert.equal(JSON.parse(f.raw(zero.id).payload).teacherGradeDraft.points,0);assert.equal(f.raw(zero.id).published,0);assert.equal(f.raw(draft.id).state,'draft');assert.equal(f.raw(draft.id).attempt,1);assert.equal(JSON.parse(f.raw(draft.id).payload).gradingMaxPoints,5);
 assert.equal(f.raw(historyId).points,80);assert.equal(JSON.parse(f.raw(historyId).payload).gradingMaxPoints,100);assert.equal(f.raw(historyId).version,1);assert.equal(JSON.parse(f.db.prepare('SELECT config FROM activity_versions WHERE activity_id=? AND revision=1').get(a.id).config).maxPoints,100);
 const audit=f.db.prepare('SELECT * FROM grade_audit WHERE submission_id=? ORDER BY id DESC LIMIT 1').get(first.id);assert.equal(JSON.parse(audit.before_value).points,80);assert.equal(JSON.parse(audit.before_value).gradingMaxPoints,100);assert.equal(JSON.parse(audit.after_value).points,4);assert.equal(JSON.parse(audit.after_value).gradingMaxPoints,5);
 const visible=await f.people[0].session.call(f.path(a));assert.equal(visible.mine[0].points,4);assert.equal(visible.mine[0].gradingMaxPoints,5);assert.equal(Object.hasOwn(visible.mine[0],'gradeDraft'),false);assert.equal((await f.people[0].session.call('/academics/courses/'+f.course.id)).grade.accumulated,4);
 const teacher=(await f.roster(a)).submissions.find(row=>row.id===first.id);assert.equal(teacher.points,null);assert.equal(teacher.publishedPoints,4);assert.equal(teacher.previousActivity.maxPoints,100);
 await f.patch(a,{maxPoints:5},f.master,409);
});

test('saving the same maximum repairs retained legacy scales and converts each row from its own denominator',async t=>{
 const f=await fixture(t),a=await f.activity({maxPoints:5,weight:100}),s=await f.submit(a),second=await f.submit(a,{},f.people[1].session);
 f.db.prepare("UPDATE submissions SET points=?,published=1,state='graded',payload=? WHERE id=?").run(80,JSON.stringify({previousActivity:{maxPoints:100},automaticPoints:80}),s.id);
 f.db.prepare("UPDATE submissions SET points=?,published=0,state='graded',payload=? WHERE id=?").run(4,JSON.stringify({gradingMaxPoints:10,previousActivity:{maxPoints:100},teacherGradeDraft:{points:4,feedback:'Keep'}}),second.id);
 const before=(await f.book()).students.find(row=>row.id===f.people[0].id).accumulated,preview=await f.patch(a,{maxPoints:5,preview:true});assert.equal(preview.scaleOnly,true);assert.equal(preview.scaleConversions,2);assert.ok(preview.impact.every(row=>row.before===row.after));
 const updated=await f.patch(a,{maxPoints:5});assert.equal(updated.maxPoints,5);assert.equal(f.raw(s.id).points,4);assert.equal(JSON.parse(f.raw(s.id).payload).automaticPoints,4);assert.equal(f.raw(second.id).points,2);assert.equal(JSON.parse(f.raw(second.id).payload).teacherGradeDraft.points,2);assert.equal((await f.book()).students.find(row=>row.id===f.people[0].id).accumulated,before);
});

test('quiz proportional scales retain exact question weights and preserved drafts or corrections submit on the current scale',async t=>{
 const f=await fixture(t),questions=Array.from({length:20},(_,index)=>({id:'q'+index,type:'single',prompt:'Question '+index,options:['Yes','No'],correct:[0],points:5})),answers=Object.fromEntries(questions.map(q=>[q.id,[0]]));
 let a=await f.activity({kind:'quiz',questions}),draft=await f.submit(a,{action:'draft',text:'',answers}),sent=await f.submit(a,{text:'',answers},f.people[1].session);
 const returned=await f.master.call('/academics/submissions/'+sent.id+'/return',{version:sent.version,reason:'Improve work',returnDueAt:null},'PATCH');
 const smaller=questions.map(q=>({...q,points:.25}));a=await f.patch(a,{maxPoints:5,questions:smaller,revisionPolicy:'optional'});assert.equal(a.maxPoints,5);assert.ok(a.questions.every(q=>q.points===.25));assert.equal(f.raw(draft.id).superseded,0);assert.equal(f.raw(returned.id).state,'returned');
 for(const [previous,who]of [[draft,f.people[0].session],[returned,f.people[1].session]]){const current=f.raw(previous.id),result=await f.submit(a,{requestId:previous.requestId,version:current.version,text:'',answers},who),raw=f.raw(result.id),p=JSON.parse(raw.payload);assert.equal(result.id,previous.id);assert.equal(result.attempt,1);assert.equal(raw.points,5);assert.equal(result.gradingMaxPoints,5);assert.equal(raw.revision,a.revision);assert.equal(raw.superseded,0);assert.equal(p.previousActivity,undefined);assert.equal(p.scaleAdjustment,undefined);}
 const repeating=await f.patch(a,{maxPoints:10,questions:questions.map(q=>({...q,points:.5})),revisionPolicy:'repeat'});assert.equal(repeating.resubmissionRequired,true);assert.equal(repeating.scaleConversionCount,0);for(const row of f.db.prepare('SELECT * FROM submissions WHERE activity_id=?').all(a.id)){assert.equal(row.superseded,1);assert.equal(row.points,5);assert.equal(JSON.parse(row.payload).gradingMaxPoints,5);}
 const fractional=await f.activity({kind:'quiz',questions:questions.slice(0,3).map(q=>({...q,points:1/3}))}),fractionalAnswer={q0:[0],q1:[1],q2:[1]},fractionalSent=await f.submit(fractional,{text:'',answers:fractionalAnswer});assert.equal(fractional.maxPoints,1);assert.ok(Math.abs(f.raw(fractionalSent.id).points-1/3)<1e-14);assert.notEqual(f.raw(fractionalSent.id).points,.33);await f.master.call(f.path(fractional)+'/release',{});
 for(const [points,count]of [[.1,1],[1000,50]]){const edge=await f.activity({kind:'quiz',maxPoints:points*count,questions:questions.slice(0,1).flatMap(q=>Array.from({length:count},(_,index)=>({...q,id:'edge'+index,points})))});assert.equal(edge.maxPoints,points*count);assert.equal((await f.patch(edge,{maxPoints:edge.maxPoints})).maxPoints,edge.maxPoints);}
});

test('a failed conversion write rolls back scores, scale snapshots, audit and the activity version',async t=>{
 const f=await fixture(t),a=await f.activity(),s=await f.submit(a);await f.grade(s,80,true);const raw=f.raw(s.id),activity=f.db.prepare('SELECT * FROM activities WHERE id=?').get(a.id),auditCount=f.db.prepare('SELECT COUNT(*) n FROM grade_audit').get().n;
 f.db.exec("CREATE TRIGGER fail_scale BEFORE INSERT ON grade_audit WHEN NEW.reason LIKE 'Conversión proporcional%' BEGIN SELECT RAISE(ABORT,'Synthetic scale failure'); END");
 await f.patch(a,{maxPoints:5},f.master,500);assert.deepEqual(f.raw(s.id),raw);assert.deepEqual(f.db.prepare('SELECT * FROM activities WHERE id=?').get(a.id),activity);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM grade_audit').get().n,auditCount);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_versions WHERE activity_id=?').get(a.id).n,0);
 f.db.exec('DROP TRIGGER fail_scale');const fixed=await f.patch(a,{maxPoints:5});assert.equal(fixed.maxPoints,5);assert.equal(f.raw(s.id).points,4);
});

test('legacy courses persist a proportional scale change with an audit table and without requesting a new delivery',async t=>{
 const f=await fixture(t,{legacy:true}),a=await f.activity({weight:100}),s=await f.submit(a);await f.grade(s,80,true);const updated=await f.patch(a,{maxPoints:5});assert.equal(updated.maxPoints,5);assert.equal(updated.resubmissionRequired,false);assert.equal(f.raw(s.id).points,4);assert.equal(f.raw(s.id).superseded,0);assert.equal(JSON.parse(f.raw(s.id).payload).previousActivity.maxPoints,100);assert.equal(JSON.parse(f.raw(s.id).payload).gradingMaxPoints,5);assert.equal((await f.people[0].session.call(f.path(a))).mine[0].points,4);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM grade_audit WHERE submission_id=?').get(s.id).n,1);assert.equal((await f.book()).students[0].accumulated,4);
});
