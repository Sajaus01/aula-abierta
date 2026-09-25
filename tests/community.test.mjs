import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server/index.mjs';
import {decodeAvatar,setupCommunity} from '../server/community.mjs';
import {setupPanorama} from '../server/panorama.mjs';
import {actionLabel} from '../public/panorama.js';
import {avatar} from '../public/community.js';

const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMxoAAAAASUVORK5CYII=';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aula-community-')),app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99900001',ADMIN_PASSWORD:'Master-Synthetic-2026!'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,db=new DatabaseSync(join(root,'aula.sqlite'));
 t.after(async()=>{db.close();await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});});
 function client(){let cookie='';const call=async(path,body,method=body?'POST':'GET',expected=200,headers={})=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];if(r.headers.get('content-type')?.startsWith('image/')){assert.equal(r.status,expected);return Buffer.from(await r.arrayBuffer());}const data=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(data));return data.data;};return call;}
 const master=client();await master('/auth/login',{document:'99900001',password:'Master-Synthetic-2026!'});
 const template=await master('/admin/courses',{title:'Instrumentación'},'POST',201),groups=[];
 for(const code of ['A','B']){const g=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Instrumentación '+code,cohort:'2026-2',code},'POST',201);await master('/platform/courses/'+g.id+'/state',{state:'active'});groups.push(g);}
 const people=[];
 for(const [document,name,roles] of [['99900003','Rodríguez Arcila',['student']],['99900004','Compañera',['student']],['99900005','Docente',['teacher']],['99900006','Otro grupo',['student']]]){
  const u=await master('/platform/users',{document,name,roles},'POST',201),c=client(),password=roles[0]==='teacher'?'Teacher-Synthetic-2026!':'4567';await c('/auth/login',{document,password:document});await c('/auth/first-password',{newPassword:password,confirmPassword:password});people.push({u,c,document,password});
 }
 for(const p of people.filter(p=>p.u.roles.includes('student')))await master('/admin/enrollments',{studentId:p.u.id,courseId:groups[p.document==='99900006'?1:0].id},'POST',201);
 await master('/platform/courses/'+groups[0].id+'/staff',{userId:people[2].u.id,edit:true,grade:true,manage:false});
 return {root,base,db,master,client,template,groups,people};
}

test('presence: classmates only, no personal identifiers, multiple tabs, hidden staff, logout and expiry',async t=>{
 const {master,groups:[a,b],people:[student,peer,teacher,other],db,client}=await fixture(t),heartbeat=(p,id,groupId=a.id)=>p.c('/community/heartbeat',{tabId:id,groupId});
 const anon=client();await anon('/community/presence?group='+a.id,undefined,'GET',401);
 await heartbeat(student,'student-first-tab');await heartbeat(student,'student-other-tab');await heartbeat(teacher,'teacher-first-tab');await heartbeat(peer,'classmate-first-tab');
 let d=await student.c('/community/presence?group='+a.id);assert.ok(d.people.some(p=>p.id===peer.u.id&&p.online&&p.inGroup));assert.ok(!d.people.some(p=>p.id===other.u.id));assert.ok(!JSON.stringify(d).includes('99900004'));assert.ok(d.people.every(p=>!('email'in p)&&!('document'in p)&&!('hidden'in p)));
 await student.c('/community/presence?group='+b.id,undefined,'GET',403);await student.c('/community/presence',undefined,'GET',400);await other.c('/community/heartbeat',{tabId:'wrong-group-access',groupId:a.id},'POST',403);
 await student.c('/community/heartbeat',{tabId:'student-first-tab',leave:true});assert.ok((await master('/community/presence?group='+a.id)).people.find(p=>p.id===student.u.id).online);
 await teacher.c('/community/profile',{bio:'Docente de instrumentación',hidden:true},'PUT');d=await master('/community/presence?group='+a.id);assert.equal(d.people.find(p=>p.id===teacher.u.id).online,false);assert.equal(d.people.find(p=>p.id===teacher.u.id).inGroup,false);
 assert.equal((await teacher.c('/community/profile')).hidden,true);await student.c('/community/profile',{bio:'Hola',hidden:true},'PUT',403);
 await teacher.c('/community/profile',{bio:'Docente',hidden:false},'PUT');assert.equal((await student.c('/community/presence?group='+a.id)).people.find(p=>p.id===teacher.u.id).online,true);
 await peer.c('/auth/logout',{});assert.equal((await student.c('/community/presence?group='+a.id)).people.find(p=>p.id===peer.u.id).online,false);
 db.prepare("UPDATE presence SET seen_at='2000-01-01T00:00:00.000Z'").run();assert.equal((await master('/community/presence?group='+a.id)).online,0);
 await heartbeat(student,'student-other-tab');await master('/platform/users/'+student.u.id+'/status',{status:'suspended'});assert.equal((await master('/community/presence?group='+a.id)).people.some(p=>p.id===student.u.id),false);
 await teacher.c('/community/heartbeat',{tabId:'preview-test-tab',groupId:a.id},'POST',403,{'X-Aula-Preview':a.id});
 await master('/admin/enrollments/'+db.prepare('SELECT id FROM enrollments WHERE student_id=?').get(peer.u.id).id,{expiresAt:'2000-01-01T00:00:00.000Z'},'PATCH');
 assert.ok(!(await teacher.c('/community/presence?group='+a.id)).people.some(p=>p.id===peer.u.id));
 await heartbeat(teacher,'teacher-expiry-tab');db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?").run(teacher.u.id);assert.equal((await master('/community/presence?group='+a.id)).people.find(p=>p.id===teacher.u.id).online,false);
});

