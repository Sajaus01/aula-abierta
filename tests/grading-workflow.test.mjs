import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aula-grading-workflow-'));
 const app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99910001',ADMIN_PASSWORD:'Master-Grading-2026!'}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-grading-workflow-'));await rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const client=()=>{let cookie='';return async(path,body,method=body?'POST':'GET',status=200)=>{
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data.data;
 };};
 const master=client();await master('/auth/login',{document:'99910001',password:'Master-Grading-2026!'});
 const template=await master('/admin/courses',{title:'Plantilla de calificación'},'POST',201);
 const group=await master(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo de prueba',cohort:'2026-2',code:'G'},'POST',201);
 await master(`/platform/courses/${group.id}/state`,{state:'active'});
 await master(`/admin/courses/${group.id}/enrollments/bulk`,{students:[{document:'99910003',name:'Estudiante A'},{document:'99910004',name:'Estudiante B'},{document:'99910005',name:'Estudiante C'}]},'POST',201);
 const students=[];for(const document of ['99910003','99910004','99910005']){const person=client();await person('/auth/login',{document,password:document});await person('/auth/first-password',{newPassword:'4567',confirmPassword:'4567'});students.push(person);}
 const activity=(body={})=>master(`/academics/courses/${group.id}/activities`,{title:'Tarea de prueba',kind:'task',status:'published',maxAttempts:3,...body},'POST',201);
 const submit=(a,student=students[0],body={})=>student(`/academics/activities/${a.id}/submit`,{requestId:randomUUID(),activityRevision:a.revision,action:'submit',text:'Respuesta de prueba',...body},'POST',201);
 const grade=(s,points,feedback='Comentario privado',extra={})=>master(`/academics/submissions/${s.id}/grade`,{version:s.version,points,feedback,published:false,...extra},'PATCH');
 const release=s=>master(`/academics/submissions/${s.id}/release`,{version:s.version});
 const mine=(a,student=students[0])=>student(`/academics/activities/${a.id}`);
 return {...app,master,group,client,students,activity,submit,grade,release,mine};
}

test('autosave keeps blank comments and new grades private until individual return, including edits to a released grade',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100});let s=await f.submit(a);
 s=await f.grade(s,null,'Comentario en preparación');assert.equal(s.gradeDraft,true);assert.equal(s.points,null);
 let visible=(await f.mine(a)).mine[0];assert.equal(visible.feedback,'');assert.equal(visible.points,null);assert.equal(visible.gradeDraft,undefined);
 await f.master(`/academics/submissions/${s.id}/release`,{version:s.version},'POST',400);
 s=await f.grade(s,80,'Primera devolución');s=await f.release(s);assert.equal(s.gradeDraft,false);assert.equal(s.published,true);
 visible=(await f.mine(a)).mine[0];assert.equal(visible.points,80);assert.equal(visible.feedback,'Primera devolución');
 for(const student of f.students.slice(1))await f.release(await f.grade(await f.submit(a,student),80));
 await f.master(`/academics/courses/${f.group.id}/settings`,{finalPublished:true},'PUT');
 s=await f.grade(s,95,'Segunda revisión privada');assert.equal(s.points,95);assert.equal(s.publishedPoints,80);assert.equal(s.gradeDraft,true);
 visible=(await f.mine(a)).mine[0];assert.equal(visible.points,80);assert.equal(visible.feedback,'Primera devolución');
 const studentBook=await f.students[0](`/academics/courses/${f.group.id}`);assert.equal(studentBook.grade.cells[0].points,80);assert.equal(studentBook.grade.provisional,4);assert.equal(studentBook.grade.final,4);
 const teacherBook=await f.master(`/academics/courses/${f.group.id}/gradebook`);assert.equal(teacherBook.students.find(v=>v.cells[0].submissionId===s.id).cells[0].points,95);
 const stale={...s};s=await f.grade(s,90,'Versión más reciente');await f.master(`/academics/submissions/${s.id}/release`,{version:stale.version},'POST',409);
 s=await f.release(s);visible=(await f.mine(a)).mine[0];assert.equal(visible.points,90);assert.equal(visible.feedback,'Versión más reciente');
 assert.equal(f.db.prepare("SELECT json_type(payload,'$.teacherGradeDraft') draft FROM submissions WHERE id=?").get(s.id).draft,null);
});

