import test from 'node:test';
import assert from 'node:assert/strict';
import { materialStatus, summarizeLearning, summarizeCourseLearning, activityCompleted, quickGuide } from '../public/learning.js';

test('abrir no completa un material y desmarcarlo conserva que fue abierto', () => {
  const rows = [{ resourceId:'a', completed:false, openedAt:'2026-09-18T10:00:00.000Z' }, { resourceId:'b', completed:true }];
  assert.equal(materialStatus('a', rows), 'opened');
  assert.equal(materialStatus('b', rows), 'completed');
  assert.equal(materialStatus('c', rows), 'unopened');
});

test('el resumen cuenta solo materiales actuales, sin duplicados ni progreso ajeno', () => {
  const resources = [{ id:'a', kind:'html' }, { id:'b', kind:'exercise' }, { id:'c', kind:'exercise' }, { id:'a', kind:'html' }];
  const rows = [{ resourceId:'a', completed:true }, { resourceId:'b', completed:false, lastOpenedAt:'2026-09-18T10:00:00.000Z' }, { resourceId:'otro-curso', completed:true }];
  assert.deepEqual(summarizeLearning(resources, rows), { total:3, completed:1, opened:2, pending:2, unopened:1, inProgress:1, percent:33, next:resources[1], exercisesTotal:2, exercisesCompleted:0 });
});

test('los cursos vacíos y terminados no inventan un siguiente material', () => {
  assert.equal(summarizeLearning().percent, 0);
  assert.equal(summarizeLearning().next, null);
  const done = summarizeLearning([{ id:'a', kind:'exercise' }], [{ resourceId:'a', completed:true }]);
  assert.equal(done.percent, 100);
  assert.equal(done.next, null);
  assert.equal(done.exercisesCompleted, 1);
});

test('la guía del estudiante no contiene instrucciones de administración', () => {
  const student = quickGuide('student').flat().join(' ');
  assert.doesNotMatch(student, /crea el curso|registra y matricula|lista CSV|publica el curso|modalidad:/i);
  assert.match(student, /Abrirlo no significa haberlo completado/);
  assert.match(quickGuide('admin').flat().join(' '), /Registra y matricula/);
  assert.deepEqual(quickGuide(undefined), quickGuide('student'));
});

test('el avance total incluye tareas y cuestionarios y no termina al completar los materiales',()=>{
  const resources=[{id:'material',kind:'html'},{id:'material',kind:'html'},{id:'draft',published:false}];
  const activities=[{id:'task',kind:'task',status:'published',submitted:true,responseState:'submitted'},{id:'quiz',kind:'quiz',status:'published',responseState:'draft'},{id:'quiz',kind:'quiz',status:'published',responseState:'draft'},{id:'hidden',status:'draft'}];
  let summary=summarizeCourseLearning(resources,activities,[{resourceId:'material',completed:true}]);
  assert.equal(summary.materials.completed,1);assert.equal(summary.materials.total,1);
  assert.equal(summary.activities.total,2);assert.equal(summary.activities.completed,1);assert.equal(summary.activities.quizzesCompleted,0);
  assert.equal(summary.total,3);assert.equal(summary.completed,2);assert.equal(summary.percent,67);assert.equal(summary.pending,1);
  assert.equal(summary.next.type,'activity');assert.equal(summary.next.item.id,'quiz');
  activities[2].responseState='graded';
  summary=summarizeCourseLearning(resources,activities,[{resourceId:'material',completed:true}]);
  assert.equal(summary.percent,100);assert.equal(summary.pending,0);assert.equal(summary.next,null);
});

test('una corrección solicitada vuelve a contar como pendiente aunque antes se hubiera enviado',()=>{
  const task={id:'task',kind:'task',status:'published',submitted:true,responseState:'returned'};
  assert.equal(activityCompleted(task),false);assert.equal(activityCompleted({...task,responseState:'draft'}),false);
  assert.equal(activityCompleted({state:'returned',submitted:true}),false);
  assert.equal(activityCompleted({...task,responseState:'submitted',points:null}),true);
  assert.equal(activityCompleted({...task,responseState:'graded',published:false,points:null}),true);
  const summary=summarizeCourseLearning([],[task]);
  assert.equal(summary.activities.returned,1);assert.equal(summary.activities.completed,0);assert.equal(summary.percent,0);
});

test('las actividades programadas visibles cuentan pero el siguiente paso elige primero las abiertas',()=>{
  const future={id:'future',kind:'quiz',status:'published',opensAt:'2030-01-01T00:00:00.000Z'},available={id:'ready',kind:'task',status:'published',dueAt:'2025-01-01T00:00:00.000Z'};
  const summary=summarizeCourseLearning([],[future,available],[],{now:'2026-01-01T00:00:00.000Z'});
  assert.equal(summary.total,2);assert.equal(summary.pending,2);assert.equal(summary.activities.scheduled,1);
  assert.equal(summary.activities.next.id,'ready');assert.equal(summary.next.scheduled,false);
  const waiting=summarizeCourseLearning([],[future],[],{now:'2026-01-01T00:00:00.000Z'});
  assert.equal(waiting.next.item.id,'future');assert.equal(waiting.next.scheduled,true);
});

test('los identificadores de material y actividad tienen espacios separados y 100 exige que no falte nada',()=>{
  const same=summarizeCourseLearning([{id:'shared'}],[{id:'shared',kind:'task',submitted:true}],[{resourceId:'shared',completed:true}]);
  assert.equal(same.total,2);assert.equal(same.completed,2);assert.equal(same.percent,100);
  const resources=Array.from({length:1000},(_,index)=>({id:'material-'+index})),progress=resources.map(resource=>({resourceId:resource.id,completed:true}));
  const almost=summarizeCourseLearning(resources,[{id:'last-quiz',kind:'quiz',status:'published'}],progress);
  assert.equal(almost.total,1001);assert.equal(almost.completed,1000);assert.equal(almost.pending,1);assert.equal(almost.percent,99);
  const empty=summarizeCourseLearning();assert.equal(empty.percent,0);assert.equal(empty.next,null);
});
