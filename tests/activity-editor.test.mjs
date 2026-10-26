import test from 'node:test';
import assert from 'node:assert/strict';
import {dateProblem,weightSummary,renderQuestion,activityForm,evaluationStructure,readResponseSettings} from '../public/activity-editor.js';
import {createAcademicTools} from '../public/academic-tools.js';

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

test('los tipos abiertos y los ejercicios no conservan respuestas de selección ocultas',()=>{
 for(const type of ['text','short','number','instruction']){
  const html=renderQuestion({id:'q',type,prompt:'Resuelve',options:['Anterior A','Anterior B'],correct:[1]});
  assert.match(html,new RegExp(`<option value="${type}" selected>`));
  assert.match(html,/<div data-options hidden>/);
  assert.match(html,/<textarea name="qOptions" hidden><\/textarea>/);
  assert.match(html,/<input type="hidden" name="qCorrect" value="">/);
 }
 assert.match(renderQuestion({type:'short'}),/500 caracteres/);
 assert.match(renderQuestion({type:'number'}),/valor numérico/);
 assert.match(renderQuestion({type:'instruction'}),/entregará sus archivos al final/);
});

test('verdadero o falso crea selección única sin marcar una respuesta por el docente',()=>{
 const html=renderQuestion({type:'truefalse'});
 assert.match(html,/<option value="single" selected>/);
 assert.match(html,/value="Verdadero"/);assert.match(html,/value="Falso"/);
 assert.doesNotMatch(html,/data-correct checked/);
 assert.doesNotMatch(html,/<option value="truefalse"/);
});

test('la política de entrega conserva los valores anteriores y distingue cambios en medios obligatorios',()=>{
 const defaults={text:true,link:true,files:true,requireText:false,requireLink:false,requireFiles:false};
 const activity={kind:'task',maxPoints:100};
 assert.equal(evaluationStructure(activity),evaluationStructure({...activity,responseSettings:defaults}));
 assert.notEqual(evaluationStructure(activity),evaluationStructure({...activity,responseSettings:{...defaults,requireFiles:true}}));
 const inputs={responseText:{checked:false},responseRequireFiles:{checked:true}};
 assert.deepEqual(readResponseSettings({elements:{namedItem:name=>inputs[name]}}),{...defaults,text:false,requireFiles:true});
 const manual={kind:'quiz',maxPoints:1,questions:[{id:'q',type:'text',points:1}]};
 assert.equal(evaluationStructure(manual),evaluationStructure({...manual,questions:[{...manual.questions[0],options:[],correct:[]}]}));
});

test('el compositor reúne contenido y configuración sin navegación por pasos',()=>{
 const html=activityForm({kind:'quiz',questions:[]},{title:'Curso',modules:[]},{modern:true,fileCards:()=>'',savedFiles:()=>'',acceptedFiles:'.pdf',questionEditor:renderQuestion});
 assert.match(html,/<aside class="editor-settings"/);
 for(const name of ['title','description','kind','moduleId','weight','maxPoints','dueAt','opensAt','closesAt','maxAttempts','status'])assert.match(html,new RegExp(`name="${name}"`));
 assert.match(html,/data-question-add-type/);assert.match(html,/data-editor-preview-details/);
 assert.match(html,/data-editor-template="files"/);assert.match(html,/data-import-slot/);
 assert.doesNotMatch(html,/data-editor-go|data-editor-next|data-editor-previous|editor-step-actions/);
});

test('las herramientas conservan tipos y política de entrega al añadir cortes, tiempo y medios',async()=>{
 const types=['single','multiple','text','short','number','instruction'];
 const fields=types.map((type,index)=>({dataset:{question:'q'+index},querySelectorAll:()=>[{value:'material.pdf'}],querySelector:selector=>selector==='[name=qFiles]'?{files:[]}:{value:selector==='[name=qImage]'?'https://example.org/image.png':'Recurso de '+type}}));
 const form={elements:{periodId:{value:'corte-1'},timeLimitMinutes:{value:'25'},kind:{value:'quiz'},changeKind:{value:'editorial'},revisionPolicy:{value:'keep'}},querySelectorAll:()=>fields};
 const tools=createAcademicTools({getState:()=>({user:{roles:['teacher']}})});
 const settings={text:false,link:false,files:true,requireText:false,requireLink:false,requireFiles:true};
 const body={kind:'quiz',responseSettings:settings,attachments:[],questions:types.map((type,index)=>({id:'q'+index,type,options:[],correct:[]}))};
 await tools.readActivity(form,body);
 assert.deepEqual(body.questions.map(q=>q.type),types);assert.strictEqual(body.responseSettings,settings);
 assert.equal(body.periodId,'corte-1');assert.equal(body.timeLimitMinutes,25);
 assert.ok(body.questions.every(q=>q.media[0]==='material.pdf'&&q.imageUrl==='https://example.org/image.png'));
 form.elements.kind.value='task';const task={kind:'task',responseSettings:settings,attachments:[],questions:[]};await tools.readActivity(form,task);
 assert.strictEqual(task.responseSettings,settings);assert.equal(task.timeLimitMinutes,0);
});
