import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.mjs';
import {evaluatedSignature} from '../server/academic-policy.mjs';
import {responseSettings} from '../server/activity-forms.mjs';

const simulatorFile={name:'circuito.sim',base64:Buffer.from('Proyecto de simulación sintético').toString('base64')};
const question=(type,id=type,extra={})=>({id,type,prompt:'Resuelve el punto '+id,points:2,...extra});
const selection=question('single','choice',{options:['Correcta','Otra'],correct:[0]});

async function fixture(t,env={}){
 const root=await mkdtemp(join(tmpdir(),'aula-activity-forms-'));
 const password='Synthetic-Forms-2026!';
 const app=await createApp({dataDir:root,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99160001',ADMIN_PASSWORD:password,...env}});
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await new Promise(done=>app.server.close(done));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'aula-activity-forms-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const client=()=>{let cookie='';return async(path,body,method=body?'POST':'GET',expected=200)=>{
  const response=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
 };};
 const masterCall=client(),master=async(...args)=>(await masterCall(...args)).data;
 await master('/auth/login',{document:'99160001',password});
 const template=await master('/admin/courses',{title:'Plantilla de formularios'},'POST',201),group=await master(`/platform/courses/${template.id}/clone`,{kind:'group',title:'Grupo de formularios',cohort:'2026-2',code:'F'},'POST',201);
 await master(`/platform/courses/${group.id}/state`,{state:'active'});
 await master(`/admin/courses/${group.id}/enrollments/bulk`,{students:[{document:'99160003',name:'Estudiante de prueba'},{document:'99160004',name:'Otra persona sintética'}]},'POST',201);
 const students=[];
 for(const document of ['99160003','99160004']){const call=client();await call('/auth/login',{document,password:document});await call('/auth/first-password',{newPassword:'4567',confirmPassword:'4567'});students.push(async(...args)=>(await call(...args)).data);}
 const activity=(body={},expected=201)=>master(`/academics/courses/${group.id}/activities`,{title:'Actividad de prueba',kind:'task',status:'published',maxAttempts:3,...body},'POST',expected);
 const submit=(a,body={},expected=201,student=students[0])=>student(`/academics/activities/${a.id}/submit`,{requestId:randomUUID(),activityRevision:a.revision,action:'submit',...body},'POST',expected);
 const activityView=(a,student=students[0])=>student(`/academics/activities/${a.id}`);
 return {...app,root,master,masterCall,students,activity,submit,activityView};
}

test('short, numeric and extended answers keep draft edits and require valid responses only at final submission',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',questions:[question('short'),question('number'),question('text'),selection]});
 assert.deepEqual(a.questions.map(q=>q.type),['short','number','text','single']);assert.deepEqual(a.questions[0].correct,[]);assert.deepEqual(a.questions[1].options,[]);
 const visible=(await f.activityView(a)).activity;
 assert.ok(!JSON.stringify(visible).includes('"correct"'));
 const requestId=randomUUID();let draft=await f.submit(a,{requestId,action:'draft',answers:{short:'',number:'-',text:'',choice:[]}});
 assert.equal(draft.state,'draft');assert.equal(draft.answers.number,'-');
 await f.submit(a,{requestId,version:draft.version,answers:{short:'Respuesta',number:'1e9999',text:'Explicación',choice:[0]}},400);
 await f.submit(a,{requestId,version:draft.version,answers:{short:'x'.repeat(501),number:'1',text:'Explicación',choice:[0]}},400);
 await f.submit(a,{requestId,version:draft.version,answers:{short:'Respuesta',number:'2 N',text:'Explicación',choice:[0]}},400);
 await f.submit(a,{requestId,version:draft.version,answers:{short:'Respuesta',number:'2',text:'',choice:[0]}},400);
 const sent=await f.submit(a,{requestId,version:draft.version,answers:{short:'Equilibrio',number:'-1,25e2',text:'Explicación razonada',choice:[0]}});
 assert.equal(sent.state,'submitted');assert.equal(sent.points,null);assert.equal(sent.answers.number,'-1,25e2');
 const raw=f.db.prepare('SELECT points,payload FROM submissions WHERE id=?').get(sent.id);assert.equal(raw.points,null);assert.equal(JSON.parse(raw.payload).automaticPoints,null);
 const zero=await f.submit(a,{answers:{short:'Cero',number:0,text:'El resultado es cero.',choice:[1]}},201,f.students[1]);assert.equal(zero.answers.number,'0');
});

