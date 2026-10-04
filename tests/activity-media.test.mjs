import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createApp,validateFile} from '../server/index.mjs';
import {readQuestionsWorkbook,mapQuestions} from '../server/question-import.mjs';
import {questionHeading,linkedText,linkPreview,embedUrl} from '../public/activity-media.js';
import {procedurePolicy,supportFileAllowed} from '../public/procedure-support.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=','base64');
test('Excel embedded images remain attached to their question row and old columns still map',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Preguntas');s.addRow(['Enunciado','Tipo','Opción 1','Opción 2','Correctas','Puntos','Descripción imagen','Enlace de apoyo']);s.addRow(['Identifica el gráfico','single','A','B','1',4,'Gráfico de prueba','https://example.com']);s.addRow(['Otra pregunta','text','','','',3]);
 const id=w.addImage({buffer:png,extension:'png'});s.addImage(id,{tl:{col:8,row:1},ext:{width:160,height:100}});
 const read=await readQuestionsWorkbook(Buffer.from(await w.xlsx.writeBuffer()));assert.equal(read.rows[0].images.length,1);assert.equal(read.rows[1].images.length,0);assert.deepEqual(Buffer.from(read.rows[0].images[0].base64,'base64'),png);
 const mapped=mapQuestions(read.rows,{prompt:0,type:1,option1:2,option2:3,correct:4,points:5,imageAlt:6,link:7});assert.deepEqual(mapped[0].errors,[]);assert.equal(mapped[0].question.embeddedImages.length,1);assert.equal(mapped[0].question.linkUrl,'https://example.com');
 assert.throws(()=>mapQuestions([{...read.rows[0],images:[{name:'bad.png',base64:Buffer.from('bad').toString('base64')}]}],{}),/dañada/);
});
test('media layouts escape content, preserve image aspect and embed supported links',()=>{
 const html=questionHeading({prompt:'<script> https://example.com',media:['diagram.png'],imageAlt:'Gráfico'},[{name:'diagram.png',mime:'image/png',url:'/private/1'}]);assert.ok(html.includes('with-images'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('alt="Gráfico"'));assert.ok(html.includes('activity-link-preview'));
 assert.equal(embedUrl('https://youtu.be/dQw4w9WgXcQ'),'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');assert.equal(embedUrl('https://drive.google.com/file/d/abc_123/view'),'https://drive.google.com/file/d/abc_123/preview');
 assert.equal(linkPreview('javascript:alert(1)'), '');assert.equal(linkPreview('https://user:secret@example.com'), '');assert.ok(!linkedText('<img src=x onerror=alert(1)>').includes('<img'));
 const policy=procedurePolicy();assert.ok(supportFileAllowed(policy,'modelo.sldprt'));assert.ok(supportFileAllowed(policy,'modelo.sim'));assert.ok(!supportFileAllowed({...policy,formats:['pdf']},'modelo.sim'));
 assert.equal(validateFile({name:'modelo.dwg',base64:Buffer.from([0,1,2,3]).toString('base64')},{any:true}).mime,'application/octet-stream');assert.throws(()=>validateFile({name:'modelo.dwg',base64:'AAEC'}));assert.throws(()=>validateFile({name:'../modelo.dwg',base64:'AAEC'},{any:true}));
});
test('images and CAD submissions stay private and unknown binaries download unchanged',async t=>{
 const root=await mkdtemp(join(tmpdir(),'aula-media-')),app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99881001',ADMIN_PASSWORD:'Synthetic-Media-2026!'}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 t.after(async()=>{await new Promise(r=>app.server.close(r));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-media-'));await rm(root,{recursive:true,force:true});});
 function client(){let cookie='';const api=async(p,b,m=b?'POST':'GET',status=200)=>{const res=await fetch(base+'/api'+p,{method:m,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body.data;};api.raw=url=>fetch(base+url,{headers:{Cookie:cookie}});return api;}
 const teacher=client(),student=client();await teacher('/auth/login',{document:'99881001',password:'Synthetic-Media-2026!'});const user=await teacher('/platform/users',{document:'99881002',name:'Estudiante de prueba',roles:['student']},'POST',201);await student('/auth/login',{document:user.document,password:user.document});await student('/auth/first-password',{newPassword:'1234',confirmPassword:'1234'});
 const template=await teacher('/admin/courses',{title:'Diseño'},'POST',201),group=await teacher(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Diseño grupo',code:'CAD',cohort:'2026'},'POST',201);await teacher(`/platform/courses/${group.id}/state`,{state:'active'});await teacher('/admin/enrollments',{courseId:group.id,studentId:user.id},'POST',201);
 const activity=await teacher(`/academics/courses/${group.id}/activities`,{title:'Cuestionario visual',kind:'quiz',status:'published',weight:20,questions:[{id:'q1',prompt:'Observa el modelo',type:'single',options:['A','B'],correct:[0],points:5,media:['grafico.png'],imageAlt:'Modelo',linkUrl:'https://example.com'}],attachments:[{name:'grafico.png',base64:png.toString('base64')}]},'POST',201);
 const view=await student(`/academics/activities/${activity.id}`);assert.equal(view.activity.questions[0].linkUrl,'https://example.com/');assert.equal(view.activity.questions[0].correct,undefined);const image=await student.raw(view.activity.attachments[0].url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal((await fetch(base+view.activity.attachments[0].url)).status,401);
 const task=await teacher(`/academics/courses/${group.id}/activities`,{title:'Modelo CAD',kind:'task',status:'published',weight:20},'POST',201),bytes=Buffer.from([0,1,255,0,9]);
 const submitted=await student(`/academics/activities/${task.id}/submit`,{requestId:crypto.randomUUID(),action:'submit',text:'Modelo',files:[{name:'pieza.sldprt',base64:bytes.toString('base64')}],answers:{}},'POST',201);
 const file=submitted.files[0],download=await teacher.raw(file.url);assert.equal(download.status,200);assert.ok(download.headers.get('content-disposition').startsWith('attachment'));assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.equal((await fetch(base+file.url)).status,401);
});

