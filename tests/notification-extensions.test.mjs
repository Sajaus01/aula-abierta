import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes,createECDH} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {setupNotifications} from '../server/notifications.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-notification-extensions-')),pushes=[],transport={status:0};
 const options={dataDir:dir,notificationPushSend:async(subscription,payload)=>{pushes.push(JSON.parse(payload));if(transport.status)throw Object.assign(new Error('Synthetic push failure'),{statusCode:transport.status});},env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99881001',ADMIN_PASSWORD:'Master-Extensions-2026!'}};
 let app,base;
 async function start(){app=await createApp(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;}
 await start();
 async function close(){await app.notifications.flush();await new Promise(resolve=>app.server.close(resolve));}
 t.after(async()=>{await close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 function client(view='learning'){let cookie='';return async(path,body,method=body===undefined?'GET':'POST',status=200,headers={})=>{
  const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie,'X-Aula-View':view,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(value));return value.data;
 };}
 const master=client('teaching');const login=()=>master('/auth/login',{document:'99881001',password:'Master-Extensions-2026!'});await login();
 const template=await master('/admin/courses',{title:'Plazos sintéticos'},'POST',201),course=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Laboratorio de plazos',cohort:'2026-2',code:'E'},'POST',201);
 await master('/platform/courses/'+course.id+'/state',{state:'active'});
 const people=[];
 async function person(enroll=true){const id=randomUUID(),document=String(99881002+people.length),time=new Date().toISOString(),hash=app.db.prepare("SELECT password_hash FROM users WHERE document='99881001'").get().password_hash;
  app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at,account_status) VALUES(?,?,?,'student',?,?,?,'active')").run(id,document,'Persona sintética '+people.length,hash,time,time);
  app.db.prepare("INSERT OR IGNORE INTO user_roles VALUES(?,'student')").run(id);
  if(enroll)await master('/admin/enrollments',{studentId:id,courseId:course.id},'POST',201);
  const call=client();const auth=()=>call('/auth/login',{document,password:'Master-Extensions-2026!'});await auth();const p={id,call,auth};people.push(p);return p;
 }
 const student=await person(),peer=await person(),outsider=await person(false);
 const activity=await master('/academics/courses/'+course.id+'/activities',{title:'Práctica de calibración',kind:'task',status:'published'},'POST',201);
 const path='/academics/activities/'+activity.id+'/extensions/'+student.id;
 const extensions=async who=>(await who.call('/notifications')).items.filter(item=>item.kind.startsWith('extension'));
 return {get db(){return app.db;},get notifications(){return app.notifications;},master,student,peer,outsider,course,activity,path,pushes,transport,extensions,async restart(){await close();await start();await login();await student.auth();await peer.auth();await outsider.auth();}};
}
const subscription=()=>{const ec=createECDH('prime256v1');return {endpoint:'https://fcm.googleapis.com/fcm/send/extension-'+randomUUID(),expirationTime:null,keys:{p256dh:ec.generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}};};
const future='2099-07-01T15:45:00.000Z';
function directGrant(f,{dueAt=future}={}){const at=new Date().toISOString(),actor=f.db.prepare("SELECT id FROM users WHERE document='99881001'").get().id;f.db.prepare('INSERT INTO activity_deadline_extensions VALUES(?,?,?,1,1,?,?,NULL,?)').run(f.activity.id,f.student.id,dueAt,at,at,actor);}

test('extension notifications are personal, date-aware and versioned without disclosing grades',async t=>{
 const f=await fixture(t);
 let result=await f.master(f.path,{dueAt:future,version:0},'PUT');assert.equal(result.extension.version,1);
 let items=await f.extensions(f.student);assert.equal(items.length,1);assert.equal(items[0].title,'Entrega habilitada');assert.equal(items[0].personal,true);assert.equal(items[0].href,'#actividad/'+f.activity.id);assert.match(items[0].body,/01\/07\/2099 a las 10:45 \(hora de Colombia\)/);
 assert.equal((await f.extensions(f.peer)).length,0);assert.equal((await f.extensions(f.outsider)).length,0);
 assert.ok(!(await f.master('/notifications/courses/'+f.course.id)).items.some(item=>item.kind.startsWith('extension')));
 const event=f.db.prepare("SELECT * FROM notification_events WHERE object_type='extension'").get();assert.equal(event.student_id,f.student.id);assert.equal(event.source_version,1);assert.deepEqual(f.db.prepare('SELECT user_id FROM notification_recipients WHERE event_id=?').all(event.id).map(row=>row.user_id),[f.student.id]);
 result=await f.master(f.path,{dueAt:null,version:1},'PUT');items=await f.extensions(f.student);assert.equal(items.length,1);assert.equal(items[0].title,'Plazo individual actualizado');assert.match(items[0].body,/sin límite de fecha/);
 result=await f.master(f.path,{version:2},'DELETE');items=await f.extensions(f.student);assert.equal(items.length,1);assert.equal(items[0].title,'Autorización retirada');assert.equal(items[0].kind,'extension-revoked');
 await f.master(f.path,{dueAt:null,version:3},'PUT');items=await f.extensions(f.student);assert.equal(items.length,1);assert.equal(items[0].title,'Entrega habilitada');
 const count=f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE object_type='extension'").get().n;
 await f.master(f.path,{dueAt:future,version:3},'PUT',409);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE object_type='extension'").get().n,count);
 await f.student.call(f.path,{dueAt:future,version:4},'PUT',403);
 await f.master('/notifications',undefined,'GET',403,{'X-Aula-Preview':f.course.id});
 assert.ok(!JSON.stringify(items).includes('feedback'));assert.ok(!JSON.stringify(items).includes('points'));
 assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('extension events roll back with authorization and schema/restarts never replay them',async t=>{
 const f=await fixture(t);f.db.exec('BEGIN IMMEDIATE');directGrant(f);f.db.exec('ROLLBACK');assert.equal((await f.extensions(f.student)).length,0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE object_type='extension'").get().n,0);
 await f.master(f.path,{dueAt:null,version:0},'PUT');const before=await f.extensions(f.student);assert.equal(before.length,1);
 setupNotifications(f.db);setupNotifications(f.db);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE object_type='extension'").get().n,1);
 await f.restart();const after=await f.extensions(f.student);assert.deepEqual(after.map(item=>item.id),before.map(item=>item.id));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE object_type='extension'").get().n,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_inbox i JOIN notification_events e ON e.id=i.event_id WHERE e.object_type='extension'").get().n,1);
});

test('pending extension alerts respect hidden content, enrollment, expiry and archived groups',async t=>{
 for(const restriction of ['activity','module','enrollment','expired','archived'])await t.test(restriction,async t=>{
  const f=await fixture(t);directGrant(f);
  if(restriction==='activity')f.db.prepare("UPDATE activities SET config=json_set(config,'$.status','draft') WHERE id=?").run(f.activity.id);
  if(restriction==='module'){const id=randomUUID();f.db.prepare('INSERT INTO modules(id,course_id,title,published) VALUES(?,?,?,1)').run(id,f.course.id,'Capítulo sintético');f.db.prepare('UPDATE activities SET module_id=? WHERE id=?').run(id,f.activity.id);f.db.prepare('UPDATE modules SET published=0 WHERE id=?').run(id);}
  if(restriction==='enrollment')f.db.prepare("UPDATE enrollments SET status='revoked' WHERE course_id=? AND student_id=?").run(f.course.id,f.student.id);
  if(restriction==='expired')f.db.prepare("UPDATE activity_deadline_extensions SET due_at='2000-01-01T00:00:00.000Z' WHERE activity_id=? AND student_id=?").run(f.activity.id,f.student.id);
  if(restriction==='archived')f.db.prepare("UPDATE courses SET lifecycle='archived' WHERE id=?").run(f.course.id);
  await f.notifications.flush();assert.equal((await f.extensions(f.student)).length,0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_inbox i JOIN notification_events e ON e.id=i.event_id WHERE e.object_type='extension'").get().n,0);
 });
});

test('extension push retries cancel obsolete versions and keep browser payload private after restart',async t=>{
 const f=await fixture(t);await f.student.call('/notifications/push/subscriptions',{subscription:subscription()},'POST',201);f.transport.status=429;
 await f.master(f.path,{dueAt:future,version:0},'PUT');await f.notifications.flush();assert.equal(f.pushes.length,1);
 await f.master(f.path,{dueAt:null,version:1},'PUT');await f.notifications.flush();assert.equal(f.pushes.length,2);
 await f.master(f.path,{version:2},'DELETE');await f.notifications.flush();assert.equal(f.pushes.length,3);
 const rows=f.db.prepare("SELECT d.state,e.source_version FROM notification_push_deliveries d JOIN notification_inbox i ON i.id=d.inbox_id JOIN notification_events e ON e.id=i.event_id WHERE e.object_type='extension' ORDER BY e.source_version").all();assert.deepEqual(rows.map(row=>row.state),['cancelled','cancelled','pending']);
 f.transport.status=0;f.db.prepare("UPDATE notification_push_deliveries SET next_attempt='2000-01-01T00:00:00.000Z' WHERE state='pending'").run();await f.notifications.flush();assert.equal(f.pushes.length,4);
 assert.ok(f.pushes.every(payload=>payload.body==='Tienes novedades en uno de tus cursos.'));assert.ok(!JSON.stringify(f.pushes).includes('calibración'));assert.ok(!JSON.stringify(f.pushes).includes('2099'));
 await f.restart();await f.notifications.flush();assert.equal(f.pushes.length,4);assert.equal((await f.extensions(f.student))[0].title,'Autorización retirada');
});

test('final-grade alerts follow each recipient while an extension preserves global publication',async t=>{
 const f=await fixture(t),past='2000-01-01T00:00:00.000Z';
 f.db.prepare("UPDATE activities SET config=json_set(config,'$.weight',100,'$.dueAt',?,'$.closesAt',?) WHERE id=?").run(past,past,f.activity.id);
 await f.master('/academics/courses/'+f.course.id+'/settings',{missingAsZero:true,finalPublished:false,confirmImpact:true},'PUT');
 await f.student.call('/notifications/push/subscriptions',{subscription:subscription()},'POST',201);
 await f.peer.call('/notifications/push/subscriptions',{subscription:subscription()},'POST',201);f.transport.status=429;
 directGrant(f);
 f.db.prepare("UPDATE grading_settings SET config=json_set(config,'$.finalPublished',1) WHERE course_id=?").run(f.course.id);
 await f.notifications.flush();
 const finals=async who=>(await who.call('/notifications')).items.filter(item=>item.kind==='grades');
 assert.equal((await finals(f.student)).length,0,'the selected learner has an open response and no final grade');
 assert.equal((await finals(f.peer)).length,1,'the other learner keeps their available final grade');
 assert.equal((await f.master('/notifications/courses/'+f.course.id)).items.filter(item=>item.kind==='grades').length,1,'the teacher feed retains the group publication');
 assert.equal(Boolean(JSON.parse(f.db.prepare('SELECT config FROM grading_settings WHERE course_id=?').get(f.course.id).config).finalPublished),true);
 await f.master(f.path,{version:1},'DELETE');assert.equal((await finals(f.student)).length,1,'revoking restores the closed missing-zero final');assert.equal((await finals(f.peer)).length,1);
 await f.master(f.path,{version:2,dueAt:null},'PUT');f.db.prepare("UPDATE notification_push_deliveries SET next_attempt='2000-01-01T00:00:00.000Z' WHERE state='pending'").run();await f.notifications.flush();assert.equal((await finals(f.student)).length,0);assert.equal((await finals(f.peer)).length,1);
 const deliveries=f.db.prepare("SELECT i.user_id,d.state FROM notification_push_deliveries d JOIN notification_inbox i ON i.id=d.inbox_id JOIN notification_events e ON e.id=i.event_id WHERE e.object_type='final'").all();
 assert.equal(deliveries.find(row=>row.user_id===f.student.id).state,'cancelled','the selected learner cannot receive a queued unavailable-final push');
 assert.equal(deliveries.find(row=>row.user_id===f.peer.id).state,'pending','the peer queue is not cancelled');
 assert.equal(f.db.prepare("SELECT cancelled FROM notification_events WHERE object_type='final'").get().cancelled,0,'the shared event is not cancelled');
 await f.master(f.path,{version:3},'DELETE');assert.equal((await finals(f.student)).length,1);assert.equal((await finals(f.peer)).length,1);
});
