import test from 'node:test';
import assert from 'node:assert/strict';
import {dateProblem,weightSummary,renderQuestion,activityForm,evaluationStructure} from '../public/activity-editor.js';

test('fechas: límites opcionales, apertura estricta y cierre igual a entrega',()=>{
 const opensAt='2026-10-01T08:00',dueAt='2026-10-02T08:00',closesAt='2026-10-03T08:00';
 for(const config of [{},{opensAt},{dueAt},{closesAt},{opensAt,dueAt,closesAt},{opensAt,dueAt,closesAt:dueAt},{dueAt,allowLate:true}])assert.equal(dateProblem(config),null);
 assert.equal(dateProblem({opensAt,dueAt:opensAt}).field,'dueAt');
 assert.equal(dateProblem({opensAt,closesAt:opensAt}).field,'closesAt');
 assert.equal(dateProblem({dueAt,closesAt:opensAt}).field,'closesAt');
 assert.equal(dateProblem({allowLate:true}).field,'dueAt');
});

test('ponderación: excluir versión editada, borradores y otros cortes; respetar 100 %',()=>{
 const items=[{id:'edit',status:'published',weight:40,periodId:'one'},{id:'other',status:'published',weight:60,periodId:'one'},{id:'draft',status:'draft',weight:90,periodId:'one'},{id:'another',status:'published',weight:100,periodId:'two'}];
 assert.deepEqual(weightSummary(items,'edit','one',40,'published'),{used:60,total:100,remaining:40,exceeded:false});
 assert.equal(weightSummary(items,'edit','one',41,'published').exceeded,true);
 assert.equal(weightSummary(items,'edit','one',99,'draft').total,60);
 assert.equal(weightSummary(items,null,'two',1,'published').exceeded,true);
 assert.equal(weightSummary([{id:'a',status:'published',weight:40}],null,'',30,'published').total,70);
});

test('editor de preguntas mantiene identidad, correctas e impide inyección de HTML',()=>{
 const html=renderQuestion({id:'stable-id',prompt:'<img src=x onerror=alert(1)>',type:'multiple',points:2,options:['<b>A</b>','B'],correct:[1]},4);
 assert.match(html,/data-question="stable-id"/);assert.match(html,/Pregunta 4/);assert.match(html,/type="checkbox" name="correct-stable-id" data-correct checked aria-label="Opción 2 correcta"/);
 assert.match(html,/name="qCorrect" value="2"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
 const empty=renderQuestion();assert.doesNotMatch(empty,/data-correct checked/);assert.match(empty,/data-add-option/);
});

test('distinguir una corrección editorial de un cambio de respuestas o puntos',()=>{
 const activity={kind:'quiz',maxPoints:1,questions:[{id:'q',type:'multiple',prompt:'Enunciado',points:1,options:['A','B'],correct:[1,0]}]};
 const same={...activity,questions:[{...activity.questions[0],prompt:'Enunciado corregido',correct:[0,1]}]};
 assert.equal(evaluationStructure(activity),evaluationStructure(same));
 assert.notEqual(evaluationStructure(activity),evaluationStructure({...activity,questions:[{...activity.questions[0],correct:[0]}]}));
 assert.notEqual(evaluationStructure({kind:'task',maxPoints:100}),evaluationStructure({kind:'task',maxPoints:50}));
});

test('crear y editar comparten secciones; la creación no ofrece decisiones sobre entregas inexistentes',()=>{
 const a={title:'Taller',description:'',kind:'task',status:'draft',weight:0,maxPoints:100,maxAttempts:1,questions:[]};
 const context={modern:true,fileCards:()=>'',savedFiles:()=>'',acceptedFiles:'.pdf',questionEditor:renderQuestion};
 const html=activityForm(a,{title:'Curso <seguro>',modules:[]},context);
 for(const id of ['details','content','delivery','grading','publication','preview','impact'])assert.match(html,new RegExp(`data-editor-section="${id}"`));
 assert.doesNotMatch(html,/data-editor-section="changes"/);assert.match(html,/Curso &lt;seguro&gt;/);
 assert.match(activityForm({...a,id:'edit'},{title:'Curso',modules:[]},context),/data-revision-slot/);
});
