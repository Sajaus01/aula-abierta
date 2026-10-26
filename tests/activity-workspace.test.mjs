import test from 'node:test';
import assert from 'node:assert/strict';
import {activityResponseSettings,studentResponseContext,studentUploadPolicy,studentActivityWorkspace,studentActivityRows} from '../public/activity-workspace.js';
import {quizQuestion} from '../public/quiz-player.js';

const base={id:'a',courseId:'c',title:'Actividad',kind:'task',revision:2,maxAttempts:2,maxPoints:10,weight:5,allowLate:true,questions:[],attachments:[]};
const render=a=>studentActivityWorkspace({activity:a,course:{title:'Curso'},mine:[]},{questionMedia:()=>'',questionPreview:()=>''});
test('legacy task keeps its existing delivery channels; configured channels control the form',()=>{
 assert.deepEqual(activityResponseSettings(),{text:true,link:true,files:true,requireText:false,requireLink:false,requireFiles:false});
 const written=render({...base,responseSettings:{text:true,link:false,files:false,requireText:true}});
 assert.match(written,/name="response"/);assert.doesNotMatch(written,/name="url"|name="attachment"/);assert.match(written,/obligatoria/);
 const file=render({...base,responseSettings:{text:false,link:false,files:true,requireFiles:true}});
 assert.match(file,/name="attachment"/);assert.doesNotMatch(file,/name="response"|name="url"/);assert.match(file,/Obligatorios/);
});
test('exercise quizzes have no answer field and require a final upload',()=>{
 const a={...base,kind:'quiz',questions:[{id:'q',type:'instruction',prompt:'Simula el circuito',points:10}]};
 const html=render(a);assert.match(html,/Simula el circuito/);assert.doesNotMatch(html,/name="answer-q"/);assert.match(html,/name="attachment"/);assert.equal(studentUploadPolicy(a).required,true);
 assert.equal(studentUploadPolicy(base).required,false);
});
test('short and numeric drafts preserve strings and render every point',()=>{
 const short=quizQuestion({id:'s',type:'short',prompt:'Concepto',points:2},1,[],{s:'RLC <serie>'});
 assert.match(short,/RLC &lt;serie&gt;/);assert.match(short,/maxlength="500"/);assert.doesNotMatch(short,/ hidden/);
 const numeric=quizQuestion({id:'n',type:'number',prompt:'Resultado',points:2},2,[],{n:'-2,5e-3'});
 assert.match(numeric,/value="-2,5e-3"/);assert.match(numeric,/inputmode="decimal"/);
});
test('returned work reopens the same attempt after the original deadline',()=>{
 const a={...base,maxAttempts:1,allowLate:false,dueAt:'2026-01-01T00:00:00Z'};
 const returned={id:'s',state:'returned',returnedAt:'2026-01-03T00:00:00Z',attempt:1};
 const c=studentResponseContext(a,[returned], '2026-01-04T00:00:00Z');assert.equal(c.editable,true);assert.equal(c.draft,returned);assert.equal(c.limit,false);
 assert.equal(studentResponseContext(a,[{...returned,returnDueAt:'2026-01-03T12:00:00Z'}],'2026-01-04T00:00:00Z').closed,true);
});
test('opening a subsequent attempt does not hide the current receipt behind the editor',()=>{
 const mine=[{id:'s',state:'submitted',attempt:1,revision:2,submittedAt:'2026-10-01T00:00:00Z',text:'Respuesta enviada'}];
 const html=studentActivityWorkspace({activity:base,course:{title:'Curso'},mine},{questionMedia:()=>'',questionPreview:()=>''});
 assert.match(html,/Respuesta enviada/);assert.match(html,/data-start-attempt/);assert.match(html,/data-answer-editor hidden/);
 assert.equal(studentResponseContext(base,mine).editable,true);assert.equal(studentResponseContext({...base,maxAttempts:1},mine).editable,false);
});
test('expired corrections still expose their saved files and optional revisions count only current attempts',()=>{
 const a={...base,repeatPolicy:'optional',maxAttempts:1};
 const old={state:'submitted',revision:1,attempt:1};
 const c=studentResponseContext(a,[old]);assert.equal(c.editable,true);assert.equal(c.usedAttempts,0);
 const returned={state:'returned',returnedAt:'2026-01-01T00:00:00Z',returnDueAt:'2026-01-02T00:00:00Z',files:[{id:'f',name:'proyecto.sim',url:'/saved-project',downloadUrl:'/saved-project?download=1'}]};
 const html=studentActivityWorkspace({activity:a,mine:[returned],course:{title:'Curso'}},{questionMedia:()=>'',questionPreview:()=>''});
 assert.match(html,/Corrección pendiente/);assert.match(html,/proyecto.sim/);assert.match(html,/href="\/saved-project"/);
});
test('current and previous quiz histories keep their answers and published question comments',()=>{
 const a={...base,kind:'quiz',questions:[{id:'q',type:'text',prompt:'Pregunta',points:10}]};
 const s={state:'submitted',revision:2,attempt:1,answers:{q:'Respuesta conservada'},questionFeedback:[{feedback:'Comentario publicado'}]};
 const html=studentActivityWorkspace({activity:a,mine:[s],previous:[{id:'old'}],course:{}},{questionMedia:()=>'',questionPreview:(q,answer)=>String(answer||''),previousSubmission:()=>'<p>Respuesta de versión anterior</p>'});
 assert.match(html,/Mis respuestas/);assert.match(html,/Comentario publicado/);assert.match(html,/Respuesta de versión anterior/);assert.equal(html.split('Respuesta conservada').length,3);
});
test('overview summaries distinguish saved drafts, corrections and file exercises without private answers',()=>{
 const html=studentActivityRows([{id:'draft',title:'Avance',responseState:'draft',activityFormat:'text'},{id:'returned',title:'Simulación',responseState:'returned',activityFormat:'exercises'}]);
 assert.match(html,/Continuar/);assert.match(html,/Corregir/);assert.match(html,/Ejercicios con archivos/);assert.match(html,/Respuesta escrita/);
});
