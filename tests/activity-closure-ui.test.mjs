import test from 'node:test';
import assert from 'node:assert/strict';
import {studentActivityWorkspace,studentResponseContext,studentActivityRows} from '../public/activity-workspace.js';
import {renderCoursePanel,coursePanelModel,courseActivityStatus} from '../public/course-panel.js';
import {renderIndividualGrades} from '../public/gradebook-overview.js';
import {closedWithoutSubmission,closureHistoryHTML,closedDraftMessage} from '../public/activity-state.js';
import {createAcademicUI} from '../public/academics.js';
import {createActivityExtensionManager,renderActivityExtensionWindow} from '../public/activity-extensions.js';

const closedAt='2020-01-02T15:00:00.000Z',deadlineAt='2020-01-01T15:00:00.000Z',now=Date.parse('2030-01-03T15:00:00.000Z');
const closure=()=>({closed:true,automatic:true,points:0,closedAt,deadlineAt,source:'activity',version:1,revision:1,reopenedAt:null,history:[{state:'closed',at:closedAt,version:1,deadlineAt,source:'activity',reason:'deadline'}]});
const activity=()=>({id:'task',courseId:'group',moduleId:'chapter',title:'Informe',description:'Resuelve el informe.',kind:'task',status:'published',maxPoints:5,maxAttempts:1,weight:100,revision:1,dueAt:deadlineAt,closesAt:deadlineAt,allowLate:false,questions:[],attachments:[],responseSettings:{text:true,files:false,link:false},responseState:'missing',submitted:false,closure:closure()});
const workspace=(a,mine=[])=>studentActivityWorkspace({course:{id:'group',title:'Curso'},activity:a,mine},{questionMedia:()=>'',questionPreview:()=>''});

test('an automatic closure shows its zero and continuity without a submission receipt, answer form or consumed attempt',()=>{
 const a=activity(),html=workspace(a),context=studentResponseContext(a,[]);
 assert.match(html,/Vencida sin entrega/);assert.match(html,/activity-automatic-result/);assert.match(html,/Finalizada por vencimiento · Puedes continuar con el curso/);
 assert.match(html,/0 <small>\/ 5<\/small><span>automático/);assert.match(html,/0 de 1 utilizados/);
 assert.doesNotMatch(html,/id="academic-submit"|Entrega enviada|Entregas y comentarios|Intento 1/);
 assert.equal(context.usedAttempts,0);assert.equal(context.editable,false);assert.equal(a.submitted,false);
});

test('a closed activity preserves its draft without presenting it as a submitted answer',()=>{
 const draft={id:'draft',state:'draft',text:'Mi avance guardado',answers:{},files:[],attempt:1,version:1},html=workspace(activity(),[draft]);
 assert.match(html,/Tu borrador guardado/);assert.match(html,/Mi avance guardado/);assert.match(html,/Tu borrador se conserva/);
 assert.doesNotMatch(html,/Tu respuesta enviada|Entrega enviada|id="academic-submit"/);assert.equal(studentResponseContext(activity(),[draft]).usedAttempts,0);
});

test('reopening removes the current automatic zero, restores the draft editor and retains the closure history',()=>{
 const a=activity();a.closure={...a.closure,closed:false,points:null,reopenedAt:'2030-01-01T15:00:00.000Z',history:[...a.closure.history,{state:'reopened',at:'2030-01-01T15:00:00.000Z',reason:'extension'}]};
 a.extension={active:true,dueAt:null,updatedAt:'2030-01-01T15:00:00.000Z'};a.deadline={source:'extension',dueAt:null,closesAt:null};a.responseState='draft';
 const draft={id:'draft',state:'draft',text:'Mi borrador',files:[],answers:{},attempt:1},html=workspace(a,[draft]);
 assert.match(html,/id="academic-submit"/);assert.match(html,/name="response"[^>]*>Mi borrador/);assert.match(html,/Entrega habilitada para ti/);
 assert.match(html,/El cero automático anterior no se aplica al resultado actual/);assert.match(html,/Historial de cierre automático/);assert.match(html,/Se habilitó un nuevo plazo/);
 assert.doesNotMatch(html,/activity-automatic-result|Entrega enviada/);assert.equal(studentResponseContext(a,[draft]).usedAttempts,0);
});

