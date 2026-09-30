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

test('chat: course permissions, scoped contacts, document sessions and preview isolation',async t=>{
 const {master,groups:[g,b],people:[s,p,teacher,other],client}=await fixture(t),url='/chat/courses/'+g.id;
 await client()('/chat',undefined,'GET',401);
 await s.c(url,{enabled:true,studentStaff:true,studentPeers:true},'PUT',403);
 await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',403);
 await teacher.c(url,{enabled:true,studentStaff:true,studentPeers:false},'PUT');
 await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',403);
 await s.c('/chat/conversations',{groupId:g.id,userId:other.u.id},'POST',403);
 await teacher.c('/chat/courses/'+b.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT',403);
 const contacts=await s.c('/chat/contacts?group='+g.id);assert.ok(!contacts.people.some(u=>u.id===other.u.id));assert.ok(contacts.people.every(u=>!u.document&&!u.email));
 const v=await s.c('/chat/conversations',{groupId:g.id,userId:teacher.u.id},'POST',201);assert.equal(v.canSend,true);
 await other.c('/chat/conversations/'+v.id,undefined,'GET',403);
 await master('/chat',undefined,'GET',403,{'X-Aula-Preview':g.id});
 await master('/admin/courses/'+g.id,{accessMode:'document'},'PATCH');const doc=client();await doc('/auth/login',{document:s.document});await doc('/chat',undefined,'GET',403);
 await teacher.c('/chat/preferences',{acceptStudents:false},'PUT');assert.equal((await s.c('/chat/conversations/'+v.id)).canSend,false);
 await s.c('/chat/conversations/'+v.id+'/messages',{body:'Hola',clientKey:'first-message-0001'},'POST',403);
 assert.equal((await teacher.c('/chat/conversations/'+v.id)).canSend,true);
 await teacher.c('/chat/global',{enabled:false},'PUT',403);
});

test('chat: persistence, idempotent sending, read receipts, replies, edits and supervised history',async t=>{
 const {master,groups:[g],people:[s,p,teacher,other],db,root}=await fixture(t);
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');
 const v=await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',201),path='/chat/conversations/'+v.id;
 assert.equal((await p.c('/chat/conversations',{groupId:g.id,userId:s.u.id},'POST',201)).id,v.id);
 const m=await s.c(path+'/messages',{body:'Procedimiento <script>alert(1)</script>',clientKey:'idempotent-message-01'},'POST',201);
 assert.equal((await s.c(path+'/messages',{body:'Duplicado',clientKey:'idempotent-message-01'})).id,m.id);
 assert.equal((await p.c('/chat')).unread,1);
 const view=await teacher.c(path);assert.equal(view.supervised,true);assert.equal(view.canSend,false);assert.equal(view.messages[0].body,'Procedimiento <script>alert(1)</script>');
 await teacher.c(path+'/read',{id:m.id},'POST',403);assert.equal((await p.c('/chat')).unread,1);
 await p.c(path+'/read',{id:m.id+100},'POST',400);await p.c(path+'/read',{id:m.id});assert.equal((await p.c('/chat')).unread,0);
 assert.equal((await s.c(path)).peerReadId,m.id);
 const reply=await p.c(path+'/messages',{body:'Gracias',replyId:m.id,clientKey:'reply-message-0001'},'POST',201);assert.equal((await s.c(path)).messages[1].reply.body,'Procedimiento <script>alert(1)</script>');
 await p.c('/chat/messages/'+m.id,{body:'Impostor'},'PATCH',403);await s.c('/chat/messages/'+m.id,{body:'Procedimiento corregido'},'PATCH');
 assert.equal((await teacher.c(path)).messages[0].history[0].body,'Procedimiento <script>alert(1)</script>');assert.equal((await p.c(path)).messages[0].history,undefined);
 await s.c('/chat/messages/'+m.id,{},'DELETE');assert.equal((await p.c(path)).messages[0].body,'');assert.equal((await teacher.c(path)).messages[0].originalBody,'Procedimiento corregido');
 const fresh=new DatabaseSync(join(root,'aula.sqlite'),{readOnly:true});assert.equal(fresh.prepare('SELECT COUNT(*) n FROM chat_messages WHERE conversation_id=?').get(v.id).n,2);fresh.close();
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 const foreign=await s.c('/chat/conversations',{groupId:g.id,userId:teacher.u.id},'POST',201);
 await s.c('/chat/conversations/'+foreign.id+'/messages',{body:'Referencia ajena',replyId:reply.id,clientKey:'invalid-reply-0001'},'POST',400);
 await s.c(path+'/messages',{body:'   ',clientKey:'empty-message-0001'},'POST',400);
 await s.c(path+'/messages',{body:'x'.repeat(5001),clientKey:'long-message-00001'},'POST',400);
});

test('chat: archive, mute, deletion for self, teacher withdrawal and restoration preserve evidence',async t=>{
 const {master,groups:[g],people:[s,p,teacher],db}=await fixture(t);
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');
 const v=await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',201),path='/chat/conversations/'+v.id;
 await s.c(path+'/messages',{body:'Mensaje permanente',clientKey:'permanent-message-1'},'POST',201);
 await p.c(path+'/state',{muted:true},'PUT');assert.equal((await p.c('/chat')).unread,0);
 await p.c(path+'/state',{hidden:true,archived:true},'PUT');assert.equal((await p.c(path)).hidden,true);assert.equal((await teacher.c(path)).messages.length,1);
 await s.c(path+'/messages',{body:'Vuelve a aparecer',clientKey:'unhide-message-0001'},'POST',201);assert.equal((await p.c(path)).hidden,false);assert.equal((await p.c(path)).archived,false);
 await s.c(path+'/remove',{confirm:v.id},'POST',403);await teacher.c(path+'/remove',{confirm:'wrong'},'POST',400);
 await teacher.c(path+'/remove',{confirm:v.id});await p.c(path,undefined,'GET',404);await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',409);
 assert.equal((await teacher.c(path)).messages.length,2);assert.equal((await teacher.c('/chat?mode=supervision&group='+g.id)).conversations[0].deleted,true);
 await teacher.c(path+'/restore',{confirm:v.id});assert.equal((await p.c(path)).canSend,true);
 await teacher.c('/chat/courses/'+g.id,{enabled:false,studentStaff:true,studentPeers:true},'PUT');assert.equal((await p.c(path)).canSend,false);assert.equal((await p.c(path)).messages.length,2);
 await master('/chat/global',{enabled:false},'PUT');await teacher.c(path+'/messages',{body:'No autorizado',clientKey:'global-disabled-001'},'POST',403);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n,2);
});

