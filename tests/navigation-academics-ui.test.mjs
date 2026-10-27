import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudentDraftSaver,studentActivityWorkspace} from '../public/activity-workspace.js';
import {bindProcedureSubmission,savedSupportFiles} from '../public/procedure-support.js';
import {analyticsFilterRoute,renderAnalyticsFilters} from '../public/analytics-dashboard.js';
import {gradebookFilterRoute} from '../public/gradebook-overview.js';
import {panoramaViewHref,panoramaEventFiltersHref} from '../public/panorama.js';
import {createActivityReview} from '../public/activity-review.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const params=href=>new URLSearchParams(href.split('?')[1]||'');

test('leaving before the autosave delay writes a draft once and never submits it',async()=>{
 const writes=[];
 const saver=createStudentDraftSaver({save:async includeFiles=>writes.push({action:'draft',includeFiles})});
 saver.markDirty();
 assert.equal(await saver.beforeLeave(),true);assert.equal(await saver.beforeLeave(),true);
 assert.deepEqual(writes,[{action:'draft',includeFiles:true}]);assert.equal(saver.isDirty(),false);saver.dispose();
});

test('navigation waits for an in-flight write and saves edits made while it was running',async()=>{
 const first=deferred(),started=deferred(),writes=[];let answer='primera';
 const saver=createStudentDraftSaver({save:async includeFiles=>{writes.push({answer,includeFiles});if(writes.length===1){started.resolve();await first.promise;}}});
 saver.markDirty();const background=saver.saveNow();await started.promise;
 answer='segunda';saver.markDirty();let completed=false;
 const leaving=saver.beforeLeave().then(result=>{completed=true;return result;});
 await Promise.resolve();assert.equal(completed,false);first.resolve();
 await background;assert.equal(await leaving,true);
 assert.deepEqual(writes,[{answer:'primera',includeFiles:false},{answer:'segunda',includeFiles:true}]);saver.dispose();
});

test('a failed write keeps the draft dirty, shows the error and blocks navigation until a retry succeeds',async()=>{
 let fail=true,writes=0;const errors=[];
 const saver=createStudentDraftSaver({save:async()=>{writes++;if(fail)throw Error('Sin conexión');},onError:error=>errors.push(error.message)});
 saver.markDirty();assert.equal(await saver.beforeLeave(),false);assert.equal(saver.isDirty(),true);
 assert.deepEqual(errors,['Sin conexión']);fail=false;
 assert.equal(await saver.beforeLeave(),true);assert.equal(writes,2);assert.equal(saver.isDirty(),false);saver.dispose();
});

test('file-only drafts are saved on navigation and limit errors retain the selection',async()=>{
 let selected=[{name:'grande.zip'}],valid=false,writes=0;const errors=[];
 const saver=createStudentDraftSaver({hasFiles:()=>selected.length>0,save:async includeFiles=>{assert.equal(includeFiles,true);if(!valid)throw Error('Supera el límite de archivos');writes++;selected=[];},onError:error=>errors.push(error.message)});
 assert.equal(await saver.beforeLeave(),false);assert.equal(writes,0);assert.equal(selected.length,1);
 valid=true;assert.equal(await saver.beforeLeave(),true);assert.equal(writes,1);assert.equal(await saver.beforeLeave(),true);
 assert.equal(writes,1);assert.deepEqual(errors,['Supera el límite de archivos']);saver.dispose();
});

function supportFixture(maxFiles=2){
 const events=new Map(),node=()=>({textContent:'',innerHTML:'',hidden:false,disabled:false,classList:{toggle(){}},setAttribute(){},focus(){},addEventListener(type,handler){events.set(this.key+type,handler);}});
 const input={...node(),key:'input',files:[],value:''},list={...node(),key:'list'},status=node(),error=node(),send=node(),saved=node();
 const nodes={'[name=attachment]':input,'[data-support-pending]':list,'[data-support-status]':status,'[data-support-error]':error,'[value=submit]':send,'[data-support-saved]':saved};
 const form={querySelector:selector=>nodes[selector],querySelectorAll:()=>[],getAttribute:()=>null,addEventListener(){}};
 const data={activity:{},draft:{files:[]}};
 bindProcedureSubmission(form,data,{policy:{enabled:true,required:true,formats:['any'],maxFiles}});
 const select=files=>{input.files=files;events.get('inputchange')();};
 return {form,data,select,saved,error};
}