test('profiles: raster limits, scoped photo access, persisted replacement and removal',async t=>{
 const {people:[student,peer,teacher,other],client,master,groups:[a,b]}=await fixture(t);
 const saved=await student.c('/community/profile',{bio:'Aprendiendo <script>no ejecutar</script>',hidden:false,photo},'PUT');assert.ok(saved.avatarUrl);assert.equal((await peer.c(saved.avatarUrl.replace('/api',''))).length,68);
 await other.c(saved.avatarUrl.replace('/api',''),undefined,'GET',404);await client()(saved.avatarUrl.replace('/api',''),undefined,'GET',401);
 await student.c('/community/profile',{bio:'Test',hidden:false,photo:'data:image/svg+xml;base64,PHN2Zz4='},'PUT',400);
 await student.c('/community/profile',{bio:'x'.repeat(241),hidden:false},'PUT',400);
 const removed=await student.c('/community/profile',{bio:'Listo',hidden:false,removePhoto:true},'PUT');assert.equal(removed.avatarUrl,null);await peer.c(saved.avatarUrl.replace('/api',''),undefined,'GET',404);
 assert.ok(!avatar({name:'<script>',avatarUrl:'" onerror="bad'}).includes('src="" onerror='));
 const fail=(_s,m)=>{throw Error(m);};assert.throws(()=>decodeAvatar('data:image/png;base64,'+'A'.repeat(400000),fail),/256/);
 const otherPhoto=await other.c('/community/profile',{bio:'Otro grupo',hidden:false,photo},'PUT');
 await master('/admin/enrollments',{studentId:student.u.id,courseId:b.id},'POST',201);await master('/admin/courses/'+a.id,{accessMode:'document'},'PATCH');
 await student.c('/auth/login',{document:student.document});await student.c('/community/presence?group='+b.id,undefined,'GET',403);await student.c(otherPhoto.avatarUrl.replace('/api',''),undefined,'GET',404);
 assert.ok(!(await student.c('/community/presence?group='+a.id)).groups.some(g=>g.id===b.id));await student.c('/community/profile',{bio:'Editar',hidden:false},'PUT',403);
});

