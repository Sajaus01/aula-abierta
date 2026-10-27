import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcademicUI} from '../public/academics.js';
import {periodTable} from '../public/grade-policy.js';

const settings={scaleMax:5,passMark:3,missingAsZero:false,finalPublished:false,periods:[]};
function grade(overrides={}){
 return {accumulated:1.6,provisional:4,gradedWeight:40,final:null,ready:false,periods:[],cells:[
  {activityId:'graded',title:'Trabajo calificado',weight:40,maxPoints:5,points:4,published:true,state:'graded'},
  {activityId:'pending',title:'Trabajo sin entregar',weight:30,maxPoints:5,points:null,published:false,state:'pending'},
  {activityId:'submitted',title:'Trabajo por calificar',weight:20,maxPoints:5,points:null,published:false,state:'submitted'},
  {activityId:'returned',title:'Trabajo por corregir',weight:10,maxPoints:5,points:null,published:false,state:'returned'}
 ],...overrides};
}
function fixture({teacher=false,result=grade(),evaluation=settings}={}){
 const course={id:'course',title:'Curso de prueba',permissions:{grade:true}},state={assurance:'password',viewMode:teacher?'teaching':'learning',courses:[course],user:{id:teacher?'teacher':'student',role:teacher?'admin':'student',roles:[teacher?'teacher':'student']}};
 const activities=result.cells.map(cell=>({id:cell.activityId,title:cell.title,weight:cell.weight,maxPoints:cell.maxPoints,status:'published'}));
 const data={course,settings:evaluation,activities,...(teacher?{students:[{id:'student',name:'Estudiante',document:'test-student',active:true,status:'active',...result}]}:{grade:result})};
 let opened=null;
 const ui=createAcademicUI({
  getState:()=>state,
  api:async path=>{assert.equal(path,'/academics/courses/course'+(teacher?'/gradebook':''));return data;},
  openModal:(title,html)=>{opened={title,html};},modal:{},toast:()=>{},render:async()=>{},
  btn:label=>`<button>${label}</button>`,icon:()=>'',heading:title=>`<h1>${title}</h1>`,empty:(title,description)=>`<p>${title}: ${description}</p>`
 });
 return {ui,modal:()=>opened};
}

test('student gradebook leads with the contribution to the full semester and preserves pending states',async()=>{
 const {ui}=fixture(),html=await ui.pageHTML('calificaciones/course');
 assert.match(html,/<strong>1,6 \/ 5<\/strong><span>Nota acumulada sobre el 100 %<\/span>/);
 assert.doesNotMatch(html,/Promedio de notas publicadas|<strong>4<\/strong>/);
 assert.match(html,/sin redistribuir su peso ni cambiar los estados pendientes/);
 assert.match(html,/No es una nota definitiva/);
 assert.match(html,/<strong>—<\/strong><span>Nota final publicada<\/span>/);
 assert.match(html,/Trabajo sin entregar<\/a><\/td><td>30 %<\/td><td>— \/ 5<\/td><td>Sin entregar/);
 assert.match(html,/Trabajo por calificar<\/a><\/td><td>20 %<\/td><td>— \/ 5<\/td><td>Resultado pendiente/);
 assert.match(html,/Trabajo por corregir<\/a><\/td><td>10 %<\/td><td>— \/ 5<\/td><td>Devuelta para corregir/);
 assert.doesNotMatch(html,/<td>0 \/ 5<\/td>/);
});

test('zero accumulation and an unavailable accumulation never fall back to the evaluated average',async()=>{
 for(const [value,label] of [[0,'0'],[null,'—']]){
  const {ui}=fixture({result:grade({accumulated:value,provisional:4})});
  const html=await ui.pageHTML('calificaciones/course');
  assert.ok(html.includes(`<strong>${label} / 5</strong><span>Nota acumulada sobre el 100 %</span>`));
  assert.equal(html.includes('<strong>4 / 5</strong>'),false);
 }
});

test('published final grades remain a distinct student indicator',async()=>{
 const {ui}=fixture({result:grade({accumulated:4,final:4,ready:true}),evaluation:{...settings,finalPublished:true}});
 const html=await ui.pageHTML('calificaciones/course');
 assert.match(html,/<strong>4 \/ 5<\/strong><span>Nota acumulada sobre el 100 %<\/span>/);
 assert.match(html,/<strong>4<\/strong><span>Nota final publicada<\/span>/);
});

test('teacher gradebook shows accumulated points and explains that private grades are included',async()=>{
 const {ui}=fixture({teacher:true}),html=await ui.pageHTML('calificaciones/course');
 assert.match(html,/<th>Nota acumulada sobre el 100 %<\/th>/);
 assert.match(html,/<strong>1,6 \/ 5<\/strong><span class="muted">40 % evaluado<\/span>/);
 assert.doesNotMatch(html,/<th>Promedio provisional<\/th>/);
 assert.match(html,/notas guardadas sin devolver, visibles solo para ti/);
 assert.match(html,/lo pendiente aporta cero provisional sin cambiar su estado/);
 assert.match(html,/Trabajo sin entregar[\s\S]*?>—<\/a><span class="muted">Sin entregar<\/span>/);
});

test('period results use the accumulated grade of the whole period rather than its evaluated average',()=>{
 const data={settings:{...settings,periods:[{id:'one',title:'Primer corte',weight:40}]},grade:grade({periods:[{id:'one',title:'Primer corte',weight:40,weightTotal:40,gradedWeight:40,accumulated:1.6,provisional:4,ready:false,allExempt:false}]})};
 const html=periodTable(data,false);
 assert.match(html,/nota acumulada sobre el 100 % de su corte/);
 assert.match(html,/<td>1,6 \/ 5<small>En curso · 40 % asignado<\/small>/);
 assert.doesNotMatch(html,/<td>4<small>/);
 assert.match(html,/Las exenciones redistribuyen su peso/);
});

test('gradebook CSV exports accumulation and leaves pending activity grades empty',async()=>{
 const result=grade({periods:[{id:'one',accumulated:1.6,provisional:4}]});
 const {ui,modal}=fixture({teacher:true,result,evaluation:{...settings,periods:[{id:'one',title:'Primer corte',weight:100}]}});
 try{
  await ui.pageHTML('calificaciones/course');await ui.action('academic-export');
  const dialog=modal();assert.equal(dialog.title,'Descargar libro de calificaciones');
  const url=/href="(blob:[^"]+)"/.exec(dialog.html)[1],csv=await (await fetch(url)).text();
  const [header,row]=csv.split('\r\n');
  assert.match(header,/"Corte: Primer corte · acumulada sobre el 100 %","nota_acumulada_sobre_100","promedio_provisional","nota_final"$/);
  assert.equal(row,'"test-student","Estudiante","4","","","","1.6","1.6","4",""');
 }finally{ui.dispose();}
});
