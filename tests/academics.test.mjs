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
const photo={name:'respuesta.png',base64:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')};

test('enunciados adjuntos y enlaces conservan privacidad, apertura y vista previa',async t=>{
 const f=await fixture(t);let a=await f.activity({instructionUrl:'https://example.org/preguntas',attachments:[pdf,photo]});
 assert.equal(a.attachments.length,2);assert.ok(!JSON.stringify(a).includes('file_key'));assert.ok(!JSON.stringify(a).includes('base64'));
 let view=ok(await f.student.call(`/academics/activities/${a.id}`)).activity;assert.equal(view.instructionUrl,'https://example.org/preguntas');assert.equal(view.attachments.length,2);
 const url=a.attachments[0].url.slice(4);let response=await f.student.call(url);ok(response);assert.match(response.headers.get('content-disposition'),/^inline/);assert.equal(response.headers.get('cache-control'),'no-store');
 response=await f.student.call(url+'?download=1');ok(response);assert.match(response.headers.get('content-disposition'),/^attachment/);ok(await f.student.call(url,'HEAD'));
 ok(await f.client().call(url),401);f.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=?").run(f.students[1].id);ok(await f.other.call(url),403);
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,opensAt:future()}));
 view=ok(await f.student.call(`/academics/activities/${a.id}`)).activity;assert.deepEqual(view.attachments,[]);assert.equal(view.instructionUrl,'');ok(await f.student.call(url),403);ok(await f.admin.call(url));
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,status:'draft'}));ok(await f.student.call(url),404);
 ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,instructionUrl:'javascript:alert(1)'}),400);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'DELETE'));assert.equal((await readdir(join(f.dir,'uploads'))).length,0);
});

test('editar adjuntos respeta versiones, valida pertenencia y revierte fallos sin archivos huérfanos',async t=>{
 const f=await fixture(t);let a=await f.activity({attachments:[pdf,photo]});const other=await f.activity({attachments:[pdf]});
 const endpoint=`/academics/activities/${a.id}`;const original=a.attachments[0].url.slice(4);
 ok(await f.admin.call(endpoint,'PATCH',{version:a.version,retainAttachmentIds:[other.attachments[0].id]}),400);
 ok(await f.admin.call(endpoint,'PATCH',{version:0,attachments:[pdf]}),409);
 ok(await f.admin.call(endpoint,'PATCH',{version:a.version,attachments:Array(4).fill(pdf)}),400);
 ok(await f.admin.call(endpoint,'PATCH',{version:a.version,attachments:[{name:'malo.html',base64:Buffer.from('<script>x</script>').toString('base64')}]}),400);
 assert.equal((await readdir(join(f.dir,'uploads'))).length,3);
 f.db.exec("CREATE TRIGGER reject_material BEFORE INSERT ON activity_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 ok(await f.admin.call(endpoint,'PATCH',{version:a.version,retainAttachmentIds:[],attachments:[pdf]}),500);assert.equal((await readdir(join(f.dir,'uploads'))).length,3);ok(await f.student.call(original));
 f.db.exec('DROP TRIGGER reject_material');
 a=ok(await f.admin.call(endpoint,'PATCH',{version:a.version,retainAttachmentIds:[a.attachments[1].id],attachments:[{...pdf,name:'nuevo.pdf'}]}));assert.equal(a.attachments.length,2);ok(await f.student.call(original),404);assert.equal((await readdir(join(f.dir,'uploads'))).length,3);
});

test('varios archivos de respuesta: borrador, retiro, envío, historial y revisión privada',async t=>{
 const f=await fixture(t),a=await f.activity({attachments:[pdf],maxAttempts:2});const key=randomUUID();
 let s=ok(await f.submit(a,{requestId:key,action:'draft',text:'',files:[pdf,photo]}),201);assert.equal(s.files.length,2);
 const removed=s.files[0].url.slice(4),kept=s.files[1].id;
 ok(await f.other.call(removed),403);ok(await f.student.call(removed));ok(await f.admin.call(removed));
 ok(await f.submit(a,{requestId:key,version:s.version,action:'draft',retainFileIds:['foreign']}),400);
 s=ok(await f.submit(a,{requestId:key,version:s.version,action:'draft',text:'',retainFileIds:[kept],files:[{...pdf,name:'respuestas.pdf'}]}),201);assert.equal(s.files.length,2);ok(await f.student.call(removed),404);
 const submitted=ok(await f.submit(a,{requestId:key,version:s.version,text:'',retainFileIds:s.files.map(f=>f.id)}),201);assert.equal(submitted.state,'submitted');
 assert.equal(ok(await f.submit(a,{requestId:key,files:[pdf]})).id,submitted.id,'Un reintento no añade archivos ni duplica la entrega');
 const next=ok(await f.submit(a,{text:'',files:[photo]}),201);assert.equal(next.attempt,2);assert.equal(ok(await f.student.call(`/academics/activities/${a.id}`)).mine.length,2);
 const size=Buffer.from(pdf.base64,'base64').length+2*Buffer.from(photo.base64,'base64').length;assert.equal(ok(await f.admin.call('/academics/storage')).usedBytes,size);
 ok(await f.grade(a,next,90));assert.equal(ok(await f.student.call(`/academics/activities/${a.id}`)).mine[0].points,90);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'DELETE'));assert.equal((await readdir(join(f.dir,'uploads'))).length,0);
});

