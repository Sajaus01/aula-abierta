import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp,validateFile} from '../server/index.mjs';
import {chatFileType,createChatMedia} from '../server/chat-media.mjs';
import {createBackup} from '../server/backup.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMxoAAAAASUVORK5CYII=','base64');
const webm=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('webm\0A_OPUS\0recorded-audio')]);
const upload=(name,buffer)=>({name,base64:buffer.toString('base64')});

test('chat media: filesystem rollback removes only newly created files and preserves colliding originals',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aula-chat-write-')),db=new DatabaseSync(':memory:');t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
 db.exec('CREATE TABLE chat_files(id TEXT,message_id INTEGER,file_key TEXT,name TEXT,mime TEXT,size INTEGER,kind TEXT,position INTEGER)');
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});},media=createChatMedia({db,fail,validateFile,uploadsDir:root,storage:{assertUpload(){}}}),plan=media.prepare([upload('uno.png',png),upload('dos.png',png)]),original=Buffer.from('Existing original');
 await writeFile(join(root,plan.added[1].key),original);db.exec('BEGIN');
 assert.throws(()=>media.save(1,plan,{userId:'student',courseId:'course'}),error=>error.code==='EEXIST');db.exec('ROLLBACK');media.rollback(plan);
 assert.deepEqual(await readdir(root),[plan.added[1].key]);assert.deepEqual(await readFile(join(root,plan.added[1].key)),original);assert.equal(db.prepare('SELECT count(*) n FROM chat_files').get().n,0);
});

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aula-chat-media-')),app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99962001',ADMIN_PASSWORD:'Synthetic-Media-2026!'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,db=new DatabaseSync(join(root,'aula.sqlite'));
 t.after(async()=>{db.close();await new Promise(r=>app.server.close(r));await rm(root,{recursive:true,force:true});});
 const client=()=>{let cookie='';const raw=async(path,headers={})=>fetch(base+'/api'+path,{headers:{Origin:base,Cookie:cookie,...headers}});const call=async(path,body,method=body?'POST':'GET',expected=200,headers={})=>{const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const result=await r.json();assert.equal(r.status,expected,path+': '+JSON.stringify(result));return result.data;};call.raw=raw;return call;};
 const master=client();await master('/auth/login',{document:'99962001',password:'Synthetic-Media-2026!'});
 const template=await master('/admin/courses',{title:'Adjuntos privados'},'POST',201),groups=[];
 for(const code of ['A','B']){const g=await master(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo '+code,cohort:'2026',code},'POST',201);await master(`/platform/courses/${g.id}/state`,{state:'active'});await master('/chat/courses/'+g.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');groups.push(g);}
 const people=[];let seq=2;
 for(const [name,role]of [['Estudiante','student'],['Compañera','student'],['Docente','teacher'],['Ajeno','student']]){const document='9996200'+seq++,u=await master('/platform/users',{document,name,roles:[role]},'POST',201),c=client();await c('/auth/login',{document,password:document});await c('/auth/first-password',{newPassword:'Synthetic-Person-2026!',confirmPassword:'Synthetic-Person-2026!'});people.push({u,c});}
 for(const p of people.slice(0,2))for(const g of groups)await master('/admin/enrollments',{studentId:p.u.id,courseId:g.id},'POST',201);
 await master(`/platform/courses/${groups[0].id}/staff`,{userId:people[2].u.id,edit:true,grade:true,manage:false});
 const v=await people[0].c('/chat/conversations',{groupId:groups[0].id,userId:people[1].u.id},'POST',201);
 return {root,db,master,people,groups,path:'/chat/conversations/'+v.id,client};
}

