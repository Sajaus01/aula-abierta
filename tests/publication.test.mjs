import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {openDatabase} from '../server/database.mjs';
import {hashPassword} from '../server/security.mjs';

function ok(r,code=200){assert.equal(r.status,code,r.text);return r.data;}
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'aula-publication-'));
 const password='Prueba-publicacion-2026!';
 const app=await createApp({dataDir:dir,env:{NODE_ENV:'test',ADMIN_DOCUMENT:'50000001',ADMIN_PASSWORD:password}});
 t.after(async()=>{await new Promise(r=>app.server.close(r));const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep+'aula-publication-'));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const client=()=>({cookie:'',async call(path,method='GET',body){const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:this.cookie},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];const text=await r.text();let p;try{p=JSON.parse(text);}catch{}return {status:r.status,data:p?.data,text};}});
 const admin=client(),student=client(),anonymous=client();ok(await admin.call('/auth/login','POST',{document:'50000001',password}));
 const at=new Date().toISOString();app.db.prepare("INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES ('learner','60000001','Prueba','student',?,?,?)").run(await hashPassword(password),at,at);
 ok(await student.call('/auth/login','POST',{document:'60000001',password}));
 const course=ok(await admin.call('/admin/courses','POST',{title:'Publicación gradual',published:true,accessMode:'public'}),201);
 ok(await admin.call('/admin/enrollments','POST',{studentId:'learner',courseId:course.id}),201);
 const module=ok(await admin.call(`/admin/courses/${course.id}/modules`,'POST',{title:'Unidad preparada'}),201);
 const resource=ok(await admin.call(`/admin/modules/${module.id}/resources`,'POST',{title:'Guía preparada',kind:'html',file:{name:'guia.html',base64:Buffer.from('<!doctype html><title>Guía privada</title>').toString('base64')}}),201);
 return {...app,admin,student,anonymous,course,module,resource,
  chapter:published=>admin.call(`/admin/modules/${module.id}`,'PATCH',{published}),
  material:published=>admin.call(`/admin/resources/${resource.id}`,'PATCH',{published}),
  detail:(who=student)=>who.call(`/courses/${course.id}`),
  preview:(who=student,method='GET')=>who.call(resource.previewUrl.slice(4),method),
  file:(who=student,method='GET')=>who.call(resource.fileUrl.slice(4),method)
 };
}

test('borradores predeterminados; publicación independiente y protección de enlaces directos',async t=>{
 const f=await fixture(t);assert.equal(f.module.published,false);assert.equal(f.resource.published,false);
 for(const who of [f.student,f.anonymous]){
  const c=ok(await f.detail(who));assert.deepEqual(c.modules,[]);assert.equal(c.resourceCount,0);assert.equal(c.moduleCount,0);
  for(const method of ['GET','HEAD']){ok(await f.preview(who,method),404);ok(await f.file(who,method),404);}
 }
 assert.equal(ok(await f.detail(f.admin)).modules[0].resources[0].published,false);ok(await f.preview(f.admin));ok(await f.file(f.admin));
 ok(await f.material(true));assert.deepEqual(ok(await f.detail()).modules,[]);ok(await f.preview(),404);
 ok(await f.chapter(true));assert.equal(ok(await f.detail()).resourceCount,1);ok(await f.preview());ok(await f.file());
 ok(await f.material(false));assert.equal(ok(await f.detail()).modules.length,1);assert.equal(ok(await f.detail()).modules[0].resources.length,0);ok(await f.preview(),404);
 ok(await f.chapter(false));ok(await f.chapter(true));assert.equal(ok(await f.detail()).resourceCount,0,'Publicar un capítulo no publica los borradores de sus materiales');
 for(const path of [`/admin/modules/${f.module.id}`,`/admin/resources/${f.resource.id}`]){
  ok(await f.student.call(path,'PATCH',{published:true}),403);
  ok(await f.admin.call(path,'PATCH',{published:'false'}),400);
 }
 ok(await f.material(true));ok(await f.admin.call(`/admin/courses/${f.course.id}`,'PATCH',{published:false}));ok(await f.detail(),404);ok(await f.preview(),404);
});