test('límites múltiples, archivos antiguos y cuestionarios mantienen compatibilidad',async t=>{
 const f=await fixture(t,{SUBMISSIONS_MAX_BYTES:'100'}),a=await f.activity();
 ok(await f.submit(a,{files:Array(6).fill(pdf)}),400);
 ok(await f.submit(a,{files:[{...pdf,base64:Buffer.from('%PDF-'+'.'.repeat(90)).toString('base64')},photo]}),413);
 const quiz=await f.activity({kind:'quiz',questions});ok(await f.submit(quiz,{text:'',answers:{q1:[0],q2:[0,2]},files:[photo]}),400);
 let s=ok(await f.submit(a,{action:'draft',file:pdf}),201);
 const raw=f.db.prepare('SELECT payload FROM submissions WHERE id=?').get(s.id);const p=JSON.parse(raw.payload);p.file=p.files[0];delete p.files;f.db.prepare('UPDATE submissions SET payload=? WHERE id=?').run(JSON.stringify(p),s.id);
 s=ok(await f.student.call(`/academics/activities/${a.id}`)).mine[0];assert.equal(s.files.length,1);ok(await f.student.call(s.fileUrl.slice(4)));ok(await f.student.call(s.files[0].url.slice(4)));
 s=ok(await f.submit(a,{requestId:s.requestId,version:s.version,action:'draft',files:[photo],retainFileIds:s.files.map(f=>f.id)}),201);assert.equal(s.files.length,2);
});
async function fixture(t,env={}){
 const dir=await mkdtemp(join(tmpdir(),'aula-academics-'));const password='Pruebas-locales-2026!';const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'50000001',ADMIN_PASSWORD:password,...env}});
 t.after(async()=>{await new Promise(r=>app.server.close(r));const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes('aula-academics-'));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const client=()=>({cookie:'',async call(path,method='GET',body,headers={}){const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:this.cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];const text=await r.text();let p;try{p=JSON.parse(text);}catch{}return {status:r.status,data:p?.data,text,headers:r.headers};}});
 const admin=client();ok(await admin.call('/auth/login','POST',{document:'50000001',password}));const course=ok(await admin.call('/admin/courses','POST',{title:'Evaluación de prueba',published:true,accessMode:'password'}),201);
 const hash=await hashPassword(password);const students=[];for(let i=0;i<2;i++){const id=randomUUID(),document=String(60000001+i),at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES (?,?,?,'student',?,?,?)").run(id,document,'Estudiante '+i,hash,at,at);ok(await admin.call('/admin/enrollments','POST',{studentId:id,courseId:course.id}),201);const c=client();ok(await c.call('/auth/login','POST',{document,password}));students.push({id,document,client:c});}
 return {...app,dir,admin,client,course,students,student:students[0].client,other:students[1].client,
  async activity(body={}){return ok(await admin.call(`/academics/courses/${course.id}/activities`,'POST',{title:'Actividad',kind:'task',status:'published',...body}),201);},
  submit(a,body={},who=students[0].client){return who.call(`/academics/activities/${a.id}/submit`,'POST',{activityRevision:a.revision??1,requestId:randomUUID(),action:'submit',text:'Mi respuesta',...body});},
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
 const edited=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,questions:[{...questions[0],correct:[1]}]}));assert.equal(edited.resubmissionRequired,true);
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

