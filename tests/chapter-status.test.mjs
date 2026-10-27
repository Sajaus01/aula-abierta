import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterStatus} from '../public/chapter-status.js';
import {summarizeCourseLearning} from '../public/learning.js';

const now=Date.parse('2050-06-10T12:00:00.000Z'),past='2050-06-09T12:00:00.000Z',future='2050-06-12T12:00:00.000Z';
const material=(id='r',more={})=>({id,title:'Material',kind:'html',published:true,...more});
const task=(id='a',more={})=>({id,title:'Actividad',kind:'task',status:'published',responseState:'pending',outcome:{state:'pending',satisfactory:false},...more});
const graded=(id='a',passed=true,more={})=>task(id,{responseState:'graded',submitted:true,outcome:{state:passed?'gradedPass':'gradedBelow',satisfactory:passed},...more});
const status=(resources=[],activities=[],progress=[])=>chapterStatus(resources,activities,progress,{now});

test('an empty chapter and unpublished content never produce a completed chapter',()=>{
 const empty=status();assert.equal(empty.state,'not-started');assert.equal(empty.percent,0);assert.equal(empty.counts.total,0);
 const hidden=status([material('r',{published:false}),material('h',{hidden:true})],[task('a',{status:'draft'}),task('b',{modulePublished:false}),task('c',{hidden:true})]);
 assert.equal(hidden.state,'not-started');assert.equal(hidden.counts.total,0);
});

test('materials progress from not started through opened to complete, including exercises and labs',()=>{
 for(const kind of ['html','exercise','lab']){
  const resources=[material('r',{kind})];
  assert.equal(status(resources).label,'Sin iniciar');
  assert.equal(status(resources,[],[{resourceId:'r',openedAt:past}]).label,'En curso');
  assert.equal(status(resources,[],[{resourceId:'r',completed:true}]).label,'Completado');
 }
});

test('all deliveries can complete action progress while chapter approval still waits for official grades',()=>{
 const activities=[task('a',{responseState:'submitted',submitted:true,outcome:{state:'submitted-awaiting-grade',satisfactory:false}}),task('q',{kind:'quiz',responseState:'graded',points:10,published:false,outcome:{state:'submitted-awaiting-grade',satisfactory:false}})];
 assert.equal(summarizeCourseLearning([],activities,[],{now}).percent,100);
 const result=status([],activities);assert.equal(result.state,'in-progress');assert.equal(result.counts.awaitingGrade,2);assert.equal(result.counts.satisfied,0);assert.match(result.summary,/2 actividades por calificar/);
});

test('a completed chapter requires every material and every published satisfactory activity result',()=>{
 const resources=[material()],activities=[graded()];
 const pendingMaterial=status(resources,activities);assert.equal(pendingMaterial.state,'in-progress');assert.equal(pendingMaterial.counts.satisfied,1);
 const completed=status(resources,activities,[{resourceId:'r',completed:true}]);assert.equal(completed.state,'completed');assert.equal(completed.percent,100);assert.equal(completed.counts.satisfied,2);
 const below=status(resources,[graded('a',false,{dueAt:past,closesAt:past})],[{resourceId:'r',completed:true}]);assert.equal(below.state,'in-progress');assert.equal(below.counts.needsReview,1);assert.equal(below.counts.overdue,0);
});

test('overdue work takes precedence over successful materials and grades without counting deliveries twice',()=>{
 const activities=[graded('passed'),graded('below',false,{dueAt:past}),task('awaiting',{responseState:'submitted',outcome:{state:'submitted-awaiting-grade',satisfactory:false},dueAt:past}),task('missing',{dueAt:past})];
 const result=status([material()],activities,[{resourceId:'r',completed:true}]);
 assert.equal(result.state,'overdue');assert.equal(result.label,'Vencidas sin entrega');assert.equal(result.counts.overdue,1);assert.equal(result.counts.needsReview,1);assert.equal(result.counts.awaitingGrade,1);assert.equal(result.counts.satisfied,2);
});