test('instruction-only simulation quizzes require final files, preserve drafts and return for correction in the same attempt',async t=>{
 const f=await fixture(t),a=await f.activity({kind:'quiz',questions:[question('instruction','simulation'),question('instruction','analysis')],procedureSupport:{enabled:false,formats:['any'],maxFiles:2,reviewRequired:true,instructions:'Adjunta el proyecto y el informe.'}});
 assert.equal(a.procedureSupport.enabled,true);assert.equal(a.maxPoints,4);assert.equal(a.procedureSupport.maxFiles,2);
 const requestId=randomUUID();let draft=await f.submit(a,{requestId,action:'draft'});assert.deepEqual(draft.answers,{});assert.equal(draft.state,'draft');
 await f.submit(a,{requestId,version:draft.version},400);
 let sent=await f.submit(a,{requestId,version:draft.version,files:[simulatorFile]});assert.equal(sent.state,'submitted');assert.equal(sent.procedureReviewPending,true);assert.equal(sent.files.length,1);assert.deepEqual(sent.answers,{});
 await f.students[1](`/academics/submissions/${sent.id}/grade`,{version:sent.version,points:4,published:true},'PATCH',403);
 let graded=await f.master(`/academics/submissions/${sent.id}/grade`,{version:sent.version,points:3,feedback:'Revisa el circuito.',published:false,procedureReviewed:true},'PATCH');
 assert.equal((await f.activityView(a)).mine[0].points,null);
 graded=await f.master(`/academics/submissions/${sent.id}/release`,{version:graded.version});assert.equal((await f.activityView(a)).mine[0].points,3);
 const returned=await f.master(`/academics/submissions/${sent.id}/return`,{version:graded.version,reason:'Corrige las conexiones.'},'PATCH');
 sent=await f.submit(a,{requestId,version:returned.version,retainFileIds:returned.files.map(file=>file.id)});assert.equal(sent.id,returned.id);assert.equal(sent.attempt,1);assert.equal(sent.files.length,1);assert.equal(sent.points,null);
 const restricted=await f.activity({kind:'quiz',questions:[question('instruction')],procedureSupport:{enabled:true,formats:['pdf'],maxFiles:1}});
 await f.submit(restricted,{files:[simulatorFile]},400);
 await f.activity({kind:'quiz',questions:[question('instruction')],procedureSupport:{enabled:false,formats:[]}},400);
});

test('assignment response channels enforce allowed and required fields without restricting existing assignments',async t=>{
 const f=await fixture(t),filesOnly=await f.activity({responseSettings:{text:false,link:false,files:true,requireFiles:true}});
 await f.submit(filesOnly,{action:'draft'});
 const draft=(await f.activityView(filesOnly)).mine[0];
 await f.submit(filesOnly,{requestId:draft.requestId,version:draft.version,text:'Texto no permitido'},400);
 await f.submit(filesOnly,{requestId:draft.requestId,version:draft.version,url:'https://example.org'},400);
 await f.submit(filesOnly,{requestId:draft.requestId,version:draft.version},400);
 const sent=await f.submit(filesOnly,{requestId:draft.requestId,version:draft.version,files:[simulatorFile]});assert.equal(sent.files.length,1);assert.equal(sent.text,'');assert.equal(sent.points,null);
 const textOnly=await f.activity({responseSettings:{text:true,link:false,files:false,requireText:true}});
 const before=(await readdir(join(f.root,'uploads'))).length;
 await f.submit(textOnly,{text:'Explicación',files:[simulatorFile]},400);assert.equal((await readdir(join(f.root,'uploads'))).length,before,'rejected files are not written');
 await f.submit(textOnly,{action:'draft',url:'https://example.org'},400);
 await f.submit(textOnly,{},400);await f.submit(textOnly,{text:'Explicación'});
 const linkOnly=await f.activity({responseSettings:{text:false,link:true,files:false,requireLink:true}});
 await f.submit(linkOnly,{},400);const linked=await f.submit(linkOnly,{url:'https://example.org/resultados'});assert.equal(linked.url,'https://example.org/resultados');
 const legacy=await f.activity();assert.deepEqual(legacy.responseSettings,responseSettings());await f.submit(legacy,{text:'Texto libre',url:'https://example.org',files:[simulatorFile]});
 for(const responseSettings of [{text:false,link:false,files:false},{files:false,requireFiles:true},{text:'true'},{unknown:true},null])await f.activity({responseSettings},400);
 await f.activity({responseSettings:{files:false},procedureSupport:{enabled:true}},400);
});