test('chat: moderation, reports, hidden teacher typing and revoked membership',async t=>{
 const {master,groups:[g],people:[s,p,teacher],db}=await fixture(t);
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');
 const v=await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',201),path='/chat/conversations/'+v.id;
 const m=await s.c(path+'/messages',{body:'Mensaje reportado',clientKey:'report-message-001'},'POST',201);
 await p.c('/chat/messages/'+m.id+'/report',{reason:'Revisar lenguaje'});const d=await teacher.c(path);assert.equal(d.messages[0].reports[0].reason,'Revisar lenguaje');assert.equal((await s.c(path)).messages[0].reports,undefined);
 const report=d.messages[0].reports[0].id;await p.c('/chat/reports/'+report,{},'PUT',403);await teacher.c('/chat/reports/'+report,{},'PUT');assert.ok((await teacher.c(path)).messages[0].reports[0].resolvedAt);
 await teacher.c('/chat/courses/'+g.id+'/users/'+s.u.id,{blocked:true},'PUT');await s.c(path+'/messages',{body:'Bloqueado',clientKey:'blocked-message-01'},'POST',403);assert.equal((await s.c(path)).messages.length,1);
 await teacher.c('/chat/courses/'+g.id+'/users/'+s.u.id,{blocked:false},'PUT');
 const staff=await s.c('/chat/conversations',{groupId:g.id,userId:teacher.u.id},'POST',201),staffPath='/chat/conversations/'+staff.id;
 await teacher.c('/community/profile',{bio:'',hidden:true},'PUT');await teacher.c(staffPath+'/typing',{typing:true});assert.equal((await s.c(staffPath)).typing.length,0);
 await teacher.c('/community/profile',{bio:'',hidden:false},'PUT');assert.equal((await s.c(staffPath)).typing[0].id,teacher.u.id);
 db.prepare("UPDATE chat_typing SET expires_at='2000-01-01T00:00:00Z'").run();assert.equal((await s.c(staffPath)).typing.length,0);
 const enrollment=db.prepare('SELECT id FROM enrollments WHERE student_id=? AND course_id=?').get(s.u.id,g.id);await master('/admin/enrollments/'+enrollment.id,{status:'revoked'},'PATCH');await s.c(path,undefined,'GET',403);assert.ok((await teacher.c(path)).messages.length);
});

