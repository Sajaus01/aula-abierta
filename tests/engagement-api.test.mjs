import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server/index.mjs';
import {createEngagement} from '../server/engagement.mjs';

test('real authenticated engagement API preserves measurement across restart and denies revoked, staff and anonymous signals',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aula-engagement-')),dataDir=join(root,'data'),env={NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'97170001',ADMIN_PASSWORD:'Engagement-Master-2026!'};
 let at=Date.now(),app=await createApp({dataDir,env,engagementClock:()=>at}),base;
 const listen=async()=>{await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;};await listen();
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-engagement-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 function client(view='teaching'){let cookie='';return async(path,body,method=body===undefined?'GET':'POST',expected=200)=>{const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Aula-View':view},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result.data;};}
 const master=client(),student=client('learning'),teacher=client(),anonymous=client('learning');await master('/auth/login',{document:env.ADMIN_DOCUMENT,password:env.ADMIN_PASSWORD});
 const users=[];for(const [call,document,name,role] of [[student,'97170002','Measured learner','student'],[teacher,'97170003','Measured teacher','teacher']]){const user=await master('/platform/users',{document,name,roles:[role]},'POST',201);users.push(user);await call('/auth/login',{document,password:document});await call('/auth/first-password',{newPassword:'Engagement-Person-2026!',confirmPassword:'Engagement-Person-2026!'});}
 const template=await master('/admin/courses',{title:'Measured course'},'POST',201),group=await master('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Measured group',cohort:'2026-2',code:'A'},'POST',201);
 await master('/platform/courses/'+group.id+'/state',{state:'active'});await master('/platform/courses/'+group.id+'/staff',{userId:users[1].id,grade:true,edit:false,manage:false});await master('/admin/enrollments',{studentId:users[0].id,courseId:group.id},'POST',201);
 const signal={courseId:group.id,tabId:'api-engagement-tab-0000',eventSeq:1,kind:'enter',active:false};
 await anonymous('/learning-activity',signal,'POST',401);await teacher('/learning-activity',signal,'POST',403);
 const started=(await student('/learning-activity',signal)).measurementStartedAt;at+=1000;await student('/learning-activity',{...signal,eventSeq:2,kind:'pulse',active:true});at+=15_000;await student('/learning-activity',{...signal,eventSeq:3,kind:'pulse',active:true,elapsedSeconds:9999});
 const summary=()=>createEngagement({db:app.db}).summary(group.id,{userIds:[users[0].id]}).students[0];
 assert.deepEqual([summary().visits,summary().sessions,summary().activeSeconds],[1,1,15]);assert.equal((await student('/learning-activity',{...signal,eventSeq:2,kind:'pulse',active:true})).applied,false);
 await new Promise(resolve=>app.server.close(resolve));app=await createApp({dataDir,env,engagementClock:()=>at});await listen();
 assert.equal(createEngagement({db:app.db}).summary(group.id).measurementStartedAt,started);assert.equal(summary().activeSeconds,15);
 at+=1000;await student('/learning-activity',{...signal,eventSeq:4,kind:'enter',active:false});assert.equal(summary().visits,1,'reloads reuse the current group session');
 app.db.prepare("UPDATE enrollments SET status='revoked' WHERE course_id=? AND student_id=?").run(group.id,users[0].id);
 at+=15_000;await student('/learning-activity',{...signal,eventSeq:5,kind:'pulse',active:true},'POST',403);assert.equal(summary().activeSeconds,15);
});
