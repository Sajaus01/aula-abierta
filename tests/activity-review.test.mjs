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

function reviewHarness(t,request){
 const previousFormData=globalThis.FormData;
 globalThis.FormData=class{constructor(form){this.values={...form.values};}get(name){return this.values[name]??null;}has(name){return Boolean(this.values[name]);}};
 t.after(()=>{globalThis.FormData=previousFormData;});
 const handlers=new Map(),status={textContent:'',classList:{toggle(){}}},error={textContent:''};
 const input={checkValidity:()=>true},form={values:{points:'12',feedback:'Revisar unidades.'},querySelector:()=>input};
 const root={innerHTML:'',inert:false},elements=new Map([['[data-review-root]',root],['[data-review=prev]',{}],['[data-review=next]',{}],['[data-review=release-all]',{}],['[data-queue-count]',{}],['.review-queue-list',{}],['.review-response-pane',{focus(){}}],['#review-grade-form',form],['[data-save-status]',status],['#review-grade-form .review-error',error]]);
 let closed=0;
 const modal={open:false,dataset:{},classList:{add(){}},querySelector:selector=>elements.get(selector),setAttribute(){},removeAttribute(){},close(){closed++;this.open=false;},addEventListener(event,fn,options){const list=handlers.get(event)||[];list.push({fn,options});handlers.set(event,list);}};
 const review=createActivityReview({modal,openModal:()=>{modal.open=true;},icon:()=>'',questionMedia:()=>'',api:request,toast(){},render(){}});
 t.after(()=>review.dispose());
 review.open({activity:{id:'activity',kind:'task',maxPoints:100,status:'published',title:'Actividad',weight:0},submissions:[{id:'submission',name:'Prueba',state:'submitted',points:null,studentId:'student',attempt:1,version:1}],id:'submission'});
 const change=()=>handlers.get('input')[0].fn({target:{id:'',closest:selector=>selector==='#review-grade-form'?form:null,matches:()=>true}});
 const close=()=>handlers.get('click').find(h=>h.options.capture).fn({target:{closest:selector=>selector==='[data-action="close-modal"]'?{}:null},preventDefault(){},stopImmediatePropagation(){}});
 const action=name=>handlers.get('click').find(h=>!h.options.capture).fn({target:{closest:selector=>selector==='[data-review]'?{dataset:{review:name}}:null}});
 return {form,change,close,action,status,error,root,closed:()=>closed};
}

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