test('acknowledging saved files prevents duplicates and keeps files added during the request',()=>{
 const {form,data,select,saved}=supportFixture(),first={name:'primero.pdf',size:10,lastModified:1},second={name:'segundo.pdf',size:20,lastModified:2};
 select([first]);const uploading=[...form.procedureUploads.files()];select([second]);
 data.draft.files=[{id:'saved-first',...first,url:'/api/saved-first'}];form.procedureUploads.acknowledgeSaved(uploading);
 assert.deepEqual(form.procedureUploads.files(),[second]);assert.doesNotThrow(()=>form.procedureUploads.validate(false));
 assert.match(saved.innerHTML,/saved-first/);assert.match(saved.innerHTML,/Guardado/);
 data.draft.files.push({id:'saved-second',...second,url:'/api/saved-second'});form.procedureUploads.acknowledgeSaved([second]);
 assert.deepEqual(form.procedureUploads.files(),[]);assert.doesNotThrow(()=>form.procedureUploads.validate(true));
});

test('saved file presentation escapes filenames and rejects script URLs',()=>{
 const html=savedSupportFiles([{id:'"bad',name:'<img src=x onerror=bad()>',url:'javascript:bad()',downloadUrl:'//foreign.example/file',size:1}]);
 assert.doesNotMatch(html,/<img|javascript:|\/\/foreign/);assert.match(html,/&lt;img/);assert.match(html,/value="&quot;bad"/);
});

test('analytics filters preserve the active tab, and clear student/activity when changing group',()=>{
 const fields=new URLSearchParams('group=g1&student=s1&activity=a1&from=2026-10-01&to=2026-10-27');
 const trends=analyticsFilterRoute(fields,{previousGroup:'g1',tab:'trends'});
 assert.equal(params(trends).get('tab'),'trends');assert.equal(params(trends).get('student'),'s1');
 const detail=analyticsFilterRoute(fields,{previousGroup:'g1',tab:'student'});assert.equal(params(detail).get('tab'),'student');
 fields.set('group','g2');const changed=analyticsFilterRoute(fields,{previousGroup:'g1',tab:'student'});
 assert.match(changed,/^#estadisticas\/g2/);assert.equal(params(changed).has('student'),false);assert.equal(params(changed).has('activity'),false);assert.equal(params(changed).has('tab'),false);
 assert.equal(params(changed).get('from'),'2026-10-01');
 const html=renderAnalyticsFilters({group:{id:'g1'},filters:{}},{tab:'trends'});assert.match(html,/data-report-tab="trends"/);
});

test('gradebook filters retain the matrix for the same group and drop a foreign student',()=>{
 const fields=new URLSearchParams('student=s2&from=2026-10-10');
 const same=gradebookFilterRoute('g1',fields,'#calificaciones/g1?student=s1&view=matrix');
 assert.equal(params(same).get('view'),'matrix');assert.equal(params(same).get('student'),'s2');
 const changed=gradebookFilterRoute('g2',fields,'#calificaciones/g1?view=matrix');
 assert.equal(params(changed).has('view'),false);assert.equal(params(changed).has('student'),false);assert.equal(params(changed).get('from'),'2026-10-10');
});

test('Panorama modes retain student, activity and audit filters without altering the measurement period',()=>{
 const origin='#panorama?group=g1&student=s1&activity=a1&from=2026-10-01&to=2026-10-27&category=grades&person=t1&search=nota&page=3';
 const events=panoramaViewHref(origin,'events');assert.equal(params(events).get('mode'),'events');
 const back=panoramaViewHref(events);assert.equal(params(back).has('mode'),false);
 for(const key of ['group','student','activity','from','to','category','person','search','page'])assert.equal(params(back).get(key),params(origin).get(key));
 const fields=new URLSearchParams('group=g1&person=t2&category=grades&from=2026-10-02');
 const filtered=panoramaEventFiltersHref(fields,events);assert.equal(params(filtered).get('student'),'s1');assert.equal(params(filtered).has('page'),false);
 fields.set('group','g2');assert.equal(params(panoramaEventFiltersHref(fields,events)).has('student'),false);
 const academic=analyticsFilterRoute(new URLSearchParams('group=g1&student=s1'),{route:'panorama',previousGroup:'g1',currentHash:events});
 assert.equal(params(academic).get('category'),'grades');assert.equal(params(academic).get('student'),'s1');
});

function reviewFixture(api){
 const listeners=new Map(),nodes=new Map(),input={checkValidity:()=>true},form={querySelector:()=>input};
 const node=()=>({innerHTML:'',textContent:'',hidden:false,disabled:false,classList:{toggle(){}},focus(){}});
 const modal={dataset:{},open:true,classList:{add(){}},addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},querySelector(selector){if(selector==='#review-grade-form')return form;if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},close(){this.open=false;},setAttribute(){},removeAttribute(){}};
 const review=createActivityReview({api,modal,openModal(){},icon:()=>'',toast(){},render(){},questionMedia:()=>''});
 review.open({activity:{id:'a',title:'Tarea',kind:'task',status:'published',maxPoints:5,weight:10,attachments:[]},submissions:[{id:'submission',studentId:'s1',name:'Alumno',state:'submitted',attempt:1,version:1,points:null,files:[]}]});
 const change=type=>{const target={id:'',matches:()=>true,closest:selector=>selector===(type==='grade'?'#review-grade-form':'#review-return-form')?{}:null};for(const fn of listeners.get('input')||[])fn({target});};
 return {review,modal,change,nodes};
}

