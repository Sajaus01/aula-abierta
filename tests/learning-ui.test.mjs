import test from 'node:test';
import assert from 'node:assert/strict';
import { materialStatus, summarizeLearning, quickGuide } from '../public/learning.js';

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