test('bulk return publishes only the latest eligible attempt and rejects stale selections before changing any record',async t=>{
 const f=await fixture(t),a=await f.activity();
 let old=await f.grade(await f.submit(a),45),first=await f.grade(await f.submit(a),90),second=await f.grade(await f.submit(a,f.students[1]),70);
 const ungraded=await f.submit(a,f.students[2]);
 await f.master(`/academics/activities/${a.id}/release`,{submissions:[{id:first.id,version:first.version},{id:second.id,version:second.version-1}]},'POST',409);
 assert.equal((await f.mine(a)).mine.find(v=>v.id===first.id).published,false);
 const result=await f.master(`/academics/activities/${a.id}/release`,{});assert.equal(result.releasedCount,2);assert.equal(result.skippedCount,1);
 const views=(await f.mine(a)).mine;assert.equal(views.find(v=>v.id===old.id).published,false);assert.equal(views.find(v=>v.id===first.id).points,90);
 assert.equal((await f.mine(a,f.students[1])).mine[0].points,70);assert.equal((await f.mine(a,f.students[2])).mine[0].points,null);
 assert.equal((await f.master(`/academics/activities/${a.id}/release`,{})).releasedCount,0);
 await f.master(`/academics/submissions/${old.id}/release`,{version:old.version},'POST',400);
 first=result.submissions.find(v=>v.id===first.id);first=await f.grade(first,92,'Cambio pendiente');
 const course=await f.master(`/academics/courses/${f.group.id}/release`,{});assert.equal(course.releasedCount,1);assert.equal((await f.mine(a)).mine[0].points,92);
 await f.master(`/academics/activities/${a.id}/release`,{submissions:[{id:ungraded.id,version:ungraded.version},{id:ungraded.id,version:ungraded.version}]},'POST',400);
});

test('release enforces grading scope, submitted work, support review and atomic publication',async t=>{
 const f=await fixture(t),a=await f.activity();let s=await f.grade(await f.submit(a),50);
 const teacherData=await f.master('/platform/users',{document:'99910006',name:'Docente colaborador',roles:['teacher']},'POST',201),teacher=f.client();
 await teacher('/auth/login',{document:'99910006',password:'99910006'});await teacher('/auth/first-password',{newPassword:'Teacher-2026!',confirmPassword:'Teacher-2026!'});
 await f.master(`/platform/courses/${f.group.id}/staff`,{userId:teacherData.id,edit:true,grade:false,manage:false});
 await teacher(`/academics/activities/${a.id}/release`,{},'POST',403);await teacher(`/academics/submissions/${s.id}/release`,{version:s.version},'POST',403);
 await f.students[0](`/academics/activities/${a.id}/release`,{},'POST',403);
 await f.master(`/platform/courses/${f.group.id}/staff`,{userId:teacherData.id,edit:false,grade:true,manage:false});
 s=await teacher(`/academics/submissions/${s.id}/release`,{version:s.version});assert.equal(s.published,true);
 const draft=await f.submit(a,f.students[1],{action:'draft'});await f.master(`/academics/submissions/${draft.id}/release`,{version:draft.version},'POST',400);
 const support=await f.activity({procedureSupport:{enabled:true,reviewRequired:true,minFiles:1,maxFiles:1,formats:['pdf']}});
 let supported=await f.submit(support,f.students[0],{files:[{name:'soporte.pdf',base64:Buffer.from('%PDF-1.4\nProcedimiento').toString('base64')}]});
 supported=await f.grade(supported,75);assert.equal((await f.master(`/academics/activities/${support.id}/release`,{})).releasedCount,0);
 await f.master(`/academics/submissions/${supported.id}/release`,{version:supported.version},'POST',400);
 supported=await f.grade(supported,75,'Soportes revisados',{procedureReviewed:true});assert.equal((await f.release(supported)).published,true);
 const rollback=await f.activity();let one=await f.grade(await f.submit(rollback),10),two=await f.grade(await f.submit(rollback,f.students[1]),20);
 f.db.exec("CREATE TRIGGER reject_bulk_grade BEFORE UPDATE ON submissions WHEN NEW.id='"+two.id+"' AND NEW.published=1 BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END");
 await f.master(`/academics/activities/${rollback.id}/release`,{submissions:[{id:one.id,version:one.version},{id:two.id,version:two.version}]},'POST',500);
 assert.equal((await f.mine(rollback)).mine[0].published,false);assert.equal((await f.mine(rollback,f.students[1])).mine[0].published,false);
 assert.equal(f.db.prepare('SELECT version FROM submissions WHERE id=?').get(one.id).version,one.version);
});
