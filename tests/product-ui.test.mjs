import test from 'node:test';
import assert from 'node:assert/strict';
import {courseEntryActions,navigationItems,manageableGroups,validatePeriods} from '../public/ui.js';
import {createQuickResourcesUI} from '../public/quick-resources.js';
import {button,icon} from '../public/ui.js';

test('el acceso al curso permanece visible al iniciar, avanzar, terminar y estar bloqueado',()=>{
 for(const [course,learning] of [[{id:'one'},null],[{id:'one'},{opened:0,nextResource:{id:'r1'}}],[{id:'one'},{opened:2,nextResource:{id:'r1'}}],[{id:'one'},{opened:2,nextResource:null}],[{id:'one',locked:true},{opened:1,nextResource:{id:'r1'}}]]){
  const html=courseEntryActions(course,learning);assert.match(html,/href="#curso\/one"/);assert.match(html,/>Abrir curso<\/a>/);
  assert.equal(html.includes('data-action="study:'),!!(!course.locked&&learning?.opened&&learning?.nextResource));
 }
});
test('la navegación mantiene separados permisos de estudiante, docente y administración',()=>{
 const items=user=>navigationItems(user).map(x=>x[0]);
 assert.deepEqual(items({role:'student',roles:['student']}),['mis-cursos','tareas','catalogo']);
 assert.ok(items({role:'admin',roles:['teacher']}).includes('grupos'));
 assert.ok(!items({role:'admin',roles:['teacher']}).includes('usuarios'));
 assert.ok(!items({role:'admin',roles:['admin']}).includes('panorama'));
 assert.ok(items({role:'admin',roles:['master']}).includes('panorama'));
 assert.deepEqual(navigationItems({role:'admin',roles:['master']},true).map(x=>x[0]),['mis-cursos','tareas','catalogo']);
});
test('los destinos de matrícula excluyen plantillas, grupos archivados, origen y grupos sin gestión',()=>{
 const base={entityKind:'group',lifecycle:'active',permissions:{manage:true}};
 const options=[{...base,id:'source'},{...base,id:'good'},{...base,id:'template',entityKind:'template'},{...base,id:'archive',lifecycle:'archived'},{...base,id:'read',permissions:{manage:false}}];
 assert.deepEqual(manageableGroups(options,'source').map(x=>x.id),['good']);
});
test('editar porcentajes conserva los identificadores y valida la distribución completa',()=>{
 const periods=[{id:'original-cut',title:'Primer corte',weight:30},{id:'second-cut',title:'Segundo corte',weight:70}];
 assert.equal(validatePeriods(periods),periods);assert.equal(periods[0].id,'original-cut');assert.deepEqual(validatePeriods([]),[]);
 assert.throws(()=>validatePeriods([{id:'a',title:'Corte',weight:20}]),/100/);
 assert.throws(()=>validatePeriods([{id:'a',title:'',weight:100}]),/nombre/);
 assert.throws(()=>validatePeriods([{id:'a',title:'Uno',weight:50},{id:'a',title:'Dos',weight:50}]),/repetido/);
 assert.throws(()=>validatePeriods([{id:'a',title:'Uno',weight:NaN}]),/porcentaje/);
});

test('los recursos rápidos se pueden abrir con permiso de lectura sin mostrar herramientas de edición',()=>{
 const course={id:'group',permissions:{edit:false},quickResources:[{id:'video1',kind:'video',title:'Tutorial',visible:true,url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}]};
 for(const role of ['student','admin']){
  const ui=createQuickResourcesUI({getState:()=>({user:{role},currentCourse:course}),btn:button,icon});
  const html=ui.panel(course);assert.match(html,/data-action="quick-view:video1"/);assert.doesNotMatch(html,/data-action="quick-(new|edit|delete|up|down):/);
 }
});
