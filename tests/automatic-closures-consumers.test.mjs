import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server/index.mjs';

test('the background sweep records one durable zero without page activity, preserves real work and informs only its owner',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aula-closure-consumers-'));
 const options={dataDir:dir,activityClosureIntervalMs:80,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99781001',ADMIN_PASSWORD:'Automatic-Closure-Master!'}};
 let app=await createApp(options);
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));let base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'aula-closure-consumers-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const client=()=>({cookie:'',async call(path,body,method=body===undefined?'GET':'POST',status=200,headers={}){
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:this.cookie,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result.data;
 }});
 const teacher=client();await teacher.call('/auth/login',{document:'99781001',password:'Automatic-Closure-Master!'});
 const template=await teacher.call('/admin/courses',{title:'Cierres sintéticos'},'POST',201),group=await teacher.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Grupo de cierre',cohort:'2026-2',code:'C'},'POST',201);
 await teacher.call('/platform/courses/'+group.id+'/state',{state:'active'});
 const people=[];
 for(const [document,name] of [['99781003','Borrador sin enviar'],['99781004','Entrega por calificar'],['99781005','Autorización sin límite']]){
  await teacher.call('/admin/courses/'+group.id+'/enrollments/bulk',{students:[{document,name}]},'POST',201);
  const session=client(),login=await session.call('/auth/login',{document,password:document});await session.call('/auth/first-password',{newPassword:'4567',confirmPassword:'4567'});people.push({id:login.user.id,session});
 }
 const due=new Date(Date.now()+86400_000).toISOString(),activity=await teacher.call('/academics/courses/'+group.id+'/activities',{title:'Informe',kind:'task',status:'published',weight:100,maxPoints:10,maxAttempts:1,dueAt:due,closesAt:due},'POST',201),path='/academics/activities/'+activity.id;
 const draft=await people[0].session.call(path+'/submit',{requestId:'kept-draft',activityRevision:activity.revision,action:'draft',text:'Conservar este borrador'},'POST',201);
 await people[1].session.call(path+'/submit',{requestId:'real-delivery',activityRevision:activity.revision,action:'submit',text:'Respuesta enviada'},'POST',201);
 await teacher.call(path+'/extensions/'+people[2].id,{version:0,dueAt:null},'PUT');
 const expired=new Date(Date.now()-1000).toISOString();app.db.prepare("UPDATE activities SET config=json_set(config,'$.dueAt',?,'$.closesAt',?) WHERE id=?").run(expired,expired,activity.id);
 // No HTTP request follows the expired deadline until the database itself shows
 // that the idle server timer persisted the closure.
 const until=Date.now()+5000;
 while(!app.db.prepare('SELECT 1 FROM activity_auto_closures WHERE activity_id=? AND active=1').get(activity.id)&&Date.now()<until)await new Promise(done=>setTimeout(done,30));
 const closureRows=app.db.prepare('SELECT * FROM activity_auto_closures WHERE activity_id=?').all(activity.id);assert.equal(closureRows.length,1);assert.equal(closureRows[0].student_id,people[0].id);assert.equal(closureRows[0].points,0);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(activity.id).n,2,'closure does not manufacture a submission');
 const storedDraft=app.db.prepare('SELECT * FROM submissions WHERE id=?').get(draft.id);assert.equal(storedDraft.state,'draft');assert.equal(JSON.parse(storedDraft.payload).text,'Conservar este borrador');
 const own=await people[0].session.call('/courses/'+group.id),closed=own.activities[0];assert.equal(closed.responseState,'missing');assert.equal(closed.submitted,false);assert.equal(closed.closure.closed,true);assert.equal(closed.closure.history.length,1);assert.equal(closed.outcome.satisfactory,false);
 const peer=await people[1].session.call('/courses/'+group.id);assert.equal(peer.activities[0].submitted,true);assert.equal(peer.activities[0].closure,null);
 const authorized=await people[2].session.call('/courses/'+group.id);assert.equal(authorized.activities[0].deadline.closed,false);assert.equal(authorized.activities[0].closure,null);
 const learning=(await people[0].session.call('/learning')).courses.find(course=>course.courseId===group.id).overall;assert.equal(learning.percent,0);assert.equal(learning.activities.completed,0);assert.equal(learning.activities.closedMissing,1);assert.equal(learning.openPending,0);assert.equal(learning.continueNext,null);
 const book=await teacher.call('/academics/courses/'+group.id+'/gradebook'),cell=book.students.find(student=>student.id===people[0].id).cells[0];assert.equal(book.settings.missingAsZero,false);assert.equal(cell.state,'missing');assert.equal(cell.points,0);assert.equal(cell.published,true);assert.equal(cell.submissionId,null);
 assert.equal(book.students.find(student=>student.id===people[1].id).cells[0].points,null);
 const stats=await teacher.call('/analytics/'+group.id);assert.equal(stats.summary.group.submitted,1);assert.equal(stats.summary.group.overdue,1);assert.equal(stats.summary.group.closedMissing,1);assert.equal(stats.summary.group.openPending,1);
 const preview=await teacher.call('/courses/'+group.id,undefined,'GET',200,{'X-Aula-Preview':group.id});assert.equal(Object.hasOwn(preview.activities[0],'closure'),false);
 await app.notifications.flush();
 const notices=await people[0].session.call('/notifications'),ownNotices=notices.items.filter(item=>item.kind==='missing');assert.equal(ownNotices.length,1);assert.equal(ownNotices[0].href,'#actividad/'+activity.id);assert.equal(ownNotices[0].personal,true);
 assert.equal((await people[1].session.call('/notifications')).items.some(item=>item.kind==='missing'),false);
 await app.notifications.flush();assert.equal((await people[0].session.call('/notifications')).items.filter(item=>item.kind==='missing').length,1,'read requests never repeat the notice');
 // A restart must neither duplicate the grade nor lose the reason/history.
 await new Promise(done=>app.server.close(done));app=await createApp(options);await new Promise(done=>app.server.listen(0,'127.0.0.1',done));base='http://127.0.0.1:'+app.server.address().port;
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM activity_auto_closure_history WHERE activity_id=?').get(activity.id).n,1);
 const reopened=await teacher.call(path+'/extensions/'+people[0].id,{version:0,dueAt:null},'PUT');assert.equal(reopened.closure.closed,false);assert.equal(reopened.closure.points,null);
 const editable=await people[0].session.call(path);assert.equal(editable.activity.closure.closed,false);assert.equal(editable.mine[0].id,draft.id);assert.equal(editable.mine[0].text,'Conservar este borrador');
 await app.notifications.flush();assert.equal((await people[0].session.call('/notifications')).items.some(item=>item.kind==='missing'),false,'an obsolete closure notice disappears after authorization');
 const sent=await people[0].session.call(path+'/submit',{submissionId:draft.id,version:editable.mine[0].version,requestId:'kept-draft',activityRevision:activity.revision,action:'submit',text:'Entrega autorizada después del cierre'},'POST',201);
 assert.equal(sent.id,draft.id);assert.equal(sent.attempt,1);
 const awaiting=await people[0].session.call('/academics/courses/'+group.id);assert.equal(awaiting.grade.cells[0].state,'submitted');assert.equal(awaiting.grade.cells[0].points,null);
 await teacher.call('/academics/submissions/'+sent.id+'/grade',{version:sent.version,points:8,published:true},'PATCH');
 const graded=await people[0].session.call('/academics/courses/'+group.id);assert.equal(graded.grade.cells[0].state,'graded');assert.equal(graded.grade.accumulated,4);assert.equal(graded.grade.cells[0].points,8);
 assert.equal(app.db.prepare('SELECT COUNT(*) n FROM activity_auto_closures WHERE activity_id=? AND active=1').get(activity.id).n,0);
});