test('review navigation saves private grades without closing the modal or releasing the grade',async()=>{
 const original=globalThis.FormData,writes=[];
 globalThis.FormData=class {get(key){return ({points:'4',feedback:'Revisado'})[key]||'';}has(){return false;}};
 const {review,modal,change}=reviewFixture(async(path,request)=>{writes.push({path,request});return {version:2,points:4,feedback:'Revisado',gradeDraft:true};});
 try{change('grade');assert.equal(await review.beforeLeave(),true);assert.equal(modal.open,true);assert.equal(modal.dataset.dirty,'false');
  assert.equal(writes.length,1);assert.match(writes[0].path,/\/grade$/);assert.equal(writes[0].request.body.published,false);
  change('return');assert.equal(await review.beforeLeave(),true);assert.equal(modal.dataset.dirty,'true');assert.equal(writes.length,1,'a correction request must remain unsent');
 }finally{review.dispose();globalThis.FormData=original;}
});

test('failed review autosave blocks navigation and retains the correction controls and error',async()=>{
 const original=globalThis.FormData;globalThis.FormData=class {get(){return '4';}has(){return false;}};
 let fail=true;const {review,modal,change,nodes}=reviewFixture(async()=>{if(fail)throw Error('Sin conexión');return {version:2,points:4};});
 try{change('grade');assert.equal(await review.beforeLeave(),false);assert.equal(modal.open,true);assert.equal(modal.dataset.dirty,'true');
  assert.equal(nodes.get('#review-grade-form .review-error').textContent,'Sin conexión');
  fail=false;assert.equal(await review.beforeLeave(),true);assert.equal(modal.dataset.dirty,'false');
 }finally{review.dispose();globalThis.FormData=original;}
});

test('the student activity exposes a safe back fallback for the navigation helper',()=>{
 const html=studentActivityWorkspace({course:{title:'Curso'},activity:{id:'a',courseId:'group',title:'Tarea',kind:'task',status:'published',maxPoints:5,weight:10,maxAttempts:1,attachments:[],responseSettings:{text:true,files:false,link:false}},mine:[]},{questionMedia:()=>''});
 assert.match(html,/<a class="text-button" data-nav-back href="#actividades\/group"/);
});