test('chat: chronological pagination and course deletion cascade',async t=>{
 const {master,groups:[g],people:[s,p,teacher],db}=await fixture(t);
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');const v=await s.c('/chat/conversations',{groupId:g.id,userId:p.u.id},'POST',201);
 for(let i=0;i<85;i++)db.prepare('INSERT INTO chat_messages(conversation_id,sender_id,body,created_at,client_key) VALUES(?,?,?,?,?)').run(v.id,s.u.id,'Mensaje '+i,new Date().toISOString(),'synthetic-message-'+i);
 const latest=await p.c('/chat/conversations/'+v.id);assert.equal(latest.messages.length,60);assert.equal(latest.hasOlder,true);assert.equal(latest.messages[59].body,'Mensaje 84');
 const older=await p.c('/chat/conversations/'+v.id+'?before='+latest.messages[0].id);assert.equal(older.messages.length,25);assert.equal(older.hasOlder,false);assert.equal(older.messages[0].body,'Mensaje 0');
 db.prepare('DELETE FROM courses WHERE id=?').run(g.id);assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n,0);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('chat UI: escaped text and safe links',async()=>{
 const {messageText}=await import('../public/chat.js');const html=messageText('<img src=x onerror=alert(1)> https://example.com/tutorial?a=1&b=2');assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('href="https://example.com/tutorial?a=1&amp;b=2"'));assert.ok(!messageText('https://user:pass@example.com/').includes('<a'));
});

test('community messaging buttons follow course, global and recipient permissions',async t=>{
 const {master,groups:[g],people:[s,p,teacher]}=await fixture(t),roster=()=>s.c('/community/presence?group='+g.id);
 assert.ok((await roster()).people.every(u=>u.chatGroupIds.length===0));
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:false},'PUT');
 let d=await roster();assert.deepEqual(d.people.find(u=>u.id===teacher.u.id).chatGroupIds,[g.id]);assert.deepEqual(d.people.find(u=>u.id===p.u.id).chatGroupIds,[]);
 await teacher.c('/chat/preferences',{acceptStudents:false},'PUT');d=await roster();assert.deepEqual(d.people.find(u=>u.id===teacher.u.id).chatGroupIds,[]);
 await teacher.c('/chat/preferences',{acceptStudents:true},'PUT');await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');
 assert.deepEqual((await roster()).people.find(u=>u.id===p.u.id).chatGroupIds,[g.id]);
 await teacher.c('/chat/courses/'+g.id,{enabled:false,studentStaff:true,studentPeers:true},'PUT');assert.ok((await roster()).people.every(u=>u.chatGroupIds.length===0));
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');await master('/chat/global',{enabled:false},'PUT');assert.ok((await roster()).people.every(u=>u.chatGroupIds.length===0));
});

test('teacher can start a conversation with a newly enrolled student before their first login',async t=>{
 const {master,groups:[g],people:[s,p,teacher],client}=await fixture(t);
 const u=await master('/platform/users',{document:'99900088',name:'Nuevo estudiante',roles:['student']},'POST',201);
 await master('/admin/enrollments',{studentId:u.id,courseId:g.id},'POST',201);
 await teacher.c('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:false},'PUT');
 const contacts=await teacher.c('/chat/contacts?group='+g.id);assert.equal(contacts.people.find(p=>p.id===u.id).canMessage,true);
 const v=await teacher.c('/chat/conversations',{groupId:g.id,userId:u.id},'POST',201),path='/chat/conversations/'+v.id;
 await teacher.c(path+'/messages',{body:'Bienvenido al grupo',clientKey:'new-student-welcome'},'POST',201);
 const student=client();await student('/auth/login',{document:'99900088',password:'99900088'});await student(path,undefined,'GET',403);
 await student('/auth/first-password',{newPassword:'4567',confirmPassword:'4567'});assert.equal((await student('/chat')).unread,1);
 const history=await student(path);assert.equal(history.messages[0].body,'Bienvenido al grupo');assert.equal(history.canSend,true);
 await student(path+'/messages',{body:'Gracias, docente',clientKey:'new-student-answer'},'POST',201);assert.equal((await teacher.c(path)).messages[1].body,'Gracias, docente');
});
