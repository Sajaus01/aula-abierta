import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCategory,reviewStatus,returnBlockReason,answerAssessment,createActivityReview,latestReviewSubmissions,releasableReviewSubmissions} from '../public/activity-review.js';

test('el seguimiento distingue avance, corrección guardada, nota interna e historial',()=>{
 assert.equal(reviewCategory({state:'draft'}),'draft');
 assert.equal(reviewCategory({state:'draft',returnedAt:'2026-09-29'}),'returned');
 assert.match(reviewStatus({state:'draft',returnedAt:'2026-09-29'}),/Corrección en curso/);
 assert.equal(reviewCategory({state:'graded',points:0,published:false}),'pending');
 assert.match(reviewStatus({state:'graded',points:0,published:false}),/sin publicar/);
 assert.equal(reviewCategory({state:'graded',published:true,superseded:true}),'history');
});
test('devolución disponible solo para la entrega vigente más reciente sin otro borrador',()=>{
 const a={status:'published'},s={id:'one',studentId:'learner',attempt:1,state:'submitted'};
 assert.equal(returnBlockReason(s,a,[s]),'');
 assert.match(returnBlockReason(s,{status:'draft'},[s]),/Publica/);
 assert.match(returnBlockReason({...s,state:'draft'},a,[s]),/enviadas/);
 assert.match(returnBlockReason({...s,superseded:true},a,[s]),/vigentes/);
 assert.match(returnBlockReason(s,a,[s,{...s,id:'two',attempt:2}]),/último intento/);
 assert.match(returnBlockReason(s,a,[s,{...s,id:'draft',state:'draft'}]),/borrador/);
 assert.equal(returnBlockReason(s,a,[s,{...s,id:'history',attempt:2,superseded:true},{...s,id:'peer',studentId:'other',attempt:3}]),'');
});
test('comparar respuestas respeta conjuntos, ceros y preguntas manuales o históricas sin claves',()=>{
 const q={type:'multiple',correct:[0,2]};
 assert.equal(answerAssessment(q,[2,0]).label,'Correcta');
 assert.equal(answerAssessment(q,[0]).label,'Por revisar');
 assert.equal(answerAssessment(q,[]).label,'Sin respuesta');
 assert.equal(answerAssessment({type:'text'},'0').label,'Revisión manual');
 assert.equal(answerAssessment({type:'single'},[0]).label,'Revisión manual');
 assert.equal(answerAssessment({type:'single',correct:[0]},[0]).label,'Correcta');
 assert.equal(answerAssessment({type:'single',correct:[0]},[1]).label,'Por revisar');
 for(const type of ['text','short','number'])assert.deepEqual(answerAssessment({type,correct:[]},'0'),{label:'Revisión manual',tone:'amber'});
 assert.deepEqual(answerAssessment({type:'instruction'},undefined),{label:'Resolver en archivos',tone:'gray'});
 assert.deepEqual(answerAssessment({type:'instruction'},'dato heredado'),{label:'Resolver en archivos',tone:'gray'});
});