test('drafts and corrections block an older approval until the current response is resolved',()=>{
 for(const responseState of ['draft','returned']){
  const current=graded('a',true,{responseState,submitted:false,dueAt:future,returnDueAt:future,returnedAt:responseState==='returned'?past:null});
  const result=status([],[current]);assert.equal(result.state,'in-progress');assert.equal(result.counts.satisfied,0);
  assert.equal(result.counts.corrections,responseState==='returned'?1:0);
 }
 const correction=task('returned',{responseState:'returned',returnDueAt:past,returnedAt:past});assert.equal(status([],[correction]).state,'overdue');
});

test('individual deadlines use explicit null, a future extension or a current correction instead of the expired group window',()=>{
 const closed=task('a',{dueAt:past,closesAt:past});assert.equal(status([],[closed]).state,'overdue');
 for(const dueAt of [null,future]){
  const extended={...closed,extension:{active:true,dueAt,updatedAt:past}};
  assert.equal(status([],[extended]).counts.overdue,0);assert.equal(status([],[extended]).state,'not-started');
 }
 assert.equal(status([],[{...closed,extension:{active:true,dueAt:past,updatedAt:past}}]).state,'overdue');
 for(const returnDueAt of [null,future])assert.equal(status([],[{...closed,responseState:'returned',returnedAt:past,returnDueAt}]).counts.overdue,0);
 const resolved={...closed,responseState:'returned',returnDueAt:past,deadline:{source:'extension',opensAt:null,dueAt:null,closesAt:null,allowLate:false}};assert.equal(status([],[resolved]).counts.overdue,0);
});

test('a missing activity stays visibly overdue even if a continuity policy marks it finished',()=>{
 const missing=task('a',{responseState:'missing',submitted:true,finished:true,points:0,ready:true});
 const result=status([],[missing]);assert.equal(result.state,'overdue');assert.equal(result.counts.satisfied,0);assert.equal(result.percent,0);
 const reopened={...missing,deadline:{source:'extension',opensAt:null,dueAt:null,closesAt:null,allowLate:false}};assert.equal(status([],[reopened]).state,'in-progress');assert.equal(status([],[reopened]).counts.overdue,0);
});

test('an explicit exemption satisfies its requirement without requiring a response or erasing material work',()=>{
 const exempt=task('a',{responseState:'missing',dueAt:past,outcome:{state:'exempt',satisfactory:true}});
 const result=status([],[exempt]);assert.equal(result.state,'completed');assert.equal(result.counts.exempt,1);assert.equal(result.counts.overdue,0);assert.match(result.summary,/1 actividad exenta/);
 assert.equal(status([material()],[exempt]).state,'in-progress');
});

test('visible scheduled activities remain requirements and never make an unfinished chapter green',()=>{
 const futureTask=task('a',{opensAt:future,dueAt:future});
 const untouched=status([],[futureTask]);assert.equal(untouched.state,'not-started');assert.equal(untouched.counts.scheduled,1);
 const materialDone=status([material()],[futureTask],[{resourceId:'r',completed:true}]);assert.equal(materialDone.state,'in-progress');assert.equal(materialDone.percent,50);assert.match(materialDone.summary,/actividad programada/);
});

test('resources and activities use separate identifiers, deduplicate within their type and enforce the exact deadline',()=>{
 const result=status([material('same'),material('same')],[graded('same'),graded('same')],[{resourceId:'same',completed:true}]);assert.equal(result.counts.total,2);assert.equal(result.state,'completed');
 assert.equal(status([],[task('a',{dueAt:new Date(now).toISOString()})]).state,'overdue');
 assert.equal(status([],[task('a',{dueAt:past,allowLate:true})]).state,'overdue','an open late-delivery window does not erase the missed due date');
 assert.equal(status([],[task('a',{closesAt:past})]).state,'overdue');
});

test('unknown outcomes and a stale approval on an explicitly pending response cannot manufacture completion',()=>{
 assert.notEqual(status([],[task('a',{outcome:{state:'unknown',satisfactory:true}})]).state,'completed');
 assert.notEqual(status([],[task('a',{outcome:{state:'gradedPass',satisfactory:true}})]).state,'completed');
});
