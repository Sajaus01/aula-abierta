import test from 'node:test';
import assert from 'node:assert/strict';
import {activityEvaluationState,activityEvaluationAttributes,activityEvaluationHTML,activityEvaluationPresentation,activityEvaluationSummaryHTML} from '../public/activity-evaluation.js';
import {createAcademicUI} from '../public/academics.js';

const evaluation=(state,counts={})=>({state,submitted:0,evaluated:0,pending:0,unreleased:0,returned:0,...counts});
const activity=(id,state,counts={})=>({id,courseId:'group',title:'Actividad '+id,description:'Instrucciones.',kind:'task',status:'published',maxPoints:5,weight:50,version:1,revision:1,maxAttempts:1,questions:[],attachments:[],evaluation:evaluation(state,counts)});

test('evaluation badges trust the server state and never infer completion from submission counts or an automatic zero',()=>{
 const labels={evaluated:'Evaluada',pending:'Por calificar',empty:'Sin entregas',correction:'En corrección',draft:'Borrador',archived:'Archivada'};
 for(const [state,label]of Object.entries(labels)){const value=activity('a',state),html=activityEvaluationHTML(value);assert.equal(activityEvaluationState(value),state);assert.match(html,new RegExp('data-activity-evaluation="'+state+'"'));assert.ok(html.includes(label));assert.match(html,/activity-evaluation-dot/);}
 for(const value of [{submissionCount:20,points:5,published:true},{closure:{closed:true,points:0}},activity('a','unexpected')]){assert.equal(activityEvaluationState(value),'');assert.equal(activityEvaluationAttributes(value),'');assert.equal(activityEvaluationHTML(value),'');}
 const closed=activityEvaluationHTML({...activity('closed','empty'),closure:{closed:true,points:0},submissionCount:50});assert.match(closed,/Sin entregas/);assert.doesNotMatch(closed,/>Evaluada</);
});

test('a saved grade is evaluated while its pending delivery to the learner remains explicit',()=>{
 const a=activity('a','evaluated',{submitted:2,evaluated:2,unreleased:2}),html=activityEvaluationHTML(a),view=activityEvaluationPresentation(a);
 assert.match(html,/>Evaluada</);assert.match(html,/2 por devolver/);assert.match(view.description,/2 notas guardadas por devolver/);assert.doesNotMatch(html,/data-activity-evaluation="pending"/);
 const pending=activityEvaluationHTML(activity('b','pending',{submitted:3,evaluated:2,pending:1,unreleased:2}));assert.match(pending,/Por calificar/);assert.match(pending,/1 entrega · 2 por devolver/);
 const compact=activityEvaluationHTML(activity('b','pending',{submitted:3,evaluated:2,pending:1,unreleased:2}),{compact:true});assert.match(compact,/<small class="activity-evaluation-detail">2 por devolver<\/small>/);assert.doesNotMatch(compact,/>1 entrega ·/);assert.match(compact,/1 entrega por calificar/);
});

test('corrections remain distinct from unevaluated new submissions without inventing a green state',()=>{
 const a=activity('a','correction',{submitted:4,evaluated:4,returned:1}),view=activityEvaluationPresentation(a),html=activityEvaluationHTML(a);
 assert.equal(view.state,'correction');assert.equal(view.counts.returned,1);assert.match(html,/En corrección/);assert.match(html,/1 entrega en corrección/);assert.doesNotMatch(html,/data-activity-evaluation="evaluated"/);
});

test('summaries count activities rather than students or submissions and separate unpublished activities',()=>{
 const activities=[activity('graded','evaluated',{submitted:50,evaluated:50,unreleased:4}),activity('waiting','pending',{submitted:10,evaluated:9,pending:1,unreleased:3}),activity('returned','correction',{returned:2}),activity('empty','empty'),{...activity('draft','draft'),status:'draft'},{...activity('archive','archived'),status:'archived'}];
 const html=activityEvaluationSummaryHTML(activities,{compact:true});assert.match(html,/1 evaluada/);assert.match(html,/1 por calificar/);assert.match(html,/1 en corrección/);assert.match(html,/1 sin entregas/);assert.match(html,/7 notas por devolver/);assert.doesNotMatch(html,/50 evaluadas|10 por calificar|en borrador|archivada/);
 const all=activityEvaluationSummaryHTML(activities,{includeUnpublished:true});assert.match(all,/1 en borrador/);assert.match(all,/1 archivada/);
 assert.equal(activityEvaluationSummaryHTML([{submissionCount:50}]),'');assert.match(activityEvaluationSummaryHTML([activities[4]]),/Sin actividades publicadas/);
});

test('only controlled labels and numeric counters reach HTML attributes and tooltips',()=>{
 assert.equal(activityEvaluationHTML({evaluation:{state:'"><script>bad()</script>'}}),'');
 const html=activityEvaluationHTML(activity('<img>','pending',{submitted:'<img>',pending:'"><script>',unreleased:'2'}));assert.doesNotMatch(html,/<img|<script|onerror/);assert.match(html,/2 por devolver/);
 const attributes=activityEvaluationAttributes(activity('a','evaluated'));assert.equal(attributes,' data-activity-evaluation-state="evaluated"');
});

