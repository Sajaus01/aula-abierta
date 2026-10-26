import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import JSZip from 'jszip';
import {createSubmissionExports,exportSegment} from '../server/submission-exports.mjs';
import {createApp} from '../server/index.mjs';

async function fixture(t) {
 const dir=await mkdtemp(join(tmpdir(),'aula-export-')),uploadsDir=join(dir,'uploads');await mkdir(uploadsDir);
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE courses(id TEXT PRIMARY KEY,title TEXT);CREATE TABLE activities(id TEXT PRIMARY KEY,course_id TEXT,config TEXT,created_at TEXT);CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE activity_files(id TEXT PRIMARY KEY,activity_id TEXT,file_key TEXT,name TEXT,position INTEGER);CREATE TABLE activity_versions(activity_id TEXT,revision INTEGER,files TEXT);
 CREATE TABLE submissions(id TEXT PRIMARY KEY,activity_id TEXT,student_id TEXT,attempt INTEGER,revision INTEGER,superseded INTEGER,state TEXT,payload TEXT,submitted_at TEXT,updated_at TEXT,returned_at TEXT);`);
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 db.prepare('INSERT INTO courses VALUES(?,?)').run('group-1','Mecánica / grupo A');db.prepare('INSERT INTO courses VALUES(?,?)').run('group-2','Grupo ajeno');
 const config={title:'Tarea: movimiento',description:'Indicaciones de prueba',questions:[]};
 db.prepare('INSERT INTO activities VALUES(?,?,?,?)').run('task-1','group-1',JSON.stringify(config),'2026-10-01');
 db.prepare('INSERT INTO activities VALUES(?,?,?,?)').run('quiz-1','group-1',JSON.stringify({title:'Cuestionario',questions:[{id:'q1',prompt:'Dos más dos',options:['4','5'],correct:[0]},{id:'q2',prompt:'Explica el procedimiento',type:'text'}]}),'2026-10-02');
 db.prepare('INSERT INTO activities VALUES(?,?,?,?)').run('foreign-1','group-2',JSON.stringify({title:'Privada'}),'2026-10-02');
 for(const id of ['student-a','student-b'])db.prepare('INSERT INTO users VALUES(?,?)').run(id,'Estudiante / igual');
 const audits=[];
 const exporter=createSubmissionExports({db,uploadsDir,fail,audit:(...args)=>audits.push(args),requireAdmin:auth=>{if(auth.user.role!=='admin')fail(403,'Acceso docente requerido');},requireCourse:id=>{const c=db.prepare('SELECT * FROM courses WHERE id=?').get(id);if(!c)fail(404,'Curso no encontrado');return c;},accessModel:{requireScope:(auth,id,action)=>{assert.equal(action,'grade');if(id!=='group-1'||auth.user.id==='viewer')fail(403,'Sin permiso para calificar');}}});
 const server=http.createServer(async(req,res)=>{try{const auth={user:{id:req.headers['x-user']||'teacher',role:req.headers['x-role']||'admin'},assurance:'password',preview:req.headers['x-preview']};if(!await exporter.handler(req,res,new URL(req.url,'http://localhost').pathname,req.method,auth)){res.statusCode=404;res.end();}}catch(e){if(res.headersSent)res.destroy();else{res.statusCode=e.status||500;res.end(e.message);}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));db.close();const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes('aula-export-'));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const insert=(id,activityId,studentId,attempt,payload,extra={})=>db.prepare('INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,activityId,studentId,attempt,extra.revision||1,extra.superseded||0,extra.state||'submitted',JSON.stringify(payload),'2026-10-20T15:00:00.000Z','2026-10-20T15:00:00.000Z',null);
 return {db,dir,uploadsDir,insert,audits,fetch:(path,options)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,options)};
}
const groupPath='/api/academics/courses/group-1/download',activityPath='/api/academics/activities/task-1/download';

test('ZIP de grupo: una carpeta por estudiante, todos los intentos, respuestas y archivos sin sobreescribir nombres',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.uploadsDir,'one'),'primer archivo');await writeFile(join(f.uploadsDir,'two'),'segundo archivo');await writeFile(join(f.uploadsDir,'guide'),'instrucciones');
 f.db.prepare('INSERT INTO activity_files VALUES(?,?,?,?,?)').run('guide-id','task-1','guide','Guía.pdf',0);
 f.insert('s1','task-1','student-a',1,{text:'Primer intento',files:[{key:'one',name:'archivo.dwg'},{key:'two',name:'archivo.dwg'}]});
 f.insert('s2','task-1','student-a',2,{text:'Avance conservado',file:{key:'two',name:'anterior.dwg'}},{state:'draft'});
 f.insert('s3','task-1','student-a',1,{text:'Versión histórica'},{revision:2,superseded:1});
 f.insert('s4','quiz-1','student-a',1,{answers:{q1:[0],q2:'Por suma'}});
 f.insert('s5','task-1','student-b',1,{text:'Otro estudiante'});
 f.insert('private','foreign-1','student-a',1,{text:'No debe incluirse'});
 const response=await f.fetch(groupPath);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/attachment;.*filename\*=UTF-8/);
 const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.includes(Buffer.from([0x50,0x4b,0x06,0x06])),'ZIP64 is enabled');
 const zip=await JSZip.loadAsync(bytes),paths=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
 const students=new Set(paths.filter(p=>p.startsWith('Estudiante')).map(p=>p.split('/')[0]));assert.equal(students.size,2,'Two same-named students keep separate stable folders');
 const answers=paths.filter(p=>p.endsWith('/Respuesta.txt'));assert.equal(answers.length,5,'Every attempt, draft and historical response is exported');
 const text=(await Promise.all(answers.map(p=>zip.file(p).async('string')))).join('\n');assert.match(text,/Primer intento/);assert.match(text,/Avance conservado/);assert.match(text,/Versión histórica/);assert.match(text,/1\. 4/);assert.match(text,/Por suma/);assert.ok(!text.includes('No debe incluirse'));
 const files=paths.filter(p=>p.includes('/Archivos/'));assert.equal(files.length,3);assert.equal(new Set(files).size,3);assert.deepEqual((await Promise.all(files.map(p=>zip.file(p).async('string')))).sort(),['primer archivo','segundo archivo','segundo archivo']);
 assert.ok(paths.some(p=>p.startsWith('Instrucciones/')&&p.endsWith('/Guía.pdf')));assert.equal(f.audits.length,1);
});

test('ZIP de actividad conserva enunciados históricos y reporta archivos ausentes o rutas inválidas',async t=>{
 const f=await fixture(t);await writeFile(join(f.uploadsDir,'old-guide'),'enunciado histórico');await writeFile(join(f.dir,'outside.txt'),'privado fuera de uploads');
 f.db.prepare('INSERT INTO activity_versions VALUES(?,?,?)').run('task-1',1,JSON.stringify([{key:'old-guide',name:'Enunciado original.pdf'}]));
 f.insert('s1','task-1','student-a',1,{text:'Respuesta incluida',files:[{key:'not-here',name:'Falta.pdf'},{key:'../outside.txt',name:'../../escape.txt'},{key:'..\\outside.txt',name:'CON'}]});
 f.insert('s2','quiz-1','student-a',1,{text:'Solo en grupo'});
 const response=await f.fetch(activityPath);assert.equal(response.status,200);const zip=await JSZip.loadAsync(await response.arrayBuffer()),paths=Object.keys(zip.files);
 assert.ok(paths.some(p=>p.startsWith('Instrucciones/')&&p.includes('Version 1/Enunciado original.pdf')));
 assert.equal(paths.filter(p=>p.endsWith('/Respuesta.txt')).length,1);assert.ok(paths.every(p=>!p.split('/').includes('..')&&!p.includes('\\')));
 const readme=await zip.file('LEEME.txt').async('string');assert.match(readme,/Archivos no disponibles \(3\)/);const allText=(await Promise.all(Object.values(zip.files).filter(v=>!v.dir).map(v=>v.async('string')))).join('\n');assert.ok(!allText.includes('privado fuera de uploads'));
});

test('descargas privadas exigen permiso de calificación, rechazan estudiantes y vista previa; HEAD no inicia exportación',async t=>{
 const f=await fixture(t);
 for(const headers of [{'x-role':'student'},{'x-user':'viewer'},{'x-preview':'1'}])assert.equal((await f.fetch(groupPath,{headers})).status,403);
 assert.equal((await f.fetch('/api/academics/courses/group-2/download')).status,403);assert.equal((await f.fetch('/api/academics/activities/foreign-1/download')).status,403);
 assert.equal((await f.fetch('/api/academics/activities/missing/download')).status,404);
 const head=await f.fetch(groupPath,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(f.audits.length,0);
 const empty=await f.fetch(groupPath),zip=await JSZip.loadAsync(await empty.arrayBuffer());assert.ok(zip.file('LEEME.txt'));assert.match(await zip.file('LEEME.txt').async('string'),/Estudiantes con respuestas: 0/);
});

test('segmentos ZIP son compatibles con rutas de Windows sin permitir directorios inyectados',()=>{
 assert.equal(exportSegment('../../archivo.txt'),'..-..-archivo.txt');assert.equal(exportSegment('CON'),'_CON');assert.equal(exportSegment('aux.txt'),'_aux.txt');assert.equal(exportSegment(' . '),'Archivo');assert.ok(!exportSegment('a\\b/c').includes('\\'));assert.ok(exportSegment('x'.repeat(300)).length<=100);
});

test('integración v2: docente calificador descarga archivos reales; docente editor, estudiante, otro grupo y vista previa no acceden',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aula-export-v2-')),password='Export-Synthetic-2026!';
 const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99040001',ADMIN_PASSWORD:password}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{await new Promise(r=>app.server.close(r));const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.includes('aula-export-v2-'));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 function client(){let cookie='';return {async raw(path,options={}){return fetch(base+'/api'+path,{...options,headers:{Cookie:cookie,...options.headers}});},async json(path,body,method=body?'POST':'GET',status=200){const r=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data.data;}};}
 const master=client();await master.json('/auth/login',{document:'99040001',password});
 const template=await master.json('/admin/courses',{title:'Curso para exportación'},'POST',201),group=await master.json(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo para exportación',cohort:'2026-2',code:'ZIP'},'POST',201);
 await master.json(`/platform/courses/${group.id}/state`,{state:'active'});
 const foreign=await master.json(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Otro grupo',cohort:'2026-2',code:'OTRO'},'POST',201);
 const activity=await master.json(`/academics/courses/${group.id}/activities`,{title:'Entrega para descargar',kind:'task',status:'published'},'POST',201);
 const hash=app.db.prepare("SELECT password_hash FROM users WHERE document='99040001'").get().password_hash,at=new Date().toISOString();
 const people=[['grader','99040002','teacher'],['editor','99040003','teacher'],['learner','99040004','student']];
 for(const [id,document,role]of people){app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES(?,?,?,'student',?,?,?)").run(id,document,'Persona sintética '+id,hash,at,at);app.db.prepare('INSERT OR IGNORE INTO user_roles VALUES(?,?)').run(id,role);}
 app.db.prepare('INSERT INTO course_staff VALUES(?,?,?,?,?)').run(group.id,'grader',0,1,0);app.db.prepare('INSERT INTO course_staff VALUES(?,?,?,?,?)').run(group.id,'editor',1,0,0);
 await master.json('/admin/enrollments',{courseId:group.id,studentId:'learner'},'POST',201);
 await writeFile(join(dir,'uploads','real-export.pdf'),'contenido entregado');
 app.db.prepare("INSERT INTO submissions(id,activity_id,student_id,request_key,attempt,state,payload,updated_at) VALUES(?,?,?,'export-request',1,'submitted',?,?)").run('real-submission',activity.id,'learner',JSON.stringify({text:'Respuesta real de prueba',files:[{id:'real-file',key:'real-export.pdf',name:'Procedimiento.pdf',mime:'application/pdf',size:19}]}),at);
 const grader=client(),editor=client(),student=client();await grader.json('/auth/login',{document:'99040002',password});await editor.json('/auth/login',{document:'99040003',password});await student.json('/auth/login',{document:'99040004',password});
 for(const endpoint of [`/academics/activities/${activity.id}/download`,`/academics/courses/${group.id}/download`]){
  const allowed=await grader.raw(endpoint);assert.equal(allowed.status,200);const zip=await JSZip.loadAsync(await allowed.arrayBuffer()),file=Object.values(zip.files).find(v=>v.name.endsWith('/Procedimiento.pdf'));assert.ok(file);assert.equal(await file.async('string'),'contenido entregado');
  assert.equal((await editor.raw(endpoint)).status,403);assert.equal((await student.raw(endpoint)).status,403);assert.equal((await grader.raw(endpoint,{headers:{'X-Aula-Preview':group.id}})).status,403);
 }
 assert.equal((await grader.raw(`/academics/courses/${foreign.id}/download`)).status,403);
 assert.equal((await client().raw(`/academics/courses/${group.id}/download`)).status,403);
});
