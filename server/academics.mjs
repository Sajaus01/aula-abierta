import {procedurePolicy} from '../public/procedure-support.js';
import {validateProcedurePolicy,validateProcedureFiles} from './procedure-support.mjs';
import {setupAcademicPolicy,revisionDecision,scaleOnlyChange,validatePeriods,gradeCalculation} from './academic-policy.mjs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createAcademicFiles,submissionFiles} from './academic-files.mjs';
import {createSubmissionExports} from './submission-exports.mjs';
import {responseSettings,validateResponseSettings,validateTaskResponse,isFiniteNumericAnswer} from './activity-forms.mjs';
import {courseChapterOrder,sortCourseActivities} from './course-model.mjs';
import {setupActivityDeadlines,createActivityDeadlines,resolveActivityDeadline} from './activity-deadlines.mjs';
import {setupAutomaticClosures,createAutomaticClosures} from './automatic-closures.mjs';
import {createActivityEvaluation} from './activity-evaluation.mjs';
import {prepareScaleConversions} from './activity-scales.mjs';
import {submissionMaxPoints,questionPointsTotal} from '../public/grading-scale.js';

export function setupAcademics(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS grading_settings(course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE, config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,config TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activity_files(id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,file_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,position INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS activities_course ON activities(course_id);
 CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_key TEXT NOT NULL,attempt INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,submitted_at TEXT,late INTEGER NOT NULL DEFAULT 0,points REAL,feedback TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,UNIQUE(activity_id,student_id,request_key));
 CREATE INDEX IF NOT EXISTS submissions_activity_student ON submissions(activity_id,student_id);`);
 for(const [table,column] of [['activities','revision'],['submissions','revision'],['submissions','superseded']])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT ${column==='superseded'?0:1}`);
 for(const column of ['returned_at','return_due_at'])if(!db.prepare('PRAGMA table_info(submissions)').all().some(c=>c.name===column))db.exec(`ALTER TABLE submissions ADD COLUMN ${column} TEXT`);
 setupActivityDeadlines(db);
 setupAutomaticClosures(db);
 db.exec('CREATE TABLE IF NOT EXISTS grade_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,submission_id TEXT NOT NULL,actor_id TEXT NOT NULL,before_value TEXT NOT NULL,after_value TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL)');
}
const defaults={scaleMax:5,passMark:3,missingAsZero:false,finalPublished:false};
const parse=row=>row?JSON.parse(row.config):null;
const rounded=n=>Math.round((n+Number.EPSILON)*100)/100;

