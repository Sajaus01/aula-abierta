import test from 'node:test';
import assert from 'node:assert/strict';
import {canManageActivityExtensions,activityExtensionButton,extensionDateInput,extensionDeadline,extensionDateLabel,filterExtensionStudents,createActivityExtensionManager,renderActivityExtensionWindow,createActivityExtensionsUI} from '../public/activity-extensions.js';
import {renderIndividualGrades} from '../public/gradebook-overview.js';
import {createAcademicUI} from '../public/academics.js';

const now='2035-02-01T15:00:00.000Z';
const state=()=>({assurance:'password',user:{id:'teacher',role:'admin',roles:['teacher']},viewMode:'teaching',courses:[{id:'group',title:'Curso',entityKind:'group',permissions:{grade:true}}]});
function report(){return {activity:{id:'task',courseId:'group',title:'Actividad <script>bad()</script>',kind:'task',status:'published',dueAt:'2035-01-31T23:00:00.000Z',closesAt:'2035-01-31T23:00:00.000Z',maxAttempts:1},students:[{id:'student',name:'María <img src=x onerror=bad()>',document:'123',submissionState:'pending',extension:null,extensionVersion:0},{id:'other',name:'José',document:'456',submissionState:'draft',extension:null,extensionVersion:0}],serverNow:now};}

test('individual habilitation is available only with explicit grading permission in the teaching view',()=>{
 const allowed=state();assert.equal(canManageActivityExtensions(allowed,'group'),true);
 for(const change of [{preview:true},{viewMode:'learning'},{assurance:'document'},{user:{role:'student'}},{courses:[{id:'group',entityKind:'group',permissions:{edit:true,grade:false}}]},{courses:[{id:'group',entityKind:'template',permissions:{grade:true}}]}])assert.equal(canManageActivityExtensions({...allowed,...change},'group'),false);
 assert.equal(canManageActivityExtensions(allowed,'foreign'),false);
});

