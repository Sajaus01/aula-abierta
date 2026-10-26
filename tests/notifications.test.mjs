import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes,createECDH} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {setupNotifications,validPushSubscription} from '../server/notifications.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-notifications-')),pushes=[],transport={status:0};
 const app=await createApp({dataDir:dir,notificationPushSend:async(subscription,payload,options)=>{pushes.push({subscription,payload:JSON.parse(payload),options});if(transport.status)throw Object.assign(new Error('synthetic transport error'),{statusCode:transport.status});},env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99880001',ADMIN_PASSWORD:'Master-Notifications-2026!'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await app.notifications.flush();await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 function client(){let cookie='';return async(path,body,method=body?'POST':'GET',status=200,headers={})=>{const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const value=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(value));return value.data;};}
 const master=client();await master('/auth/login',{document:'99880001',password:'Master-Notifications-2026!'});
 const template=await master('/admin/courses',{title:'Plantilla de laboratorio'},'POST',201),course=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Laboratorio',cohort:'2026-2',code:'A'},'POST',201);
 await master('/platform/courses/'+course.id+'/state',{state:'active'});
 const people=[];
 async function person(enroll=true){const id=randomUUID(),document=String(99880002+people.length),time=new Date().toISOString(),hash=app.db.prepare("SELECT password_hash FROM users WHERE document='99880001'").get().password_hash;
  app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at,account_status) VALUES(?,?,?,'student',?,?,?,'active')").run(id,document,'Estudiante '+people.length,hash,time,time);
  app.db.prepare("INSERT OR IGNORE INTO user_roles VALUES(?,'student')").run(id);
  if(enroll)await master('/admin/enrollments',{studentId:id,courseId:course.id},'POST',201);
  const call=client();await call('/auth/login',{document,password:'Master-Notifications-2026!'});const p={id,document,call};people.push(p);return p;
 }
 const student=await person(),peer=await person(),outsider=await person(false);
 function module(published=1,title='Capítulo de medición',courseId=course.id){const id=randomUUID();app.db.prepare('INSERT INTO modules(id,course_id,title,published) VALUES(?,?,?,?)').run(id,courseId,title,published);return id;}
 function resource(moduleId,title='Material de apoyo',published=1){const id=randomUUID(),time=new Date().toISOString();app.db.prepare("INSERT INTO resources(id,module_id,title,kind,created_at,updated_at,published) VALUES(?,?,?,'link',?,?,?)").run(id,moduleId,title,time,time,published);return id;}
 async function activity(body={}){return master('/academics/courses/'+course.id+'/activities',{title:'Informe experimental',kind:'task',status:'published',...body},'POST',201);}
 async function announcement(body={}){return master('/notifications/courses/'+course.id+'/announcements',{title:'Sesión del laboratorio',body:'Consulta la guía antes de la sesión.',clientKey:randomUUID(),...body},'POST',201);}
 return {...app,dir,pushes,transport,client,master,template,course,people,student,peer,outsider,person,module,resource,activity,announcement};
}
const subscription=(suffix='device')=>{const ec=createECDH('prime256v1');return {endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix,expirationTime:null,keys:{p256dh:ec.generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}};};