test('changing response rules is an evaluated revision while default settings preserve legacy activity signatures',async t=>{
 const raw={kind:'task',maxPoints:100,questions:[],procedureSupport:{enabled:false}};
 assert.equal(evaluatedSignature(raw),evaluatedSignature({...raw,responseSettings:responseSettings()}));
 assert.notEqual(evaluatedSignature(raw),evaluatedSignature({...raw,responseSettings:{...responseSettings(),requireFiles:true}}));
 const f=await fixture(t);let a=await f.activity();const old=await f.submit(a,{text:'Respuesta conservada'});
 // Simulate an activity created before responseSettings existed.
 const stored=JSON.parse(f.db.prepare('SELECT config FROM activities WHERE id=?').get(a.id).config);delete stored.responseSettings;f.db.prepare('UPDATE activities SET config=? WHERE id=?').run(JSON.stringify(stored),a.id);
 a=await f.master(`/academics/activities/${a.id}`);a=a.activity;
 a=await f.master(`/academics/activities/${a.id}`,{version:a.version,responseSettings:responseSettings()},'PATCH');assert.equal(a.revision,1);
 await f.master(`/academics/activities/${a.id}`,{version:a.version,responseSettings:{text:false,link:false,files:true,requireFiles:true},changeKind:'editorial'},'PATCH',400);
 a=await f.master(`/academics/activities/${a.id}`,{version:a.version,responseSettings:{text:false,link:false,files:true,requireFiles:true},changeKind:'evaluated',revisionPolicy:'repeat'},'PATCH');
 assert.equal(a.resubmissionRequired,true);assert.equal(a.revision,2);
 const current=await f.activityView(a);assert.equal(current.mine.length,0);assert.equal(current.previous[0].id,old.id);assert.equal(current.previous[0].text,'Respuesta conservada');
 assert.deepEqual(current.previous[0].previousActivity.responseSettings,responseSettings());
 await f.submit(a,{text:'La configuración nueva exige archivos'},400);await f.submit(a,{files:[simulatorFile]});
});

test('student overview distinguishes drafts, corrections and delivery formats without exposing response or future materials',async t=>{
 const f=await fixture(t);
 const written=await f.activity({responseSettings:{text:true,link:false,files:false,requireText:true}});
 const sent=await f.submit(written,{text:'PRIVATE_STUDENT_ANSWER'});
 let correction=await f.master(`/academics/submissions/${sent.id}/return`,{version:sent.version,reason:'PRIVATE_CORRECTION_FEEDBACK'},'PATCH');
 const filesOnly=await f.activity({responseSettings:{text:false,link:false,files:true,requireFiles:true}});
 await f.submit(filesOnly,{action:'draft',files:[simulatorFile]});
 const task=await f.activity();await f.submit(task,{text:'PRIVATE_TASK_ANSWER'});
 const choice=await f.activity({kind:'quiz',questions:[selection]});await f.submit(choice,{answers:{choice:[0]}});
 const future=await f.activity({kind:'quiz',opensAt:'2099-01-01T00:00:00Z',questions:[{...selection,prompt:'PRIVATE_FUTURE_PROMPT',options:['PRIVATE_CORRECT_OPTION','Otra']}],attachments:[{...simulatorFile,name:'PRIVATE_FUTURE_MATERIAL.sim'}]});
 const exercises=await f.activity({kind:'quiz',opensAt:'2099-01-01T00:00:00Z',questions:[question('instruction','futureExercise',{prompt:'PRIVATE_EXERCISE_PROMPT'})]});
 const overview=async(student=f.students[0])=>(await student('/academics/courses')).flatMap(c=>c.activities);
 let activities=await overview(),byId=new Map(activities.map(a=>[a.id,a]));
 assert.equal(byId.get(written.id).responseState,'returned');assert.equal(byId.get(written.id).activityFormat,'text');assert.equal(byId.get(written.id).state,'Pendiente');
 assert.equal(byId.get(filesOnly.id).responseState,'draft');assert.equal(byId.get(filesOnly.id).activityFormat,'files');
 assert.equal(byId.get(task.id).responseState,'submitted');assert.equal(byId.get(task.id).activityFormat,'task');assert.equal(byId.get(task.id).state,'Entregada');
 assert.equal(byId.get(choice.id).responseState,'submitted');assert.equal(byId.get(choice.id).activityFormat,'quiz');
 assert.equal(byId.get(future.id).responseState,'pending');assert.equal(byId.get(exercises.id).activityFormat,'exercises');
 correction=await f.submit(written,{requestId:correction.requestId,version:correction.version,action:'draft',text:'PRIVATE_CORRECTED_DRAFT'});
 assert.equal(correction.state,'draft');assert.ok(correction.returnedAt);
 assert.equal((await overview()).find(a=>a.id===written.id).responseState,'returned');
 for(const a of activities)assert.deepEqual(Object.keys(a).sort(),['id','title','dueAt','opensAt','closesAt','kind','responseState','activityFormat','state'].sort());
 assert.ok(!JSON.stringify(activities).includes('PRIVATE_'));
 activities=await overview(f.students[1]);assert.ok(activities.every(a=>a.responseState==='pending'));assert.ok(!JSON.stringify(activities).includes('PRIVATE_'));
});
