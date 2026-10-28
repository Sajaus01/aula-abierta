import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcademicUI} from '../public/academics.js';

function fixture({grade=true,manualGrade=null}={}){
 const activity={id:'activity',courseId:'group',title:'Actividad vencida',kind:'task',description:'Evaluación.',status:'published',maxPoints:5,weight:100,revision:1,questions:[],attachments:[]};
 const course={id:'group',title:'Grupo',entityKind:'group',permissions:{grade,edit:true},modules:[]};
 const students=[{id:'student',name:'Alumno <uno>',document:'synthetic',active:true,status:'active'}];
 const details={activity,submissions:[],manualGrades:manualGrade?[{id:'manual-record',manualGrade:true,studentId:'student',name:'Alumno <uno>',document:'synthetic',state:'graded',attempt:0,version:1,gradingMaxPoints:5,...manualGrade}]:[],students,closures:[{studentId:'student',closure:{closed:true,closedAt:'2026-10-20T12:00:00Z'}}]};
 const state={assurance:'password',viewMode:'teaching',user:{id:'teacher',role:'admin',roles:['teacher']},courses:[course]},calls=[];
 const root={innerHTML:''},elements=new Map([['[data-review-root]',root],['[data-review=prev]',{}],['[data-review=next]',{}],['.review-response-pane',{focus(){}}]]);
 const modal={dataset:{},classList:{add(){}},addEventListener(){},querySelector:selector=>elements.get(selector)};
 const api=async path=>{calls.push(path);if(path==='/academics/activities/activity')return {activity,course};if(path==='/academics/activities/activity/submissions')return details;if(path==='/courses/group')return course;if(path==='/academics/courses/group/gradebook')return {course,settings:{scaleMax:5,passMark:3,periods:[]},activities:[activity],students:students.map(s=>({...s,ready:false,accumulated:0,gradedWeight:100,final:null,cells:[{activityId:activity.id,title:activity.title,maxPoints:5,weight:100,state:'missing',points:0,published:true,closure:{closed:true},...(manualGrade?{manualGrade:true,manualGradeId:'manual-record',state:'graded',...manualGrade}:{})}]}))};if(path.startsWith('/analytics/'))throw Error('Synthetic analytics unavailable');throw Error('Unexpected request '+path);};
 const button=(label,action)=>`<button data-action="${action}">${label}</button>`;
 const ui=createAcademicUI({api,getState:()=>state,openModal(){},toast(){},render(){},modal,btn:button,icon:()=>'',heading:title=>`<h1>${title}</h1>`,empty:title=>`<p>${title}</p>`});
 return {ui,calls,root,details};
}

test('the activity roster offers grading even when no student submitted anything',async()=>{
 const {ui}=fixture(),html=await ui.pageHTML('actividad/activity');
 assert.match(html,/data-action="academic-grade:manual-student"/);assert.match(html,/>Calificar</);assert.match(html,/Alumno &lt;uno&gt;/);
 assert.match(html,/value="missing">Sin entrega/);assert.match(html,/Vencida sin entrega/);assert.match(html,/0 automático/);assert.match(html,/0 \/ 5/);
 assert.match(html,/<strong>1<\/strong><span>Sin enviar/);assert.match(html,/<strong>0<\/strong><span>Por revisar o devolver/);
 assert.doesNotMatch(html,/Intento 0|activity-missing-roster/);
});

test('teacher books display a manual private mark without presenting the automatic zero as its current mark',async()=>{
 const value=fixture({manualGrade:{points:4,published:false,gradeDraft:true}});
 for(const route of ['calificaciones/group','calificaciones/group?student=student']){
  const html=await value.ui.pageHTML(route);assert.match(html,/Sin entrega · plazo cerrado/);assert.match(html,/Nota docente privada · sin entrega/);assert.doesNotMatch(html,/0 automático/);assert.match(html,/academic-manual-grade:activity~student/);
 }
});

test('the missing gradebook cell opens the student grading panel rather than an extension',async()=>{
 const {ui,calls,root}=fixture(),html=await ui.pageHTML('calificaciones/group');
 assert.match(html,/data-action="academic-manual-grade:activity~student"/);
 await ui.action('academic-manual-grade','activity~student');
 assert.equal(calls.at(-1),'/academics/activities/activity/submissions');assert.match(root.innerHTML,/No hay una entrega enviada/);assert.match(root.innerHTML,/name="points"/);assert.match(root.innerHTML,/La actividad continúa cerrada/);assert.doesNotMatch(root.innerHTML,/Habilitar entrega|Pedir corrección|Intento 0/);
});

test('teachers without grading permission cannot see or open manual grading controls',async()=>{
 const {ui,calls,root}=fixture({grade:false}),html=await ui.pageHTML('actividad/activity');
 assert.doesNotMatch(html,/academic-grade:manual-|Calificar sin entrega/);assert.ok(!calls.some(path=>path.endsWith('/submissions')));
 await ui.action('academic-manual-grade','activity~student');assert.equal(root.innerHTML,'');
});