test('a later real submission has its own receipt and grade, while the old zero remains only in history',()=>{
 const a=activity();a.closure={...a.closure,closed:false,points:null,history:[...a.closure.history,{state:'reopened',at:'2030-01-01T15:00:00.000Z',reason:'submission'}]};a.responseState='graded';a.submitted=true;
 const response={id:'real',state:'graded',submittedAt:closedAt,attempt:1,revision:1,published:true,points:0,text:'Respuesta enviada',files:[],answers:{}},html=workspace(a,[response]);
 assert.match(html,/Entrega enviada/);assert.match(html,/Calificación/);assert.match(html,/Se recibió una entrega real/);assert.match(html,/1 de 1 utilizados/);
 assert.doesNotMatch(html,/activity-automatic-result|Vencida sin entrega/);assert.equal(studentResponseContext(a,[response]).usedAttempts,1);
});

test('activity lists distinguish a closed result, a pending reopened activity and a real graded submission',()=>{
 const a=activity(),closed=studentActivityRows([a]);assert.match(closed,/Vencida sin entrega/);assert.match(closed,/0 automático/);assert.match(closed,/Ver resultado/);assert.doesNotMatch(closed,/>Enviada<|Ver entrega/);
 const reopened=studentActivityRows([{...a,closure:{...a.closure,closed:false,points:null},responseState:'pending'}]);assert.match(reopened,/>Pendiente</);assert.doesNotMatch(reopened,/0 automático|Vencida sin entrega/);
 const graded=studentActivityRows([{...a,closure:null,responseState:'graded',submitted:true}]);assert.match(graded,/>Enviada</);assert.match(graded,/Ver entrega/);
 assert.equal(closedWithoutSubmission({...a,closure:null}),false,'a missing label alone is not an automatic result');
});

test('gradebook detail labels the automatic zero before published points and preserves manual zero grades',()=>{
 const data={settings:{scaleMax:5,periods:[]},activities:[activity()],students:[{id:'student',name:'Alumno',active:true,status:'active',accumulated:0,cells:[{activityId:'task',title:'Informe',state:'missing',points:0,published:true,maxPoints:5,weight:100,submissionId:null,closure:closure()}]}]};
 const html=renderIndividualGrades(data,label=>`<button>${label}</button>`,{allowExtensions:true});assert.match(html,/Vencida sin entrega/);assert.match(html,/0 automático/);assert.doesNotMatch(html,/Nota devuelta|academic-gradebook:/);assert.match(html,/Habilitar entrega/);
 data.students[0].cells[0]={...data.students[0].cells[0],state:'graded',closure:null,submissionId:'real'};
 const manual=renderIndividualGrades(data,label=>`<button>${label}</button>`);assert.match(manual,/<td>0 \/ 5<\/td>/);assert.match(manual,/Nota devuelta/);assert.doesNotMatch(manual,/0 automático|Vencida sin entrega/);
});

test('closed work does not block the next recommendation or pending filter, but stays visible and red in the full course',()=>{
 const a=activity(),course={id:'group',title:'Curso',modules:[{id:'chapter',title:'Capítulo',position:0,resources:[{id:'material',title:'Lectura',kind:'html'}]}],activities:[a]},progress=[{resourceId:'material',completed:true}];
 const model=coursePanelModel(course,progress,{now});assert.equal(model.next,null);assert.equal(model.upcoming.length,0);assert.equal(model.summary.percent,50);
 const html=renderCoursePanel(course,{progress,now});assert.match(html,/data-chapter-state="overdue"/);assert.match(html,/Vencida sin entrega/);assert.match(html,/0 automático · Finalizada por vencimiento/);assert.match(html,/1 finalizada por vencimiento/);assert.match(html,/Puedes continuar con el curso/);
 assert.doesNotMatch(html,/Tus actividades están entregadas|Todo lo publicado está completado/);
 const pending=renderCoursePanel(course,{progress,filter:'pending',now});assert.doesNotMatch(pending,/data-course-item="activity"/);assert.equal(courseActivityStatus(a,{now}).label,'Vencida sin entrega');
 course.modules[0].resources.push({id:'next',title:'Siguiente material',kind:'html'});assert.equal(coursePanelModel(course,progress,{now}).next.item.id,'next');
});