test('panorama: contextual submissions, membership without fabricated group visits, filters, pagination and teacher scope',async t=>{
 const {master,groups:[a,b],people:[student,peer,teacher],db}=await fixture(t);
 await student.c('/auth/login',{document:student.document,password:student.password});
 const module=await master('/admin/courses/'+a.id+'/modules',{title:'Generalidades',published:true},'POST',201);
 const material=await master('/admin/modules/'+module.id+'/resources',{title:'Introducción',kind:'html',content:'<p>Hola</p>',published:true},'POST',201);
 const activity=await master('/academics/courses/'+a.id+'/activities',{title:'Informe de señales',kind:'task',status:'published',weight:100,moduleId:module.id,maxPoints:10},'POST',201);
 await student.c('/courses/'+a.id);await student.c('/progress/'+material.id+'/open',{});
 const submission=await student.c('/academics/activities/'+activity.id+'/submit',{requestId:'request-panorama',action:'submit',activityRevision:1,text:'Mis respuestas'},'POST',201);
 await teacher.c('/academics/submissions/'+submission.id+'/grade',{points:8,feedback:'Buen trabajo',published:true,version:submission.version,reason:'Revisión de informe'},'PATCH');
 let d=await master('/platform/overview?group='+a.id+'&person='+student.u.id);
 const send=d.events.find(x=>x.action==='submission.submit');assert.equal(send.context.object.title,'Informe de señales');assert.equal(send.context.group.code,'A');assert.equal(send.context.module.title,'Generalidades');assert.equal(send.context.student.name,'Rodríguez Arcila');assert.equal(send.context.submission.attempt,1);
 const login=d.events.find(x=>x.action==='auth.login.password');assert.equal(login.context.group,null);assert.ok(login.context.memberships.some(g=>g.id===a.id));assert.ok(d.events.find(x=>x.action==='group.enter'&&!x.context.reconstructed));
 assert.ok(d.events.some(x=>x.action==='resource.open'));assert.equal((await master('/platform/overview?group='+a.id+'&category=grades')).events[0].context.change.after,8);
 const filtered=await master('/platform/overview?search=Informe&category=submissions');assert.ok(filtered.events.length);assert.ok(filtered.events.every(x=>x.category==='submissions'));
 await student.c('/platform/overview',undefined,'GET',403);await teacher.c('/platform/overview?group='+b.id,undefined,'GET',403);await master('/platform/overview?from=2026-12-31&to=2026-01-01',undefined,'GET',400);
 await master('/platform/courses/'+a.id+'/staff',{userId:teacher.u.id,edit:true,grade:false,manage:false});d=await teacher.c('/platform/overview');assert.ok(!d.events.some(x=>['grades','submissions'].includes(x.category)));assert.ok(d.courses.every(c=>c.id===a.id));
 await master('/academics/activities/'+activity.id,{version:activity.version},'DELETE');d=await master('/platform/overview?group='+a.id);assert.equal(d.events.find(x=>x.action==='activity.delete').context.object.title,'Informe de señales');assert.equal(d.events.find(x=>x.action==='submission.submit').context.student.id,student.u.id);
 const row=db.prepare("SELECT * FROM audit WHERE action='resource.open' LIMIT 1").get();for(let i=0;i<60;i++)db.prepare('INSERT INTO audit(actor_id,action,target_id,created_at,context) VALUES(?,?,?,?,?)').run(row.actor_id,row.action,row.target_id,row.created_at,row.context);
 const page1=await master('/platform/overview?category=learning'),page2=await master('/platform/overview?category=learning&page=2');assert.equal(page1.events.length,50);assert.ok(page2.events.length);assert.ok(page2.events.every(x=>!page1.events.some(y=>y.id===x.id)));assert.equal(actionLabel('submission.submit'),'Envió una entrega');
});

test('community migration is repeatable, preserves records and paginates a 500-student cohort',async t=>{
 const {master,db,groups:[group],people:[student]}=await fixture(t);
 await student.c('/community/profile',{bio:'Perfil conservado',photo,hidden:false},'PUT');
 const tables=['users','courses','enrollments','profiles','audit','learning_events'],snapshot=()=>Object.fromEntries(tables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()])),before=snapshot();
 setupCommunity(db);setupPanorama(db);setupCommunity(db);setupPanorama(db);assert.deepEqual(snapshot(),before);
 db.exec('BEGIN');try{for(let i=0;i<500;i++){const id='scale-person-'+i;db.prepare("INSERT INTO users(id,document,name,role,created_at,updated_at) VALUES(?,?,?,'student',?,?)").run(id,String(70000000+i),'Estudiante '+String(i).padStart(3,'0'),'2026-01-01','2026-01-01');db.prepare("INSERT INTO enrollments(id,student_id,course_id,status,created_at) VALUES(?,?,?,'active',?)").run('scale-enroll-'+i,id,group.id,'2026-01-01');}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 const first=await master('/community/presence?group='+group.id+'&role=student'),last=await master('/community/presence?group='+group.id+'&role=student&page=11');assert.equal(first.total,502);assert.equal(first.people.length,50);assert.equal(first.pages,11);assert.equal(last.people.length,2);assert.ok(last.people.every(p=>!first.people.some(q=>q.id===p.id)));
 const searched=await master('/community/presence?group='+group.id+'&search=Estudiante%20499');assert.equal(searched.filtered,1);assert.equal(searched.people[0].name,'Estudiante 499');
});
