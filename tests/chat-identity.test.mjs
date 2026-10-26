import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setupChat} from '../server/chat.mjs';
import {createApp} from '../server/index.mjs';

test('legacy pair migration preserves messages, replies, evidence and exact read holes; reruns are idempotent',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE courses(id TEXT PRIMARY KEY);
   INSERT INTO users VALUES('alice'),('bob'),('teacher');INSERT INTO courses VALUES('group-a'),('group-b');
   CREATE TABLE chat_conversations(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,user_a TEXT NOT NULL REFERENCES users(id),user_b TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,deleted_at TEXT,deleted_by TEXT REFERENCES users(id),UNIQUE(course_id,user_a,user_b),CHECK(user_a<user_b));
   CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,sender_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,deleted_at TEXT,reply_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,client_key TEXT NOT NULL,UNIQUE(conversation_id,sender_id,client_key));
   CREATE TABLE chat_members(conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),read_id INTEGER NOT NULL DEFAULT 0,hidden_id INTEGER NOT NULL DEFAULT -1,archived INTEGER NOT NULL DEFAULT 0,muted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id));
   INSERT INTO chat_conversations VALUES('first','group-a','alice','bob','2026-01-01',NULL,NULL),('second','group-b','alice','bob','2026-01-02',NULL,NULL);
   INSERT INTO chat_messages(id,conversation_id,sender_id,body,created_at,client_key) VALUES(1,'second','alice','Unread in B','2026-01-03','same-client-key'),(2,'first','alice','Read in A','2026-01-04','same-client-key');
   INSERT INTO chat_messages(id,conversation_id,sender_id,body,created_at,client_key,reply_id) VALUES(3,'second','bob','B reply','2026-01-05','reply-b',1),(4,'first','bob','A reply','2026-01-06','reply-a',2);
   INSERT INTO chat_members VALUES('first','alice',4,-1,0,0),('first','bob',2,4,1,1),('second','alice',1,3,1,1),('second','bob',0,3,0,0);
  `);
  // Set up the remaining legacy evidence tables before the migration is invoked.
  db.exec(`CREATE TABLE chat_edits(id INTEGER PRIMARY KEY AUTOINCREMENT,message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,body TEXT NOT NULL,changed_at TEXT NOT NULL);
   CREATE TABLE chat_reports(id TEXT PRIMARY KEY,message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,reporter_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT,UNIQUE(message_id,reporter_id));
   INSERT INTO chat_edits(message_id,body,changed_at) VALUES(2,'Original A','2026-01-07');INSERT INTO chat_reports VALUES('report',1,'bob','Reason','2026-01-08',NULL);`);
  db.exec("CREATE TRIGGER stop_merge BEFORE DELETE ON chat_conversations WHEN OLD.id='second' BEGIN SELECT RAISE(ABORT,'Synthetic rollback test'); END");
  assert.throws(()=>setupChat(db),/Synthetic rollback test/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_conversations').get().n,2);
  assert.equal(db.prepare('SELECT conversation_id FROM chat_messages WHERE id=1').get().conversation_id,'second');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='chat_identity_migrations'").get().n,0);
  db.exec('DROP TRIGGER stop_merge');setupChat(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_conversations').get().n,1);
  assert.equal(db.prepare('SELECT conversation_id FROM chat_conversation_aliases WHERE id=?').get('second').conversation_id,'first');
  assert.deepEqual(db.prepare('SELECT id,course_id,reply_id FROM chat_messages ORDER BY id').all().map(x=>[x.id,x.course_id,x.reply_id]),[[1,'group-b',null],[2,'group-a',null],[3,'group-b',1],[4,'group-a',2]]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE conversation_id=?').get('first').n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_message_reads WHERE message_id=1 AND user_id=?').get('bob').n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_message_reads WHERE message_id=2 AND user_id=?').get('bob').n,1);
  assert.equal(db.prepare('SELECT read_at FROM chat_message_reads WHERE message_id=2 AND user_id=?').get('bob').read_at,'');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_legacy_members').get().n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_legacy_keys').get().n,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_edits').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_reports').get().n,1);
  assert.equal(db.prepare('SELECT muted FROM chat_members WHERE user_id=?').get('bob').muted,0);
  assert.equal(db.prepare('SELECT hidden_id FROM chat_members WHERE user_id=?').get('bob').hidden_id,4);
  assert.equal(db.prepare('SELECT hidden_id FROM chat_members WHERE user_id=?').get('alice').hidden_id,-1);
  assert.throws(()=>db.prepare('INSERT INTO chat_conversations(id,course_id,user_a,user_b,created_at) VALUES(?,?,?,?,?)').run('duplicate','group-b','alice','bob','2026-02-01'),/UNIQUE/);
  setupChat(db);assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_message_reads WHERE message_id=1 AND user_id=?').get('bob').n,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  db.prepare('DELETE FROM courses WHERE id=?').run('group-a');
  assert.equal(db.prepare('SELECT course_id FROM chat_conversations WHERE id=?').get('first').course_id,'group-b');
  assert.deepEqual(db.prepare('SELECT id FROM chat_messages ORDER BY id').all().map(x=>x.id),[1,3]);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aula-personal-chat-')),app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99952001',ADMIN_PASSWORD:'Synthetic-Chat-2026!'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,db=new DatabaseSync(join(root,'aula.sqlite'));
 t.after(async()=>{db.close();await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});});
 const client=()=>{let cookie='';return async(path,body,method=body?'POST':'GET',expected=200)=>{const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const result=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(result));return result.data;};};
 const master=client();await master('/auth/login',{document:'99952001',password:'Synthetic-Chat-2026!'});
 const template=await master('/admin/courses',{title:'Mensajería personal'},'POST',201),groups=[];
 for(const code of ['A','B','C']){const g=await master(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo '+code,cohort:'2026',code},'POST',201);await master(`/platform/courses/${g.id}/state`,{state:'active'});await master('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');groups.push(g);}
 const people=[];let seq=2;
 for(const [name,role]of [['Alice','student'],['Bob','student'],['Docente A','teacher'],['Docente B','teacher'],['Otra persona','student']]){const document='9995200'+seq++,u=await master('/platform/users',{document,name,roles:[role]},'POST',201),c=client();await c('/auth/login',{document,password:document});await c('/auth/first-password',{newPassword:'Synthetic-Person-2026!',confirmPassword:'Synthetic-Person-2026!'});people.push({u,c});}
 for(const p of people.slice(0,2))for(const g of groups.slice(0,2))await master('/admin/enrollments',{studentId:p.u.id,courseId:g.id},'POST',201);
 await master('/admin/enrollments',{studentId:people[4].u.id,courseId:groups[2].id},'POST',201);
 for(const [p,g]of [[people[2],groups[0]],[people[3],groups[1]]])await master(`/platform/courses/${g.id}/staff`,{userId:p.u.id,edit:true,grade:true,manage:false});
 return {master,people,groups,db};
}

test('one personal conversation spans groups while contacts, supervision, reports and replies stay authorized',async t=>{
 const {master,people:[alice,bob,teacherA,teacherB,outsider],groups:[ga,gb],db}=await fixture(t);
 const [ca,cb]=await Promise.all([alice.c('/chat/conversations',{groupId:ga.id,userId:bob.u.id},'POST',201),bob.c('/chat/conversations',{groupId:gb.id,userId:alice.u.id},'POST',201)]);assert.equal(ca.id,cb.id);
 assert.equal((await alice.c('/chat')).conversations.length,1);assert.equal((await alice.c('/chat/contacts')).people.filter(p=>p.id===bob.u.id).length,1);
 assert.ok(!(await alice.c('/chat/contacts')).people.some(p=>p.id===outsider.u.id));
 await outsider.c('/chat/conversations/'+ca.id,undefined,'GET',403);
 const path='/chat/conversations/'+ca.id,ma=await alice.c(path+'/messages',{body:'Origen A',groupId:ga.id,clientKey:'message-origin-a-01'},'POST',201);
 const mb=await bob.c(path+'/messages',{body:'Origen B',groupId:gb.id,replyId:ma.id,clientKey:'message-origin-b-01'},'POST',201);
 db.prepare('INSERT INTO chat_conversation_aliases VALUES(?,?)').run('old-thread',ca.id);
 db.prepare('INSERT INTO chat_legacy_keys VALUES(?,?,?)').run(ma.id,'old-thread','legacy-retry-key-01');
 assert.deepEqual((await alice.c(path)).legacyIds,['old-thread']);
 assert.equal((await alice.c('/chat/conversations/old-thread/messages',{body:'Retry from old tab',groupId:ga.id,clientKey:'legacy-retry-key-01'})).id,ma.id);
 assert.equal((await alice.c(path)).messages.length,2);
 const monitoredA=await teacherA.c(path+'?group='+ga.id),monitoredB=await teacherB.c(path+'?group='+gb.id);
 assert.deepEqual(monitoredA.messages.map(m=>m.body),['Origen A']);assert.deepEqual(monitoredB.messages.map(m=>m.body),['Origen B']);assert.equal(monitoredB.messages[0].reply,null);
 assert.equal(monitoredA.messages[0].canModerate,true);await teacherA.c('/chat/messages/'+mb.id,{},'DELETE',403);
 await alice.c('/chat/messages/'+mb.id+'/report',{reason:'Solo grupo B debe ver este reporte'});
 assert.equal((await teacherA.c(path)).pendingReports,0);assert.equal((await teacherB.c(path)).pendingReports,1);
 const report=(await teacherB.c(path)).messages[0].reports[0];await teacherA.c('/chat/reports/'+report.id,{},'PUT',403);
 assert.equal((await alice.c(path)).messages.find(m=>m.id===ma.id).readByPeer,false);
 // Sending a response does not claim that the sender read earlier incoming messages.
 assert.equal((await bob.c(path)).unread,1);await bob.c(path+'/read',{id:mb.id});assert.equal((await alice.c(path)).messages.find(m=>m.id===ma.id).readByPeer,true);
 await teacherA.c('/chat/courses/'+ga.id,{enabled:false,studentStaff:true,studentPeers:true},'PUT');
 const contact=(await alice.c('/chat/contacts')).people.find(p=>p.id===bob.u.id);assert.equal(contact.sendGroupId,gb.id);assert.equal((await alice.c(path)).sendGroupId,gb.id);
 await teacherA.c(path+'/remove?group='+ga.id,{confirm:ca.id});
 assert.equal((await alice.c('/chat/contacts?group='+ga.id)).people.find(p=>p.id===bob.u.id).canMessage,false);
 assert.equal((await bob.c(path)).messages.length,1);assert.equal((await bob.c(path)).canSend,true);assert.equal((await teacherA.c(path+'?group='+ga.id)).messages.length,1);
 await teacherA.c(path+'/restore?group='+ga.id,{confirm:ca.id});assert.equal((await bob.c(path)).messages.length,2);
 db.prepare('DELETE FROM courses WHERE id=?').run(ga.id);assert.equal((await alice.c(path)).messages.length,1);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