test('an inactive closure returns to the recommendation and pending filter when the teacher enables delivery',()=>{
 const a=activity();a.closure={...a.closure,closed:false,points:null};a.responseState='draft';a.deadline={source:'extension',dueAt:null,closesAt:null};
 const course={id:'group',title:'Curso',modules:[{id:'chapter',title:'Capítulo',resources:[]}],activities:[a]},model=coursePanelModel(course,[],{now});
 assert.equal(model.next.item.id,'task');assert.equal(model.upcoming.length,1);assert.equal(model.summary.activities.openPending,1);assert.equal(courseActivityStatus(a,{now}).label,'Entrega habilitada');
 const html=renderCoursePanel(course,{filter:'pending',now});assert.match(html,/data-course-item="activity"/);assert.doesNotMatch(html,/0 automático/);
});

test('the extension dialog uses the fresh server closure and response state after a new deadline',async()=>{
 const a=activity(),report={activity:a,students:[{id:'student',name:'Alumno',document:'123',submissionState:'missing',extension:null,extensionVersion:0,closure:a.closure}],serverNow:'2030-01-03T15:00:00.000Z'};
 assert.match(renderActivityExtensionWindow({report,studentId:'student',now}),/Vencida sin entrega/);assert.match(renderActivityExtensionWindow({report,studentId:'student',now}),/0 automático/);
 const manager=createActivityExtensionManager({api:async()=>({studentId:'student',submissionState:'draft',closure:{...a.closure,closed:false,points:null},extension:{active:true,dueAt:null,version:1},extensionVersion:1,serverNow:report.serverNow})});
 const updated=await manager.save(report,'student',null),html=renderActivityExtensionWindow({report:updated,studentId:'student',now});
 assert.match(html,/Borrador guardado/);assert.doesNotMatch(html,/Vencida sin entrega|0 automático/);assert.equal(updated.students[0].closure.closed,false);
});

test('closure history escapes data and stays separate from attempts and submissions',()=>{
 const value=closure();value.history.push({state:'reopened',at:'not-a-date<script>',deadlineAt:'<img>',reason:'<script>'});
 const html=closureHistoryHTML(value);assert.match(html,/Cierre automático · 0/);assert.match(html,/Cierre retirado/);assert.doesNotMatch(html,/<script>|<img>|Intento|Entrega enviada/);
});

function academicFixture(teacher=false){
 const a=activity(),course={id:'group',title:'Curso',entityKind:'group',permissions:{grade:teacher,edit:teacher},modules:[]},settings={scaleMax:5,passMark:3,periods:[],missingAsZero:false,finalPublished:false};
 const cell={activityId:'task',title:'Informe',state:'missing',points:0,published:true,maxPoints:5,weight:100,submissionId:null,closure:a.closure};
 const state={assurance:'password',viewMode:teacher?'teaching':'learning',user:{role:teacher?'admin':'student',roles:[teacher?'teacher':'student']},courses:[course]};
 const api=async path=>{if(path==='/academics/courses/group')return {course,settings,activities:[a],grade:{cells:[cell],periods:[],accumulated:0,gradedWeight:100,final:null}};if(path==='/academics/activities/task')return {activity:a,course};if(path==='/academics/activities/task/submissions')return {activity:a,submissions:[],closures:[{studentId:'student',name:'Alumno',document:'123',closure:a.closure}]};if(path==='/courses/group')return course;throw Error('Unexpected request '+path);};
 return createAcademicUI({api,getState:()=>state,modal:{},openModal(){},toast(){},render(){},btn:(label,action)=>`<button data-action="${action}">${label}</button>`,icon:()=>'',heading:title=>`<h1>${title}</h1>`,empty:title=>`<p>${title}</p>`});
}

test('student grades show automatic origin rather than calling an unsent zero a published grade',async()=>{
 const html=await academicFixture().pageHTML('calificaciones/group');assert.match(html,/0 automático/);assert.match(html,/Vencida sin entrega/);assert.doesNotMatch(html,/Nota publicada/);
});

test('the teacher sees automatic closures separately without a fake submission to review or release',async()=>{
 const html=await academicFixture(true).pageHTML('actividad/task');assert.match(html,/activity-missing-roster/);assert.match(html,/Alumno/);assert.match(html,/0 automático/);assert.match(html,/academic-extension:task/);
 assert.doesNotMatch(html,/academic-grade:student|academic-gradebook:student|Revisar entregas/);
});

