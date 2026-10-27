import test from 'node:test';
import assert from 'node:assert/strict';
import {studentDeadline,activityDueAt,individualDeadlineLabel} from '../public/activity-deadline.js';
import {studentResponseContext,studentActivityWorkspace,studentActivityRows} from '../public/activity-workspace.js';
import {coursePanelModel,courseActivityStatus,renderCoursePanel} from '../public/course-panel.js';

const at='2050-06-10T12:00:00.000Z',clock=Date.parse(at),past='2050-06-01T12:00:00.000Z',future='2050-06-12T12:00:00.000Z';
const base={id:'a',courseId:'course',title:'Informe',kind:'task',status:'published',revision:1,maxAttempts:1,maxPoints:10,weight:100,dueAt:past,closesAt:past,allowLate:false,responseSettings:{text:true,files:false,link:false},questions:[],attachments:[]};
const extension=dueAt=>({active:true,dueAt,version:1,updatedAt:'2050-06-09T12:00:00.000Z'});
const workspace=(activity,mine=[])=>studentActivityWorkspace({activity,course:{title:'Curso'},mine},{questionMedia:()=>'',questionPreview:()=>''});

test('an unlimited individual deadline reopens the selected response without falling back to expired group dates',()=>{
 const own={...base,extension:extension(null)};
 assert.equal(studentResponseContext(own,[],at).editable,true);
 assert.equal(studentResponseContext(base,[],at).closed,true);
 assert.equal(activityDueAt(own),null);
 assert.equal(individualDeadlineLabel(own,[],clock),'Entrega habilitada sin fecha límite');
 assert.equal(courseActivityStatus(own,{now:clock}).label,'Entrega habilitada');
});

test('the resolved server policy determines the personal deadline and expires at the exact boundary',()=>{
 const activity={...base,extension:extension(null),deadline:{source:'extension',opensAt:null,dueAt:future,closesAt:future,allowLate:false}};
 assert.equal(activityDueAt(activity),future);
 assert.equal(studentResponseContext(activity,[],at).editable,true);
 assert.equal(studentResponseContext(activity,[],future).closed,true);
 assert.equal(studentDeadline(activity,[],Date.parse(future)+1).closed,true);
});

test('a newer correction remains authoritative and a later extension can authorize that same saved attempt',()=>{
 const returned={id:'s',state:'draft',returnedAt:'2050-06-09T15:00:00.000Z',returnDueAt:past,attempt:1,text:'Guardado'};
 const old={...base,extension:extension(null)};
 assert.equal(studentResponseContext(old,[returned],at).deadline.source,'correction');
 assert.equal(studentResponseContext(old,[returned],at).closed,true);
 const newer={...old,extension:{...old.extension,updatedAt:'2050-06-09T16:00:00.000Z'}};
 const result=studentResponseContext(newer,[returned],at);
 assert.equal(result.editable,true);assert.equal(result.draft,returned);assert.equal(result.usedAttempts,0);
 assert.equal(activityDueAt(newer,[returned]),null);
});

test('an individual window does not bypass opening time, exhausted attempts or a submitted receipt',()=>{
 const own={...base,extension:extension(null)};
 assert.equal(studentResponseContext({...own,opensAt:future},[],at).future,true);
 const sent={id:'sent',state:'submitted',attempt:1,revision:1,text:'Ya enviada'};
 assert.equal(studentResponseContext(own,[sent],at).editable,false);
 assert.equal(studentResponseContext(own,[sent],at).latest,sent);
 const revoked={...own,extension:{...own.extension,active:false}};
 assert.equal(studentResponseContext(revoked,[],at).closed,true);
});

test('the student sees the authorization, Colombia time or no deadline, and the saved correction uses its current window',()=>{
 const own={...base,title:'Informe <script>',extension:extension(null)};
 const html=workspace(own);
 assert.match(html,/Entrega habilitada para ti/);assert.match(html,/sin fecha límite/);assert.match(html,/Plazo para ti/);assert.match(html,/id="academic-submit"/);
 assert.match(html,/Informe &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
 const dated=workspace({...base,extension:extension('2999-06-12T12:00:00.000Z')});
 assert.match(dated,/hora de Colombia/);assert.match(dated,/2999/);
 const pastExtension=workspace({...base,extension:extension('2020-01-01T00:00:00.000Z')});
 assert.match(pastExtension,/Tu plazo individual terminó/);assert.doesNotMatch(pastExtension,/id="academic-submit"/);
 const list=studentActivityRows([own]);assert.match(list,/Entrega habilitada sin fecha límite/);
});

test('course ordering and progress use the personal deadline while authorization alone never completes an activity',()=>{
 const own={...base,moduleId:'m',extension:extension(null)},other={...base,id:'b',title:'Otra actividad',dueAt:future,closesAt:future};
 const course={id:'course',title:'Curso',modules:[{id:'m',title:'Capítulo',published:true,resources:[{id:'r',title:'Material',kind:'html'}]}],activities:[own,other]};
 const model=coursePanelModel(course,[{resourceId:'r',completed:true}],{now:clock});
 assert.deepEqual(model.upcoming.map(item=>item.id),['b','a']);assert.equal(model.summary.completed,1);assert.equal(model.summary.total,3);assert.equal(model.summary.activities.pending,2);
 assert.match(renderCoursePanel(course,{progress:[{resourceId:'r',completed:true}],now:clock}),/Entrega habilitada sin fecha límite/);
 const delivered=coursePanelModel({...course,activities:[{...own,responseState:'submitted'}]},[{resourceId:'r',completed:true}],{now:clock});assert.equal(delivered.summary.percent,100);
});