test('la revisión muestra respuestas manuales y excluye ejercicios con archivos del contador de respuestas',t=>{
 const root={innerHTML:''},elements=new Map([['[data-review-root]',root],['[data-review=prev]',{}],['[data-review=next]',{}],['.review-response-pane',{focus(){}}]]);
 const modal={open:true,dataset:{},classList:{add(){}},querySelector:selector=>elements.get(selector),addEventListener(){}};
 const review=createActivityReview({modal,openModal(){},icon:()=>'',questionMedia:()=>'',api(){},toast(){},render(){}});
 t.after(()=>review.dispose());
 const questions=[{id:'file',type:'instruction',prompt:'Simula y entrega el archivo',points:2},{id:'long',type:'text',prompt:'Explica',points:1},{id:'short',type:'short',prompt:'Nombre',points:1},{id:'num',type:'number',prompt:'Magnitud',points:1},{id:'single',type:'single',prompt:'Elige una',options:['A','B'],correct:[0],points:1},{id:'multiple',type:'multiple',prompt:'Elige varias',options:['A','B','C'],correct:[0,2],points:1}];
 const activity={id:'activity',kind:'quiz',maxPoints:7,status:'published',title:'Cuestionario',weight:0,questions};
 const submission={id:'submission',name:'Prueba',state:'submitted',points:null,studentId:'student',attempt:1,answers:{long:'<Explicación>',short:'0',num:'0',multiple:[2,0]}};
 review.open({activity,submissions:[submission],id:submission.id});
 assert.match(root.innerHTML,/4 \/ 5 respuestas/);
 assert.match(root.innerHTML,/Resolver en archivos/);
 assert.match(root.innerHTML,/Este ejercicio se resuelve en los archivos adjuntos/);
 assert.match(root.innerHTML,/&lt;Explicación&gt;/);
 assert.equal((root.innerHTML.match(/class="academic-text">0<\/p>/g)||[]).length,2);
 assert.equal((root.innerHTML.match(/class="review-options"/g)||[]).length,2);
 review.open({activity:{...activity,questions:[questions[0]]},submissions:[submission],id:submission.id});
 assert.doesNotMatch(root.innerHTML,/\d+ \/ \d+ respuestas/);
 assert.match(root.innerHTML,/Resolver en archivos/);
});

test('un evento tardío de cierre no desactiva una revisión recién abierta',()=>{
 const handlers=new Map(),elements=new Map([['[data-review-root]',{innerHTML:''}],['[data-review=prev]',{}],['[data-review=next]',{}],['.review-response-pane',{focus(){}}]]);
 const modal={open:false,dataset:{},classList:{add(){}},querySelector:selector=>elements.get(selector),addEventListener:(event,fn,options)=>handlers.set(event,{fn,signal:options.signal})};
 const review=createActivityReview({modal,openModal:()=>{modal.open=true;},icon:()=>'',modern:()=>true,questionMedia:()=>'',api:()=>{},toast:()=>{},render:()=>{throw Error('No hubo modificaciones');}});
 review.open({activity:{id:'activity',kind:'task',maxPoints:100,status:'published',title:'Actividad',weight:0},submissions:[{id:'submission',name:'Prueba',state:'draft',points:null,studentId:'student',attempt:1}],id:'submission'});
 const close=handlers.get('close');close.fn();assert.equal(close.signal.aborted,false,'the current modal remains interactive while open');
 modal.open=false;close.fn();assert.equal(close.signal.aborted,true,'listeners are cleaned up after the actual close');
});

test('la cola muestra una sola respuesta vigente por estudiante y un borrador posterior bloquea devolver la anterior',()=>{
 const records=[
  {id:'old',studentId:'a',name:'Ana',attempt:1,state:'graded',points:70,published:false},
  {id:'draft',studentId:'a',name:'Ana',attempt:2,state:'draft',points:null},
  {id:'history',studentId:'a',name:'Ana',attempt:3,state:'graded',points:100,superseded:true},
  {id:'zero',studentId:'b',name:'Bea',attempt:1,state:'graded',points:0,published:false},
  {id:'support',studentId:'c',name:'Carlos',attempt:1,state:'submitted',points:80,procedureReviewPending:true},
  {id:'public',studentId:'d',name:'Diana',attempt:1,state:'graded',points:50,published:true},
  {id:'edited',studentId:'e',name:'Elena',attempt:1,state:'graded',points:60,published:true,gradeDraft:true},
 ];
 assert.deepEqual(latestReviewSubmissions(records).map(s=>s.id),['draft','zero','support','public','edited']);
 assert.deepEqual(releasableReviewSubmissions(records).map(s=>s.id),['zero','edited']);
 assert.equal(reviewCategory(records[6]),'pending');
 assert.match(reviewStatus(records[6]),/sin devolver/);
});