test('ocultar excluye contenido del progreso sin borrar el avance previo',async t=>{
 const f=await fixture(t);ok(await f.chapter(true));ok(await f.material(true));
 ok(await f.student.call(`/progress/${f.resource.id}`,'PUT',{completed:true}));
 assert.equal(ok(await f.student.call('/learning')).courses[0].completed,1);
 ok(await f.material(false));assert.deepEqual(ok(await f.student.call('/progress')),[]);
 const learning=ok(await f.student.call('/learning'));assert.equal(learning.courses[0].total,0);assert.deepEqual(learning.recent,[]);assert.deepEqual(learning.activities,[]);
 ok(await f.student.call(`/progress/${f.resource.id}/open`,'POST',{}),404);ok(await f.student.call(`/progress/${f.resource.id}`,'PUT',{completed:false}),404);
 ok(await f.material(true));assert.equal(ok(await f.student.call('/progress'))[0].completed,true);
 ok(await f.chapter(false));assert.equal(ok(await f.student.call('/learning')).courses[0].total,0);ok(await f.preview(),404);
 ok(await f.chapter(true));assert.equal(ok(await f.student.call('/learning')).courses[0].completed,1);
});

test('capítulo oculto bloquea actividades en listados, entregas y archivos sin alterar notas',async t=>{
 const f=await fixture(t);ok(await f.chapter(true));
 const activity=ok(await f.admin.call(`/academics/courses/${f.course.id}/activities`,'POST',{title:'Tarea de unidad',kind:'task',status:'published',moduleId:f.module.id,weight:100}),201);
 const path=`/academics/activities/${activity.id}`;
 const sub=ok(await f.student.call(path+'/submit','POST',{requestId:randomUUID(),action:'submit',text:'Respuesta',file:{name:'entrega.pdf',base64:Buffer.from('%PDF-1.4\nPrueba').toString('base64')}}),201);
 ok(await f.admin.call(`/academics/submissions/${sub.id}/grade`,'PATCH',{points:80,published:true,feedback:'Bien',version:sub.version}));
 const grade=ok(await f.student.call(`/academics/courses/${f.course.id}`)).grade;
 ok(await f.chapter(false));assert.deepEqual(ok(await f.detail()).activities,[]);
 assert.deepEqual(ok(await f.student.call('/academics/courses'))[0].activities,[]);
 const detail=ok(await f.student.call(`/academics/courses/${f.course.id}`));assert.deepEqual(detail.activities,[]);assert.deepEqual(detail.grade.cells,[]);assert.equal(detail.grade.provisional,grade.provisional);assert.equal(detail.grade.weightTotal,grade.weightTotal);
 ok(await f.student.call(path),404);ok(await f.student.call(path+'/submit','POST',{requestId:randomUUID(),action:'submit',text:'No disponible'}),404);
 ok(await f.student.call(sub.fileUrl.slice(4)),404);ok(await f.admin.call(path));
 assert.equal(ok(await f.admin.call(`/academics/courses/${f.course.id}/gradebook`)).activities.length,1);
 ok(await f.chapter(true));assert.equal(ok(await f.student.call(path)).mine[0].points,80);ok(await f.student.call(sub.fileUrl.slice(4)));
});

test('migración conserva visibilidad antigua y no república borradores al reiniciar',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'aula-publication-'));let db;
 t.after(async()=>{db?.close();const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep+'aula-publication-'));await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 db=openDatabase(dir);const at=new Date().toISOString();
 db.prepare("INSERT INTO courses(id,title,published,created_at,updated_at) VALUES ('old','Existente',1,?,?)").run(at,at);
 db.prepare("INSERT INTO modules(id,course_id,title) VALUES ('old-module','old','Existente')").run();
 db.prepare("INSERT INTO resources(id,module_id,title,kind,content,created_at,updated_at) VALUES ('old-resource','old-module','Existente','html','<p>Hola</p>',?,?)").run(at,at);
 db.exec('ALTER TABLE resources DROP COLUMN published; ALTER TABLE modules DROP COLUMN published');db.close();db=openDatabase(dir);
 assert.equal(db.prepare('SELECT published FROM modules').get().published,1);assert.equal(db.prepare('SELECT published FROM resources').get().published,1);
 db.exec('UPDATE modules SET published=0; UPDATE resources SET published=0');db.close();db=openDatabase(dir);
 assert.equal(db.prepare('SELECT published FROM modules').get().published,0);assert.equal(db.prepare('SELECT published FROM resources').get().published,0);
});
