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

test('student results use the effective grading scale while original question points remain authentic',()=>{
 const a={...base,kind:'quiz',maxPoints:5,maxAttempts:1,questions:[{id:'q',type:'text',prompt:'Pregunta actual',points:5}]};
 const original={kind:'quiz',maxPoints:100,questions:[{id:'q',type:'text',prompt:'Pregunta original',points:100}]};
 const submission={id:'response',state:'graded',attempt:1,revision:2,published:true,points:4,gradingMaxPoints:5,previousActivity:original,scaleAdjustment:{from:100,to:5},answers:{q:'Respuesta conservada'}};
 const html=studentActivityWorkspace({activity:a,course:{title:'Curso'},mine:[submission]},{questionMedia:()=>'',questionPreview:q=>q.prompt});
 assert.match(html,/<strong>4<small> \/ 5<\/small><\/strong>/);assert.match(html,/Escala ajustada de 100 a 5 puntos/);assert.match(html,/Pregunta original/);assert.match(html,/100 puntos/);assert.equal(original.maxPoints,100);assert.equal(original.questions[0].points,100);
 assert.doesNotMatch(html,/<strong>4<small> \/ 100/);
});

test('zero grades and unchanged historical attempts retain their own denominators',()=>{
 const a={...base,maxPoints:5,maxAttempts:1},zero={id:'zero',state:'graded',attempt:1,revision:2,published:true,points:0,gradingMaxPoints:5,previousActivity:{kind:'task',maxPoints:80},scaleAdjustment:{from:80,to:5}};
 let html=studentActivityWorkspace({activity:a,course:{},mine:[zero]},{questionMedia:()=>'',questionPreview:()=>''});assert.match(html,/<strong>0<small> \/ 5<\/small>/);assert.match(html,/Escala ajustada de 80 a 5/);
 const older={...zero,id:'older',points:64,gradingMaxPoints:80,scaleAdjustment:null};
 html=studentActivityWorkspace({activity:a,course:{},mine:[older]},{questionMedia:()=>'',questionPreview:()=>''});assert.match(html,/<strong>64<small> \/ 80<\/small>/);assert.doesNotMatch(html,/Escala ajustada/);
});

test('grading metadata never reveals private points or invents a grade for an ungraded submission',()=>{
 const a={...base,maxPoints:5,maxAttempts:1},submission={id:'private',state:'submitted',attempt:1,revision:2,published:false,points:null,gradingMaxPoints:5,previousActivity:{kind:'task',maxPoints:100},scaleAdjustment:{from:100,to:5}};
 const html=studentActivityWorkspace({activity:a,course:{},mine:[submission]},{questionMedia:()=>'',questionPreview:()=>''});assert.match(html,/Tu docente está revisando la entrega/);assert.doesNotMatch(html,/class="activity-result"/);assert.match(html,/Escala ajustada de 100 a 5/);
});

test('an open activity shows the published teacher grade without hiding delivery controls or consuming an attempt',()=>{
 const manualGrade={manualGrade:true,published:true,points:4,gradingMaxPoints:5,feedback:'Comentario <publicado>'},a={...base,maxPoints:5};
 const html=studentActivityWorkspace({activity:a,manualGrade,course:{},mine:[]},{questionMedia:()=>'',questionPreview:()=>''});
 assert.equal((html.match(/activity-manual-result/g)||[]).length,1);assert.match(html,/Calificación docente · sin entrega/);assert.match(html,/<strong>4 <small>\/ 5<\/small>/);assert.match(html,/Comentario &lt;publicado&gt;/);
 assert.match(html,/id="academic-submit"/);assert.match(html,/name="response"/);assert.match(html,/Enviar actividad/);assert.match(html,/0 de 2 utilizados/);assert.doesNotMatch(html,/Entrega enviada/);
});

test('a preserved student draft and published manual grade remain visible together in the open form',()=>{
 const draft={id:'draft',state:'draft',revision:base.revision,attempt:1,text:'Mi avance conservado'};
 const html=studentActivityWorkspace({activity:base,manualGrade:{published:true,points:0,gradingMaxPoints:10,feedback:'Nota cero docente'},mine:[draft],course:{}},{questionMedia:()=>'',questionPreview:()=>''});
 assert.equal((html.match(/activity-manual-result/g)||[]).length,1);assert.match(html,/Mi avance conservado/);assert.match(html,/Nota cero docente/);assert.match(html,/Borrador recuperado/);assert.match(html,/0 de 2 utilizados/);
});

test('unpublished teacher grades never appear in the open student form',()=>{
 const html=studentActivityWorkspace({activity:base,manualGrade:{published:false,points:9.876,gradingMaxPoints:10,feedback:'Comentario privado invisible'},mine:[],course:{}},{questionMedia:()=>'',questionPreview:()=>''});
 assert.doesNotMatch(html,/activity-manual-result|9\.876|Comentario privado invisible/);assert.match(html,/Enviar actividad/);
});

test('a real submitted attempt does not duplicate a stale separate manual result in the next-attempt form',()=>{
 const html=studentActivityWorkspace({activity:base,manualGrade:{published:true,points:4,feedback:'Nota manual anterior'},mine:[{id:'real',state:'submitted',attempt:1,revision:base.revision,submittedAt:'2026-10-20T12:00:00Z'}],course:{}},{questionMedia:()=>'',questionPreview:()=>''});
 assert.doesNotMatch(html,/activity-manual-result|Nota manual anterior/);assert.match(html,/Entrega enviada/);assert.match(html,/Preparar otra entrega/);
});
