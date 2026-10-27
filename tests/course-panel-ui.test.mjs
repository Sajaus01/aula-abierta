import test from 'node:test';
import assert from 'node:assert/strict';
import {coursePanelModel,renderCoursePanel} from '../public/course-panel.js';

const now=Date.parse('2026-10-26T15:00:00.000Z');
const makeCourse=()=>({id:'course',title:'Circuitos y simulación',description:'Aprende mediante ejemplos y ejercicios.',coverUrl:'https://example.com/cover.png',enrolled:true,entityKind:'group',cohort:'2026-2',groupCode:'A',chapterOrder:'asc',modules:[{id:'m1',title:'Fundamentos',position:0,resources:[{id:'r1',title:'Magnitudes y unidades',kind:'html',published:true}]}],activities:[{id:'a1',moduleId:'m1',title:'Diseña tu experimento',kind:'task',status:'published',submitted:false,responseState:null,dueAt:'2026-11-06T15:00:00.000Z'}]});
const completedMaterial=[{resourceId:'r1',completed:true,openedAt:'2026-10-25T15:00:00.000Z'}];

test('public visitors see course content without a personal completion claim or personal pending-work panel',()=>{
 const html=renderCoursePanel(makeCourse(),{learner:false,now});
 assert.doesNotMatch(html,/aria-label="Avance total del curso"|Tus actividades|Tus actividades están entregadas/);
 assert.match(html,/Ingresa para guardar tu avance/);assert.match(html,/Magnitudes y unidades/);
});

test('the student course cannot show100 percent when materials are complete but an activity remains',()=>{
 const course=makeCourse(),model=coursePanelModel(course,completedMaterial,{now});
 assert.equal(model.summary.total,2);assert.equal(model.summary.completed,1);assert.equal(model.summary.percent,50);
 const html=renderCoursePanel(course,{progress:completedMaterial,now});
 assert.match(html,/aria-valuenow="50"/);assert.match(html,/Diseña tu experimento/);
 assert.doesNotMatch(html,/100%|Completaste todos los materiales/);
 const filtered=renderCoursePanel(course,{progress:completedMaterial,filter:'activities',now});
 assert.match(filtered,/aria-valuenow="50"/,'filtering the content must not change the global course progress');
});

test('correction is the next action before new materials, while quiz drafts remain pending',()=>{
 const course=makeCourse();course.modules[0].resources.push({id:'r2',title:'Un material sin abrir',kind:'html'});
 course.activities.push({id:'a2',moduleId:'m1',title:'Corrige el informe',kind:'task',status:'published',submitted:false,responseState:'returned',dueAt:'2026-10-24T15:00:00.000Z'});
 course.activities.push({id:'a3',moduleId:null,title:'Cuestionario en borrador',kind:'quiz',status:'published',submitted:false,responseState:'draft'});
 const model=coursePanelModel(course,completedMaterial,{now});
 assert.equal(model.next.type,'activity');assert.equal(model.next.item.id,'a2');
 assert.equal(model.summary.completed,1);assert.equal(model.summary.total,5);
 const html=renderCoursePanel(course,{progress:completedMaterial,now});
 assert.match(html,/Corrige el informe/);assert.match(html,/Cuestionario en borrador/);
});

test('scheduled activities count as requirements without becoming an actionable activity before opening',()=>{
 const course=makeCourse();course.activities=[{...course.activities[0],opensAt:'2026-11-08T15:00:00.000Z',dueAt:'2026-11-10T15:00:00.000Z'}];
 const model=coursePanelModel(course,completedMaterial,{now});
 assert.equal(model.summary.percent,50);assert.equal(model.next.type,'activity');assert.equal(model.next.scheduled,true);
 const html=renderCoursePanel(course,{progress:completedMaterial,now});
 assert.match(html,/programad|disponible|abre/i);
});

