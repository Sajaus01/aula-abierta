import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server/index.mjs';
import {courseChapterOrder,sortCourseModules} from '../server/course-model.mjs';
import {createBackup,restoreBackup} from '../server/backup.mjs';
import {DatabaseSync} from 'node:sqlite';

test('chapter direction reverses the persisted numeric sequence and breaks ties consistently without mutating content',()=>{
 const modules=[{id:'b',position:1,title:'Alphabetically first'},{id:'z',position:8,title:'Chapter 10'},{id:'a',position:1,title:'Chapter 2'}],before=structuredClone(modules);
 assert.deepEqual(sortCourseModules(modules,'asc').map(row=>row.id),['a','b','z']);
 assert.deepEqual(sortCourseModules(modules,'desc').map(row=>row.id),['z','b','a']);
 assert.deepEqual(modules,before);
 assert.equal(courseChapterOrder({chapter_order:'desc'}),'desc');
 assert.equal(courseChapterOrder({chapterOrder:'desc'}),'desc');
 assert.equal(courseChapterOrder({}),'asc');
});

test('teachers choose a persistent chapter direction for students; clone, restart and backups retain it without widening editing permissions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aula-chapter-order-')),dataDir=join(root,'data'),restoreDir=join(root,'restored');
 const env={NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'97110001',ADMIN_PASSWORD:'Chapter-Master-2026!'};
 let app=await createApp({dataDir,env}),base;
 const listen=async()=>{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;};
 await listen();
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-chapter-order-'));await rm(root,{recursive:true,force:true});});
 function client(){let cookie='';return async(path,body,method=body===undefined?'GET':'POST',expected=200,headers={})=>{const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Aula-View':'teaching',...headers},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result.data;};}
 const master=client(),editor=client(),grader=client(),student=client(),outsider=client();
 await master('/auth/login',{document:env.ADMIN_DOCUMENT,password:env.ADMIN_PASSWORD});
 const people=[];
 for(const [call,document,name,roles]of [[editor,'97110002','Editor',['teacher']],[grader,'97110003','Grader',['teacher']],[student,'97110004','Learner',['student']],[outsider,'97110005','Outsider',['teacher']]]){
  const user=await master('/platform/users',{document,name,roles},'POST',201);people.push(user);
  await call('/auth/login',{document,password:document});await call('/auth/first-password',{newPassword:'Chapter-Person-2026!',confirmPassword:'Chapter-Person-2026!'});
 }
 const [editorUser,graderUser,studentUser]=people;
 const template=await master('/admin/courses',{title:'Ordered course'},'POST',201);
 const group=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Group A',cohort:'2026-2',code:'A'},'POST',201);
 await master('/platform/courses/'+group.id+'/state',{state:'active'});
 await master('/platform/courses/'+group.id+'/staff',{userId:editorUser.id,edit:true,grade:false,manage:false});
 await master('/platform/courses/'+group.id+'/staff',{userId:graderUser.id,edit:false,grade:true,manage:false});
 await master('/admin/enrollments',{studentId:studentUser.id,courseId:group.id},'POST',201);
 const chapters=[];
 for(const [position,title,published]of [[4,'Chapter 10',true],[1,'Chapter 2',true],[2,'Hidden chapter',false]]){
  const chapter=await master('/admin/courses/'+group.id+'/modules',{title,position,published},'POST',201);chapters.push(chapter);
 }
 const initial=await student('/courses/'+group.id);
 assert.equal(initial.chapterOrder,'asc');assert.deepEqual(initial.modules.map(row=>row.title),['Chapter 2','Chapter 10']);
 const chosen=await editor('/platform/courses/'+group.id+'/chapter-order',{chapterOrder:'desc'});
 assert.deepEqual(chosen,{chapterOrder:'desc'});
 const descending=await student('/courses/'+group.id);
 assert.equal(descending.chapterOrder,'desc');assert.deepEqual(descending.modules.map(row=>row.title),['Chapter 10','Chapter 2']);
 assert.deepEqual(descending.modules.map(row=>row.position),[4,1]);
 await grader('/platform/courses/'+group.id+'/chapter-order',{chapterOrder:'asc'},'POST',403);
 await outsider('/platform/courses/'+group.id+'/chapter-order',{chapterOrder:'asc'},'POST',403);
 await student('/platform/courses/'+group.id+'/chapter-order',{chapterOrder:'asc'},'POST',403);
 await editor('/platform/courses/'+group.id+'/chapter-order',{chapterOrder:'asc'},'POST',403,{'X-Aula-Preview':group.id});
 await editor('/platform/courses/'+group.id+'/chapter-order',{chapterOrder:'alphabetical'},'POST',400);
 assert.equal((await student('/courses/'+group.id)).chapterOrder,'desc');
 // A group copy keeps its presentation direction independently of the original.
 const clone=await master('/platform/courses/'+group.id+'/clone',{kind:'group',title:'Group B',cohort:'2026-2',code:'B'},'POST',201);
 assert.equal(clone.chapterOrder,'desc');
 await master('/platform/courses/'+clone.id+'/chapter-order',{chapterOrder:'asc'});
 assert.equal((await master('/courses/'+group.id)).chapterOrder,'desc');
 // Templates use the same preference, which is copied into future groups.
 await master('/platform/courses/'+template.id+'/chapter-order',{chapterOrder:'desc'});
 const fromTemplate=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Next group',cohort:'2026-3',code:'A'},'POST',201);
 assert.equal(fromTemplate.chapterOrder,'desc');
 await new Promise(resolve=>app.server.close(resolve));app=await createApp({dataDir,env});await listen();
 assert.deepEqual((await student('/courses/'+group.id)).modules.map(row=>row.title),['Chapter 10','Chapter 2']);
 // Backups retain the preference as data, without special file conversion.
 const backup=createBackup(dataDir,{label:'chapter-order-test'});restoreBackup(backup.directory,restoreDir);
 const restored=new DatabaseSync(join(restoreDir,'aula.sqlite'),{readOnly:true});try{assert.equal(restored.prepare('SELECT chapter_order FROM courses WHERE id=?').get(group.id).chapter_order,'desc');assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{restored.close();}
 assert.throws(()=>app.db.prepare('UPDATE courses SET chapter_order=? WHERE id=?').run('invalid',group.id),/CHECK/);
});