test('deadline input and serialization use Colombia time independently of the computer timezone',()=>{
 const previous=process.env.TZ;process.env.TZ='Asia/Tokyo';
 try{
  assert.equal(extensionDateInput('2035-02-02T01:30:00.000Z'),'2035-02-01T20:30');
  assert.equal(extensionDeadline('2035-02-01T20:30',{now:Date.parse(now)}),'2035-02-02T01:30:00.000Z');
  assert.equal(extensionDeadline('',{unlimited:true,now:Date.parse(now)}),null);
  assert.match(extensionDateLabel('2035-02-02T01:30:00.000Z'),/2035/);
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test('deadline validation rejects incomplete, impossible, expired and pre-opening dates',()=>{
 const options={now:Date.parse(now)};
 for(const value of ['', '2035-02-01','2035-02-30T10:00','2035-02-01T10:00','2035-02-01T09:59','2035-02-01T25:00'])assert.throws(()=>extensionDeadline(value,options));
 assert.throws(()=>extensionDeadline('2035-02-02T10:00',{...options,opensAt:'2035-02-03T00:00:00.000Z'}),/apertura/);
 assert.throws(()=>extensionDeadline('2035-02-03T10:00',{...options,opensAt:'2035-02-03T15:00:00.000Z'}),/posterior a la apertura/);
 assert.equal(extensionDateInput('invalid'),'');assert.equal(extensionDateLabel('invalid'),'Fecha no disponible');
});

test('roster search matches accents and documents while retaining the selected student',()=>{
 const rows=report().students;
 assert.deepEqual(filterExtensionStudents(rows,'jose').map(row=>row.id),['other']);
 assert.deepEqual(filterExtensionStudents(rows,'123').map(row=>row.id),['student']);
 assert.deepEqual(filterExtensionStudents(rows,'jose','student').map(row=>row.id),['student','other']);
});

test('opening the manager only reads the roster, including students who have never submitted',async()=>{
 const original=report(),calls=[];
 const manager=createActivityExtensionManager({api:async(path,request)=>{calls.push({path,request});return original;}});
 const loaded=await manager.load('task');assert.equal(loaded.students[0].submissionState,'pending');assert.equal(loaded.students[0].extension,null);
 assert.deepEqual(calls,[{path:'/academics/activities/task/extensions',request:undefined}]);
});

test('save and revoke use optimistic versions and preserve global dates, other students and the server submission state',async()=>{
 const original=report(),calls=[];
 const manager=createActivityExtensionManager({api:async(path,request)=>{calls.push({path,request});return {studentId:'student',extension:{active:request.method==='PUT',dueAt:null,version:calls.length,revokedAt:request.method==='DELETE'?now:null},extensionVersion:calls.length,submissionState:'pending',serverNow:now};}});
 const saved=await manager.save(original,'student',null);
 assert.deepEqual(calls[0],{path:'/academics/activities/task/extensions/student',request:{method:'PUT',body:{version:0,dueAt:null}}});
 assert.equal(saved.students[0].submissionState,'pending');assert.equal(saved.students[1],original.students[1]);assert.equal(saved.activity,original.activity);assert.equal(original.students[0].extension,null);
 const revoked=await manager.revoke(saved,'student');assert.deepEqual(calls[1].request,{method:'DELETE',body:{version:1}});assert.equal(revoked.students[0].extension.active,false);
 await assert.rejects(()=>manager.save(original,'foreign',null),/matrícula/);assert.equal(calls.length,2);
});

test('the compact dialog escapes people and activity data and offers one direct save action',()=>{
 const data=report(),html=renderActivityExtensionWindow({activities:[data.activity],report:data,activityId:'task',studentId:'student',now:Date.parse(now)});
 assert.doesNotMatch(html,/<script>|<img|onerror=bad\(\)>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
 assert.match(html,/Sin entregar/);assert.match(html,/type="datetime-local"/);assert.match(html,/Sin límite/);assert.match(html,/Colombia \(UTC−5\)/);
 assert.equal((html.match(/type="submit"/g)||[]).length,1);assert.doesNotMatch(html,/name="points"|name="maxAttempts"|data-extension-action="revoke"/);
 assert.match(activityExtensionButton({activityId:'a"bad',studentId:'s"bad',title:'<Alumno>'}),/academic-extension:a%22bad/);
 assert.doesNotMatch(activityExtensionButton({activityId:'a',studentId:'s"bad',title:'<Alumno>'}),/<Alumno>|data-student="s"bad/);
});

test('the existing exception and reversible revoke action remain visible beside the student status',()=>{
 const data=report();data.students[0].extension={active:true,dueAt:null,version:2};data.students[0].extensionVersion=2;
 const html=renderActivityExtensionWindow({activities:[data.activity],report:data,activityId:'task',studentId:'student',now:Date.parse(now)});
 assert.match(html,/Sin límite de fecha/);assert.match(html,/Retirar autorización/);assert.match(html,/Puedes habilitarla de nuevo/);assert.match(html,/Actualizar plazo/);
 assert.match(html,/value="unlimited" checked/);assert.match(html,/name="dueAt"[^>]+disabled/);
});

test('the suggested date does not shorten a future deadline and reflects a newer correction',()=>{
 const data=report();data.activity.dueAt='2035-03-01T17:00:00.000Z';
 let html=renderActivityExtensionWindow({report:data,studentId:'student',now:Date.parse(now)});assert.match(html,/name="dueAt"[^>]+value="2035-03-01T12:00"/);
 data.students[0].extension={active:true,dueAt:'2035-02-10T17:00:00.000Z',version:1};data.students[0].deadline={source:'correction',dueAt:'2035-02-20T17:00:00.000Z'};
 html=renderActivityExtensionWindow({report:data,studentId:'student',now:Date.parse(now)});assert.match(html,/Plazo de corrección/);assert.match(html,/name="dueAt"[^>]+value="2035-02-20T12:00"/);
});

test('quiz guidance explains the expired timer and never promises an extra attempt or publication',()=>{
 const data=report();data.activity={...data.activity,kind:'quiz',status:'draft',timeLimitMinutes:30};
 const html=renderActivityExtensionWindow({report:data,studentId:'student',now:Date.parse(now)});
 assert.match(html,/Si el tiempo del cuestionario ya terminó/);assert.match(html,/Conserva los intentos y las respuestas guardadas/);assert.match(html,/seguirá oculta hasta que la publiques/);
 data.activity.kind='task';assert.doesNotMatch(renderActivityExtensionWindow({report:data,studentId:'student',now:Date.parse(now)}),/tiempo del cuestionario/);
});

test('the gradebook exposes habilitation for an unsubmitted cell and hides it without authorization',()=>{
 const data={settings:{scaleMax:5,periods:[]},activities:[{id:'task',title:'Tarea'}],students:[{id:'student',name:'Alumno',active:true,status:'active',accumulated:0,cells:[{activityId:'task',title:'Tarea',state:'pending',points:null,maxPoints:5,weight:10,submissionId:null}]}]};
 const button=label=>`<button>${label}</button>`;
 const html=renderIndividualGrades(data,button,{allowExtensions:true});assert.match(html,/academic-extension:task/);assert.match(html,/data-student="student"/);assert.match(html,/Sin entregar/);
 assert.doesNotMatch(renderIndividualGrades(data,button),/academic-extension/);
 data.students[0].status='revoked';assert.doesNotMatch(renderIndividualGrades(data,button,{allowExtensions:true}),/academic-extension/);
});

function dialogFixture(api){
 const listeners=new Map(),nodes=new Map(),attributes=new Map(),form={id:'activity-extension-form',elements:{dueAt:{value:'2035-02-03T10:30'},deadlineMode:{value:'date'}}};
 const modal={open:false,dataset:{},classList:{add(){}},addEventListener(type,fn,{signal}={}){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);signal?.addEventListener('abort',()=>listeners.set(type,listeners.get(type).filter(item=>item!==fn)));},querySelector(selector){if(selector==='#activity-extension-form')return form;if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',hidden:false,inert:false,focus(){this.focused=true;}});return nodes.get(selector);},setAttribute(key,value){attributes.set(key,value);},removeAttribute(key){attributes.delete(key);},close(){modal.open=false;for(const handler of [...listeners.get('close')||[]])handler();}};
 let rendered=0;const ui=createActivityExtensionsUI({api,modal,openModal(){modal.open=true;},toast(){},render(){rendered++;},getState:state});
 const submit=async()=>{for(const handler of listeners.get('submit')||[])handler({target:form,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));};
 const click=async action=>{for(const handler of listeners.get('click')||[])handler({target:{closest:()=>({dataset:{extensionAction:action}})}});await new Promise(resolve=>setImmediate(resolve));};
 const edit=async(type,name,value)=>{if(form.elements[name])form.elements[name].value=value;for(const handler of listeners.get(type)||[])handler({target:{name,value,closest:()=>form}});await new Promise(resolve=>setImmediate(resolve));};
 return {ui,modal,form,nodes,attributes,submit,click,edit,get rendered(){return rendered;}};
}

test('search and activity/student selection stay clean, while an edited deadline survives switching students',async()=>{
 const calls=[],fixture=dialogFixture(async(path,request)=>{calls.push({path,request});const data=report();data.activity.id=path.split('/')[3];return data;});
 const activities=[report().activity,{...report().activity,id:'second',title:'Otra actividad'}];
 await fixture.ui.open({courseId:'group',activities,activityId:'task'});
 await fixture.edit('change','student','student');assert.equal(fixture.modal.dataset.dirty,'false');
 await fixture.edit('input','search','jose');assert.equal(fixture.modal.dataset.dirty,'false');
 await fixture.edit('change','activity','second');assert.equal(fixture.modal.dataset.dirty,'false');assert.equal(calls.length,2);assert.ok(calls.every(call=>!call.request));
 await fixture.edit('input','dueAt','2035-02-08T10:30');assert.equal(fixture.modal.dataset.dirty,'true');
 await fixture.edit('change','student','other');assert.equal(fixture.modal.dataset.dirty,'true');
 await fixture.edit('change','student','student');assert.match(fixture.nodes.get('[data-extensions-root]').innerHTML,/value="2035-02-08T10:30"/);
 fixture.ui.dispose();
});

test('revocation reports the correction deadline when that is the authorization restored by the server',async()=>{
 const data=report();data.students[0]={...data.students[0],submissionState:'returned',extension:{active:true,dueAt:null,version:2},extensionVersion:2,deadline:{source:'extension',dueAt:null}};
 const calls=[],fixture=dialogFixture(async(_path,request)=>{if(!request)return data;calls.push(request);return {studentId:'student',extension:{active:false,dueAt:null,version:3},extensionVersion:3,deadline:{source:'correction',dueAt:'2035-02-05T15:00:00.000Z'},effectiveDueAt:'2035-02-05T15:00:00.000Z',serverNow:now};});
 await fixture.ui.open({courseId:'group',activities:[data.activity],activityId:'task',studentId:'student'});await fixture.click('revoke');
 assert.deepEqual(calls,[{method:'DELETE',body:{version:2}}]);
 const html=fixture.nodes.get('[data-extensions-root]').innerHTML;assert.match(html,/Plazo de corrección/);assert.match(html,/plazo vigente de la corrección/);assert.doesNotMatch(html,/Restablecer plazo del grupo/);
 assert.equal(fixture.modal.dataset.dirty,'false');fixture.ui.dispose();
});

test('the dialog keeps errors and entered dates in place, then saves without changing route or closing',async()=>{
 const calls=[];let fail=true;
 const fixture=dialogFixture(async(path,request)=>{calls.push({path,request});if(!request)return report();if(fail)throw Error('Sin conexión');return {studentId:'student',extension:{active:true,dueAt:request.body.dueAt,version:1},extensionVersion:1,serverNow:now};});
 await fixture.ui.open({courseId:'group',activities:[report().activity],activityId:'task',studentId:'student'});assert.equal(calls.length,1);assert.equal(fixture.modal.dataset.dirty,'false');
 await fixture.submit();assert.equal(fixture.modal.open,true);assert.equal(fixture.modal.dataset.dirty,'true');assert.equal(fixture.form.elements.dueAt.value,'2035-02-03T10:30');
 assert.equal(fixture.nodes.get('[data-extension-error]').textContent,'Sin conexión');assert.equal(fixture.attributes.has('aria-busy'),false);assert.equal(fixture.nodes.get('[data-extensions-root]').inert,false);
 fail=false;await fixture.submit();assert.equal(fixture.modal.open,true);assert.equal(fixture.modal.dataset.dirty,'false');assert.equal(calls.at(-1).request.body.dueAt,'2035-02-03T15:30:00.000Z');
 assert.match(fixture.nodes.get('[data-extensions-root]').innerHTML,/Entrega habilitada para/);fixture.modal.close();assert.equal(fixture.rendered,1);fixture.ui.dispose();
});

test('a conflict reloads the current exception while retaining the requested date for an explicit retry',async()=>{
 let reads=0,writes=0;const versions=[];
 const fixture=dialogFixture(async(_path,request)=>{
  if(!request){reads++;const data=report();if(reads>1){data.students[0].extension={active:true,dueAt:'2035-02-04T17:00:00.000Z',version:2};data.students[0].extensionVersion=2;}return data;}
  writes++;versions.push(request.body.version);if(writes===1){const error=Error('Conflicto');error.status=409;throw error;}
  return {studentId:'student',extension:{active:true,dueAt:request.body.dueAt,version:3},extensionVersion:3,serverNow:now};
 });
 await fixture.ui.open({courseId:'group',activities:[report().activity],activityId:'task',studentId:'student'});await fixture.submit();
 assert.equal(writes,1);assert.equal(reads,2);assert.equal(fixture.form.elements.dueAt.value,'2035-02-03T10:30');assert.match(fixture.nodes.get('[data-extension-error]').textContent,/otra sesión/);
 await fixture.submit();assert.deepEqual(versions,[0,2]);assert.equal(fixture.modal.dataset.dirty,'false');fixture.ui.dispose();
});

test('the teacher activity offers habilitation even when nobody has submitted, while an editor cannot use it',async()=>{
 async function page(grade){
  const context=state();context.courses[0].permissions={grade,edit:true};const course={...context.courses[0],modules:[]},activity={...report().activity,description:'',attachments:[],questions:[],maxPoints:5,weight:10,version:1};
  const api=async path=>{if(path==='/academics/activities/task')return {course,activity};if(path==='/academics/activities/task/submissions')return {submissions:[]};if(path==='/courses/group')return course;throw Error('Unexpected request '+path);};
  const ui=createAcademicUI({api,getState:()=>context,openModal(){},toast(){},render(){},modal:{open:false},btn:(label,action)=>`<button data-action="${action}">${label}</button>`,icon:()=>'',heading:title=>`<h1>${title}</h1>`,empty:title=>`<p>${title}</p>`});
  return {html:await ui.pageHTML('actividad/task'),ui};
 }
 const teacher=await page(true);assert.match(teacher.html,/academic-extension:task/);assert.match(teacher.html,/Aún no hay entregas/);
 const editor=await page(false);assert.doesNotMatch(editor.html,/academic-extension/);await assert.rejects(()=>editor.ui.action('academic-extension','task',{dataset:{}}),/permiso para calificar/);
});