test('the course cover and all user text render safely in the header and content',()=>{
 const course=makeCourse();course.title='<img src=x onerror=bad()>';course.description='<script>bad()</script>';
 const html=renderCoursePanel(course,{progress:completedMaterial,now});
 assert.match(html,/src="https:\/\/example.com\/cover.png"/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<img src=x|<script>bad/);
 course.coverUrl='javascript:alert(1)';assert.doesNotMatch(renderCoursePanel(course,{progress:completedMaterial,now}),/src="javascript:/);
});

test('chapter display respects the teacher supplied order without mutating the course or losing general activities',()=>{
 const course=makeCourse();course.chapterOrder='desc';course.modules=[{id:'m3',title:'Diseño avanzado',position:2,resources:[]},course.modules[0]];
 course.activities.push({id:'general',moduleId:null,title:'Reto general del curso',kind:'quiz',status:'published',submitted:false});
 const snapshot=JSON.stringify(course),html=renderCoursePanel(course,{progress:completedMaterial,now});
 const first=html.indexOf('data-module-id="m3"'),second=html.indexOf('data-module-id="m1"');assert.ok(first>=0&&second>first);assert.match(html,/Reto general del curso/);assert.equal(JSON.stringify(course),snapshot);
});

test('student rendering and content filters preserve the server sequence inside descending chapters',()=>{
 const course=makeCourse();course.chapterOrder='desc';
 course.modules[0].resources=[{id:'r-high',title:'A material at position40',position:40,kind:'html',published:true},{id:'r-low',title:'Z material at position3',position:3,kind:'html',published:true}];
 course.activities=[{id:'a-new',moduleId:'m1',title:'Second authored quiz',kind:'quiz',status:'published'},{id:'a-old',moduleId:'m1',title:'First authored task',kind:'task',status:'published'}];
 const before=JSON.stringify(course),model=coursePanelModel(course,[],{now});
 assert.deepEqual(model.modules[0].resources.map(item=>item.id),['r-high','r-low']);
 assert.deepEqual(model.modules[0].activities.map(item=>item.id),['a-new','a-old']);
 for(const filter of ['all','materials','pending']){
  const html=renderCoursePanel(course,{filter,query:'material',now});
  assert.ok(html.indexOf('data-action="resource:r-high"')<html.indexOf('data-action="resource:r-low"'));
 }
 const activities=renderCoursePanel(course,{filter:'activities',now});
 assert.ok(activities.indexOf('aria-label="Abrir Second authored quiz"')<activities.indexOf('aria-label="Abrir First authored task"'));
 assert.equal(JSON.stringify(course),before);
});

test('correction uses its extended deadline, retains priority and does not sort by the expired original deadline',()=>{
 const course=makeCourse(),original='2026-10-20T15:00:00.000Z',extended='2026-11-10T15:00:00.000Z';
 course.activities[0].dueAt='2026-10-28T15:00:00.000Z';
 course.activities.push({id:'returned',moduleId:'m1',title:'Informe por corregir',kind:'task',status:'published',submitted:false,responseState:'returned',dueAt:original,returnDueAt:extended});
 const model=coursePanelModel(course,completedMaterial,{now});
 assert.equal(model.next.item.id,'returned','a requested correction remains the primary action');
 assert.deepEqual(model.upcoming.map(item=>item.id),['a1','returned'],'the agenda orders the replacement deadline, not the old deadline');
 const format=value=>new Date(value).toLocaleString('es-CO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}),html=renderCoursePanel(course,{progress:completedMaterial,now});
 assert.ok(html.includes(format(extended)));assert.equal(html.includes(format(original)),false);
});

test('a correction without a replacement deadline does not bring back the expired original deadline',()=>{
 const course=makeCourse(),original='2026-10-20T15:00:00.000Z';
 course.activities.push({id:'unlimited-return',moduleId:'m1',title:'Corrección sin plazo nuevo',kind:'task',status:'published',submitted:false,responseState:'returned',dueAt:original,returnDueAt:null});
 const model=coursePanelModel(course,completedMaterial,{now});
 assert.equal(model.next.item.id,'unlimited-return');assert.equal(model.upcoming.at(-1).id,'unlimited-return');
 const html=renderCoursePanel(course,{progress:completedMaterial,now}),oldLabel=new Date(original).toLocaleString('es-CO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 assert.equal(html.includes(oldLabel),false);assert.match(html,/Sin fecha límite/);
});

test('chapter numbers remain canonical ranks in ascending and descending views without mutating source modules',()=>{
 const course=makeCourse(),ascending=[{id:'zz',title:'Primero',position:10,resources:[]},{id:'aa',title:'Segundo',position:25,resources:[]},{id:'mm',title:'Tercero',position:40,resources:[]}];
 course.modules=ascending;course.activities=[];
 const snapshot=JSON.stringify(course),first=coursePanelModel(course,[],{now});
 assert.deepEqual(first.modules.map(module=>[module.id,module.number]),[['zz',1],['aa',2],['mm',3]]);assert.equal(JSON.stringify(course),snapshot);
 course.chapterOrder='desc';course.modules=[...ascending].reverse();const reversedSnapshot=JSON.stringify(course),second=coursePanelModel(course,[],{now});
 assert.deepEqual(second.modules.map(module=>[module.id,module.number]),[['mm',3],['aa',2],['zz',1]]);assert.equal(JSON.stringify(course),reversedSnapshot);
});
