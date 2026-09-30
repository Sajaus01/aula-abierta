import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCategory,reviewStatus,returnBlockReason,answerAssessment,createActivityReview} from '../public/activity-review.js';

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
