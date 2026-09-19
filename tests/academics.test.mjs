import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/security.mjs';

function ok(r,status=200){assert.equal(r.status,status,r.text);return r.data;}
const future=()=>new Date(Date.now()+3600000).toISOString();
const past=()=>new Date(Date.now()-3600000).toISOString();
const pdf={name:'trabajo.pdf',base64:Buffer.from('%PDF-1.4\nEntrega de prueba').toString('base64')};
const questions=[{id:'q1',type:'single',prompt:'Dos más dos',options:['4','5'],correct:[0],points:1},{id:'q2',type:'multiple',prompt:'Pares',options:['2','3','4'],correct:[0,2],points:1}];
async function fixture(t,env={}){
 const dir=await mkdtemp(join(tmpdir(),'aula-academics-'));const password='Pruebas-locales-2026!';const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'50000001',ADMIN_PASSWORD:password,...env}});
 t.after(async()=>{await new Promise(r=>app.server.close(r));const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes('aula-academics-'));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const client=()=>({cookie:'',async call(path,method='GET',body,headers={}){const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:this.cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];const text=await r.text();let p;try{p=JSON.parse(text);}catch{}return {status:r.status,data:p?.data,text,headers:r.headers};}});
 const admin=client();ok(await admin.call('/auth/login','POST',{document:'50000001',password}));const course=ok(await admin.call('/admin/courses','POST',{title:'Evaluación de prueba',published:true,accessMode:'password'}),201);
 const hash=await hashPassword(password);const students=[];for(let i=0;i<2;i++){const id=randomUUID(),document=String(60000001+i),at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES (?,?,?,'student',?,?,?)").run(id,document,'Estudiante '+i,hash,at,at);ok(await admin.call('/admin/enrollments','POST',{studentId:id,courseId:course.id}),201);const c=client();ok(await c.call('/auth/login','POST',{document,password}));students.push({id,document,client:c});}
 return {...app,dir,admin,client,course,students,student:students[0].client,other:students[1].client,
  async activity(body={}){return ok(await admin.call(`/academics/courses/${course.id}/activities`,'POST',{title:'Actividad',kind:'task',status:'published',...body}),201);},
  submit(a,body={},who=students[0].client){return who.call(`/academics/activities/${a.id}/submit`,'POST',{requestId:randomUUID(),action:'submit',text:'Mi respuesta',...body});},
  grade(a,s,points,published=true){return admin.call(`/academics/submissions/${s.id}/grade`,'PATCH',{points,feedback:'Revisión del docente',published,version:s.version});},
  book(){return admin.call(`/academics/courses/${course.id}/gradebook`);}
 };
}
test('borradores, entrega idempotente y archivos privados mantienen historial y permisos',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100,maxAttempts:2});const key=randomUUID();let s=ok(await f.submit(a,{requestId:key,action:'draft',file:pdf}),201);assert.equal(s.state,'draft');assert.equal(s.points,null);
 const storage=ok(await f.admin.call('/academics/storage'));assert.equal(storage.usedBytes,Buffer.from(pdf.base64,'base64').length);assert.equal(storage.maxBytes,500*1024*1024);assert.equal(storage.fileMaxBytes,10*1024*1024);ok(await f.student.call('/academics/storage'),403);ok(await f.client().call('/academics/storage'),403);
 ok(await f.other.call(s.fileUrl.replace('/api','')),403);ok(await f.client().call(s.fileUrl.replace('/api','')),401);
 const file=await f.student.call(s.fileUrl.replace('/api',''));ok(file);assert.match(file.headers.get('content-disposition'),/attachment/);assert.match(file.text,/%PDF/);
 s=ok(await f.submit(a,{requestId:key,version:s.version}),201);assert.equal(s.fileName,'trabajo.pdf');assert.equal(s.state,'submitted');
 const repeated=ok(await f.submit(a,{requestId:key}));assert.equal(repeated.id,s.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions').get().n,1);
 const second=ok(await f.submit(a),201);assert.equal(second.attempt,2);ok(await f.submit(a),403);
 const response=ok(await f.admin.call(`/academics/activities/${a.id}/submissions`));assert.equal(response.submissions.length,2);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'DELETE'));assert.equal((await readdir(join(f.dir,'uploads'))).length,0);
});
test('cuestionarios se corrigen en servidor y nunca entregan claves ni notas sin publicar',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',questions,weight:100});const publicView=ok(await f.student.call(`/academics/activities/${a.id}`));assert.equal(publicView.activity.questions[0].correct,undefined);
 const s=ok(await f.submit(a,{text:'',answers:{q1:[0],q2:[0,2]},points:999,published:true}),201);assert.equal(s.points,null);assert.equal(s.state,'submitted');
 const teacher=ok(await f.admin.call(`/academics/activities/${a.id}/submissions`));assert.equal(teacher.submissions[0].points,2);assert.equal(teacher.submissions[0].published,false);
 ok(await f.other.call(`/academics/submissions/${s.id}/grade`,'PATCH',{points:2,published:true,version:1}),403);
 ok(await f.admin.call(`/academics/courses/${f.course.id}/release`,'POST',{}));const studentView=ok(await f.student.call(`/academics/activities/${a.id}`));assert.equal(studentView.mine[0].points,2);assert.equal(studentView.activity.questions[0].correct,undefined);
 ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,questions:[{...questions[0],correct:[1]}]}),409);
});
test('preguntas abiertas requieren revisión manual; múltiples requieren coincidencia completa',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',questions:[...questions,{id:'q3',type:'text',prompt:'Explica',points:3}]});ok(await f.submit(a,{text:'',answers:{q1:[0],q2:[0]}}),400);
 const s=ok(await f.submit(a,{text:'',answers:{q1:[0],q2:[0],q3:'Porque...'}}),201);const raw=f.db.prepare('SELECT points FROM submissions WHERE id=?').get(s.id);assert.equal(raw.points,null);
 ok(await f.grade(a,s,6),400);const graded=ok(await f.grade(a,s,0));assert.equal(graded.points,0);assert.equal(graded.published,true);
 const b=await f.activity({kind:'quiz',questions});ok(await f.submit(b,{text:'',answers:{q1:[0],q2:[0]}}),201);assert.equal(ok(await f.admin.call(`/academics/activities/${b.id}/submissions`)).submissions[0].points,1);
});
test('plazos se aplican también a API, borradores y preguntas antes de apertura',async t=>{
 const f=await fixture(t);const a=await f.activity({dueAt:past()});ok(await f.submit(a),403);ok(await f.submit(a,{action:'draft'}),403);
 const late=await f.activity({dueAt:past(),allowLate:true,closesAt:future()});assert.equal(ok(await f.submit(late),201).late,true);
 const closed=await f.activity({dueAt:past(),closesAt:past(),allowLate:true});ok(await f.submit(closed),403);
 const scheduled=await f.activity({kind:'quiz',questions,opensAt:future()});assert.deepEqual(ok(await f.student.call(`/academics/activities/${scheduled.id}`)).activity.questions,[]);ok(await f.submit(scheduled,{text:'',answers:{q1:[0],q2:[0,2]}}),403);
 ok(await f.admin.call(`/academics/courses/${f.course.id}/activities`,'POST',{title:'Fechas inválidas',opensAt:future(),dueAt:past()}),400);
});
test('nota ponderada, publicación privada, escala y última entrega invalidan cierre anterior',async t=>{
 const f=await fixture(t),a=await f.activity({weight:60,maxAttempts:2}),b=await f.activity({kind:'quiz',questions,weight:40});
 for(const student of [f.student,f.other]){const s=ok(await f.submit(a,{},student),201);ok(await f.grade(a,s,80,false));ok(await f.submit(b,{text:'',answers:{q1:[0],q2:[0]}},student),201);}
 let mine=ok(await f.student.call(`/academics/courses/${f.course.id}`));assert.equal(mine.grade.provisional,null);
 ok(await f.admin.call(`/academics/courses/${f.course.id}/settings`,'PUT',{finalPublished:true}),400);
 ok(await f.admin.call(`/academics/courses/${f.course.id}/release`,'POST',{}));ok(await f.admin.call(`/academics/courses/${f.course.id}/settings`,'PUT',{finalPublished:true}));
 mine=ok(await f.student.call(`/academics/courses/${f.course.id}`));assert.equal(mine.grade.final,3.4);assert.equal(mine.grade.provisional,3.4);assert.equal(mine.grade.cells.length,2);
 ok(await f.submit(a),201);mine=ok(await f.student.call(`/academics/courses/${f.course.id}`));assert.equal(mine.settings.finalPublished,false);assert.equal(mine.grade.final,null);assert.equal(mine.grade.cells.find(c=>c.activityId===a.id).points,null);
});
test('porcentajes y faltantes requieren decisión explícita sin transformar una entrega pendiente en cero',async t=>{
 const f=await fixture(t),a=await f.activity({weight:100});ok(await f.admin.call(`/academics/courses/${f.course.id}/activities`,'POST',{title:'Exceso',status:'published',weight:1}),400);
 ok(await f.admin.call(`/academics/courses/${f.course.id}/settings`,'PUT',{missingAsZero:true,finalPublished:true}),400);
 const s=ok(await f.submit(a),201);ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,dueAt:past()}));ok(await f.admin.call(`/academics/courses/${f.course.id}/settings`,'PUT',{missingAsZero:true,finalPublished:true}),400);
 ok(await f.grade(a,s,50));ok(await f.admin.call(`/academics/courses/${f.course.id}/settings`,'PUT',{missingAsZero:true,finalPublished:true}));const book=ok(await f.book());assert.equal(book.students.find(x=>x.id===f.students[1].id).final,0);assert.equal(book.students.find(x=>x.id===f.students[0].id).final,2.5);
});
test('permisos requieren matrícula, contraseña, curso publicado y cambio inicial completo',async t=>{
 const f=await fixture(t),a=await f.activity();ok(await f.student.call(`/academics/courses/${f.course.id}/gradebook`),403);ok(await f.student.call(`/academics/courses/${f.course.id}/activities`,'POST',{title:'Intruso'}),403);
 ok(await f.student.call(`/academics/activities/${a.id}/submissions`),403);ok(await f.admin.call(`/academics/courses/${f.course.id}/release`,'POST',{}, {Origin:'https://otro.example'}),403);
 f.db.prepare("UPDATE sessions SET assurance='document' WHERE user_id=?").run(f.students[0].id);ok(await f.student.call(`/academics/activities/${a.id}`),403);
 f.db.prepare("UPDATE sessions SET assurance='password' WHERE user_id=?").run(f.students[0].id);f.db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(f.students[0].id);ok(await f.student.call('/academics/courses'),403);
 f.db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(f.students[0].id);f.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=?").run(f.students[0].id);ok(await f.submit(a),403);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'PATCH',{published:false}));ok(await f.other.call(`/academics/activities/${a.id}`),404);
});
test('archivos validan formato, límite total y sustitución sin huérfanos',async t=>{
 const f=await fixture(t,{SUBMISSIONS_MAX_BYTES:'100'}),a=await f.activity();ok(await f.submit(a,{file:{name:'x.html',base64:Buffer.from('<script>x</script>').toString('base64')}}),400);ok(await f.submit(a,{file:{name:'x.pdf',base64:Buffer.from('falso').toString('base64')}}),400);
 ok(await f.submit(a,{file:{name:'../x.pdf',base64:pdf.base64}}),400);ok(await f.submit(a,{file:{name:'largo.pdf',base64:Buffer.from('%PDF-'+'.'.repeat(110)).toString('base64')}}),413);
 const key=randomUUID();let s=ok(await f.submit(a,{action:'draft',requestId:key,file:pdf}),201);s=ok(await f.submit(a,{action:'draft',requestId:key,version:s.version,file:{name:'tabla.xlsx',base64:Buffer.from([0x50,0x4b,3,4,1,2,3,4]).toString('base64')}}),201);assert.equal((await readdir(join(f.dir,'uploads'))).length,1);assert.equal(s.fileName,'tabla.xlsx');
 s=ok(await f.submit(a,{action:'draft',requestId:key,version:s.version,removeFile:true}),201);assert.equal(s.fileName,null);assert.equal((await readdir(join(f.dir,'uploads'))).length,0);
});
test('el contenido del curso ubica actividades por capítulo sin filtrar respuestas ni notas',async t=>{
 const f=await fixture(t);for(const id of ['chapter-one','chapter-two'])f.db.prepare('INSERT INTO modules(id,course_id,title) VALUES (?,?,?)').run(id,f.course.id,id);
 const a=await f.activity({title:'Tarea del capítulo',moduleId:'chapter-one'}),quiz=await f.activity({kind:'quiz',questions,moduleId:'chapter-two'}),draft=await f.activity({status:'draft',moduleId:'chapter-one'}),archived=await f.activity({status:'archived'}),general=await f.activity();
 const detail=()=>f.student.call(`/courses/${f.course.id}`);
 let c=ok(await detail());assert.equal(c.activities.length,3);assert.equal(c.activities.find(x=>x.id===a.id).moduleId,'chapter-one');assert.equal(c.activities.find(x=>x.id===general.id).moduleId,null);
 assert.deepEqual(Object.keys(c.activities.find(x=>x.id===quiz.id)).sort(),['id','moduleId','title','kind','status','weight','dueAt','opensAt','closesAt','submitted'].sort());
 assert.equal(ok(await f.admin.call(`/courses/${f.course.id}`)).activities.length,5);
 const submitted=ok(await f.submit(a),201);ok(await f.grade(a,submitted,90,false));c=ok(await detail());assert.equal(c.activities.find(x=>x.id===a.id).submitted,true);assert.equal(ok(await f.other.call(`/courses/${f.course.id}`)).activities.find(x=>x.id===a.id).submitted,false);
 ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,moduleId:'chapter-two'}));assert.equal(ok(await detail()).activities.find(x=>x.id===a.id).moduleId,'chapter-two');
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'PATCH',{accessMode:'public'}));assert.deepEqual(ok(await f.client().call(`/courses/${f.course.id}`)).activities,[]);
 f.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=?").run(f.students[0].id);assert.deepEqual(ok(await detail()).activities,[]);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'PATCH',{accessMode:'document'}));f.db.prepare("UPDATE sessions SET assurance='document' WHERE user_id=?").run(f.students[1].id);const documentView=ok(await f.other.call(`/courses/${f.course.id}`));assert.equal(documentView.activities.length,3);assert.ok(documentView.activities.every(x=>!x.submitted));
});

test('reintentos simultáneos no duplican y versiones evitan sobrescribir calificaciones',async t=>{
 const f=await fixture(t),a=await f.activity(),key=randomUUID();const results=await Promise.all([f.submit(a,{requestId:key}),f.submit(a,{requestId:key})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].data.id,results[1].data.id);const s=results[0].data;ok(await f.grade(a,s,90));ok(await f.grade(a,s,10),409);
 const draft=await f.activity({status:'draft'});ok(await f.student.call(`/academics/activities/${draft.id}`),404);const r=await f.admin.call(`/academics/activities/${draft.id}`,'PATCH',{version:999,title:'Otro'});ok(r,409);
});