test('chat media: private verified images, audio ranges and downloaded files; retries preserve quota and receipts',async t=>{
 const {root,db,people:[s,p,teacher,outsider],groups:[g],path,client}=await fixture(t);
 const payload={body:'',groupId:g.id,clientKey:'media-idempotency-001',files:[upload('foto.png',png),upload('audio.webm',webm),upload('informe.html',Buffer.from('<script>alert(1)</script>'))]};
 const m=await s.c(path+'/messages',payload,'POST',201);assert.equal(m.files.length,3);assert.deepEqual(m.files.map(f=>f.kind),['image','audio','file']);
 assert.equal((await s.c(path+'/messages',payload)).id,m.id);assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_files').get().n,3);assert.equal((await readdir(join(root,'uploads'))).length,3);
 const view=await p.c(path);assert.equal(view.messages[0].body,'');assert.equal(view.messages[0].files.length,3);assert.equal(view.messages[0].readByPeer,false);
 assert.equal((await p.c('/chat')).conversations[0].preview,'3 archivos');await p.c(path+'/read',{id:m.id});assert.equal((await s.c(path)).messages[0].readByPeer,true);
 let response=await p.c.raw(m.files[0].url.slice(4));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('content-disposition'),/^inline/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
 response=await p.c.raw(m.files[1].url.slice(4),{Range:'bytes=4-11'});assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/webm');assert.equal(response.headers.get('content-range'),`bytes 4-11/${webm.length}`);assert.deepEqual(Buffer.from(await response.arrayBuffer()),webm.subarray(4,12));
 response=await p.c.raw(m.files[2].url.slice(4));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment/);await response.arrayBuffer();
 assert.equal((await outsider.c.raw(m.files[0].url.slice(4))).status,403);assert.equal((await client().raw(m.files[0].url.slice(4))).status,401);
 response=await p.c.raw(m.files[1].url.slice(4),{Range:'bytes=99999-'});assert.equal(response.status,416);await response.arrayBuffer();
 const inventory=await teacher.c('/storage/mine');assert.ok(inventory.courses.find(x=>x.id===g.id).usedBytes>=png.length+webm.length);
 const backup=createBackup(root,{label:'chat-media-test'});assert.equal(backup.files.length,3);assert.equal(backup.counts.chat_files,3);
 await s.c('/chat/messages/'+m.id,{},'DELETE');assert.deepEqual((await p.c(path)).messages[0].files,[]);assert.equal((await p.c.raw(m.files[0].url.slice(4))).status,403);assert.equal((await teacher.c.raw(m.files[0].url.slice(4))).status,200);assert.equal((await readdir(join(root,'uploads'))).length,3,'moderation originals remain stored');
});