function reviewHarness(t,request,{submission={},activity={}}={}){
 const previousFormData=globalThis.FormData;
 globalThis.FormData=class{constructor(form){this.values={...form.values};}get(name){return this.values[name]??null;}has(name){return Boolean(this.values[name]);}};
 t.after(()=>{globalThis.FormData=previousFormData;});
 const handlers=new Map(),status={textContent:'',classList:{toggle(){}}},error={textContent:''};
 const input={checkValidity:()=>true},form={values:{points:'12',feedback:'Revisar unidades.'},querySelector:()=>input};
 const root={innerHTML:'',inert:false},elements=new Map([['[data-review-root]',root],['[data-review=prev]',{}],['[data-review=next]',{}],['[data-review=release-all]',{}],['[data-queue-count]',{}],['.review-queue-list',{}],['.review-response-pane',{focus(){}}],['#review-grade-form',form],['[data-save-status]',status],['#review-grade-form .review-error',error]]);
 let closed=0,renders=0;const messages=[];
 const modal={open:false,dataset:{},classList:{add(){}},querySelector:selector=>elements.get(selector),setAttribute(){},removeAttribute(){},close(){closed++;this.open=false;},addEventListener(event,fn,options){const list=handlers.get(event)||[];list.push({fn,options});handlers.set(event,list);}};
 const review=createActivityReview({modal,openModal:()=>{modal.open=true;},icon:()=>'',questionMedia:()=>'',api:request,toast:message=>messages.push(message),render(){renders++;}});
 t.after(()=>review.dispose());
 review.open({activity:{id:'activity',kind:'task',maxPoints:100,status:'published',title:'Actividad',weight:0,...activity},submissions:[{id:'submission',name:'Prueba',state:'submitted',points:null,studentId:'student',attempt:1,version:1,...submission}],id:'submission'});
 const change=()=>handlers.get('input')[0].fn({target:{id:'',closest:selector=>selector==='#review-grade-form'?form:null,matches:()=>true}});
 const close=()=>handlers.get('click').find(h=>h.options.capture).fn({target:{closest:selector=>selector==='[data-action="close-modal"]'?{}:null},preventDefault(){},stopImmediatePropagation(){}});
 const action=name=>handlers.get('click').find(h=>!h.options.capture).fn({target:{closest:selector=>selector==='[data-review]'?{dataset:{review:name}}:null}});
 const closedEvent=()=>handlers.get('close').forEach(({fn,options})=>{if(!options.signal.aborted)fn();});
 return {form,input,change,close,action,status,error,root,messages,closedEvent,beforeLeave:()=>review.beforeLeave(),closed:()=>closed,renders:()=>renders};
}

test('devolver a todos sin editar una nota actualiza la página al cerrar la revisión',async t=>{
 const calls=[],activity={id:'activity',kind:'task',maxPoints:100,status:'published',title:'Actividad',weight:0};
 const harness=reviewHarness(t,async(path,options)=>{
  calls.push({path,options});
  if(options?.method==='POST')return {releasedCount:1,skippedCount:0};
  return {activity,submissions:[{id:'submission',name:'Prueba',state:'graded',points:12,published:true,studentId:'student',attempt:1,version:2}]};
 },{submission:{state:'graded',points:12,published:false}});
 await harness.action('release-all');
 assert.deepEqual(calls.map(call=>call.path),['/academics/activities/activity/release','/academics/activities/activity/submissions']);
 assert.deepEqual(calls[0].options.body,{submissions:[{id:'submission',version:1}]});
 assert.equal(harness.renders(),0,'the review stays open until the teacher closes it');
 harness.close();await new Promise(resolve=>setImmediate(resolve));harness.closedEvent();
 assert.equal(harness.renders(),1,'the underlying evaluation status must be fetched again');
});