test('notifications: publication is transactional, visible, scoped, read per user and never backfilled',async t=>{
 const f=await fixture(t),{db,student,peer,outsider,course}=f;
 assert.equal((await student.call('/notifications')).items.length,0);
 const chapter=f.module(0),material=f.resource(chapter,'Calibración del sensor');
 const hidden=f.module(0,'Capítulo privado');f.resource(hidden,'Instrucciones privadas');
 const draft=await f.activity({status:'draft',title:'Actividad secreta'});
 assert.equal((await student.call('/notifications')).items.length,0);
 db.exec('BEGIN IMMEDIATE');db.prepare('UPDATE modules SET published=1 WHERE id=?').run(chapter);db.exec('ROLLBACK');
 assert.equal((await student.call('/notifications')).items.length,0,'failed publications do not create inbox entries');
 db.prepare('UPDATE modules SET published=1 WHERE id=?').run(chapter);
 let inbox=await student.call('/notifications');assert.equal(inbox.items.length,2);assert.equal(inbox.unread,2);
 assert.ok(inbox.items.some(i=>i.href==='#curso/'+course.id+'?resource='+material));
 assert.ok(!JSON.stringify(inbox).includes('privadas'));assert.ok(!JSON.stringify(inbox).includes(draft.title));
 assert.equal(inbox.courses[0].title,'Laboratorio');assert.equal(inbox.courses[0].unread,2);
 const first=inbox.items[0].id;await student.call('/notifications/read',{ids:[first]});assert.equal((await student.call('/notifications')).unread,1);assert.equal((await peer.call('/notifications')).unread,2);
 await student.call('/notifications/read',{all:true,courseId:{}},'POST',400);await student.call('/notifications/read',{ids:['invalid']},'POST',400);
 await outsider.call('/notifications/read',{ids:[first]});assert.equal((await student.call('/notifications')).unread,1);
 await student.call('/notifications/courses/'+course.id);await outsider.call('/notifications/courses/'+course.id,undefined,'GET',403);
 await student.call('/notifications/courses/'+course.id+'/announcements',{title:'No permitido',body:'No permitido'},'POST',403);
 await f.master('/notifications',undefined,'GET',403,{'X-Aula-Preview':course.id});
 f.module(1,'Contenido de plantilla',f.template.id);assert.ok(!(await student.call('/notifications')).items.some(i=>i.title==='Contenido de plantilla'));
 const before=db.prepare('SELECT COUNT(*) n FROM notification_events').get().n;setupNotifications(db);assert.equal(db.prepare('SELECT COUNT(*) n FROM notification_events').get().n,before,'schema upgrades never import an old-content flood');
 await student.call('/notifications/read',{all:true,courseId:course.id});assert.equal((await student.call('/notifications')).unread,0);
 db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=?").run(student.id);inbox=await student.call('/notifications');assert.equal(inbox.items.length,0);assert.equal(inbox.courses.length,0);await student.call('/notifications/courses/'+course.id,undefined,'GET',403);
 db.prepare("UPDATE enrollments SET expires_at='2000-01-01T00:00:00.000Z' WHERE student_id=?").run(peer.id);assert.equal((await peer.call('/notifications')).items.length,0);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('notifications: scheduled opening gets a fresh cursor, hidden content is cancelled and pagination keeps backlog',async t=>{
 const f=await fixture(t),opening=new Date(Date.now()+1000).toISOString();
 const a=await f.activity({title:'Práctica programada',opensAt:opening});
 const cancelled=await f.activity({title:'No debe anunciarse',opensAt:new Date(Date.now()+1000).toISOString()});
 await f.master('/academics/activities/'+cancelled.id,{version:cancelled.version,status:'draft'},'PATCH');
 f.module();const baseline=await f.student.call('/notifications');assert.ok(!baseline.items.some(i=>i.title===a.title));
 await new Promise(r=>setTimeout(r,1050));await f.notifications.flush();
 const newlyVisible=await f.student.call('/notifications?after='+baseline.cursor);assert.equal(newlyVisible.items.length,1);assert.equal(newlyVisible.items[0].title,a.title);assert.ok(newlyVisible.items[0].id>baseline.cursor);
 for(let i=0;i<5;i++)f.module(1,'Capítulo '+i);
 let cursor=newlyVisible.cursor,received=[];
 for(let page=0;page<3;page++){const d=await f.student.call('/notifications?after='+cursor+'&limit=2');received.push(...d.items);assert.ok(d.cursor>cursor);cursor=d.cursor;if(!d.hasMore)break;}
 assert.equal(received.length,5);assert.equal(new Set(received.map(i=>i.id)).size,5);
 const latest=await f.student.call('/notifications?limit=2'),older=await f.student.call('/notifications?before='+latest.nextBefore+'&limit=2');assert.equal(latest.hasMore,true);assert.ok(older.items.every(i=>i.id<latest.nextBefore));
 assert.ok(!(await f.student.call('/notifications')).items.some(i=>i.title===cancelled.title));
});

test('notifications: private grade drafts never alert, release and correction are personal and idempotent',async t=>{
 const f=await fixture(t),a=await f.activity();
 let submission=await f.student.call('/academics/activities/'+a.id+'/submit',{activityRevision:a.revision,requestId:randomUUID(),action:'submit',text:'Datos experimentales'},'POST',201);
 const gradePath='/academics/submissions/'+submission.id;
 let before=await f.student.call('/notifications');
 submission=await f.master(gradePath+'/grade',{version:submission.version,points:84,feedback:'Comentario reservado',published:false},'PATCH');
 let added=await f.student.call('/notifications?after='+before.cursor);assert.equal(added.items.length,0,'autosaved private grades produce no notification');
 submission=await f.master(gradePath+'/release',{version:submission.version});
 added=await f.student.call('/notifications?after='+before.cursor);assert.equal(added.items.length,1);assert.equal(added.items[0].kind,'grade');assert.equal(added.items[0].personal,true);assert.equal(added.items[0].href,'#actividad/'+a.id);
 assert.ok(!JSON.stringify(added).includes('Comentario reservado'));assert.ok(!added.items[0].body.includes('84'));assert.equal(added.items[0].points,undefined);
 assert.ok(!(await f.peer.call('/notifications')).items.some(i=>i.kind==='grade'));
 assert.ok(!(await f.master('/notifications/courses/'+f.course.id)).items.some(i=>i.kind==='grade'));
 before=added;await f.master('/academics/activities/'+a.id+'/release',{});assert.equal((await f.student.call('/notifications?after='+before.cursor)).items.length,0);
 submission=await f.master(gradePath+'/return',{version:submission.version,reason:'Adjunta la simulación completa.'},'PATCH');
 added=await f.student.call('/notifications?after='+before.cursor);assert.equal(added.items.length,1);assert.equal(added.items[0].kind,'correction');assert.ok(!JSON.stringify(added).includes('Adjunta la simulación completa'));
 assert.ok(!(await f.peer.call('/notifications')).items.some(i=>i.kind==='correction'));
 const events=f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE kind='correction'").get().n;
 await f.master(gradePath+'/return',{version:submission.version-1,reason:'Duplicado'},'PATCH',409);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_events WHERE kind='correction'").get().n,events);
 f.db.prepare("UPDATE grading_settings SET config=json_set(config,'$.finalPublished',1) WHERE course_id=?").run(f.course.id);
 const final=(await f.student.call('/notifications')).items.find(i=>i.kind==='grades');assert.equal(final.href,'#calificaciones/'+f.course.id);assert.ok(!final.body.includes('84'));
 f.db.prepare("UPDATE grading_settings SET config=json_set(config,'$.finalPublished',0) WHERE course_id=?").run(f.course.id);assert.ok(!(await f.student.call('/notifications')).items.some(i=>i.kind==='grades'));
});

test('notifications: teacher announcements are deduplicated and only enrolled recipients receive them',async t=>{
 const f=await fixture(t),body={title:'Cambio de horario',body:'La práctica comienza a las 10.',clientKey:randomUUID()};
 const first=await f.announcement(body),again=await f.master('/notifications/courses/'+f.course.id+'/announcements',body);assert.equal(first.id,again.id);
 const list=await f.student.call('/notifications');assert.equal(list.items.length,1);assert.equal(list.items[0].kind,'announcement');assert.equal(list.items[0].body,body.body);
 assert.equal((await f.master('/notifications/courses/'+f.course.id)).items.filter(i=>i.kind==='announcement').length,1);
 assert.equal((await f.outsider.call('/notifications')).items.length,0);
 const late=await f.person();assert.equal((await late.call('/notifications')).items.length,0,'enrolling later does not replay historical alerts');
 f.db.prepare('UPDATE courses SET published=0 WHERE id=?').run(f.course.id);assert.equal((await f.student.call('/notifications')).items.length,0);
});

test('push: HTTPS allowlist and bounded keys prevent endpoint SSRF',()=>{
 const s=subscription();assert.ok(validPushSubscription(s));
 for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://localhost/x','https://fcm.googleapis.com.evil.example/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:8080/x','https://evil.example/https://fcm.googleapis.com'])assert.equal(validPushSubscription({...s,endpoint}),false,endpoint);
 assert.equal(validPushSubscription({...s,keys:{p256dh:'bad',auth:s.keys.auth}}),false);
 assert.equal(validPushSubscription({...s,keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url'),auth:s.keys.auth}}),false);
 assert.equal(validPushSubscription({...s,expirationTime:1}),false);
 assert.ok(validPushSubscription({...s,endpoint:'https://wns2-bl2p.notify.windows.com/w/?token=sample'}));
});

test('push: encrypted durable subscriptions, quiet baseline, generic payload, retry and expired device cleanup',async t=>{
 const f=await fixture(t);await f.announcement();
 const config=await f.student.call('/notifications/push/config');assert.equal(config.enabled,true);assert.equal(Buffer.from(config.publicKey,'base64url').length,65);assert.ok(!JSON.stringify(config).includes('privateKey'));
 const sub=subscription(),registered=await f.student.call('/notifications/push/subscriptions',{subscription:sub},'POST',201);
 await f.notifications.flush();assert.equal(f.pushes.length,0,'opting in never sends historical alerts');
 const raw=f.db.prepare('SELECT * FROM notification_push_subscriptions').get();assert.ok(!raw.cipher.includes(sub.endpoint));assert.ok(!JSON.stringify(raw).includes(sub.keys.auth));
 await f.announcement({title:'Segundo aviso'});await f.notifications.flush();assert.equal(f.pushes.length,1);assert.equal(f.pushes[0].payload.title,'Aula Abierta');assert.equal(f.pushes[0].payload.body,'Tienes novedades en uno de tus cursos.');assert.ok(!JSON.stringify(f.pushes[0].payload).includes('Segundo aviso'));
 await f.notifications.flush();assert.equal(f.pushes.length,1,'a successful queue entry is not sent again');
 await f.peer.call('/notifications/push/subscriptions',{endpoint:sub.endpoint},'DELETE');assert.ok(f.db.prepare('SELECT id FROM notification_push_subscriptions WHERE id=?').get(registered.id));
 f.transport.status=429;await f.announcement({title:'Aviso con reintento'});await f.notifications.flush();assert.equal(f.pushes.length,2);
 let delivery=f.db.prepare("SELECT * FROM notification_push_deliveries WHERE state='pending'").get();assert.equal(delivery.attempts,1);await f.notifications.flush();assert.equal(f.pushes.length,2);
 f.transport.status=0;f.db.prepare("UPDATE notification_push_deliveries SET next_attempt='2000-01-01T00:00:00.000Z' WHERE state='pending'").run();await f.notifications.flush();assert.equal(f.pushes.length,3);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_push_deliveries WHERE state='sent'").get().n,2);
 f.transport.status=410;await f.announcement({title:'Dispositivo retirado'});await f.notifications.flush();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notification_push_subscriptions').get().n,0);
 assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('push: reading and revoked access cancel retries, account switching reassigns only the opted-in device',async t=>{
 const f=await fixture(t),sub=subscription('shared-device');
 await f.student.call('/notifications/push/subscriptions',{subscription:sub},'POST',201);
 f.transport.status=429;await f.announcement();await f.notifications.flush();let sent=f.pushes.length;assert.equal(sent,1);
 await f.student.call('/notifications/read',{all:true});
 f.db.prepare("UPDATE notification_push_deliveries SET next_attempt='2000-01-01T00:00:00.000Z' WHERE state='pending'").run();await f.notifications.flush();assert.equal(f.pushes.length,sent);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_push_deliveries WHERE state='cancelled'").get().n,1);
 await f.announcement();await f.notifications.flush();sent=f.pushes.length;assert.equal(sent,2);
 f.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=?").run(f.student.id);
 f.db.prepare("UPDATE notification_push_deliveries SET next_attempt='2000-01-01T00:00:00.000Z' WHERE state='pending'").run();await f.notifications.flush();assert.equal(f.pushes.length,sent);
 await f.peer.call('/notifications/push/subscriptions',{subscription:sub},'POST',201);
 assert.equal(f.db.prepare('SELECT user_id FROM notification_push_subscriptions').get().user_id,f.peer.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notification_push_deliveries').get().n,0);
 await f.student.call('/notifications/push/subscriptions',{endpoint:sub.endpoint},'DELETE');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notification_push_subscriptions').get().n,1);
 f.transport.status=0;await f.announcement();await f.notifications.flush();assert.equal(f.pushes.length,sent+1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notification_push_deliveries WHERE state='sent'").get().n,1);
 await f.peer.call('/notifications/push/subscriptions',{endpoint:sub.endpoint},'DELETE');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notification_push_subscriptions').get().n,0);
});