test('chat media: origin membership, withdrawal, quota and database failure do not leak or orphan files',async t=>{
 const {root,db,master,people:[s,p,teacher],groups:[g,b],path}=await fixture(t);
 const first=await s.c(path+'/messages',{groupId:g.id,clientKey:'media-membership-001',files:[upload('foto.png',png)]},'POST',201);
 await s.c(path+'/messages',{groupId:b.id,body:'Otro origen',clientKey:'other-origin-text-01'},'POST',201);
 await teacher.c(path+'/remove?group='+g.id,{confirm:path.split('/').at(-1)});assert.equal((await p.c.raw(first.files[0].url.slice(4))).status,403);assert.equal((await teacher.c.raw(first.files[0].url.slice(4))).status,200);
 await teacher.c(path+'/restore?group='+g.id,{confirm:path.split('/').at(-1)});
 db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=? AND course_id=?").run(p.u.id,g.id);assert.equal((await p.c.raw(first.files[0].url.slice(4))).status,403);assert.equal((await p.c(path)).messages.length,1);
 const before=await readdir(join(root,'uploads')),count=db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n;
 db.prepare('INSERT INTO storage_user_limits VALUES(?,0,?)').run(s.u.id,new Date().toISOString());await s.c(path+'/messages',{groupId:b.id,clientKey:'media-zero-quota-001',files:[upload('foto.png',png)]},'POST',413);assert.deepEqual(await readdir(join(root,'uploads')),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n,count);
 db.prepare('DELETE FROM storage_user_limits WHERE user_id=?').run(s.u.id);db.exec("CREATE TRIGGER reject_chat_file BEFORE INSERT ON chat_files BEGIN SELECT RAISE(ABORT,'Synthetic media rollback'); END");
 await s.c(path+'/messages',{groupId:b.id,clientKey:'media-database-fail-1',files:[upload('foto.png',png)]},'POST',500);assert.deepEqual(await readdir(join(root,'uploads')),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_messages').get().n,count);db.exec('DROP TRIGGER reject_chat_file');
 const retained=await s.c(path+'/messages',{groupId:b.id,clientKey:'media-origin-retain-1',files:[upload('evidencia.txt',Buffer.from('Grupo B'))]},'POST',201);
 const preview=await master(`/platform/courses/${g.id}/delete`);assert.equal(preview.counts.files,1);await master(`/platform/courses/${g.id}/delete`,{confirmed:true,confirmTitle:preview.title,counts:preview.counts},'DELETE');assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_files').get().n,1);assert.equal((await readdir(join(root,'uploads'))).length,1);assert.equal((await s.c.raw(retained.files[0].url.slice(4))).status,200);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('chat media: strict upload caps, signatures and MIME derived from bytes',async t=>{
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 for(const [name,bytes,mime]of [['audio.ogg',Buffer.from('OggS\0OpusHead'),'audio/ogg'],['audio.mp4',Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftypisom\0soun')]),'audio/mp4'],['audio.wav',Buffer.from('RIFF0000WAVEdata'),'audio/wav']])assert.equal(chatFileType(validateFile(upload(name,bytes),{any:true}),fail).mime,mime);
 assert.throws(()=>chatFileType(validateFile(upload('falso.webm',Buffer.from('<html>')), {any:true}),fail),e=>e.status===400);
 const {people:[s],groups:[g],path,db}=await fixture(t);
 await s.c(path+'/messages',{body:'',groupId:g.id,clientKey:'media-empty-message-1'},'POST',400);
 await s.c(path+'/messages',{groupId:g.id,clientKey:'media-many-files-001',files:Array.from({length:6},()=>upload('foto.png',png))},'POST',400);
 await s.c(path+'/messages',{groupId:g.id,clientKey:'media-huge-file-0001',files:[upload('archivo.bin',Buffer.alloc(10*1024*1024+1))]},'POST',413);
 await s.c(path+'/messages',{groupId:g.id,clientKey:'media-false-image-01',files:[upload('foto.png',Buffer.from('<script>'))]},'POST',400);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM chat_files').get().n,0);
});

test('chat context: HTTP resolver, teacher recipient and normalized immutable origin snapshot',async t=>{
 const {db,people:[s,p,teacher],groups:[g],path}=await fixture(t);
 db.prepare('INSERT INTO modules(id,course_id,title,published) VALUES(?,?,?,1)').run('chapter-context',g.id,'Capítulo visible');
 db.prepare('INSERT INTO resources(id,module_id,title,kind,created_at,updated_at,published) VALUES(?,?,?,?,?,?,1)').run('resource-context','chapter-context','Simulación RC','link',new Date().toISOString(),new Date().toISOString());
 let descriptor=await s.c('/chat/context?courseId='+g.id+'&resourceId=resource-context');assert.equal(descriptor.context.title,'Simulación RC');assert.equal(descriptor.context.moduleTitle,'Capítulo visible');assert.deepEqual(descriptor.teachers.map(p=>p.id),[teacher.u.id]);
 await s.c(path+'/messages',{body:'Ayuda',groupId:g.id,clientKey:'context-wrong-peer-01',context:{courseId:g.id,resourceId:'resource-context'}},'POST',403);
 const v=await s.c('/chat/conversations',{groupId:g.id,userId:teacher.u.id},'POST',201),teacherPath='/chat/conversations/'+v.id;
 const message=await s.c(teacherPath+'/messages',{body:'¿Cómo inicio?',groupId:g.id,clientKey:'context-to-teacher-01',context:{courseId:g.id,resourceId:'resource-context',title:'FORJADO',href:'https://evil.example'}},'POST',201);
 assert.equal(message.context.title,'Simulación RC');assert.equal(message.context.href,`#curso/${g.id}?resource=resource-context`);
 db.prepare("UPDATE resources SET title='Título nuevo',published=0 WHERE id='resource-context'").run();assert.equal((await teacher.c(teacherPath)).messages[0].context.title,'Simulación RC');await s.c('/chat/context?courseId='+g.id+'&resourceId=resource-context',undefined,'GET',404);
 assert.equal((await p.c(path)).messages.length,0);
});

test('chat media: paginated history and visible origins update after partial withdrawal or membership revocation',async t=>{
 const {db,people:[s,p,teacher],groups:[g,b],path}=await fixture(t);
 const first=await s.c(path+'/messages',{groupId:g.id,clientKey:'page-origin-image-01',files:[upload('imagen.png',png)]},'POST',201);
 await s.c(path+'/messages',{groupId:b.id,body:'Origen B',clientKey:'page-origin-b-text-01'},'POST',201);
 for(let i=0;i<65;i++)db.prepare('INSERT INTO chat_messages(conversation_id,sender_id,body,created_at,client_key,course_id) VALUES(?,?,?,?,?,?)').run(path.split('/').at(-1),s.u.id,'Mensaje '+i,new Date().toISOString(),'page-origin-b-'+i,b.id);
 const latest=await p.c(path),olderPath=path+'?before='+latest.messages[0].id;assert.equal(latest.messages.length,60);assert.ok((await p.c(olderPath)).messages.some(m=>m.id===first.id));
 await teacher.c(path+'/remove?group='+g.id,{confirm:path.split('/').at(-1)});
 let current=await p.c(path),older=await p.c(olderPath);assert.deepEqual(current.visibleGroupIds,[b.id]);assert.ok(older.messages.every(m=>m.groupId===b.id));assert.equal((await p.c.raw(first.files[0].url.slice(4))).status,403);
 assert.ok((await teacher.c(path+'?group='+g.id)).visibleGroupIds.includes(g.id));
 await teacher.c(path+'/restore?group='+g.id,{confirm:path.split('/').at(-1)});db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=? AND course_id=?").run(p.u.id,g.id);
 current=await p.c(path);older=await p.c(olderPath);assert.deepEqual(current.visibleGroupIds,[b.id]);assert.ok(older.messages.every(m=>m.groupId===b.id));assert.equal((await p.c.raw(first.files[0].url.slice(4))).status,403);
});
