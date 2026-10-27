import test from 'node:test';
import assert from 'node:assert/strict';
import {gradebookRoute,gradebookReportQuery,renderGradebookFilters,renderIndividualGrades} from '../public/gradebook-overview.js';
import {createAcademicUI} from '../public/academics.js';

test('gradebook routes separate group identity from student and period filters',()=>{
 const {type,id,query}=gradebookRoute('calificaciones/group-a?student=student-b&from=2026-10-01&to=2026-10-27&view=matrix&group=foreign');
 assert.equal(type,'calificaciones');assert.equal(id,'group-a');assert.equal(query.get('view'),'matrix');
 assert.equal(gradebookReportQuery(query),'from=2026-10-01&to=2026-10-27&student=student-b');
});

test('gradebook filters retain the selected student, escape names and omit groups without grading access',()=>{
 const data={course:{id:'g',title:'Group'},query:new URLSearchParams('student=s'),insights:{filters:{from:'2026-10-01',to:'2026-10-27'},studentOptions:[{id:'s',name:'<script>student</script>'}]}};
 const html=renderGradebookFilters(data,[{id:'g',title:'<Group>',entityKind:'group',permissions:{grade:true}},{id:'foreign',title:'Private group',entityKind:'group',permissions:{grade:false}}]);
 assert.match(html,/value="s" selected/);assert.match(html,/&lt;script&gt;student&lt;\/script&gt;/);assert.match(html,/&lt;Group&gt;/);assert.doesNotMatch(html,/Private group|<script>/);
 assert.match(html,/value="2026-10-01"/);assert.match(html,/estado actual/);
});

function fixture(){
 const course={id:'g',title:'Group A',entityKind:'group',permissions:{grade:true}},settings={scaleMax:5,passMark:3,periods:[],finalPublished:false};
 const grade={accumulated:1.6,provisional:4,gradedWeight:40,final:null,ready:false,cells:[{activityId:'a',title:'Task',weight:40,maxPoints:5,points:4,published:true,state:'graded'}],periods:[]};
 const students=[{id:'s1',name:'One',document:'synthetic-one',active:true,status:'active',...grade},{id:'s2',name:'Two',document:'synthetic-two',active:true,status:'active',...grade}];
 const state={assurance:'password',viewMode:'teaching',courses:[course],user:{id:'t',role:'admin',roles:['teacher']}};
 const requests=[];
 const api=async path=>{
  requests.push(path);
  if(path==='/academics/courses/g/gradebook')return {course,settings,activities:[{id:'a',title:'Task',maxPoints:5,weight:40}],students};
  if(path.startsWith('/analytics/g')){
   const q=new URL(path,'http://localhost').searchParams,selected=students.filter(s=>!q.get('student')||s.id===q.get('student'));
   const aggregate={students:students.length,activeSeconds:120,visits:2,sessions:2,averageSessionSeconds:60,progress:40,gradeAccumulated:1.6,scaleMax:5,submitted:2,pending:2,overdue:0,awaitingGrade:0};
   return {group:course,settings,filters:{from:q.get('from')||'2026-10-01',to:'2026-10-27',studentId:q.get('student')||''},measurement:{available:true,startedAt:'2026-10-01T05:00:00.000Z'},studentOptions:students,summary:{group:aggregate,selection:{...aggregate,students:selected.length}},students:selected.map(s=>({...s,current:{submitted:1,pending:1,overdue:0,awaitingGrade:0,progress:40,materialsCompleted:1,materialsTotal:2,gradeAccumulated:1.6,scaleMax:5,lastActivityAt:null},period:{visits:1,sessions:1,activeSeconds:60,averageSessionSeconds:60}}))};
  }
  throw Error('Unexpected request '+path);
 };
 const ui=createAcademicUI({api,getState:()=>state,openModal:()=>{},toast:()=>{},render:async()=>{},modal:{},btn:label=>`<button>${label}</button>`,icon:()=>'',heading:title=>`<h1>${title}</h1>`,empty:title=>`<p>${title}</p>`});
 return {ui,requests};
}

test('the teacher gradebook starts with a student overview and keeps the activity matrix collapsed',async()=>{
 const {ui,requests}=fixture(),html=await ui.pageHTML('calificaciones/g');
 assert.deepEqual(requests,['/academics/courses/g/gradebook','/analytics/g']);
 assert.match(html,/<form[^>]+id="gradebook-overview-filters"/);assert.match(html,/data-analytics-roster/);
 assert.match(html,/Medición desde/,'gradebook must disclose when measured participation begins');
 assert.match(html,/<details class="gradebook-matrix"\s*>/);assert.doesNotMatch(html,/<details class="gradebook-matrix"[^>]*\bopen\b/);
 assert.ok(html.indexOf('data-analytics-roster')<html.indexOf('class="gradebook-matrix"'));
});

test('student grade links open only that student matrix and retain the measurement period',async()=>{
 const {ui,requests}=fixture(),html=await ui.pageHTML('calificaciones/g?student=s2&from=2026-10-10&view=matrix');
 assert.equal(requests[1],'/analytics/g?from=2026-10-10&student=s2');
 assert.match(html,/<details class="gradebook-matrix" open>/);
 const matrix=html.slice(html.indexOf('class="gradebook-matrix"'));
 assert.match(matrix,/Two/);assert.doesNotMatch(matrix,/synthetic-one|>One</);
 assert.match(matrix,/gradebook-individual/);
 assert.match(html,/from=2026-10-10/);
});

test('individual grade detail lists activities vertically and preserves private zero and pending blanks',()=>{
 const data={settings:{scaleMax:5,periods:[]},activities:[],students:[{name:'<Student>',accumulated:0,cells:[{activityId:'zero',title:'Private zero',weight:40,maxPoints:5,points:0,published:false,state:'graded',submissionId:'submission'},{activityId:'waiting',title:'Waiting for a grade',weight:60,maxPoints:5,points:null,published:false,state:'submitted'}]}]};
 const html=renderIndividualGrades(data,(label,action)=>`<button data-action="${action}">${label}</button>`);
 assert.match(html,/&lt;Student&gt;/);assert.match(html,/<td>0 \/ 5<\/td><td>Nota privada/);
 assert.match(html,/<td>— \/ 5<\/td><td>Por calificar/);assert.match(html,/academic-gradebook:submission/);
 assert.equal((html.match(/<tbody>/g)||[]).length,1);assert.equal((html.match(/<tr>/g)||[]).length,3);
});
