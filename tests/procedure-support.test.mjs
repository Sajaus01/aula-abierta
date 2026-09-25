import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server/index.mjs';
import {validateProcedurePolicy} from '../server/procedure-support.mjs';
import {supportEditor,supportRules,procedurePolicy,supportPreview} from '../public/procedure-support.js';

const fail=(_status,message)=>{throw Error(message);};
const pdf={name:'procedimientos.pdf',base64:Buffer.from('%PDF-1.4\nProcedimientos sintéticos').toString('base64')};
const png={name:'pagina.png',base64:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')};
const policy={enabled:true,instructions:'Explica cada operación.',formats:['pdf'],maxFiles:1,reviewRequired:true};
const questions=[{id:'q1',type:'single',prompt:'Dos más dos',options:['4','5'],correct:[0],points:1}];

test('procedure policy defaults, validation and escaped presentation',()=>{
 assert.equal(procedurePolicy().enabled,false);assert.deepEqual(supportRules(),{enabled:false});
 for(const value of [null,[],{enabled:'true'},{enabled:true,formats:[]},{formats:['exe']},{formats:['pdf','pdf']},{maxFiles:0},{maxFiles:6},{maxFiles:1.5},{instructions:'a'.repeat(4001)},{reviewRequired:'true'}])assert.throws(()=>validateProcedurePolicy(value,fail));
 assert.deepEqual(validateProcedurePolicy(policy,fail),policy);
 const html=supportEditor({procedureSupport:{...policy,instructions:'</textarea><script>alert(1)</script>'}});
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('name="procedureEnabled" checked'));
 assert.ok(supportPreview(policy).includes('obligatorios'));assert.equal(supportPreview(procedurePolicy()),'');
});