test('una devolución en lote rechazada no marca la página como modificada',async t=>{
 let calls=0;
 const harness=reviewHarness(t,async()=>{calls++;throw Error('La calificación cambió. Actualiza antes de devolver.');},{submission:{state:'graded',points:12,published:false}});
 await harness.action('release-all');
 assert.equal(calls,1);assert.match(harness.error.textContent,/Actualiza/);
 harness.close();await new Promise(resolve=>setImmediate(resolve));harness.closedEvent();
 assert.equal(harness.renders(),0);
});

test('el mensaje de devolución masiva no atribuye pendientes a las entregas omitidas',async t=>{
 const harness=reviewHarness(t,async(path,options)=>options?.method==='POST'?{releasedCount:0,skippedCount:1}:{activity:{id:'activity',kind:'task',maxPoints:100,status:'published',title:'Actividad',weight:0},submissions:[{id:'submission',name:'Prueba',state:'graded',points:12,published:true,studentId:'student',attempt:1,version:2}]},{submission:{state:'graded',points:12,published:false}});
 await harness.action('release-all');
 assert.deepEqual(harness.messages,['No hay notas nuevas listas para devolver. Las demás entregas conservaron su estado.']);assert.doesNotMatch(harness.messages[0],/siguen pendientes|0 notas devueltas/);
});

test('si la devolución se guardó pero falla su recarga, cerrar vuelve a consultar la página',async t=>{
 const harness=reviewHarness(t,async(path,options)=>{if(options?.method==='POST')return {releasedCount:1,skippedCount:0};throw Error('No se pudo actualizar la lista.');},{submission:{state:'graded',points:12,published:false}});
 await harness.action('release-all');
 assert.match(harness.error.textContent,/actualizar la lista/);
 harness.close();await new Promise(resolve=>setImmediate(resolve));harness.closedEvent();
 assert.equal(harness.renders(),1);
});

test('cerrar espera el guardado privado y conserva otra edición hecha mientras la solicitud estaba en curso',async t=>{
 const calls=[];let resolveFirst;
 const first=new Promise(resolve=>{resolveFirst=resolve;});
 const harness=reviewHarness(t,async(path,options)=>{calls.push({path,body:options.body});if(calls.length===1)await first;return {id:'submission',points:options.body.points,feedback:options.body.feedback,version:calls.length+1,gradeDraft:true};});
 harness.change();harness.close();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(harness.closed(),0);
 assert.equal(calls[0].body.published,false);
 assert.equal(calls[0].body.version,1);
 harness.form.values.feedback='Conservar la revisión más reciente.';harness.change();resolveFirst();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert.equal(calls[1].body.version,2);
 assert.equal(calls[1].body.feedback,'Conservar la revisión más reciente.');
 assert.equal(harness.closed(),1);
});

test('un error de guardado mantiene abierta la revisión y permite reintentar al cerrar',async t=>{
 let calls=0;const harness=reviewHarness(t,async(path,options)=>{if(++calls===1)throw Error('Conexión interrumpida');return {id:'submission',points:options.body.points,feedback:options.body.feedback,version:2,gradeDraft:true};});
 harness.change();harness.close();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(harness.closed(),0);assert.match(harness.error.textContent,/Conexión interrumpida/);
 harness.close();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,2);assert.equal(harness.closed(),1);
});

test('un conflicto se recupera mediante descarte explícito y usa la versión actualizada en el siguiente guardado',async t=>{
 let writes=0;const versions=[];
 const harness=reviewHarness(t,async(path,options)=>{
  if(path.endsWith('/submissions'))return {activity:{id:'activity',kind:'task',maxPoints:100,status:'published',title:'Actividad',weight:0},submissions:[{id:'submission',name:'Prueba',state:'graded',points:8,feedback:'Revisión guardada por otra persona.',studentId:'student',attempt:1,version:4}]};
  versions.push(options.body.version);if(++writes===1)throw Error('La calificación cambió. Actualiza la entrega.');
  return {id:'submission',points:options.body.points,feedback:options.body.feedback,version:5};
 });
 harness.change();harness.close();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(harness.closed(),0);assert.match(harness.error.textContent,/Actualiza/);
 await harness.action('discard-reload');
 assert.match(harness.root.innerHTML,/Revisión guardada por otra persona/);
 harness.form.values.feedback='Nueva revisión tras actualizar.';harness.change();harness.close();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(versions,[1,4]);assert.equal(harness.closed(),1);
});