export function createAcademics(ctx) {
 const {db,fail,json,readJson,readSession,requireAdmin,requireStudent,requireCourse,isEnrolled,validateFile,fileResponse,uploadsDir,audit,env,accessModel,storage}=ctx;
 const all=(sql,...p)=>db.prepare(sql).all(...p),one=(sql,...p)=>db.prepare(sql).get(...p),run=(sql,...p)=>db.prepare(sql).run(...p);
 if(accessModel)setupAcademicPolicy(db);
 const files=createAcademicFiles(ctx);
 const extensions=createActivityDeadlines({db,fail});
 const activityEvaluation=createActivityEvaluation({db,accessModel});
 const submissionExports=createSubmissionExports(ctx);
 const now=()=>new Date().toISOString(),admin=a=>a?.user.role==='admin'&&a.assurance==='password';
 const settings=id=>({...defaults,...parse(one('SELECT config FROM grading_settings WHERE course_id=?',id))});
 const saveSettings=(id,c)=>run('INSERT INTO grading_settings VALUES (?,?) ON CONFLICT(course_id) DO UPDATE SET config=excluded.config',id,JSON.stringify(c));
 const invalidate=id=>saveSettings(id,{...settings(id),finalPublished:false});
 const text=(v,label,max=10000,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail(400,`${label}: texto ${required?'obligatorio, ':''}máximo ${max} caracteres.`);return v.trim();};
 const num=(v,label,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(400,`${label}: usa un número entre ${min} y ${max}.`);return v;};
 const bool=(v,label)=>{if(typeof v!=='boolean')fail(400,`${label} no válido.`);return v;};
 const date=(v)=>{if(v===null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))fail(400,'Fecha no válida; incluye zona horaria.');return new Date(v).toISOString();};
 const access=(id,auth)=>{const c=requireCourse(id,auth);if(!admin(auth)){requireStudent(auth);if(auth.assurance!=='password')fail(403,'Ingresa con contraseña para entregar actividades y consultar notas.','PASSWORD_REQUIRED');if(!auth.preview&&!isEnrolled(auth.user.id,id))fail(403,'Necesitas matrícula vigente para participar en las actividades.');}return c;};
 const activityFromRow=r=>{const config=parse(r);return {...config,procedureSupport:procedurePolicy(config.procedureSupport),responseSettings:responseSettings(config.responseSettings),id:r.id,courseId:r.course_id,moduleId:r.module_id,version:r.version,revision:r.revision,createdAt:r.created_at};};
 const getActivity=id=>{const row=one('SELECT * FROM activities WHERE id=?',id);if(!row)fail(404,'Actividad no encontrada.');return activityFromRow(row);};
 const list=id=>sortCourseActivities(all('SELECT * FROM activities WHERE course_id=? ORDER BY created_at,id',id).map(activityFromRow),all('SELECT id,position FROM modules WHERE course_id=?',id),courseChapterOrder(one('SELECT * FROM courses WHERE id=?',id)));
 const released=a=>a.status==='published'&&(!a.moduleId||Boolean(one('SELECT id FROM modules WHERE id=? AND published=1',a.moduleId)));
 const checkActivity=(id,auth)=>{const a=getActivity(id);access(a.courseId,auth);if(!admin(auth)&&auth.previewActivity!==id&&!released(a))fail(404,'Actividad no disponible.');return a;};
 function evaluationSummaries(courseIds,auth){return activityEvaluation.summaries(courseIds,auth);}
 function evaluationSummary(courseId,auth){return evaluationSummaries([courseId],auth).get(courseId)||null;}
 function activityViewContext(courseId,auth){
  const summary=admin(auth)?evaluationSummary(courseId,auth):null,attachments=new Map();
  for(const file of all('SELECT f.activity_id,f.id,f.file_key AS key,f.name,f.mime,f.size FROM activity_files f JOIN activities a ON a.id=f.activity_id WHERE a.course_id=? ORDER BY f.activity_id,f.position,f.id',courseId)){const group=attachments.get(file.activity_id)||[];group.push(file);attachments.set(file.activity_id,group);}
  return {summary,counts:admin(auth)?summary?.legacyCounts||activityEvaluation.counts([courseId]):null,attachments};
 }
 function view(a,auth,providedContext){
  const available=admin(auth)||auth.previewActivity===a.id||!a.opensAt||a.opensAt<=now(),context=providedContext||(admin(auth)?activityViewContext(a.courseId,auth):null);
  const evaluation=context?.summary?.byActivity.get(a.id)?.evaluation;
  const counts=admin(auth)?context.counts?.get(a.id)||{submissionCount:0,draftCount:0,returnedCount:0,activeResponseCount:0}:{};
  return {...a,...(evaluation?{evaluation}:{}),...(!admin(auth)&&!auth.preview?deadlineFields(a,auth.user.id):{}),...(auth.previewActivity===a.id?{previewStatus:a.status,opensAt:null,dueAt:null,closesAt:null}:{}),instructionUrl:available?a.instructionUrl||'':'',attachments:available?files.publicFiles(context?.attachments?context.attachments.get(a.id)||[]:files.instructionFiles(a.id),'/api/academics/activities/'+a.id+'/attachments'):[],materialsAvailable:available,questions:!admin(auth)&&auth.previewActivity!==a.id&&a.opensAt&&a.opensAt>now()?[]:a.questions.map(q=>admin(auth)?q:{id:q.id,type:q.type,prompt:q.prompt,options:q.options,points:q.points,imageUrl:q.imageUrl,imageAlt:q.imageAlt,linkUrl:q.linkUrl,media:q.media||[]}),...counts};
 }
 function subView(s,auth) {const p=JSON.parse(s.payload),attachments=submissionFiles(p),first=attachments[0];const visible=admin(auth)||Boolean(s.published),feedbackVisible=visible||Boolean(s.returned_at);const prior=accessModel?one('SELECT config,files FROM activity_versions WHERE activity_id=? AND revision=?',s.activity_id,s.revision):null;const versionConfig=prior?JSON.parse(prior.config):getActivity(s.activity_id),draft=admin(auth)?p.teacherGradeDraft:null;return {procedureSupport:p.procedureSupport||null,procedureNote:p.procedureNote||'',procedureReviewPending:!!p.procedureReviewPending,automaticPoints:admin(auth)?p.automaticPoints??null:undefined,questionFeedback:visible?versionConfig.questions.map(q=>({id:q.id,feedback:q.feedback||''})):[],instructionFiles:prior?files.publicFiles(JSON.parse(prior.files),`/api/academics/submissions/${s.id}/instructions`):[],id:s.id,activityId:s.activity_id,revision:s.revision,gradingMaxPoints:submissionMaxPoints(p,versionConfig),scaleAdjustment:p.scaleAdjustment||null,superseded:Boolean(s.superseded),previousActivity:admin(auth)&&prior?JSON.parse(prior.config):p.previousActivity||null,studentId:s.student_id,requestId:s.request_key,attempt:s.attempt,state:s.state==='graded'&&!visible?'submitted':s.state,text:p.text||'',url:p.url||'',answers:p.answers||{},files:files.publicFiles(attachments,`/api/academics/submissions/${s.id}/files`),fileName:first?.name||null,fileSize:first?.size||0,fileUrl:first?`/api/academics/submissions/${s.id}/file`:null,submittedAt:s.submitted_at,returnedAt:s.returned_at||null,returnDueAt:s.return_due_at||null,late:Boolean(s.late),points:visible?s.points:null,feedback:feedbackVisible?s.feedback:'',published:Boolean(s.published),version:s.version,updatedAt:s.updated_at,...(admin(auth)?{gradeDraft:!!draft,publishedPoints:s.published?s.points:null,publishedFeedback:s.published?s.feedback:'',...(draft?{points:draft.points,feedback:draft.feedback,state:['draft','returned'].includes(s.state)?s.state:draft.points===null||p.procedureReviewPending?'submitted':'graded'}:{})}:{})};}
 function rows(id,userId) {return all('SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND superseded=0 ORDER BY attempt DESC,updated_at DESC',id,userId);}
 function studentDeadline(activity,userId,submission=undefined,at=now()) {const a=typeof activity==='string'?getActivity(activity):activity;return resolveActivityDeadline(a,extensions.get(a.id,userId),submission===undefined?rows(a.id,userId)[0]:submission,at);}
 const automaticClosures=createAutomaticClosures({db,accessModel,studentDeadline,audit});
 function reconcileClosures(options={}) {return automaticClosures.reconcile(options);}
 function studentClosure(activity,userId,options={}) {const a=typeof activity==='string'||!activity.revision?getActivity(typeof activity==='string'?activity:activity.id):activity;return automaticClosures.get(a,userId,options);}
 function deadlineFields(activity,userId,submission=undefined) {const deadline=studentDeadline(activity,userId,submission);return {extension:deadline.extension,effectiveDueAt:deadline.dueAt,effectiveClosesAt:deadline.closesAt,deadline,closure:studentClosure(activity,userId)};}
 function studentActivitySummary(a,userId,preview=false) {
  const latest=preview?null:rows(a.id,userId)[0],channels=a.responseSettings;
  const fields=preview?{}:deadlineFields(a,userId,latest),closed=Boolean(fields.closure?.closed),delivered=['submitted','graded'].includes(latest?.state);
  const responseState=closed?'missing':latest?.state==='returned'||latest?.state==='draft'&&latest.returned_at?'returned':latest?.state==='draft'?'draft':latest?'submitted':'pending';
  const activityFormat=a.kind==='quiz'?(a.questions.length&&a.questions.every(q=>q.type==='instruction')?'exercises':'quiz'):channels.files&&!channels.text&&!channels.link?'files':channels.text&&!channels.files&&!channels.link?'text':'task';
  return {id:a.id,title:a.title,dueAt:a.dueAt,opensAt:a.opensAt,closesAt:a.closesAt,kind:a.kind,...fields,responseState,activityFormat,finalized:closed||delivered,state:closed?'Finalizada':delivered?'Entregada':'Pendiente'};
 }
 const gradeDraft=s=>JSON.parse(s.payload).teacherGradeDraft||null;
 const effectiveGrade=s=>{const draft=gradeDraft(s);return draft?{...s,points:draft.points,feedback:draft.feedback,published:0}:s;};
 function gradeRow(activities,userId,cfg,forAdmin) {
  for(const courseId of new Set(activities.map(activity=>activity.courseId).filter(Boolean)))reconcileClosures({courseId,studentId:userId});
  const gradeRows=(id,uid)=>rows(id,uid).map(s=>forAdmin?effectiveGrade(s):s);
  if(accessModel)return gradeCalculation(activities,userId,cfg,forAdmin,{rows:gradeRows,closed:a=>studentDeadline(a,userId).closed,closure:a=>studentClosure(a,userId,{reconcile:false}),override:(activityId,studentId)=>Boolean(one("SELECT exempt FROM grade_overrides WHERE activity_id=? AND student_id=?",activityId,studentId)?.exempt)});
  let earned=0,gradedWeight=0,ready=true;
  const cells=activities.map(a=>{const history=gradeRows(a.id,userId),latest=history[0],s=latest?.state==='draft'&&latest.returned_at?{...latest,state:'returned'}:history.find(r=>r.state!=='draft');const closure=studentClosure(a,userId,{reconcile:false}),automaticZero=!s&&Boolean(closure?.closed);const visible=s&&s.state!=='returned'&&s.points!==null&&(forAdmin||s.published);const zero=automaticZero||!s&&cfg.missingAsZero&&studentDeadline(a,userId,latest).closed;const maximum=submissionMaxPoints(s?JSON.parse(s.payload):null,a);const released=s&&s.state!=='returned'&&s.points!==null&&s.published;
   if(a.weight>0){if(visible||zero){earned+=(zero?0:s.points/maximum)*a.weight;gradedWeight+=a.weight;}if(!released&&!zero)ready=false;}
   return {activityId:a.id,title:a.title,weight:a.weight,maxPoints:maximum,submissionId:s?.id||null,points:automaticZero?0:visible?s.points:null,published:automaticZero||Boolean(s?.published),state:s?.state==='returned'?'returned':zero?'missing':!s?'pending':visible?'graded':'submitted',late:Boolean(s?.late),...(closure?{closure}:{})};});
  const weightTotal=rounded(activities.reduce((n,a)=>n+a.weight,0));const complete=ready&&Math.abs(weightTotal-100)<0.001;
  return {cells,weightTotal,gradedWeight:rounded(gradedWeight),provisional:gradedWeight?rounded(earned/gradedWeight*cfg.scaleMax):null,accumulated:rounded(earned/100*cfg.scaleMax),ready:complete,final:cfg.finalPublished&&complete?rounded(earned/100*cfg.scaleMax):null};
 }
 function config(body,current=null) {
  const b={title:'',description:'',kind:'task',status:'draft',weight:0,maxPoints:100,opensAt:null,dueAt:null,closesAt:null,allowLate:false,maxAttempts:1,questions:[],...current,...body};
  const c={title:text(b.title,'Título',180,true),description:text(b.description,'Instrucciones',20000),kind:b.kind,status:b.status,weight:num(b.weight,'Porcentaje',0,100),maxPoints:num(b.maxPoints,'Puntos máximos',b.kind==='quiz'?.1:1,b.kind==='quiz'?50000:10000),opensAt:date(b.opensAt),dueAt:date(b.dueAt),closesAt:date(b.closesAt),allowLate:bool(b.allowLate,'Entregas tardías'),maxAttempts:num(b.maxAttempts,'Intentos',1,20),questions:[]};
  c.procedureSupport=validateProcedurePolicy(b.procedureSupport,fail);
  c.responseSettings=validateResponseSettings(b.responseSettings,fail);
  if(!Number.isInteger(c.maxAttempts)||!['task','quiz'].includes(c.kind)||!['draft','published','archived'].includes(c.status))fail(400,'Tipo, estado o intentos no válidos.');
  if((c.opensAt&&c.dueAt&&c.opensAt>=c.dueAt)||(c.opensAt&&c.closesAt&&c.opensAt>=c.closesAt)||(c.dueAt&&c.closesAt&&c.dueAt>c.closesAt))fail(400,'Ordena las fechas: apertura, entrega y cierre.');
  if(c.allowLate&&!c.dueAt)fail(400,'Define una fecha de entrega para admitir entregas tardías.');
  if(c.kind==='quiz'){
   if(!Array.isArray(b.questions)||!b.questions.length||b.questions.length>50)fail(400,'El cuestionario requiere de 1 a 50 preguntas.');const ids=new Set();
   c.questions=b.questions.map(q=>{if(!q||typeof q!=='object'||Array.isArray(q))fail(400,'Pregunta no válida.');const id=text(q.id,'Identificador',80,true);if(ids.has(id))fail(400,'Identificador de pregunta repetido.');ids.add(id);if(!['single','multiple','text','short','number','instruction'].includes(q.type))fail(400,'Tipo de pregunta no válido.');
    const r={id,type:q.type,prompt:text(q.prompt,'Pregunta',3000,true),points:num(q.points,'Puntos de pregunta',0.1,1000),options:[],correct:[]};
    if(['single','multiple'].includes(q.type)){if(!Array.isArray(q.options)||q.options.length<2||q.options.length>10)fail(400,'Cada pregunta de selección requiere entre 2 y 10 opciones.');r.options=q.options.map(v=>text(v,'Opción',1000,true));if(!Array.isArray(q.correct)||!q.correct.length||q.correct.some(n=>!Number.isInteger(n)||n<0||n>=r.options.length)||new Set(q.correct).size!==q.correct.length||(q.type==='single'&&q.correct.length!==1))fail(400,'Selecciona las respuestas correctas.');r.correct=[...q.correct].sort((a,b)=>a-b);}if(accessModel){r.media=Array.isArray(q.media)?q.media.map(v=>text(v,'Archivo de pregunta',200,true)):[];if(r.media.length>5)fail(400,'Hasta 5 archivos por pregunta.');r.imageAlt=text(q.imageAlt||'','Descripción de imagen',500);r.imageUrl=text(q.imageUrl??'','Imagen',2048);if(r.imageUrl&&!/^https:\/\/[^\s]+$/.test(r.imageUrl))fail(400,'La imagen requiere una URL HTTPS.');r.linkUrl=text(q.linkUrl??'','Enlace de apoyo',2048);if(r.linkUrl){let u;try{u=new URL(r.linkUrl);}catch{fail(400,'Enlace de apoyo no válido.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail(400,'Enlace de apoyo no permitido.');r.linkUrl=u.href;}r.feedback=text(q.feedback??'','Retroalimentación',3000);}return r;});
   if(c.questions.some(q=>q.type==='instruction'))c.procedureSupport=validateProcedurePolicy({...c.procedureSupport,enabled:true},fail);
   c.maxPoints=questionPointsTotal(c.questions);
  }
  if(c.kind==='task'&&c.procedureSupport.enabled&&!c.responseSettings.files)fail(400,'Los soportes requieren permitir archivos en la entrega.');
  c.instructionUrl=text(b.instructionUrl??'','Enlace del enunciado',2048);
  if(c.instructionUrl){let u;try{u=new URL(c.instructionUrl);}catch{fail(400,'Escribe un enlace completo para el enunciado.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail(400,'Enlace del enunciado no permitido.');c.instructionUrl=u.href;}
  if(accessModel){c.periodId=text(b.periodId??'','Corte',80);c.timeLimitMinutes=num(b.timeLimitMinutes??0,'Tiempo límite',0,180);c.repeatPolicy=current?.repeatPolicy||'keep';}
  return c;
 }
 function checkWeights(courseId,c,id=null) {if(accessModel&&c.periodId&&!(settings(courseId).periods||[]).some(p=>p.id===c.periodId))fail(400,'Selecciona un corte existente.');const total=list(courseId).filter(a=>a.id!==id&&a.status==='published'&&(!accessModel||(a.periodId||'')===(c.periodId||''))).reduce((n,a)=>n+a.weight,0)+(c.status==='published'?c.weight:0);if(total>100.00001)fail(400,'Los porcentajes de actividades publicadas no pueden superar el 100 %.');}
 function checkWindow(a,userId,submission,at=now(),{draftBackup=false}={}){const deadline=studentDeadline(a,userId,submission,at);if(a.opensAt&&at<a.opensAt)fail(403,'La actividad todavía no está abierta.');const backupOnly=Boolean(draftBackup&&deadline.closed&&studentClosure(a,userId,{reconcile:false})?.closed);if(deadline.closed&&!backupOnly)fail(403,deadline.source==='correction'?'El plazo de la corrección terminó. Pide a tu docente que lo amplíe.':'El plazo de la actividad terminó.');return {...deadline,backupOnly};}
 function checkAttemptTime(a,userId,at=now()){if(accessModel&&a.timeLimitMinutes>0){const start=one('SELECT started_at FROM attempt_starts WHERE activity_id=? AND student_id=? AND revision=?',a.id,userId,a.revision);if(!start)fail(409,'Abre la actividad para iniciar el tiempo del intento.');if(Date.parse(at)>=Date.parse(start.started_at)+a.timeLimitMinutes*60000)fail(403,'El tiempo de este intento terminó. Solicita una nueva oportunidad al docente.');}}
 function validateAnswers(a,input,final){if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Respuestas no válidas.');const out={};for(const q of a.questions){const v=input[q.id];if(q.type==='instruction')continue;if(['text','short','number'].includes(q.type)){const value=q.type==='number'&&typeof v==='number'?String(v):v;out[q.id]=text(value??'','Respuesta',q.type==='short'?500:q.type==='number'?200:10000,final);if(q.type==='number'&&final&&!isFiniteNumericAnswer(out[q.id]))fail(400,'Escribe una respuesta numérica finita; usa punto o coma para los decimales.');}else{const values=v??[];if(!Array.isArray(values)||values.some(n=>!Number.isInteger(n)||n<0||n>=q.options.length)||new Set(values).size!==values.length||(q.type==='single'&&values.length>1)||(final&&!values.length))fail(400,'Revisa las respuestas de selección.');out[q.id]=[...values].sort((x,y)=>x-y);}}return out;}
 function autoScore(a,answers){if(a.questions.some(q=>!['single','multiple'].includes(q.type)))return null;return questionPointsTotal(a.questions.filter(q=>JSON.stringify(q.correct)===JSON.stringify(answers[q.id])));}
 const configuredStorage=Number(env.SUBMISSIONS_MAX_BYTES);
 const maxStorage=Number.isFinite(configuredStorage)&&configuredStorage>0?configuredStorage:500*1024*1024;
 function saveActivityFiles(plan,id,mutate){files.write(plan);try{db.exec('BEGIN IMMEDIATE');mutate();files.storeInstructions(id,plan);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');plan.added.forEach(files.remove);throw error;}plan.removed.forEach(files.remove);}
 function serve(req,res,file,forceDownload=false){const inline=file.mime==='application/pdf'||file.mime.startsWith('image/');fileResponse(req,res,join(uploadsDir,file.key),file.mime,file.name,forceDownload||!inline||new URL(req.url,'http://localhost').searchParams.get('download')==='1',true);return true;}
 function releaseBlock(s,a){
  if(a.status!=='published')return 'Publica la actividad antes de devolver las notas.';
  if(s.superseded||['draft','returned'].includes(s.state))return 'Solo puedes devolver notas de entregas vigentes y enviadas.';
  const latest=one('SELECT id FROM submissions WHERE activity_id=? AND student_id=? AND superseded=0 ORDER BY attempt DESC,updated_at DESC LIMIT 1',s.activity_id,s.student_id);
  if(latest?.id!==s.id)return 'Devuelve la última entrega de este estudiante.';
  if(effectiveGrade(s).points===null)return 'Escribe una nota antes de devolver la entrega.';
  const maximum=submissionMaxPoints(JSON.parse(s.payload),a),points=effectiveGrade(s).points;
  if(!Number.isFinite(points)||!maximum||points<0||points>maximum)return 'La calificación debe estar dentro de la escala vigente de esta entrega.';
  if(JSON.parse(s.payload).procedureReviewPending)return 'Revisa los soportes antes de devolver esta nota.';
  return '';
 }
 function publishSubmission(s,auth){
  const payload=JSON.parse(s.payload),draft=payload.teacherGradeDraft,points=draft?draft.points:s.points,feedback=draft?draft.feedback:s.feedback;
  if(s.published&&!draft)return false;
  delete payload.teacherGradeDraft;
  run("UPDATE submissions SET points=?,feedback=?,published=1,payload=?,state='graded',version=version+1,updated_at=? WHERE id=?",points,feedback,JSON.stringify(payload),now(),s.id);
  if(accessModel)run('INSERT INTO grade_audit(submission_id,actor_id,before_value,after_value,reason,created_at) VALUES(?,?,?,?,?,?)',s.id,auth.user.id,JSON.stringify({points:s.points,published:s.published}),JSON.stringify({points,published:true}),draft?.reason||'Devolución de calificación',now());
  audit(auth.user,'submission.release',s.id,{points,previousPoints:s.points});return true;
 }
 function releaseMany(activities,auth,selection){
  if(selection!==undefined&&(!Array.isArray(selection)||selection.length>5000||selection.some(v=>!v||typeof v.id!=='string'||!Number.isInteger(v.version))))fail(400,'Selecciona las entregas que deseas devolver.');
  const activityMap=new Map(activities.map(a=>[a.id,a])),records=activities.flatMap(a=>all('SELECT * FROM submissions WHERE activity_id=? AND superseded=0 ORDER BY attempt DESC,updated_at DESC',a.id));
  let candidates;
  if(selection!==undefined){
   if(new Set(selection.map(v=>v.id)).size!==selection.length)fail(400,'La selección contiene entregas repetidas.');
   candidates=selection.map(v=>{const s=records.find(s=>s.id===v.id);if(!s)fail(400,'Una entrega no pertenece a esta actividad o ya no está vigente.');if(s.version!==v.version)fail(409,'Una calificación cambió. Actualiza antes de devolver las notas.');return s;});
  }else {const seen=new Set();candidates=records.filter(s=>{const key=s.activity_id+':'+s.student_id;if(seen.has(key))return false;seen.add(key);return true;});}
  const eligible=candidates.filter(s=>!releaseBlock(s,activityMap.get(s.activity_id))&&(!s.published||gradeDraft(s))),releasedIds=[];
  db.exec('BEGIN IMMEDIATE');try{
   for(const s of eligible)if(publishSubmission(s,auth))releasedIds.push(s.id);
   for(const courseId of new Set(eligible.map(s=>activityMap.get(s.activity_id).courseId)))invalidate(courseId);
   db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  return {success:true,releasedCount:releasedIds.length,skippedCount:candidates.length-releasedIds.length,submissions:releasedIds.map(id=>subView(one('SELECT * FROM submissions WHERE id=?',id),auth))};
 }
 function extensionActivity(id,auth) {
  requireAdmin(auth);const activity=checkActivity(id,auth);
  if(accessModel){accessModel.requireScope(auth,activity.courseId,'grade');if(one('SELECT entity_kind FROM courses WHERE id=?',activity.courseId)?.entity_kind!=='group')fail(400,'Los plazos individuales se asignan en un grupo, no en la plantilla.');}
  return activity;
 }
 function extensionStudent(activity,studentId) {
  const student=one('SELECT id,name,document,active,role FROM users WHERE id=?',studentId);
  if(!student?.active||!isEnrolled(studentId,activity.courseId)||(accessModel?(!accessModel.p.active(studentId)||!accessModel.p.roles(studentId).includes('student')):student.role!=='student'))fail(403,'El estudiante necesita una matrícula vigente en este grupo.');
  return student;
 }
 function extensionStudentView(activity,student) {
  const latest=rows(activity.id,student.id)[0],extension=extensions.get(activity.id,student.id),deadline=studentDeadline(activity,student.id,latest);
  return {id:student.id,name:student.name,document:student.document,submissionState:latest?.returned_at&&['returned','draft'].includes(latest.state)?'returned':latest?.state||'pending',extension,extensionVersion:extension?.version||0,deadline,effectiveDueAt:deadline.dueAt,effectiveClosesAt:deadline.closesAt,closure:studentClosure(activity,student.id)};
 }
 function activityClosures(activity) {
  reconcileClosures({activityId:activity.id});
  return all('SELECT c.student_id,u.name,u.document FROM activity_auto_closures c JOIN users u ON u.id=c.student_id WHERE c.activity_id=? AND c.revision=? AND c.active=1 ORDER BY u.name,u.id',activity.id,activity.revision).map(student=>({studentId:student.student_id,name:student.name,document:student.document,closure:studentClosure(activity,student.student_id,{reconcile:false})}));
 }
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/academics/'))return false;
  if(await submissionExports.handler(req,res,path,method,auth))return true;
  const send=(data,status)=>{json(res,data,status);return true;};let match;
  if(path==='/api/academics/storage'&&method==='GET'){requireAdmin(auth);const mine=storage?.report(auth);return send({...mine,usedBytes:!accessModel||accessModel.global(auth)?files.usedBytes():mine?.own.usedBytes,maxBytes:storage?.settings().submissionBytes??maxStorage,fileMaxBytes:10*1024*1024});}
  if(path==='/api/academics/courses'&&method==='GET'){
   if(admin(auth)){
    const courses=all('SELECT id,title FROM courses ORDER BY title').filter(course=>!accessModel||accessModel.p.can(auth.user.id,course.id,'view')),ids=courses.map(course=>course.id),summaries=evaluationSummaries(ids,auth),pending=activityEvaluation.pendingByCourse(ids);
    return send(courses.map(course=>{const summary=summaries.get(course.id);return {...course,pending:pending.get(course.id)||0,...(summary?{activities:summary.activities,evaluation:summary.evaluation}:{})};}));
   }
   requireStudent(auth);if(auth.assurance!=='password')fail(403,'Ingresa con contraseña para ver tus actividades y notas.','PASSWORD_REQUIRED');
   const courses=all('SELECT id,title,published FROM courses WHERE published=1').filter(c=>auth.preview?c.id===auth.preview:isEnrolled(auth.user.id,c.id));
   return send(courses.map(c=>({id:c.id,title:c.title,activities:list(c.id).filter(released).map(a=>studentActivitySummary(a,auth.user.id,Boolean(auth.preview)))})));
  }
  match=/^\/api\/academics\/courses\/([^/]+)(?:\/(activities|settings|gradebook|release))?$/.exec(path);
  if(match){const [,id,section]=match;const c=access(id,auth);
   if(!section&&method==='GET'){const acts=list(id).filter(a=>admin(auth)||released(a));const cfg=settings(id),context=activityViewContext(id,auth);const grade=!admin(auth)&&!auth.preview?gradeRow(list(id).filter(a=>a.status==='published'),auth.user.id,cfg,false):null;if(grade)grade.cells=grade.cells.filter(cell=>acts.some(a=>a.id===cell.activityId));return send({course:{id:c.id,title:c.title},settings:cfg,activities:acts.map(a=>({...view(a,auth,context),mine:!admin(auth)?auth.preview?[]:rows(a.id,auth.user.id).map(s=>subView(s,auth)):undefined})),grade});}
   requireAdmin(auth);
   if(section==='release'&&method==='POST'){await readJson(req);auth=readSession(req);requireAdmin(auth);access(id,auth);const result=releaseMany(list(id).filter(a=>a.status==='published'),auth);return send(result);}
   if(section==='activities'&&method==='POST'){const b=await readJson(req,29*1024*1024);auth=readSession(req);requireAdmin(auth);access(id,auth);const a=config(b);checkWeights(id,a);let moduleId=b.moduleId||null;if(moduleId&&!one('SELECT id FROM modules WHERE id=? AND course_id=?',moduleId,id))fail(400,'Capítulo no válido.');const aid=randomUUID(),plan=files.prepare([],b.attachments,b.retainAttachmentIds,{teacher:true});storage?.assertUpload({userId:auth.user.id,courseId:id,added:plan.added});saveActivityFiles(plan,aid,()=>{run('INSERT INTO activities(id,course_id,module_id,config,created_at) VALUES (?,?,?,?,?)',aid,id,moduleId,JSON.stringify(a),now());invalidate(id);audit(auth.user,'activity.create',aid);});return send(view(getActivity(aid),auth),201);}
   if(section==='gradebook'&&method==='GET'){const activities=list(id).filter(a=>a.status==='published');const cfg=settings(id),context=activityViewContext(id,auth);const students=all("SELECT u.id,u.name,u.document,u.active,e.status FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=? ORDER BY u.name",id);return send({course:{id,title:c.title},settings:cfg,activities:activities.map(a=>view(a,auth,context)),students:students.map(s=>({...s,...gradeRow(activities,s.id,cfg,true)}))});}
   if(section==='settings'&&method==='PUT'){const b=await readJson(req);auth=readSession(req);requireAdmin(auth);access(id,auth);const cfg={...settings(id),...b};const out={scaleMax:num(cfg.scaleMax,'Escala',1,100),passMark:num(cfg.passMark,'Nota aprobatoria',0,cfg.scaleMax),missingAsZero:bool(cfg.missingAsZero,'Pendientes como cero'),finalPublished:bool(cfg.finalPublished,'Publicar notas finales')};
    if(accessModel){out.periods=validatePeriods(cfg.periods||[],fail);out.rounding='2 decimales';if(list(id).some(a=>a.periodId&&!out.periods.some(p=>p.id===a.periodId)))fail(400,'Antes de eliminar un corte, cambia de corte sus actividades.');const activities=list(id).filter(a=>a.status==='published'),students=all("SELECT student_id FROM enrollments WHERE course_id=?",id);const impact=students.map(s=>({studentId:s.student_id,before:gradeRow(activities,s.student_id,settings(id),true).accumulated,after:gradeRow(activities,s.student_id,out,true).accumulated}));if(b.preview)return send({settings:out,impact});if(impact.some(r=>r.before!==r.after)&&!b.confirmImpact)fail(409,'Revisa y confirma el efecto del cambio sobre las notas.');}
    if(out.finalPublished){const activities=list(id).filter(a=>a.status==='published');const students=all("SELECT student_id FROM enrollments WHERE course_id=? AND status='active'",id);if((!out.periods?.length&&Math.abs(activities.reduce((n,a)=>n+a.weight,0)-100)>0.00001)||students.some(s=>!gradeRow(activities,s.student_id,out,true).ready))fail(400,'Para publicar la nota final, los porcentajes deben sumar 100 % y cada actividad debe estar calificada y publicada. Las entregas faltantes solo cuentan como cero si activas esa opción y el plazo terminó.');}saveSettings(id,out);audit(auth.user,'grades.settings',id);return send(out);}
  }
  match=/^\/api\/academics\/activities\/([^/]+)\/extensions(?:\/([^/]+))?$/.exec(path);
  if(match){const [,id,studentId]=match;let activity=extensionActivity(id,auth);
   if(!studentId&&method==='GET'){
    const students=all('SELECT DISTINCT u.id,u.name,u.document,u.active,u.role FROM users u JOIN enrollments e ON e.student_id=u.id WHERE e.course_id=? AND u.active=1 ORDER BY u.name,u.id',activity.courseId).filter(student=>isEnrolled(student.id,activity.courseId)&&(accessModel?accessModel.p.active(student.id)&&accessModel.p.roles(student.id).includes('student'):student.role==='student'));
    const {title,courseId,version,status,kind,opensAt,dueAt,closesAt,allowLate,maxAttempts,timeLimitMinutes}=activity;
    return send({activity:{id,title,courseId,version,status,kind,opensAt,dueAt,closesAt,allowLate,maxAttempts,timeLimitMinutes:timeLimitMinutes||0},students:students.map(student=>extensionStudentView(activity,student)),serverNow:now()});
   }
   if(studentId&&['PUT','DELETE'].includes(method)){
    const body=await readJson(req);auth=readSession(req);activity=extensionActivity(id,auth);const student=extensionStudent(activity,studentId),at=now();let extension,timerReset=false;
    db.exec('BEGIN IMMEDIATE');try{
     reconcileClosures({activityId:id,studentId,at});
     extension=method==='PUT'?extensions.grant(activity,studentId,body.dueAt,body.version,auth.user.id,at):extensions.revoke(id,studentId,body.version,auth.user.id,at);
     if(method==='PUT'&&accessModel&&activity.timeLimitMinutes>0){const latest=rows(id,studentId)[0],start=one('SELECT started_at FROM attempt_starts WHERE activity_id=? AND student_id=? AND revision=?',id,studentId,activity.revision);if(start&&(!latest||['draft','returned'].includes(latest.state))&&Date.parse(at)>=Date.parse(start.started_at)+activity.timeLimitMinutes*60000){run('DELETE FROM attempt_starts WHERE activity_id=? AND student_id=? AND revision=?',id,studentId,activity.revision);timerReset=true;}}
     reconcileClosures({activityId:id,studentId,at});audit(auth.user,method==='PUT'?'activity.extension.grant':'activity.extension.revoke',id,{studentId,dueAt:extension.dueAt,version:extension.version,timerReset});db.exec('COMMIT');
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    const result=extensionStudentView(activity,student);return send({studentId,extension,extensionVersion:extension.version,deadline:result.deadline,effectiveDueAt:result.effectiveDueAt,effectiveClosesAt:result.effectiveClosesAt,closure:result.closure,submissionState:result.submissionState,timerReset,serverNow:now()});
   }
   fail(404,'Función de plazos individuales no encontrada.');
  }
  match=/^\/api\/academics\/activities\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
  if(match&&['GET','HEAD'].includes(method)){const a=checkActivity(match[1],auth);if(!admin(auth)&&a.opensAt&&a.opensAt>now())fail(403,'El enunciado estará disponible en la fecha de apertura.');const file=files.instructionFiles(a.id).find(f=>f.id===match[2]);if(!file)fail(404,'Archivo no encontrado.');return serve(req,res,file);}
  match=/^\/api\/academics\/activities\/([^/]+)\/publication$/.exec(path);
  if(match&&method==='PATCH'){requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);const a=checkActivity(match[1],auth);if(b.version!==a.version)fail(409,'La actividad cambió. Recarga antes de publicarla.');if(!['published','draft'].includes(b.status))fail(400,'Selecciona publicar o volver a borrador.');if(b.status===a.status)return send(view(a,auth));checkWeights(a.courseId,{...a,status:b.status},a.id);const config={...parse(one('SELECT config FROM activities WHERE id=?',a.id)),status:b.status};run('UPDATE activities SET config=?,version=version+1 WHERE id=?',JSON.stringify(config),a.id);invalidate(a.courseId);audit(auth.user,'activity.publication',a.id,{status:b.status});return send(view(getActivity(a.id),auth));}
  match=/^\/api\/academics\/activities\/([^/]+)(?:\/(submissions|submit|release))?$/.exec(path);
  if(match){const [,id,section]=match;let a=checkActivity(id,auth);
   if(!section&&method==='GET'){
    if(accessModel&&!admin(auth)&&!auth.preview&&released(a)&&(!a.opensAt||a.opensAt<=now()))run("INSERT INTO learning_events(user_id,course_id,object_id,action,created_at,context) VALUES(?,?,?,'activity.start',?,?)",auth.user.id,a.courseId,a.id,now(),JSON.stringify(audit.capture(auth.user,'activity.start',a.id)));
    let deadline=null;
    if(accessModel&&!admin(auth)&&!auth.preview&&a.timeLimitMinutes>0&&(!a.opensAt||a.opensAt<=now())&&!studentDeadline(a,auth.user.id).closed){run('INSERT OR IGNORE INTO attempt_starts VALUES(?,?,?,?)',id,auth.user.id,a.revision,now());const start=one('SELECT started_at FROM attempt_starts WHERE activity_id=? AND student_id=? AND revision=?',id,auth.user.id,a.revision);deadline=new Date(Date.parse(start.started_at)+a.timeLimitMinutes*60000).toISOString();}
    const data={deadline,activity:view(a,auth),course:one('SELECT id,title FROM courses WHERE id=?',a.courseId)};
    if(!admin(auth)){data.mine=auth.preview?[]:rows(id,auth.user.id).map(s=>subView(s,auth));data.previous=auth.preview?[]:all('SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND superseded=1 ORDER BY revision DESC,attempt DESC',id,auth.user.id).map(s=>subView(s,auth));}
    return send(data);
   }
   if(!section&&method==='DELETE'){
    requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);a=checkActivity(id,auth);
    if(b.version!==a.version)fail(409,'La actividad cambió. Recarga antes de eliminarla.');
    const attached=[...(accessModel?all('SELECT files FROM activity_versions WHERE activity_id=?',id).flatMap(r=>JSON.parse(r.files)):[]),...files.instructionFiles(id),...all('SELECT payload FROM submissions WHERE activity_id=?',id).flatMap(s=>submissionFiles(JSON.parse(s.payload)))];
    db.exec('BEGIN IMMEDIATE');try{if(accessModel){run('DELETE FROM grade_audit WHERE submission_id IN (SELECT id FROM submissions WHERE activity_id=?)',id);run('DELETE FROM learning_events WHERE object_id=?',id);}audit(auth.user,'activity.delete',id);run('DELETE FROM activities WHERE id=?',id);invalidate(a.courseId);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    attached.forEach(files.remove);return send({success:true,courseId:a.courseId});
   }
   if(!section&&method==='PATCH'){
    requireAdmin(auth);const b=await readJson(req,29*1024*1024);auth=readSession(req);requireAdmin(auth);a=checkActivity(id,auth);
    if(b.version!==a.version)fail(409,'La actividad cambió. Recarga antes de guardar.');
    const c=config(b,a);checkWeights(a.courseId,c,id);const moduleId=b.moduleId===undefined?a.moduleId:b.moduleId||null;
    if(moduleId&&!one('SELECT id FROM modules WHERE id=? AND course_id=?',moduleId,a.courseId))fail(400,'Capítulo no válido.');
    const plan=files.prepare(files.instructionFiles(id),b.attachments,b.retainAttachmentIds,{teacher:true}),attachmentsChanged=plan.added.length>0||plan.removed.length>0;
    const changed=['title','description','kind','maxPoints','questions','instructionUrl','procedureSupport',...(c.kind==='task'?['responseSettings']:[])].some(k=>JSON.stringify(c[k])!==JSON.stringify(a[k]??(k==='instructionUrl'?'':undefined)))||attachmentsChanged;
    const records=all('SELECT * FROM submissions WHERE activity_id=? AND superseded=0',id),count=records.length,hasScaleMismatch=records.some(s=>submissionMaxPoints(JSON.parse(s.payload),a)!==c.maxPoints);
    const scaleOnly=scaleOnlyChange(a,c,attachmentsChanged,{hasScaleMismatch});
    if(b.requestResubmission!==undefined)bool(b.requestResubmission,'Solicitar nueva entrega');
    const decision=accessModel?revisionDecision(a,c,b,count,attachmentsChanged,fail):null,reset=decision?decision.reset:Boolean(count&&(!scaleOnly&&changed||b.requestResubmission));if(decision)c.repeatPolicy=decision.policy;let reopened=false;
    if(reset){if(c.dueAt&&c.dueAt<=now()){c.dueAt=null;c.allowLate=false;reopened=true;}if(c.closesAt&&c.closesAt<=now()){c.closesAt=null;reopened=true;}}
    const at=now(),archiveDrafts=Boolean(accessModel&&changed&&b.changeKind==='evaluated'&&!scaleOnly),conversions=reset?[]:prepareScaleConversions(records,a,c.maxPoints,fail,{at,skipDrafts:archiveDrafts}),conversionMap=new Map(conversions.map(row=>[row.id,row]));
    const snapshot={title:a.title,kind:a.kind,maxPoints:a.maxPoints,procedureSupport:a.procedureSupport,responseSettings:a.responseSettings,questions:a.questions.map(({correct,...q})=>q)};
    if(accessModel&&b.preview){
     const canGrade=activityEvaluation.canRead(auth,a.courseId),oldActivities=list(a.courseId).filter(x=>x.status==='published'),nextActivities=list(a.courseId).map(x=>x.id===id?{...x,...c}:x).filter(x=>x.status==='published');
     const impact=canGrade?all('SELECT u.id,u.name FROM users u JOIN enrollments e ON e.student_id=u.id WHERE e.course_id=?',a.courseId).map(u=>({name:u.name,before:gradeRow(oldActivities,u.id,settings(a.courseId),true).accumulated,after:gradeCalculation(nextActivities,u.id,settings(a.courseId),true,{closed:activity=>studentDeadline(activity,u.id).closed,override:(aid,uid)=>Boolean(one('SELECT exempt FROM grade_overrides WHERE activity_id=? AND student_id=?',aid,uid)?.exempt),rows:(aid,uid)=>aid!==id?rows(aid,uid).map(effectiveGrade):reset?[]:rows(aid,uid).filter(s=>!archiveDrafts||s.state!=='draft').map(s=>{const converted=conversionMap.get(s.id),p=converted?converted.payload:JSON.parse(s.payload);return effectiveGrade({...s,points:converted?converted.points:s.points,payload:JSON.stringify({...p,previousActivity:p.previousActivity||snapshot})});})}).accumulated})):[];
     const scaleConversions=conversions.length;
     return send({impact,affectedResponses:count,policy:decision.policy,changed:decision.changed,scaleOnly,oldMaxPoints:a.maxPoints,newMaxPoints:c.maxPoints,scaleConversionCount:conversions.length,scaleConversions,oldWeight:a.weight,newWeight:c.weight,oldPeriod:a.periodId||'',newPeriod:c.periodId||''});
    }
    storage?.assertUpload({userId:auth.user.id,courseId:a.courseId,added:plan.added,removed:accessModel?[]:plan.removed.map(f=>f.key)});
    saveActivityFiles(plan,id,()=>{
     if(accessModel){
      if(archiveDrafts)run("UPDATE submissions SET superseded=1,version=version+1 WHERE activity_id=? AND state='draft' AND superseded=0",id);
      run('INSERT OR IGNORE INTO activity_versions VALUES(?,?,?,?,?)',id,a.revision,JSON.stringify(a),JSON.stringify(files.instructionFiles(id)),at);
      run("UPDATE submissions SET payload=json_set(payload,'$.previousActivity',json(?)) WHERE activity_id=? AND superseded=0 AND json_extract(payload,'$.previousActivity') IS NULL",JSON.stringify(snapshot),id);
     }
     if(reset){if(accessModel)run('UPDATE submissions SET superseded=1,version=version+1 WHERE activity_id=? AND superseded=0',id);else run("UPDATE submissions SET superseded=1,payload=json_set(payload,'$.previousActivity',json(?)),version=version+1 WHERE activity_id=? AND superseded=0",JSON.stringify(snapshot),id);}
     for(const converted of conversions){
      const payload={...converted.payload,previousActivity:converted.payload.previousActivity||snapshot};
      if(!run('UPDATE submissions SET points=?,payload=?,version=version+1,updated_at=? WHERE id=? AND version=? AND superseded=0',converted.points,JSON.stringify(payload),at,converted.id,converted.version).changes)fail(409,'Una entrega cambió mientras guardabas. Recarga para revisar la escala.');
      const reason='Conversión proporcional de escala de '+converted.from+' a '+converted.to;
      run('INSERT INTO grade_audit(submission_id,actor_id,before_value,after_value,reason,created_at) VALUES(?,?,?,?,?,?)',converted.id,auth.user.id,JSON.stringify(converted.before),JSON.stringify(converted.after),reason,at);
      audit(auth.user,'submission.scale',converted.id,{studentId:converted.studentId,gradingMaxPoints:converted.to,scaleAdjustment:{from:converted.from,to:converted.to},change:{before:converted.before,after:converted.after,reason}});
     }
     run('UPDATE activities SET config=?,module_id=?,version=version+1,revision=revision+? WHERE id=?',JSON.stringify(c),moduleId,Number(changed||reset),id);
     invalidate(a.courseId);audit(auth.user,reset?'activity.reassign':'activity.edit',id);
    });return send({...view(getActivity(id),auth),resubmissionRequired:reset,reopened,scaleOnly,scaleConversionCount:conversions.length});
   }
   if(section==='release'&&method==='POST'){requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);a=checkActivity(id,auth);if(a.status!=='published')fail(409,'Publica la actividad antes de devolver las notas.');return send(releaseMany([a],auth,b.submissions));}
   if(section==='submissions'&&method==='GET'){requireAdmin(auth);return send({activity:view(a,auth),submissions:all("SELECT s.*,u.name,u.document FROM submissions s JOIN users u ON u.id=s.student_id WHERE activity_id=? ORDER BY s.superseded,s.revision DESC,s.attempt DESC,s.updated_at DESC",id).map(s=>({...subView(s,auth),name:s.name,document:s.document})),closures:activityClosures(a)});}
   if(section==='submit'&&method==='POST'){
    requireStudent(auth);const b=await readJson(req,29*1024*1024);auth=readSession(req);requireStudent(auth);a=checkActivity(id,auth);const key=text(b.requestId,'Identificador de entrega',80,true);if(!/^[\w-]{8,80}$/.test(key))fail(400,'Identificador de entrega no válido.');if(!['draft','submit'].includes(b.action))fail(400,'Acción no válida.');
    if((b.activityRevision??1)!==a.revision)fail(409,'La actividad fue actualizada. Recarga para responder la nueva versión.');
    reconcileClosures({activityId:id,studentId:auth.user.id});
    const previous=one('SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND request_key=?',id,auth.user.id,key);if(previous?.superseded)fail(409,'Esta entrega pertenece a una versión anterior. Recarga la actividad.');if(previous&&!['draft','returned'].includes(previous.state))return send(subView(previous,auth));const pendingReturn=one("SELECT request_key FROM submissions WHERE activity_id=? AND student_id=? AND superseded=0 AND returned_at IS NOT NULL AND state IN ('returned','draft')",id,auth.user.id);if(pendingReturn&&pendingReturn.request_key!==key)fail(409,'Continúa la entrega devuelta; no crees otro intento.');const initialWindow=checkWindow(a,auth.user.id,previous,now(),{draftBackup:b.action==='draft'});
    if(!initialWindow.backupOnly)checkAttemptTime(a,auth.user.id);
    if(previous&&b.version!==previous.version)fail(409,'Tu borrador cambió en otra pestaña. Recarga antes de guardar.');
    const history=rows(id,auth.user.id);if(!previous?.returned_at&&history.filter(s=>!['draft','returned'].includes(s.state)&&(!accessModel||a.repeatPolicy!=='optional'||s.revision===a.revision)).length>=a.maxAttempts)fail(403,'Alcanzaste el máximo de entregas o intentos.');if(!previous&&history.some(s=>s.state==='draft'))fail(409,'Ya tienes un borrador. Recarga y continúa ese borrador.');
    const payload={gradingMaxPoints:a.maxPoints,text:text(b.text??'','Respuesta',20000),url:text(b.url??'','Enlace',2048),answers:a.kind==='quiz'?validateAnswers(a,b.answers===undefined?{}:b.answers,b.action==='submit'):{}};
    if(payload.url){let u;try{u=new URL(payload.url);}catch{fail(400,'Escribe un enlace completo HTTPS o HTTP.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail(400,'Enlace no permitido.');payload.url=u.href;}
    const oldFiles=previous?submissionFiles(JSON.parse(previous.payload)):[];
    if(b.file&&b.files!==undefined)fail(400,'Usa una sola lista de archivos.');
    const uploaded=b.files??(b.file?[b.file]:undefined);
    const retain=b.retainFileIds??(b.removeFile||b.file?[]:undefined);
    if(a.kind==='quiz'&&((!a.procedureSupport.enabled&&Array.isArray(uploaded)&&uploaded.length)||payload.url||payload.text))fail(400,'Responde el cuestionario en sus preguntas.');
    const plan=files.prepare(oldFiles,uploaded,retain);payload.files=plan.files;
    if(a.kind==='task')validateTaskResponse(a.responseSettings,payload,plan.files,b.action==='submit',fail);
    validateProcedureFiles(a.procedureSupport,plan.files,b.action==='submit',fail);
    payload.procedureNote=text(b.procedureNote??'','Nota sobre procedimientos',3000);
    if(!a.procedureSupport.enabled&&payload.procedureNote)fail(400,'Esta actividad no solicita una nota de procedimientos.');
    payload.procedureSupport=a.procedureSupport.enabled?{...a.procedureSupport}:null;
    payload.procedureReviewPending=b.action==='submit'&&a.procedureSupport.enabled&&a.procedureSupport.reviewRequired;
    if(!storage&&files.usedBytes()+plan.files.reduce((n,f)=>n+f.size,0)-oldFiles.reduce((n,f)=>n+f.size,0)>maxStorage)fail(413,'El espacio para entregas está lleno. Comunícate con tu docente o entrega un enlace.');
    if(a.kind==='task'&&b.action==='submit'&&!payload.text&&!payload.url&&!payload.files.length)fail(400,'Añade texto, un enlace o un archivo antes de entregar.');
    const final=b.action==='submit',points=final&&a.kind==='quiz'?autoScore(a,payload.answers):null;const sid=previous?.id||randomUUID(),attempt=previous?.attempt||Math.max(0,...history.map(s=>s.attempt))+1;
    payload.automaticPoints=points;
    storage?.assertUpload({userId:auth.user.id,courseId:a.courseId,kind:'submission',added:plan.added,removed:plan.removed.map(f=>f.key)});
    files.write(plan);try{db.exec('BEGIN IMMEDIATE');
     // Upload validation and disk writes can cross a deadline. Authorization,
     // enrollment and individual windows must still hold at the actual write.
     auth=readSession(req);requireStudent(auth);a=checkActivity(id,auth);const at=now(),currentPrevious=previous?one('SELECT * FROM submissions WHERE id=?',previous.id):null;
     if((b.activityRevision??1)!==a.revision||currentPrevious?.superseded)fail(409,'La actividad fue actualizada. Recarga para responder la nueva versión.');
     if(previous&&(!currentPrevious||currentPrevious.version!==b.version))fail(409,'Tu borrador cambió en otra pestaña. Recarga antes de guardar.');
     reconcileClosures({activityId:id,studentId:auth.user.id,at});const deadline=checkWindow(a,auth.user.id,currentPrevious,at,{draftBackup:b.action==='draft'});if(!deadline.backupOnly)checkAttemptTime(a,auth.user.id,at);
     const late=Number(final&&deadline.source!=='correction'&&deadline.dueAt&&at>deadline.dueAt)||0;
     if(previous)run('UPDATE submissions SET payload=?,state=?,submitted_at=?,late=?,points=?,published=0,feedback=CASE WHEN ? THEN \'\' ELSE feedback END,returned_at=CASE WHEN ? THEN NULL ELSE returned_at END,return_due_at=CASE WHEN ? THEN NULL ELSE return_due_at END,revision=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(payload),final?(points===null||payload.procedureReviewPending?'submitted':'graded'):'draft',final?at:previous.submitted_at,late,points,Number(final),Number(final),Number(final),a.revision,now(),sid);
     else run('INSERT INTO submissions(id,activity_id,student_id,request_key,attempt,state,payload,submitted_at,late,points,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',sid,id,auth.user.id,key,attempt,final?(points===null||payload.procedureReviewPending?'submitted':'graded'):'draft',JSON.stringify(payload),final?at:null,late,points,at,a.revision);
     if(final){if(accessModel)run('DELETE FROM attempt_starts WHERE activity_id=? AND student_id=? AND revision=?',id,auth.user.id,a.revision);reconcileClosures({activityId:id,studentId:auth.user.id,at});invalidate(a.courseId);audit(auth.user,'submission.submit',sid);}else if(accessModel&&!previous)audit(auth.user,'submission.start',sid);db.exec('COMMIT');
    }catch(e){if(db.isTransaction)db.exec('ROLLBACK');plan.added.forEach(files.remove);throw e;}
    plan.removed.forEach(files.remove);return send({...subView(one('SELECT * FROM submissions WHERE id=?',sid),auth),closure:studentClosure(a,auth.user.id,{reconcile:false})},201);
   }
  }
  match=/^\/api\/academics\/submissions\/([^/]+)\/(grade|release|return|file|files|instructions)(?:\/([^/]+))?$/.exec(path);
  if(match){const [,id,section]=match;let s=one('SELECT * FROM submissions WHERE id=?',id);if(!s)fail(404,'Entrega no encontrada.');const a=checkActivity(s.activity_id,auth);if(!admin(auth)&&s.student_id!==auth.user.id)fail(403,'Esta entrega pertenece a otro estudiante.');
   if(section==='instructions'&&accessModel&&['GET','HEAD'].includes(method)){const v=one('SELECT files FROM activity_versions WHERE activity_id=? AND revision=?',s.activity_id,s.revision),file=v&&JSON.parse(v.files).find(f=>f.id===match[3]);if(!file)fail(404,'Enunciado histórico no encontrado.');return serve(req,res,file);}
   if(['file','files'].includes(section)&&['GET','HEAD'].includes(method)){const items=submissionFiles(JSON.parse(s.payload));const file=section==='file'?items[0]:items.find(f=>f.id===match[3]);if(!file)fail(404,'Archivo no encontrado.');return serve(req,res,file,section==='file');}
   if(section==='return'&&method==='PATCH'){requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);checkActivity(s.activity_id,auth);s=one('SELECT * FROM submissions WHERE id=?',id);if(!s||s.superseded||!(['submitted','graded','returned'].includes(s.state)||s.state==='draft'&&s.returned_at))fail(409,'Solo puedes devolver una entrega enviada o actualizar una corrección vigente.');if(a.status!=='published')fail(409,'Publica la actividad antes de devolver una entrega para corrección.');if(b.version!==s.version)fail(409,'La entrega cambió. Recarga antes de devolverla.');const latest=one("SELECT id FROM submissions WHERE activity_id=? AND student_id=? AND superseded=0 AND (state!='draft' OR returned_at IS NOT NULL) ORDER BY attempt DESC,updated_at DESC LIMIT 1",s.activity_id,s.student_id);if(latest?.id!==id)fail(409,'Devuelve la última entrega vigente de este estudiante.');if(one("SELECT id FROM submissions WHERE activity_id=? AND student_id=? AND superseded=0 AND state='draft' AND id!=?",s.activity_id,s.student_id,id))fail(409,'El estudiante ya tiene otro intento en borrador. Revísalo antes de devolver esta entrega.');const reason=text(b.reason,'Indicaciones de corrección',10000,true),returnDueAt=date(b.returnDueAt??null);if(returnDueAt&&returnDueAt<=now())fail(400,'El nuevo plazo debe estar en el futuro.');db.exec('BEGIN IMMEDIATE');try{run("UPDATE submissions SET state='returned',points=NULL,published=0,payload=json_remove(payload,'$.teacherGradeDraft'),feedback=?,returned_at=?,return_due_at=?,version=version+1,updated_at=? WHERE id=?",reason,now(),returnDueAt,now(),id);if(accessModel){run('DELETE FROM attempt_starts WHERE activity_id=? AND student_id=? AND revision=?',s.activity_id,s.student_id,s.revision);run('INSERT INTO grade_audit(submission_id,actor_id,before_value,after_value,reason,created_at) VALUES(?,?,?,?,?,?)',id,auth.user.id,JSON.stringify({points:s.points,published:s.published,state:s.state}),JSON.stringify({points:null,published:false,state:'returned'}),reason,now());}invalidate(a.courseId);audit(auth.user,'submission.return',id,{studentId:s.student_id,returnDueAt});db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}return send(subView(one('SELECT * FROM submissions WHERE id=?',id),auth));}
   if(section==='release'&&method==='POST'){requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);checkActivity(s.activity_id,auth);s=one('SELECT * FROM submissions WHERE id=?',id);if(b.version!==s.version)fail(409,'Esta calificación cambió. Actualiza antes de devolver.');const block=releaseBlock(s,a);if(block)fail(400,block);db.exec('BEGIN IMMEDIATE');try{publishSubmission(s,auth);invalidate(a.courseId);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}return send(subView(one('SELECT * FROM submissions WHERE id=?',id),auth));}
   if(section==='grade'&&method==='PATCH'){
    requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);checkActivity(s.activity_id,auth);s=one('SELECT * FROM submissions WHERE id=?',id);
    if(s?.superseded)fail(409,'La actividad cambió. Esta entrega es histórica y ya no se puede calificar.');
    if(!s||['draft','returned'].includes(s.state))fail(400,'Solo puedes calificar entregas enviadas que no estén devueltas.');
    if(b.version!==s.version)fail(409,'Esta calificación cambió. Recarga antes de guardar.');
    const payload=JSON.parse(s.payload),maximum=submissionMaxPoints(payload,a),published=bool(b.published,'Publicar nota');if(!maximum)fail(409,'Esta entrega no tiene una escala válida para calificar.');
    const points=b.points===null&&!published?null:num(b.points,'Nota en puntos',0,maximum),feedback=text(b.feedback??'','Comentarios',10000),reason=text(b.reason||'Calificación docente','Motivo de la calificación',1000,true);
    if(b.procedureReviewed!==undefined&&typeof b.procedureReviewed!=='boolean')fail(400,'La revisión de soportes debe ser verdadera o falsa.');
    if(payload.procedureReviewPending&&b.procedureReviewed===true){payload.procedureReviewPending=false;payload.procedureReviewedAt=now();payload.procedureReviewedBy=auth.user.id;}
    if(published&&payload.procedureReviewPending)fail(400,'Revisa los soportes antes de devolver esta nota.');
    if(published&&a.status!=='published')fail(409,'Publica la actividad antes de devolver la nota.');
    db.exec('BEGIN IMMEDIATE');try{
     if(published){delete payload.teacherGradeDraft;run("UPDATE submissions SET points=?,feedback=?,published=1,payload=?,state='graded',version=version+1,updated_at=? WHERE id=?",points,feedback,JSON.stringify(payload),now(),id);invalidate(a.courseId);}
     else {payload.teacherGradeDraft={points,feedback,reason,savedAt:now()};run('UPDATE submissions SET payload=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(payload),now(),id);}
     if(accessModel)run('INSERT INTO grade_audit(submission_id,actor_id,before_value,after_value,reason,created_at) VALUES(?,?,?,?,?,?)',id,auth.user.id,JSON.stringify({points:effectiveGrade(s).points,published:s.published}),JSON.stringify({points,published,draft:!published}),reason,now());
     audit(auth.user,published?'submission.grade':'submission.grade-draft',id,{change:{before:effectiveGrade(s).points,after:points,published,reason}});db.exec('COMMIT');
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    return send(subView(one('SELECT * FROM submissions WHERE id=?',id),auth));
   }
  }
  fail(404,'Función académica no encontrada.');
 }
 return {handler,settings,list,gradeRow,invalidate,studentDeadline,studentClosure,reconcileClosures,evaluationSummary,evaluationSummaries,courseFiles:files.courseFiles};
}
