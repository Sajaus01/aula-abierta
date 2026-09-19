import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server/index.mjs';
import {hashPassword} from '../server/security.mjs';
import {youtubeThumbnail} from '../public/quick-resources.js';
const ok=(r,status=200)=>{assert.equal(r.status,status,r.text);return r.data;};
const pdf={name:'guia.pdf',base64:Buffer.from('%PDF-1.4\nGuía de prueba').toString('base64')};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-quick-')),password='Pruebas-recursos-2026!';const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'50000001',ADMIN_PASSWORD:password}});
 t.after(async()=>{await new Promise(r=>app.server.close(r));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('aula-quick-'));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const client=()=>({cookie:'',async call(path,method='GET',body,headers={}){const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:this.cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];const text=await r.text();let p;try{p=JSON.parse(text);}catch{}return {status:r.status,text,data:p?.data,headers:r.headers};}});
 const admin=client();ok(await admin.call('/auth/login','POST',{document:'50000001',password}));const course=ok(await admin.call('/admin/courses','POST',{title:'Curso con recursos rápidos',published:true,accessMode:'password'}),201);
 const at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES ('student','60000001','Estudiante','student',?,?,?)").run(await hashPassword(password),at,at);
 ok(await admin.call('/admin/enrollments','POST',{studentId:'student',courseId:course.id}),201);const student=client();ok(await student.call('/auth/login','POST',{document:'60000001',password}));
 return {...app,dir,admin,student,client,course,create:body=>admin.call(`/admin/courses/${course.id}/quick-resources`,'POST',{title:'Recurso',kind:'link',url:'https://example.com',...body}),edit:(r,b)=>admin.call(`/admin/quick-resources/${r.id}`,'PATCH',{version:r.version,...b}),detail:who=>(who||student).call(`/courses/${course.id}`)};
}
test('recursos rápidos respetan curso, publicación, matrícula y permisos docentes',async t=>{
 const f=await fixture(t),a=ok(await f.create({title:'Tutorial',kind:'video',url:'https://youtu.be/dQw4w9WgXcQ',description:'Instalación'}),201),hidden=ok(await f.create({visible:false}),201);
 assert.deepEqual(ok(await f.detail()).quickResources.map(r=>r.id),[a.id]);assert.equal(ok(await f.detail(f.admin)).quickResources.length,2);
 ok(await f.client().call(`/courses/${f.course.id}`),401);ok(await f.student.call(`/admin/courses/${f.course.id}/quick-resources`,'POST',{title:'Intruso'}),403);
 ok(await f.admin.call(`/admin/quick-resources/${a.id}`,'PATCH',{version:a.version,title:'CSRF'},{Origin:'https://otro.example'}),403);
 f.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id='student'").run();ok(await f.detail(),403);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'PATCH',{accessMode:'public'}));assert.equal(ok(await f.detail(f.client())).quickResources.length,1);
 ok(await f.admin.call(`/admin/courses/${f.course.id}`,'PATCH',{published:false}));ok(await f.detail(f.client()),404);
});
test('orden, edición, ocultar, versiones y límite de recursos',async t=>{
 const f=await fixture(t),a=ok(await f.create({title:'Primero'}),201),b=ok(await f.create({title:'Segundo'}),201);
 const moved=ok(await f.edit(b,{move:'up'}));assert.deepEqual(ok(await f.detail()).quickResources.map(r=>r.title),['Segundo','Primero']);
 ok(await f.edit(b,{title:'Versión obsoleta'}),409);const edited=ok(await f.edit(moved,{title:'Nuevo rótulo',description:'Descripción útil',visible:false}));assert.equal(ok(await f.detail()).quickResources.length,1);
 ok(await f.admin.call(`/admin/quick-resources/${edited.id}`,'DELETE',{version:edited.version}));assert.equal(ok(await f.detail(f.admin)).quickResources.length,1);
 for(let i=1;i<30;i++)ok(await f.create(),201);ok(await f.create(),400);
});
test('PDF privados, sustitución, eliminación y limpieza al eliminar curso',async t=>{
 const f=await fixture(t);let r=ok(await f.create({source:'file',kind:'download',file:pdf,url:''}),201);
 const path=r.fileUrl.replace('/api','');const response=await f.student.call(path);ok(response);assert.match(response.headers.get('content-disposition'),/attachment/);assert.match(response.text,/%PDF/);ok(await f.client().call(path),401);
 r=ok(await f.edit(r,{visible:false}));ok(await f.student.call(path),404);ok(await f.admin.call(path));
 r=ok(await f.edit(r,{file:{name:'nuevo.pdf',base64:pdf.base64}}));assert.equal((await readdir(join(f.dir,'uploads'))).length,1);
 r=ok(await f.edit(r,{source:'link',url:'https://example.com/libro',visible:true}));assert.equal(r.fileUrl,null);assert.equal((await readdir(join(f.dir,'uploads'))).length,0);
 r=ok(await f.edit(r,{source:'file',file:pdf}));ok(await f.admin.call(`/admin/courses/${f.course.id}`,'DELETE'));assert.equal((await readdir(join(f.dir,'uploads'))).length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quick_resources').get().n,0);
});
test('validación bloquea enlaces ejecutables y archivos no permitidos sin dejar huérfanos',async t=>{
 const f=await fixture(t);for(const url of ['javascript:alert(1)','data:text/html,x','https://user:secret@example.com'])ok(await f.create({url}),400);
 ok(await f.create({imageUrl:'javascript:alert(1)'}),400);ok(await f.create({source:'file',kind:'video',file:pdf}),400);ok(await f.create({source:'file',file:{name:'app.exe',base64:pdf.base64}}),400);ok(await f.create({source:'file',file:{name:'falso.pdf',base64:Buffer.from('falso').toString('base64')}}),400);
 ok(await f.create({title:'',source:'file',file:pdf}),400);assert.equal((await readdir(join(f.dir,'uploads'))).length,0);
});
test('miniaturas de YouTube reconocen videos válidos sin aceptar hosts falsos',()=>{
 for(const url of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=20','https://youtube.com/shorts/dQw4w9WgXcQ'])assert.equal(youtubeThumbnail(url),'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
 for(const url of ['https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ','javascript:alert(1)','https://youtu.be/invalido','https://vimeo.com/123'])assert.equal(youtubeThumbnail(url),'');
});