test('la revisión usa el máximo efectivo de la nota sin reescribir el enunciado original',t=>{
 const original={id:'activity',title:'Enunciado original',kind:'quiz',description:'Instrucciones originales',maxPoints:100,questions:[{id:'q',type:'text',prompt:'Pregunta original',points:100}]};
 const harness=reviewHarness(t,async()=>{}, {activity:{maxPoints:5,kind:'quiz',questions:[{id:'new',type:'text',prompt:'Pregunta actual',points:5}]},submission:{state:'graded',points:4,published:true,publishedPoints:4,automaticPoints:4,gradingMaxPoints:5,previousActivity:original,scaleAdjustment:{from:100,to:5},answers:{q:'Respuesta original'}}});
 assert.match(harness.root.innerHTML,/name="points"[^>]+max="5"[^>]+step="any"[^>]+value="4"/);assert.match(harness.root.innerHTML,/El estudiante ve 4 \/ 5/);
 assert.match(harness.root.innerHTML,/Escala ajustada de 100 a 5 puntos/);assert.match(harness.root.innerHTML,/Pregunta original/);assert.match(harness.root.innerHTML,/100 puntos/);assert.doesNotMatch(harness.root.innerHTML,/Pregunta actual/);
 assert.equal(original.maxPoints,100);assert.equal(original.questions[0].points,100);
});

test('guardar un comentario conserva una nota convertida con más de dos decimales',async t=>{
 const writes=[],harness=reviewHarness(t,async(path,options)=>{writes.push(options.body);return {points:options.body.points,feedback:options.body.feedback,version:2,gradingMaxPoints:5};},{activity:{maxPoints:5},submission:{points:1.6665,gradingMaxPoints:5,previousActivity:{kind:'task',maxPoints:100},scaleAdjustment:{from:100,to:5}}});
 assert.match(harness.root.innerHTML,/step="any" value="1.6665"/);
 harness.form.values.points='1.6665';harness.form.values.feedback='Comentario sin cambiar la nota.';harness.change();assert.equal(await harness.beforeLeave(),true);
 assert.equal(writes.length,1);assert.equal(writes[0].points,1.6665);assert.equal(writes[0].feedback,'Comentario sin cambiar la nota.');assert.equal(writes[0].published,false);
});

test('un valor fuera de la escala efectiva se conserva en pantalla y no se guarda',async t=>{
 let writes=0;const harness=reviewHarness(t,async()=>{writes++;},{activity:{maxPoints:5},submission:{points:4,gradingMaxPoints:5,previousActivity:{kind:'task',maxPoints:100}}});
 harness.form.values.points='6';harness.input.checkValidity=()=>false;harness.change();assert.equal(await harness.beforeLeave(),false);assert.match(harness.status.textContent,/entre 0 y 5\./);assert.equal(writes,0);assert.equal(harness.form.values.points,'6');
});

test('el historial no invalidado por la conversión conserva su propia escala de 100 puntos',t=>{
 const harness=reviewHarness(t,async()=>{}, {activity:{maxPoints:5},submission:{state:'graded',points:80,published:true,superseded:true,gradingMaxPoints:100,previousActivity:{kind:'task',maxPoints:100,description:'Versión histórica'}}});
 assert.match(harness.root.innerHTML,/<span>100 puntos · 0 %<\/span>/);assert.match(harness.root.innerHTML,/Versión histórica/);assert.doesNotMatch(harness.root.innerHTML,/Escala ajustada|name="points"/);
});