function fixture({grade=true,learner=false,preview=false}={}){
 const course={id:'group',title:'Curso <img src=x onerror=bad()>',entityKind:'group',permissions:{grade,edit:true},modules:[]};
 const activities=[activity('graded','evaluated',{submitted:2,evaluated:2,unreleased:1}),activity('waiting','pending',{submitted:1,pending:1}),activity('empty','empty')];
 const settings={scaleMax:5,passMark:3,periods:[],finalPublished:false,missingAsZero:false};
 const student={id:'student',name:'Alumno',document:'synthetic',active:true,status:'active',ready:false,accumulated:1,gradedWeight:50,final:null,cells:activities.map(a=>({activityId:a.id,title:a.title,maxPoints:a.maxPoints,weight:a.weight,state:'pending',points:null,published:false}))};
 const state={assurance:'password',preview:preview?'group':null,viewMode:learner?'learning':'teaching',user:{role:learner?'student':'admin',roles:[learner?'student':'teacher']},courses:[course]},calls=[];
 const api=async path=>{calls.push(path);if(path==='/academics/courses')return [{id:course.id,title:course.title,pending:99,activities}];if(path==='/storage/mine')return {own:{usedBytes:0,limitBytes:null}};if(path==='/academics/courses/group')return {course,settings,activities,grade:{cells:student.cells,accumulated:1,gradedWeight:50,final:null,periods:[]}};if(path==='/academics/courses/group/gradebook')return {course,settings,activities,students:[student]};if(path.startsWith('/analytics/'))throw Error('Synthetic unavailable analytics');if(path.startsWith('/academics/activities/')&&path.endsWith('/submissions'))return {activity:activities.find(a=>path.includes('/'+a.id+'/')),submissions:[],closures:[]};if(path.startsWith('/academics/activities/'))return {course,activity:activities.find(a=>path.endsWith('/'+a.id)),mine:[]};if(path==='/courses/group')return course;throw Error('Unexpected request '+path);};
 const ui=createAcademicUI({api,getState:()=>state,modal:{},openModal(){},toast(){},render(){},btn:(label,action)=>`<button data-action="${action}">${label}</button>`,icon:()=>'',heading:title=>`<h1>${title}</h1>`,empty:title=>`<p>${title}</p>`});
 return {ui,state,activities,calls};
}

test('teacher activity list has state labels and row tint targets only with grading permission',async()=>{
 const allowed=await fixture().ui.pageHTML('actividades/group');assert.match(allowed,/class="activity-management-row" data-activity-evaluation-state="evaluated"/);assert.match(allowed,/class="activity-management-row" data-activity-evaluation-state="pending"/);assert.match(allowed,/>Evaluada</);assert.match(allowed,/>Por calificar</);assert.match(allowed,/1 por devolver/);assert.match(allowed,/class="activity-management-meta"><span>Tarea<\/span><span class="activity-evaluation compact"/);
 const denied=await fixture({grade:false}).ui.pageHTML('actividades/group');assert.doesNotMatch(denied,/data-activity-evaluation|activity-evaluation-detail/);assert.match(denied,/Abrir actividad/);
});

test('course overview uses evaluation counts and does not repeat the former mixed grading/publication backlog',async()=>{
 const html=await fixture().ui.pageHTML('tareas');assert.match(html,/1 evaluada/);assert.match(html,/1 por calificar/);assert.match(html,/1 sin entregas/);assert.doesNotMatch(html,/99 entregas pendientes/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
 const denied=await fixture({grade:false}).ui.pageHTML('tareas');assert.doesNotMatch(denied,/activity-evaluation/);assert.match(denied,/Consulta las actividades del grupo/);
});

test('teacher detail and workbench have consistent server state without deriving it from empty local submissions',async()=>{
 const html=await fixture().ui.pageHTML('actividad/graded');assert.match(html,/class="grading-activity-meta" data-activity-evaluation-state="evaluated"/);assert.match(html,/class="panel submission-workbench" data-activity-evaluation-state="evaluated"/);assert.match(html,/>Evaluada</);assert.match(html,/1 por devolver/);
 const denied=await fixture({grade:false}).ui.pageHTML('actividad/graded');assert.doesNotMatch(denied,/data-activity-evaluation|activity-evaluation-detail/);
});

test('gradebook matrix headers report activity evaluation separately from each student grade',async()=>{
 const html=await fixture().ui.pageHTML('calificaciones/group');assert.match(html,/<th data-activity-evaluation-state="evaluated"><a class="gradebook-activity-title"/);assert.match(html,/<th data-activity-evaluation-state="pending"><a class="gradebook-activity-title"/);assert.match(html,/activity-evaluation compact/);
});

test('learner and preview routes never show a teacher badge even when a synthetic DTO contains evaluation',async()=>{
 for(const options of [{learner:true},{preview:true}]){
  const setup=fixture(options);for(const route of ['tareas','actividades/group','actividad/graded']){const html=await setup.ui.pageHTML(route);assert.doesNotMatch(html,/data-activity-evaluation|activity-evaluation-detail|1 por devolver/);}
  assert.ok(setup.calls.every(path=>!path.endsWith('/submissions')));
 }
});

test('shared legacy course rows preserve their actions while permission-gating teacher evaluation',()=>{
 const setup=fixture();setup.state.currentCourse=setup.state.courses[0];assert.match(setup.ui.courseRows(setup.activities),/data-activity-evaluation-state="pending"/);
 setup.state.courses[0].permissions.grade=false;assert.doesNotMatch(setup.ui.courseRows(setup.activities),/data-activity-evaluation/);
});
