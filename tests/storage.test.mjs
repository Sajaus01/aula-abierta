import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,rmSync,readdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server/index.mjs';
import {createStorage} from '../server/storage.mjs';
import {optimizeBackups,physicalBytes,diskFiles} from '../server/storage-disk.mjs';
const MB=1048576;
function temporary(t){const root=mkdtempSync(join(tmpdir(),'aula-storage-'));t.after(()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-storage-'));rmSync(root,{recursive:true,force:true});});return root;}
test('backup optimization preserves paths and bytes, excludes live files and is idempotent',t=>{
 const root=temporary(t);for(const x of ['backups/a/uploads','backups/b/uploads','uploads'])mkdirSync(join(root,x),{recursive:true});const data=Buffer.alloc(180000,17);
 for(const f of ['backups/a/uploads/file','backups/b/uploads/other','uploads/live'])writeFileSync(join(root,f),data);writeFileSync(join(root,'backups/a/aula.sqlite'),'database A');writeFileSync(join(root,'backups/b/aula.sqlite'),'database B');
 const old=physicalBytes(diskFiles(join(root,'backups'))),r=optimizeBackups(root);assert.equal(r.linked,1);assert.ok(r.savedBytes>0);assert.ok(physicalBytes(diskFiles(join(root,'backups')))<old);
 assert.deepEqual(readFileSync(join(root,'backups/b/uploads/other')),data);assert.equal(statSync(join(root,'backups/a/uploads/file')).ino,statSync(join(root,'backups/b/uploads/other')).ino);assert.notEqual(statSync(join(root,'uploads/live')).ino,statSync(join(root,'backups/a/uploads/file')).ino);
 copyFileSync(join(root,'backups/b/uploads/other'),join(root,'restored'));writeFileSync(join(root,'restored'),'edited');assert.deepEqual(readFileSync(join(root,'backups/a/uploads/file')),data);assert.equal(optimizeBackups(root).linked,0);
});
async function fixture(t){const root=mkdtempSync(join(tmpdir(),'aula-storage-')),app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99883001',ADMIN_PASSWORD:'Storage-Synthetic-2026!'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-storage-'));rmSync(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.server.address().port;
 function client(){let cookie='';const call=async(p,b,m=b?'POST':'GET',status=200)=>{const r=await fetch(base+'/api'+p,{method:m,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body.data||body;};return call;}
 const master=client();await master('/auth/login',{document:'99883001',password:'Storage-Synthetic-2026!'});const users={};for(const [role,doc] of [['teacher','99883002'],['student','99883003'],['admin','99883004']]){const u=await master('/platform/users',{document:doc,name:'Prueba '+role,roles:[role]},'POST',201);const api=client();await api('/auth/login',{document:doc,password:doc});await api('/auth/first-password',{newPassword:role==='student'?'1234':'Storage-Synthetic-2026!',confirmPassword:role==='student'?'1234':'Storage-Synthetic-2026!'});users[role]={...u,api};}
 const teacher=users.teacher.api,template=await teacher('/admin/courses',{title:'Curso de almacenamiento'},'POST',201);const group=await teacher(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo de almacenamiento',code:'A',cohort:'2026'},'POST',201);await teacher(`/platform/courses/${group.id}/state`,{state:'active'});await teacher('/admin/enrollments',{courseId:group.id,studentId:users.student.id},'POST',201);
 const set=async(path,b,who=master)=>{const r=await who('/storage');return who('/storage/'+path,{...b,version:r.version},'PUT');};
 return {root,app,master,teacher,student:users.student.api,admin:users.admin.api,users,template,group,set};
}
const attachment=(size=12)=>({name:'modelo.cad',base64:Buffer.alloc(size,1).toString('base64')});
test('storage panel permissions, inherited limits, optimistic edits and teacher cross-course aggregation',async t=>{
 const f=await fixture(t);await f.teacher('/storage',null,'GET',403);await f.student('/storage',null,'GET',403);await f.teacher('/storage/settings',{},'PUT',403);await f.admin('/storage');
 let report=await f.master('/storage');assert.equal(report.courses.find(x=>x.id===f.group.id).ownerId,f.users.teacher.id);const studentMine=await f.student('/storage/mine');assert.deepEqual(studentMine.courses,[]);assert.equal(studentMine.users,undefined);
 await f.set('users/'+f.users.teacher.id,{limitBytes:20,inherit:false});await f.master('/storage/users/'+f.users.teacher.id,{version:report.version,limitBytes:100},'PUT',409);
 const a=await f.teacher(`/academics/courses/${f.group.id}/activities`,{title:'Con archivo',attachments:[attachment()]},'POST',201);
 await f.teacher(`/academics/courses/${f.template.id}/activities`,{title:'Otro curso',attachments:[attachment()]},'POST',413);
 assert.equal((await f.teacher('/storage/mine')).own.usedBytes,12);
 await f.teacher(`/academics/courses/${f.template.id}/activities`,{title:'Enlace sin archivo',instructionUrl:'https://example.com'},'POST',201);
 await f.set('users/'+f.users.teacher.id,{limitBytes:100,inherit:false},f.admin);
 await f.set('courses/'+f.group.id,{limitBytes:12,ownerId:f.users.teacher.id,inherit:false});
 await f.teacher(`/academics/courses/${f.group.id}/activities`,{title:'Grupo lleno',attachments:[attachment(1)]},'POST',413);
 await f.set('courses/'+f.group.id,{limitBytes:100,ownerId:f.users.teacher.id,inherit:false});
 const changed=await f.teacher(`/academics/activities/${a.id}`,{version:a.version,title:'Versión dos',retainAttachmentIds:[],attachments:[attachment(8)]},'PATCH');
 assert.equal((await f.teacher('/storage/mine')).own.usedBytes,20,'retained revision and current files both consume space');
 report=await f.master('/storage');assert.equal(report.files.length,2);assert.ok(report.events.length>=4);
 await f.set('users/'+f.users.teacher.id,{limitBytes:0,inherit:false});await f.teacher(`/academics/activities/${changed.id}`,{version:changed.version,title:'Editar sin añadir'},'PATCH');
 await f.set('users/'+f.users.teacher.id,{inherit:true});assert.equal((await f.teacher('/storage/mine')).own.limitBytes,500*MB);
 await f.set('courses/'+f.group.id,{limitBytes:100,ownerId:f.users.admin.id,inherit:false});assert.equal((await f.teacher('/storage/mine')).own.usedBytes,0);assert.equal((await f.admin('/storage/mine')).own.usedBytes,20);
});
test('student quota, draft replacement, group and platform limits apply to real writes and copies',async t=>{
 const f=await fixture(t),task=await f.teacher(`/academics/courses/${f.group.id}/activities`,{title:'Tarea',kind:'task',status:'published'},'POST',201);
 await f.set('users/'+f.users.student.id,{limitBytes:12,inherit:false});const requestId=crypto.randomUUID();let sub=await f.student(`/academics/activities/${task.id}/submit`,{requestId,action:'draft',files:[attachment()]},'POST',201);
 sub=await f.student(`/academics/activities/${task.id}/submit`,{requestId,action:'draft',version:sub.version,retainFileIds:[],files:[attachment(10)]},'POST',201);assert.equal((await f.student('/storage/mine')).own.usedBytes,10);assert.equal(readdirSync(join(f.root,'uploads')).length,1);
 await f.student(`/academics/activities/${task.id}/submit`,{requestId,action:'draft',version:sub.version,files:[attachment(3)]},'POST',413);assert.equal(readdirSync(join(f.root,'uploads')).length,1);
 let report=await f.master('/storage');await f.set('settings',{...report.settings,platformBytes:10});
 const module=await f.teacher(`/admin/courses/${f.group.id}/modules`,{title:'Archivos'},'POST',201);
 await f.teacher(`/admin/modules/${module.id}/resources`,{title:'Archivo',kind:'book',file:{name:'a.txt',base64:Buffer.from('x').toString('base64')}},'POST',413);
 await f.teacher(`/admin/courses/${f.group.id}/quick-resources`,{title:'Archivo',source:'file',file:{name:'a.txt',base64:Buffer.from('x').toString('base64')}},'POST',413);
 report=await f.master('/storage');await f.set('settings',{...report.settings,platformBytes:null});
 const material=await f.teacher(`/admin/modules/${module.id}/resources`,{title:'Archivo',kind:'book',file:{name:'a.txt',base64:Buffer.from('test').toString('base64')}},'POST',201);
 await f.set('users/'+f.users.teacher.id,{limitBytes:14,inherit:false});await f.teacher('/library',{kind:'resource',sourceId:material.id,title:'Biblioteca'},'POST',413);
 await f.teacher(`/platform/courses/${f.group.id}/clone`,{kind:'group',title:'Copia',code:'B',cohort:'2026'},'POST',413);
 await f.set('users/'+f.users.teacher.id,{limitBytes:100,inherit:false});const lib=await f.teacher('/library',{kind:'resource',sourceId:material.id,title:'Biblioteca'},'POST',201);assert.ok(lib.id);
 const storage=createStorage({db:f.app.db,dataDir:f.root,uploadsDir:join(f.root,'uploads'),fail:(status,message,code)=>{throw Object.assign(Error(message),{status,code});},capacity:()=>({totalBytes:MB,freeBytes:10}),audit:()=>{}});
 assert.throws(()=>storage.assertUpload({userId:f.users.teacher.id,courseId:f.group.id,added:[{size:1}]}),e=>e.code==='STORAGE_DISK_FULL');assert.doesNotThrow(()=>storage.assertUpload({userId:f.users.teacher.id,added:[]}));
});
