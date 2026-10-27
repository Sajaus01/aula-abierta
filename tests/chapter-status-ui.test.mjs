import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCoursePanel,coursePanelModel,courseActivityStatus} from '../public/course-panel.js';

const now=Date.parse('2035-02-01T15:00:00.000Z');
const resource=id=>({id,title:'Material '+id,kind:'html',published:true});
const activity=(id,moduleId,extra={})=>({id,moduleId,title:'Actividad '+id,kind:'task',status:'published',responseState:'pending',dueAt:'2035-02-10T15:00:00.000Z',...extra});
const course=()=>({id:'group',title:'Curso',entityKind:'group',modules:[{id:'chapter',title:'Capítulo',position:0,resources:[resource('material')]}],activities:[activity('task','chapter')]});
const progress=[{resourceId:'material',completed:true}];
function chapter(html,id='chapter'){
 const at=html.indexOf('data-module-id="'+id+'"');assert.notEqual(at,-1);
 return html.slice(html.lastIndexOf('<details',at),html.indexOf('</details>',at)+10);
}
const summary=html=>html.slice(0,html.indexOf('</summary>')+10);

test('every state is visible inside a closed chapter through a label, icon and requirement count',()=>{
 const cases=[
  {state:'not-started',label:'Sin iniciar',data:course(),progress:[]},
  {state:'in-progress',label:'En curso',data:course(),progress},
  {state:'completed',label:'Completado',data:{...course(),activities:[activity('task','chapter',{responseState:'graded',outcome:{state:'gradedPass',satisfactory:true}})]},progress},
  {state:'overdue',label:'Vencidas sin entrega',data:{...course(),activities:[activity('task','chapter',{dueAt:'2035-01-31T15:00:00.000Z'})]},progress:[]}
 ];
 for(const item of cases){
  const html=renderCoursePanel(item.data,{progress:item.progress,now,openChapters:new Set()}),part=chapter(html),head=summary(part);
  assert.match(head,new RegExp('data-chapter-state="'+item.state+'"'));assert.match(head,new RegExp(item.label));
  assert.doesNotMatch(part.split('>')[0],/\bopen(?:\s|$)/);
  assert.match(head,/course-chapter-status[^>]*>[\s\S]*<svg[^>]+aria-hidden="true"/);assert.match(head,/requisitos cumplidos/);
  if(item.state==='overdue')assert.match(head,/course-chapter-status-count">1<span class="sr-only"> actividades vencidas sin entrega/);
 }
});

test('an ungraded submission keeps the chapter blue while the course action progress remains unchanged',()=>{
 const data=course();data.activities[0]={...data.activities[0],submitted:true,responseState:'submitted',outcome:{state:'submitted-awaiting-grade',satisfactory:false}};
 const model=coursePanelModel(data,progress,{now}),html=renderCoursePanel(data,{progress,now}),part=chapter(html);
 assert.equal(model.summary.percent,100);assert.match(html,/aria-label="Avance total del curso" aria-valuenow="100"/);
 assert.match(summary(part),/data-chapter-state="in-progress"/);assert.match(summary(part),/1\/2<span class="sr-only"> requisitos cumplidos/);assert.match(summary(part),/style="width:50%"/);
 assert.match(part,/1 actividad por calificar/);assert.match(summary(part),/<small class="course-chapter-status-detail">1 por calificar<\/small>/);assert.doesNotMatch(html,/Completaste el contenido publicado|Todo lo publicado está completado/);
 assert.match(html,/Avance registrado · revisa el estado de tus capítulos/);assert.match(html,/materiales completados y actividades aprobadas o exentas/i);
});

test('a known result below the pass threshold stays in progress and remains distinct from missing work',()=>{
 const data=course();data.activities[0]={...data.activities[0],submitted:true,responseState:'graded',outcome:{state:'gradedBelow',satisfactory:false}};
 const part=chapter(renderCoursePanel(data,{progress,now}));
 assert.match(summary(part),/data-chapter-state="in-progress"/);assert.match(part,/resultado por debajo del umbral de aprobación/);assert.match(summary(part),/<small class="course-chapter-status-detail">1 resultado por revisar<\/small>/);assert.doesNotMatch(summary(part),/Vencidas sin entrega|Completado/);
});

test('an exemption satisfies its requirement without inventing a submission or showing zero of one',()=>{
 const data=course();data.modules[0].resources=[];data.activities[0].outcome={state:'exempt',satisfactory:true};
 const part=chapter(renderCoursePanel(data,{now}));
 assert.match(summary(part),/data-chapter-state="completed"/);assert.match(summary(part),/1\/1<span class="sr-only"> requisitos cumplidos/);assert.match(summary(part),/style="width:100%"/);
 assert.match(part,/1 actividad exenta/);assert.doesNotMatch(summary(part),/0\/1/);assert.equal(data.activities[0].responseState,'pending');
 assert.deepEqual(courseActivityStatus(data.activities[0],{now}),{label:'Exenta',tone:'done'});assert.match(part,/>Exenta<\/span>/);
});

test('a missed delivery remains red regardless of unrelated completed material and published approvals',()=>{
 const data=course();data.activities.push(activity('passed','chapter',{responseState:'graded',outcome:{state:'gradedPass',satisfactory:true}}));data.activities[0]={...data.activities[0],responseState:'missing',dueAt:'2035-01-31T15:00:00.000Z'};
 const part=chapter(renderCoursePanel(data,{progress,now}));
 assert.match(summary(part),/data-chapter-state="overdue"/);assert.match(summary(part),/2\/3<span class="sr-only"> requisitos cumplidos/);assert.match(part,/actividad vencida sin entrega/);
});

test('renewed individual deadlines clear the red chapter status without changing its global due date',()=>{
 const data=course(),original='2035-01-31T15:00:00.000Z';data.activities[0]={...data.activities[0],dueAt:original,responseState:'draft',extension:{active:true,dueAt:null,updatedAt:'2035-02-01T14:00:00.000Z'},deadline:{source:'extension',dueAt:null,closesAt:null,closed:false,future:false}};
 const before=JSON.stringify(data),part=chapter(renderCoursePanel(data,{progress,now}));
 assert.match(summary(part),/data-chapter-state="in-progress"/);assert.doesNotMatch(summary(part),/Vencidas sin entrega/);assert.equal(JSON.stringify(data),before);
});

test('content search and material/activity filters retain the full chapter status and counts',()=>{
 const data=course();data.modules[0].resources.push(resource('unopened'));data.activities[0]={...data.activities[0],responseState:'graded',outcome:{state:'gradedPass',satisfactory:true}};
 for(const filter of ['all','activities','materials','pending']){
  const part=chapter(renderCoursePanel(data,{progress,filter,now}));assert.match(summary(part),/data-chapter-state="in-progress"/);assert.match(summary(part),/2\/3<span class="sr-only"> requisitos cumplidos/);
 }
 const found=chapter(renderCoursePanel(data,{progress,query:'Actividad task',now}));assert.match(summary(found),/2\/3<span class="sr-only"> requisitos cumplidos/);assert.doesNotMatch(found,/data-action="resource:/);
});

test('public pages and teacher previews do not show personal chapter outcomes or their guide',()=>{
 const data=course();data.activities[0]={...data.activities[0],responseState:'graded',outcome:{state:'gradedBelow',satisfactory:false}};
 for(const options of [{learner:false},{learner:false,showChapterStatus:true},{learner:true,showChapterStatus:false}]){
  const html=renderCoursePanel(data,{...options,progress,now});assert.doesNotMatch(html,/data-chapter-state|course-chapter-status-label|data-chapter-status-summary|Estado de los capítulos|resultado por debajo del umbral/);
 }
});

test('empty and scheduled-only chapters never claim completed requirements',()=>{
 const data=course();data.modules.push({id:'empty',title:'Próximamente',position:1,resources:[]});data.activities[0].opensAt='2035-02-05T15:00:00.000Z';
 const html=renderCoursePanel(data,{now});assert.match(summary(chapter(html,'empty')),/data-chapter-state="not-started"/);assert.match(summary(chapter(html,'empty')),/0\/0<span class="sr-only"> requisitos cumplidos/);
 assert.match(summary(chapter(html)),/data-chapter-state="not-started"/);assert.match(chapter(html),/actividad programada/);
});

test('chapter status preserves safe text, supplied order, open state and original course/progress data',()=>{
 const data=course();data.modules[0].title='<img src=x onerror=bad()>';data.modules.unshift({id:'last',title:'Último',position:10,resources:[resource('last-resource')]});data.chapterOrder='desc';
 const before=JSON.stringify(data),savedProgress=JSON.stringify(progress),html=renderCoursePanel(data,{progress,now,openChapters:new Set(['last'])});
 assert.ok(html.indexOf('data-module-id="last"')<html.indexOf('data-module-id="chapter"'));assert.match(chapter(html,'last').split('>')[0],/\bopen\b/);
 assert.match(html,/&lt;img src=x onerror=bad\(\)&gt;/);assert.doesNotMatch(html,/<img src=x/);assert.equal(JSON.stringify(data),before);assert.equal(JSON.stringify(progress),savedProgress);
});