test('saving a dirty draft after automatic closure lets navigation continue with its text and files conserved',async()=>{
 const original={document:globalThis.document,FormData:globalThis.FormData,FileReader:globalThis.FileReader};
 const listeners=new Map(),inputListeners=new Map(),file={name:'avance.txt',size:12,lastModified:1},status={textContent:''},error={textContent:''};
 const node=()=>({textContent:'',innerHTML:'',classList:{toggle(){}},setAttribute(){},focus(){},addEventListener(){}});
 const input={...node(),files:[file],value:'',addEventListener(type,fn){inputListeners.set(type,fn);}},submit={...node(),disabled:false};
 const nodes={'#academic-autosave-status':status,'[data-submission-error]':error,'[name=attachment]':input,'[data-support-pending]':node(),'[data-support-status]':node(),'[data-support-error]':node(),'[value=submit]':submit,'[data-support-saved]':node()};
 const attributes=new Map(),form={inert:false,values:{response:'Últimas líneas antes de salir'},querySelector:selector=>nodes[selector]||null,querySelectorAll:()=>[],getAttribute:name=>attributes.get(name)||null,setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name),addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);}};
 globalThis.document={getElementById:id=>id==='academic-submit'?form:null,querySelector:()=>null,querySelectorAll:()=>[],contains:element=>element===form};
 globalThis.FormData=class{constructor(value){this.form=value;}get(name){return this.form.values[name]||'';}getAll(){return [];}has(){return false;}};
 globalThis.FileReader=class{readAsDataURL(){this.result='data:text/plain;base64,YXZhbmNl';queueMicrotask(()=>this.onload());}};
 const open={...activity(),dueAt:'2090-01-01T15:00:00.000Z',closesAt:null,closure:null,responseState:'pending',responseSettings:{text:true,files:true,link:false}},course={id:'group',title:'Curso',modules:[]},writes=[],toasts=[];let renders=0;
 const state={assurance:'password',user:{role:'student',roles:['student']},viewMode:'learning',courses:[course]};
 const saved={id:'draft',state:'draft',version:2,requestId:'draft-request',points:null,published:false,text:form.values.response,files:[{id:'file',name:file.name,size:file.size,url:'/api/file'}],closure:closure()};
 const api=async(path,request)=>{if(request){writes.push(request.body);return saved;}if(path==='/academics/activities/task')return {activity:open,course,mine:[]};if(path==='/courses/group')return course;throw Error('Unexpected request '+path);};
 const ui=createAcademicUI({api,getState:()=>state,modal:{},openModal(){},toast:message=>toasts.push(message),render(){renders++;},btn:()=>'',icon:()=>'',heading:()=>'',empty:()=>''});
 try{
  await ui.pageHTML('actividad/task');ui.bind();inputListeners.get('change')();
  for(const handler of listeners.get('input')||[])handler({target:{type:'textarea'}});
  assert.equal(await ui.beforeLeave(),true);assert.equal(renders,0,'autosave must not rerender the page during a navigation guard');
  assert.equal(writes.length,1);assert.equal(writes[0].action,'draft');assert.equal(writes[0].text,form.values.response);assert.deepEqual(writes[0].files,[{name:'avance.txt',base64:'YXZhbmNl'}]);
  assert.equal(status.textContent,closedDraftMessage);assert.equal(error.textContent,'');assert.equal(saved.state,'draft');assert.equal(saved.points,null);assert.equal(saved.closure.closed,true);
  assert.equal(form.procedureUploads.files().length,0);assert.equal(form.inert,false);assert.equal(await ui.beforeLeave(),true);assert.equal(writes.length,1,'another guard must not upload the same files again');
  const html=workspace({...open,closure:saved.closure,responseState:'missing'},[saved]);assert.match(html,/Últimas líneas antes de salir/);assert.match(html,/avance.txt/);assert.match(html,/activity-automatic-result/);assert.doesNotMatch(html,/Entrega enviada/);
  for(const handler of listeners.get('submit')||[])await handler({preventDefault(){},submitter:{value:'draft'}});
  assert.equal(renders,1,'an explicit draft save can refresh its readonly result');assert.deepEqual(toasts,[closedDraftMessage]);assert.equal(writes[1].action,'draft');assert.deepEqual(writes[1].retainFileIds,['file']);assert.deepEqual(writes[1].files,[]);assert.equal(saved.closure.closed,true);
 }finally{ui.dispose();for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