test('required procedures: drafts, uploads, privacy, review, revisions and cleanup over HTTP',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aula-procedures-'));
 const app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99900001',ADMIN_PASSWORD:'Master-Synthetic-2026!'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await new Promise(r=>app.server.close(r));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-procedures-'));await rm(root,{recursive:true,force:true});});
 function client(){let cookie='';const call=async(path,body,method=body?'POST':'GET',expected=200)=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data.data;};call.file=async(path,status)=>{const r=await fetch(base+path,{headers:{Cookie:cookie}});assert.equal(r.status,status);await r.arrayBuffer();};return call;}
 const master=client(),student=client(),peer=client(),anonymous=client();
 await master('/auth/login',{document:'99900001',password:'Master-Synthetic-2026!'});
 const template=await master('/admin/courses',{title:'Plantilla de soportes'},'POST',201);
 const g=await master(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo de soportes',cohort:'2026-2',code:'A'},'POST',201);
 await master(`/platform/courses/${g.id}/state`,{state:'active'});
 await master(`/admin/courses/${g.id}/enrollments/bulk`,{students:[{document:'99900003',name:'Estudiante'},{document:'99900004',name:'Compañero'}]},'POST',201);
 for(const [c,document]of [[student,'99900003'],[peer,'99900004']]){await c('/auth/login',{document,password:document});await c('/auth/first-password',{newPassword:'4567',confirmPassword:'4567'});}
 const make=body=>master(`/academics/courses/${g.id}/activities`,{title:'Soportes',kind:'quiz',status:'published',questions,maxAttempts:3,procedureSupport:policy,...body},'POST',201);
 let a=await make({weight:100}),path=`/academics/activities/${a.id}/submit`,request={requestId:'procedure-attempt-one',activityRevision:a.revision,action:'submit',answers:{q1:[0]}};
 let saved;
 await t.test('requires an actual file, allows an incomplete draft and validates before writing',async()=>{
  await student(path,request,'POST',400);
  await student(path,{...request,procedureNote:'Ya hice el procedimiento'},'POST',400);
  await student(path,{...request,url:'https://example.com/procedure'},'POST',400);
  await student(path,{...request,files:[png]},'POST',400);
  await student(path,{...request,files:[pdf,pdf]},'POST',400);
  await student(path,{...request,files:[{name:'falso.pdf',base64:Buffer.from('not a PDF').toString('base64')}]},'POST',400);
  assert.equal((await readdir(join(root,'uploads'))).length,0);
  saved=await student(path,{...request,action:'draft',answers:{}},'POST',201);assert.equal(saved.state,'draft');
  saved=await student(path,{...request,action:'draft',version:saved.version,files:[pdf],procedureNote:'Desarrollo de la pregunta 1'},'POST',201);assert.equal(saved.files.length,1);
  await student(path,{...request,version:saved.version,retainFileIds:[]},'POST',400);
  assert.equal((await readdir(join(root,'uploads'))).length,1);
  saved=await student(path,{...request,version:saved.version,procedureNote:'Desarrollo de la pregunta 1'},'POST',201);
  assert.equal(saved.state,'submitted');assert.equal(saved.points,null);assert.equal(saved.automaticPoints,undefined);assert.equal(saved.procedureReviewPending,true);assert.equal(saved.files.length,1);
  const again=await student(path,{...request,files:[pdf]});assert.equal(again.id,saved.id);assert.equal((await readdir(join(root,'uploads'))).length,1);
 });
 await t.test('attachments stay private and teacher must confirm review to release grades',async()=>{
  assert.equal(saved.files[0].key,undefined);await student.file(saved.files[0].url,200);await master.file(saved.files[0].url,200);await peer.file(saved.files[0].url,403);await anonymous.file(saved.files[0].url,401);
  let teacherView=(await master(`/academics/activities/${a.id}/submissions`)).submissions[0];assert.equal(teacherView.automaticPoints,1);assert.equal(teacherView.procedureNote,'Desarrollo de la pregunta 1');
  await master(`/academics/courses/${g.id}/release`,{});assert.equal((await student(`/academics/activities/${a.id}`)).mine[0].published,false);
  const grade={points:0.75,feedback:'Buen desarrollo',reason:'Revisión sintética',version:teacherView.version,published:true};
  await master(`/academics/submissions/${saved.id}/grade`,grade,'PATCH',400);
  await master(`/academics/submissions/${saved.id}/grade`,{...grade,procedureReviewed:'true'},'PATCH',400);
  teacherView=await master(`/academics/submissions/${saved.id}/grade`,{...grade,published:false},'PATCH');assert.equal(teacherView.procedureReviewPending,true);
  teacherView=await master(`/academics/submissions/${saved.id}/grade`,{...grade,version:teacherView.version,procedureReviewed:true},'PATCH');assert.equal(teacherView.procedureReviewPending,false);
  const result=(await student(`/academics/activities/${a.id}`)).mine[0];assert.equal(result.points,0.75);assert.equal(result.feedback,'Buen desarrollo');assert.equal(result.automaticPoints,undefined);
 });
 await t.test('changed requirements use revision policy and retain historical supports',async()=>{
  await master(`/academics/activities/${a.id}`,{version:a.version,procedureSupport:{...policy,maxFiles:2},changeKind:'editorial'},'PATCH',400);
  a=await master(`/academics/activities/${a.id}`,{version:a.version,procedureSupport:{...policy,maxFiles:2},changeKind:'evaluated',revisionPolicy:'repeat'},'PATCH');
  const data=await student(`/academics/activities/${a.id}`);assert.equal(data.mine.length,0);assert.equal(data.previous.length,1);assert.equal(data.previous[0].procedureSupport.maxFiles,1);await student.file(data.previous[0].files[0].url,200);
  await student(path,{...request,files:[pdf]},'POST',409);
  const draft=await student(path,{...request,requestId:'procedure-new-revision',activityRevision:a.revision,action:'draft',files:[pdf]},'POST',201);
  const replaced=await student(path,{...request,requestId:draft.requestId,activityRevision:a.revision,version:draft.version,retainFileIds:[],files:[{...pdf,name:'nuevo.pdf'}]},'POST',201);assert.equal(replaced.files[0].name,'nuevo.pdf');assert.equal((await readdir(join(root,'uploads'))).length,2);
  const entry=await master('/library',{kind:'activity',sourceId:a.id,title:'Actividad reutilizable',shared:true},'POST',201);
  const copy=await master(`/library/${entry.id}/use`,{courseId:g.id},'POST',201);assert.deepEqual((await master('/academics/activities/'+copy.id)).activity.procedureSupport,a.procedureSupport);
  await master(`/academics/activities/${a.id}`,{version:a.version},'DELETE');assert.equal((await readdir(join(root,'uploads'))).length,0);
 });
 await t.test('tasks and auto-graded quizzes support formats and configurable review',async()=>{
  for(const [name,bytes] of [['pagina.png',Buffer.from(png.base64,'base64')],['desarrollo.docx',Buffer.from([80,75,3,4,1,2,3,4])],['formulas.xlsx',Buffer.from([80,75,3,4,1,2,3,4])],['diapositivas.pptx',Buffer.from([80,75,3,4,1,2,3,4])],['tabla.csv',Buffer.from('operacion,resultado\n2+2,4')],['notas.txt',Buffer.from('Dos más dos es cuatro.')]]){
   const activity=await make({procedureSupport:{enabled:true,reviewRequired:false}});
   const result=await student(`/academics/activities/${activity.id}/submit`,{...request,files:[{name,base64:bytes.toString('base64')}]},'POST',201);assert.equal(result.procedureReviewPending,false);
   await master(`/academics/courses/${g.id}/release`,{});assert.equal((await student(`/academics/activities/${activity.id}`)).mine[0].points,1);
  }
  const task=await make({kind:'task',questions:[],procedureSupport:policy});
  await student(`/academics/activities/${task.id}/submit`,{...request,text:'Mi respuesta',url:'https://example.com/'},'POST',400);
  const taskResult=await student(`/academics/activities/${task.id}/submit`,{...request,text:'Mi respuesta',files:[pdf]},'POST',201);assert.equal(taskResult.procedureReviewPending,true);
  const oldQuiz=await make({procedureSupport:undefined});assert.equal(oldQuiz.procedureSupport.enabled,false);
  await student(`/academics/activities/${oldQuiz.id}/submit`,{...request,files:[pdf]},'POST',400);
  await student(`/academics/activities/${oldQuiz.id}/submit`,request,'POST',201);
  const oldTask=await make({kind:'task',questions:[],procedureSupport:undefined});await student(`/academics/activities/${oldTask.id}/submit`,{...request,text:'Respuesta sin archivo'},'POST',201);
 });
});