test('editar una actividad respondida conserva historial privado y exige una nueva entrega',async t=>{
 const f=await fixture(t);let a=await f.activity({kind:'quiz',questions,weight:100});
 const s=ok(await f.submit(a,{text:'',answers:{q1:[0],q2:[0,2]}}),201);ok(await f.grade(a,s,2));
 const draft=ok(await f.submit(a,{text:'',action:'draft',answers:{q1:[0]}},f.other),201);
 const oldVersion=a.version;
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,kind:'task',maxPoints:50,description:'Nuevo enunciado',attachments:[pdf]}));
 assert.equal(a.revision,2);assert.equal(a.resubmissionRequired,true);assert.equal(a.activeResponseCount,0);
 const data=ok(await f.student.call(`/academics/activities/${a.id}`));assert.equal(data.mine.length,0);assert.equal(data.previous.length,1);assert.equal(data.previous[0].previousActivity.maxPoints,2);assert.equal(data.previous[0].previousActivity.questions[0].correct,undefined);assert.equal(data.previous[0].points,2);
 const other=ok(await f.other.call(`/academics/activities/${a.id}`));assert.equal(other.previous[0].id,draft.id);assert.equal(other.mine.length,0);
 const g=ok(await f.student.call(`/academics/courses/${f.course.id}`)).grade;assert.equal(g.cells[0].state,'pending');assert.equal(g.provisional,null);
 assert.equal(ok(await f.student.call(`/courses/${f.course.id}`)).activities[0].submitted,false);
 assert.equal(ok(await f.student.call('/academics/courses'))[0].activities[0].state,'Pendiente');
 ok(await f.submit(a,{activityRevision:1,requestId:s.requestId}),409);ok(await f.submit(a,{requestId:s.requestId}),409);ok(await f.grade(a,s,20),409);
 ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:oldVersion,title:'Edición atrasada'}),409);
 const fresh=ok(await f.submit(a,{files:[photo]}),201);assert.equal(fresh.attempt,1);assert.equal(fresh.revision,2);ok(await f.grade(a,fresh,40));
 assert.equal(ok(await f.student.call(`/academics/courses/${f.course.id}`)).grade.provisional,4);
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,description:'Tercer enunciado'}));assert.equal(a.revision,3);assert.equal(ok(await f.student.call(`/academics/activities/${a.id}`)).previous.length,2);assert.equal(ok(await f.submit(a),201).attempt,1);
});

test('cambios administrativos conservan respuestas; nueva entrega explícita reabre plazos vencidos',async t=>{
 const f=await fixture(t);let a=await f.activity({attachments:[pdf]});const s=ok(await f.submit(a),201);
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,weight:50,dueAt:past(),closesAt:past()}));assert.equal(a.resubmissionRequired,false);assert.equal(a.revision,1);assert.equal(ok(await f.student.call(`/academics/activities/${a.id}`)).mine[0].id,s.id);
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,requestResubmission:true}));assert.equal(a.reopened,true);assert.equal(a.dueAt,null);assert.equal(a.closesAt,null);assert.equal(a.revision,2);ok(await f.submit(a),201);
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,retainAttachmentIds:[]}));assert.equal(a.resubmissionRequired,true);assert.equal(a.revision,3);
});

test('eliminar actividad borra entregas vigentes e históricas, adjuntos y nota; conserva el resto del curso',async t=>{
 const f=await fixture(t);let a=await f.activity({weight:100,attachments:[pdf,photo]});const keep=await f.activity({attachments:[photo]});
 let s=ok(await f.submit(a,{files:[pdf,photo]}),201);const oldFile=s.files[0].url.slice(4);ok(await f.grade(a,s,80));
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,description:'Versión nueva'}));s=ok(await f.submit(a,{files:[pdf]}),201);ok(await f.grade(a,s,90));
 ok(await f.submit(a,{action:'draft',files:[photo]},f.other),201);
 const endpoint=`/academics/activities/${a.id}`;
 ok(await f.student.call(endpoint,'DELETE',{version:a.version}),403);ok(await f.admin.call(endpoint,'DELETE',{version:0}),409);ok(await f.admin.call(endpoint,'DELETE',{version:a.version},{Origin:'https://other.example'}),403);
 f.db.exec("CREATE TRIGGER reject_activity_delete BEFORE DELETE ON activities BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 ok(await f.admin.call(endpoint,'DELETE',{version:a.version}),500);ok(await f.student.call(oldFile));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n,3);
 f.db.exec('DROP TRIGGER reject_activity_delete');
 ok(await f.admin.call(endpoint,'DELETE',{version:a.version}));ok(await f.admin.call(endpoint),404);ok(await f.student.call(oldFile),404);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(a.id).n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activity_files WHERE activity_id=?').get(a.id).n,0);
 assert.equal((await readdir(join(f.dir,'uploads'))).length,1);assert.equal(ok(await f.admin.call('/academics/storage')).usedBytes,0);assert.equal(ok(await f.book()).activities.length,1);assert.equal(ok(await f.book()).settings.finalPublished,false);ok(await f.admin.call(`/academics/activities/${keep.id}`));
});

test('edición fallida no archiva respuestas y publicar notas no altera historial',async t=>{
 const f=await fixture(t);let a=await f.activity({attachments:[pdf]});const s=ok(await f.submit(a,{files:[photo]}),201);ok(await f.grade(a,s,90,false));
 f.db.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON activity_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,title:'Cambiar',attachments:[photo]}),500);
 assert.equal(ok(await f.student.call(`/academics/activities/${a.id}`)).mine.length,1);assert.equal((await readdir(join(f.dir,'uploads'))).length,2);
 f.db.exec('DROP TRIGGER reject_revision');
 a=ok(await f.admin.call(`/academics/activities/${a.id}`,'PATCH',{version:a.version,title:'Cambiar'}));ok(await f.admin.call(`/academics/courses/${f.course.id}/release`,'POST',{}));
 const pastView=ok(await f.student.call(`/academics/activities/${a.id}`)).previous[0];assert.equal(pastView.points,null);assert.equal(pastView.feedback,'');assert.equal(pastView.published,false);
});

