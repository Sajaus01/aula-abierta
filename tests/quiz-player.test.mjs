import test from 'node:test';
import assert from 'node:assert/strict';
import {quizQuestion,quizSharedAttachments} from '../public/quiz-player.js';
import {createAcademicUI} from '../public/academics.js';

const activity={id:'visual-quiz',courseId:'group',title:'Cuestionario visual',kind:'quiz',status:'published',weight:10,maxPoints:2,maxAttempts:2,revision:1,description:'Observa las figuras y responde.',questions:[{id:'q1',type:'single',prompt:'¿Qué representa la figura?',points:1,options:['Fuerza','Velocidad'],media:['figura.png']},{id:'q2',type:'text',prompt:'Explica tu respuesta.',points:1,options:[],media:[]}],attachments:[{id:'image',name:'figura.png',mime:'image/png',url:'/private/figure',downloadUrl:'/private/figure?download=1'},{id:'shared',name:'guia.pdf',mime:'application/pdf',url:'/private/guide',downloadUrl:'/private/guide?download=1'}]};
test('question images stay with their question and never become introductory downloads',()=>{
 assert.deepEqual(quizSharedAttachments(activity).map(f=>f.name),['guia.pdf']);
 const first=quizQuestion(activity.questions[0],0,activity.attachments,{q1:[1]});
 assert.match(first,/quiz-question-layout with-image/);assert.match(first,/src="\/private\/figure"/);assert.match(first,/value="1" checked/);assert.ok(!first.match(/data-quiz-question="0" hidden/));
 assert.doesNotMatch(quizQuestion(activity.questions[1],1,[],{q2:'Texto <seguro>'}),/ hidden/);assert.match(quizQuestion(activity.questions[1],1,[],{q2:'Texto <seguro>'}),/Texto &lt;seguro&gt;/);
});
test('student sees all points, instructions and delivery actions on the same page',async()=>{
 const state={user:{role:'student',roles:['student']},assurance:'password',courses:[{id:'group'}]};
 const ui=createAcademicUI({getState:()=>state,api:async path=>path.startsWith('/academics/')?{activity,course:{id:'group',title:'Mecánica'},mine:[]}:{id:'group',modules:[]},openModal(){},toast(){},render(){},modal:{},btn:()=>'',icon:()=>'',heading:()=>'',empty:()=>''});
 const html=await ui.pageHTML('actividad/visual-quiz'),materials=html.split('activity-instructions')[1].split('</section>')[0];
 assert.match(html,/student-activity-workspace/);assert.match(materials,/Qué debes hacer/);assert.ok(!materials.includes('/private/figure'));assert.ok(materials.includes('guia.pdf'));
 assert.match(html,/data-quiz-question="0"/);assert.match(html,/data-quiz-question="1"/);assert.doesNotMatch(html,/data-quiz-question="\d+" hidden/);assert.match(html,/value="submit"/);assert.doesNotMatch(html,/value="submit" hidden/);assert.match(html,/Tu entrega/);assert.match(html,/Guardar borrador/);
});
test('returned drafts keep answers, attachments and correction instructions in the new student player',async()=>{
 const returned={id:'returned',state:'returned',returnedAt:'2026-10-04T00:00:00Z',attempt:1,feedback:'Corrige el desarrollo.',answers:{q1:[0],q2:'Respuesta recuperada'},requestId:'same-attempt',files:[],version:2};
 const a={...activity,procedureSupport:{enabled:true,formats:['any'],maxFiles:5}};
 const state={user:{role:'student',roles:['student']},assurance:'password',courses:[]};
 const ui=createAcademicUI({getState:()=>state,api:async path=>path.startsWith('/academics/')?{activity:a,course:{id:'group',title:'Mecánica'},mine:[returned]}:{modules:[]},openModal(){},toast(){},render(){},modal:{},btn:()=>'',icon:()=>'',heading:()=>'',empty:()=>''});
 const html=await ui.pageHTML('actividad/visual-quiz');assert.match(html,/Corrige el desarrollo/);assert.match(html,/value="0" checked/);assert.match(html,/Respuesta recuperada/);assert.match(html,/data-procedure-stage/);assert.match(html,/Conservas el mismo intento/);
});
