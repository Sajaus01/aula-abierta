import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createAcademicFiles,submissionFiles} from './academic-files.mjs';

export function setupAcademics(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS grading_settings(course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE, config TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,module_id TEXT REFERENCES modules(id) ON DELETE SET NULL,config TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS activity_files(id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,file_key TEXT NOT NULL UNIQUE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,position INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS activities_course ON activities(course_id);
 CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_key TEXT NOT NULL,attempt INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,submitted_at TEXT,late INTEGER NOT NULL DEFAULT 0,points REAL,feedback TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,UNIQUE(activity_id,student_id,request_key));
 CREATE INDEX IF NOT EXISTS submissions_activity_student ON submissions(activity_id,student_id);`);
 for(const [table,column] of [['activities','revision'],['submissions','revision'],['submissions','superseded']])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT ${column==='superseded'?0:1}`);
}
const defaults={scaleMax:5,passMark:3,missingAsZero:false,finalPublished:false};
const parse=row=>row?JSON.parse(row.config):null;
const rounded=n=>Math.round((n+Number.EPSILON)*100)/100;

export function createAcademics(ctx) {
 const {db,fail,json,readJson,readSession,requireAdmin,requireStudent,requireCourse,isEnrolled,validateFile,fileResponse,uploadsDir,audit,env}=ctx;
 const all=(sql,...p)=>db.prepare(sql).all(...p),one=(sql,...p)=>db.prepare(sql).get(...p),run=(sql,...p)=>db.prepare(sql).run(...p);
 const files=createAcademicFiles(ctx);
 const now=()=>new Date().toISOString(),admin=a=>a?.user.role==='admin'&&a.assurance==='password';
 const settings=id=>({...defaults,...parse(one('SELECT config FROM grading_settings WHERE course_id=?',id))});
 const saveSettings=(id,c)=>run('INSERT INTO grading_settings VALUES (?,?) ON CONFLICT(course_id) DO UPDATE SET config=excluded.config',id,JSON.stringify(c));
 const invalidate=id=>saveSettings(id,{...settings(id),finalPublished:false});
 const text=(v,label,max=10000,required=false)=>{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail(400,`${label}: texto ${required?'obligatorio, ':''}máximo ${max} caracteres.`);return v.trim();};
 const num=(v,label,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(400,`${label}: usa un número entre ${min} y ${max}.`);return v;};
 const bool=(v,label)=>{if(typeof v!=='boolean')fail(400,`${label} no válido.`);return v;};
 const date=(v)=>{if(v===null||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))fail(400,'Fecha no válida; incluye zona horaria.');return new Date(v).toISOString();};
 const access=(id,auth)=>{const c=requireCourse(id,auth);if(!admin(auth)){requireStudent(auth);if(auth.assurance!=='password')fail(403,'Ingresa con contraseña para entregar actividades y consultar notas.','PASSWORD_REQUIRED');if(!isEnrolled(auth.user.id,id))fail(403,'Necesitas matrícula vigente para participar en las actividades.');}return c;};
 const getActivity=id=>{const r=one('SELECT * FROM activities WHERE id=?',id);if(!r)fail(404,'Actividad no encontrada.');return {...parse(r),id:r.id,courseId:r.course_id,moduleId:r.module_id,version:r.version,revision:r.revision,createdAt:r.created_at};};
 const list=id=>all('SELECT * FROM activities WHERE course_id=? ORDER BY created_at,id',id).map(r=>getActivity(r.id));
 const released=a=>a.status==='published'&&(!a.moduleId||Boolean(one('SELECT id FROM modules WHERE id=? AND published=1',a.moduleId)));
 const checkActivity=(id,auth)=>{const a=getActivity(id);access(a.courseId,auth);if(!admin(auth)&&!released(a))fail(404,'Actividad no disponible.');return a;};
 function view(a,auth) {const available=admin(auth)||!a.opensAt||a.opensAt<=now();return {...a,instructionUrl:available?a.instructionUrl||'':'',attachments:available?files.publicFiles(files.instructionFiles(a.id),`/api/academics/activities/${a.id}/attachments`):[],materialsAvailable:available,questions:!admin(auth)&&a.opensAt&&a.opensAt>now()?[]:a.questions.map(q=>admin(auth)?q:{id:q.id,type:q.type,prompt:q.prompt,options:q.options,points:q.points}),submissionCount:admin(auth)?one("SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND state!='draft' AND superseded=0",a.id).n:undefined,activeResponseCount:admin(auth)?one('SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND superseded=0',a.id).n:undefined};}
 function subView(s,auth) {const p=JSON.parse(s.payload),attachments=submissionFiles(p),first=attachments[0];const visible=admin(auth)||Boolean(s.published);return {id:s.id,activityId:s.activity_id,revision:s.revision,superseded:Boolean(s.superseded),previousActivity:p.previousActivity||null,studentId:s.student_id,requestId:s.request_key,attempt:s.attempt,state:s.state==='graded'&&!visible?'submitted':s.state,text:p.text||'',url:p.url||'',answers:p.answers||{},files:files.publicFiles(attachments,`/api/academics/submissions/${s.id}/files`),fileName:first?.name||null,fileSize:first?.size||0,fileUrl:first?`/api/academics/submissions/${s.id}/file`:null,submittedAt:s.submitted_at,late:Boolean(s.late),points:visible?s.points:null,feedback:visible?s.feedback:'',published:Boolean(s.published),version:s.version,updatedAt:s.updated_at};}
 function rows(id,userId) {return all('SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND superseded=0 ORDER BY attempt DESC,updated_at DESC',id,userId);}
 const closed=a=>Boolean((a.closesAt&&a.closesAt<=now())||(!a.allowLate&&a.dueAt&&a.dueAt<=now()));
 function gradeRow(activities,userId,cfg,forAdmin) {
  let earned=0,gradedWeight=0,ready=true;
  const cells=activities.map(a=>{const s=rows(a.id,userId).find(r=>r.state!=='draft');const visible=s&&s.points!==null&&(forAdmin||s.published);const zero=!s&&cfg.missingAsZero&&closed(a);const released=s&&s.points!==null&&s.published;
   if(a.weight>0){if(visible||zero){earned+=(zero?0:s.points/a.maxPoints)*a.weight;gradedWeight+=a.weight;}if(!released&&!zero)ready=false;}
   return {activityId:a.id,title:a.title,weight:a.weight,maxPoints:a.maxPoints,submissionId:s?.id||null,points:visible?s.points:null,published:Boolean(s?.published),state:zero?'missing':!s?'pending':s.points!==null&&(forAdmin||s.published)?'graded':'submitted',late:Boolean(s?.late)};});
  const weightTotal=rounded(activities.reduce((n,a)=>n+a.weight,0));const complete=ready&&Math.abs(weightTotal-100)<0.001;
  return {cells,weightTotal,gradedWeight:rounded(gradedWeight),provisional:gradedWeight?rounded(earned/gradedWeight*cfg.scaleMax):null,accumulated:rounded(earned/100*cfg.scaleMax),ready:complete,final:cfg.finalPublished&&complete?rounded(earned/100*cfg.scaleMax):null};
 }
 function config(body,current=null) {
  const b={title:'',description:'',kind:'task',status:'draft',weight:0,maxPoints:100,opensAt:null,dueAt:null,closesAt:null,allowLate:false,maxAttempts:1,questions:[],...current,...body};
  const c={title:text(b.title,'Título',180,true),description:text(b.description,'Instrucciones',20000),kind:b.kind,status:b.status,weight:num(b.weight,'Porcentaje',0,100),maxPoints:num(b.maxPoints,'Puntos máximos',1,10000),opensAt:date(b.opensAt),dueAt:date(b.dueAt),closesAt:date(b.closesAt),allowLate:bool(b.allowLate,'Entregas tardías'),maxAttempts:num(b.maxAttempts,'Intentos',1,20),questions:[]};
  if(!Number.isInteger(c.maxAttempts)||!['task','quiz'].includes(c.kind)||!['draft','published','archived'].includes(c.status))fail(400,'Tipo, estado o intentos no válidos.');
  if((c.opensAt&&c.dueAt&&c.opensAt>=c.dueAt)||(c.opensAt&&c.closesAt&&c.opensAt>=c.closesAt)||(c.dueAt&&c.closesAt&&c.dueAt>c.closesAt))fail(400,'Ordena las fechas: apertura, entrega y cierre.');
  if(c.allowLate&&!c.dueAt)fail(400,'Define una fecha de entrega para admitir entregas tardías.');
  if(c.kind==='quiz'){
   if(!Array.isArray(b.questions)||!b.questions.length||b.questions.length>50)fail(400,'El cuestionario requiere de 1 a 50 preguntas.');const ids=new Set();
   c.questions=b.questions.map(q=>{const id=text(q.id,'Identificador',80,true);if(ids.has(id))fail(400,'Identificador de pregunta repetido.');ids.add(id);if(!['single','multiple','text'].includes(q.type))fail(400,'Tipo de pregunta no válido.');
    const r={id,type:q.type,prompt:text(q.prompt,'Pregunta',3000,true),points:num(q.points,'Puntos de pregunta',0.1,1000),options:[],correct:[]};
    if(q.type!=='text'){if(!Array.isArray(q.options)||q.options.length<2||q.options.length>10)fail(400,'Cada pregunta de selección requiere entre 2 y 10 opciones.');r.options=q.options.map(v=>text(v,'Opción',1000,true));if(!Array.isArray(q.correct)||!q.correct.length||q.correct.some(n=>!Number.isInteger(n)||n<0||n>=r.options.length)||new Set(q.correct).size!==q.correct.length||(q.type==='single'&&q.correct.length!==1))fail(400,'Selecciona las respuestas correctas.');r.correct=[...q.correct].sort((a,b)=>a-b);}return r;});
   c.maxPoints=rounded(c.questions.reduce((n,q)=>n+q.points,0));
  }
  c.instructionUrl=text(b.instructionUrl??'','Enlace del enunciado',2048);
  if(c.instructionUrl){let u;try{u=new URL(c.instructionUrl);}catch{fail(400,'Escribe un enlace completo para el enunciado.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail(400,'Enlace del enunciado no permitido.');c.instructionUrl=u.href;}
  return c;
 }
 function checkWeights(courseId,c,id=null) {const total=list(courseId).filter(a=>a.id!==id&&a.status==='published').reduce((n,a)=>n+a.weight,0)+(c.status==='published'?c.weight:0);if(total>100.00001)fail(400,'Los porcentajes de actividades publicadas no pueden superar el 100 %.');}
 function checkWindow(a){const at=now();if(a.opensAt&&at<a.opensAt)fail(403,'La actividad todavía no está abierta.');if(a.closesAt&&at>=a.closesAt)fail(403,'El plazo de la actividad terminó.');if(!a.allowLate&&a.dueAt&&at>=a.dueAt)fail(403,'La fecha límite de entrega terminó.');}
 function validateAnswers(a,input,final){if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Respuestas no válidas.');const out={};for(const q of a.questions){const v=input[q.id];if(q.type==='text'){out[q.id]=text(v??'','Respuesta',10000,final);}else{const values=v??[];if(!Array.isArray(values)||values.some(n=>!Number.isInteger(n)||n<0||n>=q.options.length)||new Set(values).size!==values.length||(q.type==='single'&&values.length>1)||(final&&!values.length))fail(400,'Revisa las respuestas de selección.');out[q.id]=[...values].sort((x,y)=>x-y);}}return out;}
 function autoScore(a,answers){if(a.questions.some(q=>q.type==='text'))return null;return rounded(a.questions.reduce((n,q)=>n+(JSON.stringify(q.correct)===JSON.stringify(answers[q.id])?q.points:0),0));}
 const configuredStorage=Number(env.SUBMISSIONS_MAX_BYTES);
 const maxStorage=Number.isFinite(configuredStorage)&&configuredStorage>0?configuredStorage:500*1024*1024;
 function saveActivityFiles(plan,id,mutate){files.write(plan);try{db.exec('BEGIN IMMEDIATE');mutate();files.storeInstructions(id,plan);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');plan.added.forEach(files.remove);throw error;}plan.removed.forEach(files.remove);}
 function serve(req,res,file,forceDownload=false){const inline=file.mime==='application/pdf'||file.mime.startsWith('image/');fileResponse(req,res,join(uploadsDir,file.key),file.mime,file.name,forceDownload||!inline||new URL(req.url,'http://localhost').searchParams.get('download')==='1',true);return true;}
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/academics/'))return false;
  const send=(data,status)=>{json(res,data,status);return true;};let match;
  if(path==='/api/academics/storage'&&method==='GET'){requireAdmin(auth);return send({usedBytes:files.usedBytes(),maxBytes:maxStorage,fileMaxBytes:10*1024*1024});}
  if(path==='/api/academics/courses'&&method==='GET'){
   if(admin(auth))return send(all('SELECT id,title FROM courses ORDER BY title').map(c=>({...c,pending:one("SELECT COUNT(*) n FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id=? AND s.superseded=0 AND (s.state='submitted' OR (s.state='graded' AND s.published=0))",c.id).n})));
   requireStudent(auth);if(auth.assurance!=='password')fail(403,'Ingresa con contraseña para ver tus actividades y notas.','PASSWORD_REQUIRED');
   const courses=all('SELECT id,title,published FROM courses WHERE published=1').filter(c=>isEnrolled(auth.user.id,c.id));
   return send(courses.map(c=>({id:c.id,title:c.title,activities:list(c.id).filter(released).map(a=>({id:a.id,title:a.title,dueAt:a.dueAt,opensAt:a.opensAt,closesAt:a.closesAt,kind:a.kind,state:rows(a.id,auth.user.id).find(s=>s.state!=='draft')?'Entregada':'Pendiente'}))})));
  }
  match=/^\/api\/academics\/courses\/([^/]+)(?:\/(activities|settings|gradebook|release))?$/.exec(path);
  if(match){const [,id,section]=match;const c=access(id,auth);
   if(!section&&method==='GET'){const acts=list(id).filter(a=>admin(auth)||released(a));const cfg=settings(id);const grade=!admin(auth)?gradeRow(list(id).filter(a=>a.status==='published'),auth.user.id,cfg,false):null;if(grade)grade.cells=grade.cells.filter(cell=>acts.some(a=>a.id===cell.activityId));return send({course:{id:c.id,title:c.title},settings:cfg,activities:acts.map(a=>({...view(a,auth),mine:!admin(auth)?rows(a.id,auth.user.id).map(s=>subView(s,auth)):undefined})),grade});}
   requireAdmin(auth);
   if(section==='release'&&method==='POST'){await readJson(req);auth=readSession(req);requireAdmin(auth);access(id,auth);db.exec('BEGIN IMMEDIATE');try{run("UPDATE submissions SET published=1,version=version+1 WHERE points IS NOT NULL AND superseded=0 AND activity_id IN (SELECT id FROM activities WHERE course_id=? AND json_extract(config,'$.status')='published')",id);invalidate(id);audit(auth.user,'grades.release',id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send({success:true});}
   if(section==='activities'&&method==='POST'){const b=await readJson(req,29*1024*1024);auth=readSession(req);requireAdmin(auth);access(id,auth);const a=config(b);checkWeights(id,a);let moduleId=b.moduleId||null;if(moduleId&&!one('SELECT id FROM modules WHERE id=? AND course_id=?',moduleId,id))fail(400,'Capítulo no válido.');const aid=randomUUID(),plan=files.prepare([],b.attachments,b.retainAttachmentIds,{teacher:true});saveActivityFiles(plan,aid,()=>{run('INSERT INTO activities(id,course_id,module_id,config,created_at) VALUES (?,?,?,?,?)',aid,id,moduleId,JSON.stringify(a),now());invalidate(id);audit(auth.user,'activity.create',aid);});return send(view(getActivity(aid),auth),201);}
   if(section==='gradebook'&&method==='GET'){const activities=list(id).filter(a=>a.status==='published');const cfg=settings(id);const students=all("SELECT u.id,u.name,u.document,u.active,e.status FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=? ORDER BY u.name",id);return send({course:{id,title:c.title},settings:cfg,activities:activities.map(a=>view(a,auth)),students:students.map(s=>({...s,...gradeRow(activities,s.id,cfg,true)}))});}
   if(section==='settings'&&method==='PUT'){const b=await readJson(req);auth=readSession(req);requireAdmin(auth);access(id,auth);const cfg={...settings(id),...b};const out={scaleMax:num(cfg.scaleMax,'Escala',1,100),passMark:num(cfg.passMark,'Nota aprobatoria',0,cfg.scaleMax),missingAsZero:bool(cfg.missingAsZero,'Pendientes como cero'),finalPublished:bool(cfg.finalPublished,'Publicar notas finales')};
    if(out.finalPublished){const activities=list(id).filter(a=>a.status==='published');const students=all("SELECT student_id FROM enrollments WHERE course_id=? AND status='active'",id);if(Math.abs(activities.reduce((n,a)=>n+a.weight,0)-100)>0.00001||students.some(s=>!gradeRow(activities,s.student_id,out,true).ready))fail(400,'Para publicar la nota final, los porcentajes deben sumar 100 % y cada actividad debe estar calificada y publicada. Las entregas faltantes solo cuentan como cero si activas esa opción y el plazo terminó.');}saveSettings(id,out);audit(auth.user,'grades.settings',id);return send(out);}
  }
  match=/^\/api\/academics\/activities\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
  if(match&&['GET','HEAD'].includes(method)){const a=checkActivity(match[1],auth);if(!admin(auth)&&a.opensAt&&a.opensAt>now())fail(403,'El enunciado estará disponible en la fecha de apertura.');const file=files.instructionFiles(a.id).find(f=>f.id===match[2]);if(!file)fail(404,'Archivo no encontrado.');return serve(req,res,file);}
  match=/^\/api\/academics\/activities\/([^/]+)(?:\/(submissions|submit))?$/.exec(path);
  if(match){const [,id,section]=match;let a=checkActivity(id,auth);
   if(!section&&method==='GET'){const data={activity:view(a,auth),course:one('SELECT id,title FROM courses WHERE id=?',a.courseId)};if(!admin(auth)){data.mine=rows(id,auth.user.id).map(s=>subView(s,auth));data.previous=all('SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND superseded=1 ORDER BY revision DESC,attempt DESC',id,auth.user.id).map(s=>subView(s,auth));}return send(data);}
   if(!section&&method==='DELETE'){
    requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);a=checkActivity(id,auth);
    if(b.version!==a.version)fail(409,'La actividad cambió. Recarga antes de eliminarla.');
    const attached=[...files.instructionFiles(id),...all('SELECT payload FROM submissions WHERE activity_id=?',id).flatMap(s=>submissionFiles(JSON.parse(s.payload)))];
    db.exec('BEGIN IMMEDIATE');try{run('DELETE FROM activities WHERE id=?',id);invalidate(a.courseId);audit(auth.user,'activity.delete',id);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    attached.forEach(files.remove);return send({success:true,courseId:a.courseId});
   }
   if(!section&&method==='PATCH'){
    requireAdmin(auth);const b=await readJson(req,29*1024*1024);auth=readSession(req);requireAdmin(auth);a=checkActivity(id,auth);
    if(b.version!==a.version)fail(409,'La actividad cambió. Recarga antes de guardar.');
    const c=config(b,a);checkWeights(a.courseId,c,id);const moduleId=b.moduleId===undefined?a.moduleId:b.moduleId||null;
    if(moduleId&&!one('SELECT id FROM modules WHERE id=? AND course_id=?',moduleId,a.courseId))fail(400,'Capítulo no válido.');
    const plan=files.prepare(files.instructionFiles(id),b.attachments,b.retainAttachmentIds,{teacher:true});
    const changed=['title','description','kind','maxPoints','questions','instructionUrl'].some(k=>JSON.stringify(c[k])!==JSON.stringify(a[k]??(k==='instructionUrl'?'':undefined)))||plan.added.length>0||plan.removed.length>0;
    const count=one('SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND superseded=0',id).n;
    if(b.requestResubmission!==undefined)bool(b.requestResubmission,'Solicitar nueva entrega');
    const reset=Boolean(count&&(changed||b.requestResubmission));let reopened=false;
    if(reset){if(c.dueAt&&c.dueAt<=now()){c.dueAt=null;c.allowLate=false;reopened=true;}if(c.closesAt&&c.closesAt<=now()){c.closesAt=null;reopened=true;}}
    const snapshot={title:a.title,kind:a.kind,maxPoints:a.maxPoints,questions:a.questions.map(({correct,...q})=>q)};
    saveActivityFiles(plan,id,()=>{
     if(reset)run("UPDATE submissions SET superseded=1,payload=json_set(payload,'$.previousActivity',json(?)),version=version+1 WHERE activity_id=? AND superseded=0",JSON.stringify(snapshot),id);
     run('UPDATE activities SET config=?,module_id=?,version=version+1,revision=revision+? WHERE id=?',JSON.stringify(c),moduleId,Number(changed||reset),id);
     invalidate(a.courseId);audit(auth.user,reset?'activity.reassign':'activity.edit',id);
    });return send({...view(getActivity(id),auth),resubmissionRequired:reset,reopened});
   }
   if(section==='submissions'&&method==='GET'){requireAdmin(auth);return send({activity:view(a,auth),submissions:all("SELECT s.*,u.name,u.document FROM submissions s JOIN users u ON u.id=s.student_id WHERE activity_id=? AND s.state!='draft' ORDER BY s.superseded,s.revision DESC,s.submitted_at DESC,s.attempt DESC",id).map(s=>({...subView(s,auth),name:s.name,document:s.document}))});}
   if(section==='submit'&&method==='POST'){
    requireStudent(auth);const b=await readJson(req,29*1024*1024);auth=readSession(req);requireStudent(auth);a=checkActivity(id,auth);const key=text(b.requestId,'Identificador de entrega',80,true);if(!/^[\w-]{8,80}$/.test(key))fail(400,'Identificador de entrega no válido.');if(!['draft','submit'].includes(b.action))fail(400,'Acción no válida.');
    if((b.activityRevision??1)!==a.revision)fail(409,'La actividad fue actualizada. Recarga para responder la nueva versión.');
    const previous=one('SELECT * FROM submissions WHERE activity_id=? AND student_id=? AND request_key=?',id,auth.user.id,key);if(previous?.superseded)fail(409,'Esta entrega pertenece a una versión anterior. Recarga la actividad.');if(previous&&previous.state!=='draft')return send(subView(previous,auth));checkWindow(a);
    if(previous&&b.version!==previous.version)fail(409,'Tu borrador cambió en otra pestaña. Recarga antes de guardar.');
    const history=rows(id,auth.user.id);if(history.filter(s=>s.state!=='draft').length>=a.maxAttempts)fail(403,'Alcanzaste el máximo de entregas o intentos.');if(!previous&&history.some(s=>s.state==='draft'))fail(409,'Ya tienes un borrador. Recarga y continúa ese borrador.');
    const payload={text:text(b.text??'','Respuesta',20000),url:text(b.url??'','Enlace',2048),answers:a.kind==='quiz'?validateAnswers(a,b.answers,b.action==='submit'):{}};
    if(payload.url){let u;try{u=new URL(payload.url);}catch{fail(400,'Escribe un enlace completo HTTPS o HTTP.');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)fail(400,'Enlace no permitido.');payload.url=u.href;}
    const oldFiles=previous?submissionFiles(JSON.parse(previous.payload)):[];
    if(b.file&&b.files!==undefined)fail(400,'Usa una sola lista de archivos.');
    const uploaded=b.files??(b.file?[b.file]:undefined);
    const retain=b.retainFileIds??(b.removeFile||b.file?[]:undefined);
    if(a.kind==='quiz'&&((Array.isArray(uploaded)&&uploaded.length)||payload.url||payload.text))fail(400,'Responde el cuestionario en sus preguntas.');
    const plan=files.prepare(oldFiles,uploaded,retain);payload.files=plan.files;
    if(files.usedBytes()+plan.files.reduce((n,f)=>n+f.size,0)-oldFiles.reduce((n,f)=>n+f.size,0)>maxStorage)fail(413,'El espacio para entregas está lleno. Comunícate con tu docente o entrega un enlace.');
    if(a.kind==='task'&&b.action==='submit'&&!payload.text&&!payload.url&&!payload.files.length)fail(400,'Añade texto, un enlace o un archivo antes de entregar.');
    const final=b.action==='submit',points=final&&a.kind==='quiz'?autoScore(a,payload.answers):null;const sid=previous?.id||randomUUID(),attempt=previous?.attempt||Math.max(0,...history.map(s=>s.attempt))+1;
    files.write(plan);try{db.exec('BEGIN IMMEDIATE');
     if(previous)run('UPDATE submissions SET payload=?,state=?,submitted_at=?,late=?,points=?,version=version+1,updated_at=? WHERE id=?',JSON.stringify(payload),final?(points===null?'submitted':'graded'):'draft',final?now():null,Number(final&&a.dueAt&&now()>a.dueAt)||0,points,now(),sid);
     else run('INSERT INTO submissions(id,activity_id,student_id,request_key,attempt,state,payload,submitted_at,late,points,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',sid,id,auth.user.id,key,attempt,final?(points===null?'submitted':'graded'):'draft',JSON.stringify(payload),final?now():null,Number(final&&a.dueAt&&now()>a.dueAt)||0,points,now(),a.revision);
     if(final){invalidate(a.courseId);audit(auth.user,'submission.submit',sid);}db.exec('COMMIT');
    }catch(e){if(db.isTransaction)db.exec('ROLLBACK');plan.added.forEach(files.remove);throw e;}
    plan.removed.forEach(files.remove);return send(subView(one('SELECT * FROM submissions WHERE id=?',sid),auth),201);
   }
  }
  match=/^\/api\/academics\/submissions\/([^/]+)\/(grade|file|files)(?:\/([^/]+))?$/.exec(path);
  if(match){const [,id,section]=match;let s=one('SELECT * FROM submissions WHERE id=?',id);if(!s)fail(404,'Entrega no encontrada.');const a=checkActivity(s.activity_id,auth);if(!admin(auth)&&s.student_id!==auth.user.id)fail(403,'Esta entrega pertenece a otro estudiante.');
   if(['file','files'].includes(section)&&['GET','HEAD'].includes(method)){const items=submissionFiles(JSON.parse(s.payload));const file=section==='file'?items[0]:items.find(f=>f.id===match[3]);if(!file)fail(404,'Archivo no encontrado.');return serve(req,res,file,section==='file');}
   if(section==='grade'&&method==='PATCH'){requireAdmin(auth);const b=await readJson(req);auth=readSession(req);requireAdmin(auth);checkActivity(s.activity_id,auth);s=one('SELECT * FROM submissions WHERE id=?',id);if(s?.superseded)fail(409,'La actividad cambió. Esta entrega es histórica y ya no se puede calificar.');if(!s||s.state==='draft')fail(400,'Solo puedes calificar entregas enviadas.');if(b.version!==s.version)fail(409,'Esta calificación cambió. Recarga antes de guardar.');const points=num(b.points,'Nota en puntos',0,a.maxPoints),feedback=text(b.feedback??'','Comentarios',10000),published=bool(b.published,'Publicar nota');run("UPDATE submissions SET points=?,feedback=?,published=?,state='graded',version=version+1,updated_at=? WHERE id=?",points,feedback,Number(published),now(),id);invalidate(a.courseId);audit(auth.user,'submission.grade',id);return send(subView(one('SELECT * FROM submissions WHERE id=?',id),auth));}
  }
  fail(404,'Función académica no encontrada.');
 }
 return {handler,courseFiles:files.courseFiles};
}
