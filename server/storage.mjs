import {statSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {diskFiles,physicalBytes,diskCapacity,optimizeBackups} from './storage-disk.mjs';

const MB=1024*1024,MAX=10*1024**4;
const sum=items=>items.reduce((n,x)=>n+x.size,0);
const bytes=n=>`${Math.round(n/MB*10)/10} MB`;
export function createStorage({db,dataDir,uploadsDir,accessModel:a,fail,json,readJson,readSession,audit,env={},capacity=()=>diskCapacity(dataDir)}) {
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 const has=t=>!!one('SELECT 1 FROM sqlite_master WHERE type=? AND name=?','table',t);
 db.exec(`CREATE TABLE IF NOT EXISTS storage_settings(id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS storage_user_limits(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,limit_bytes INTEGER CHECK(limit_bytes>=0),updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS storage_course_limits(course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,limit_bytes INTEGER CHECK(limit_bytes>=0),updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS storage_events(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT,action TEXT NOT NULL,target_id TEXT,details TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const initial={teacherBytes:500*MB,studentBytes:100*MB,courseBytes:250*MB,platformBytes:null,submissionBytes:Number(env.SUBMISSIONS_MAX_BYTES)>0?Number(env.SUBMISSIONS_MAX_BYTES):500*MB,reserveBytes:50*MB,warningPercent:80};
 run('INSERT OR IGNORE INTO storage_settings VALUES(1,?,1)',JSON.stringify(initial));
 const settings=()=>({...initial,...JSON.parse(one('SELECT config FROM storage_settings WHERE id=1').config)});
 const roles=id=>a?a.p.roles(id):(one('SELECT role FROM users WHERE id=?',id)?.role==='admin'?['master']:['student']);
 const staff=id=>roles(id).some(r=>r!=='student');
 const global=auth=>a?a.global(auth):auth?.assurance==='password'&&auth.user.role==='admin'&&!auth.preview;
 function requireManager(auth){if(!global(auth))fail(403,'Solo máster y administrativos pueden gestionar el almacenamiento.','STORAGE_FORBIDDEN');}
 const event=(auth,action,target,details)=>{run('INSERT INTO storage_events(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)',auth.user.id,action,target,JSON.stringify(details),new Date().toISOString());audit(auth.user,action,target);};
 function setOwner(courseId,userId){run('INSERT OR IGNORE INTO storage_course_limits VALUES(?,?,NULL,?)',courseId,userId,new Date().toISOString());}
 // Stable attribution: course creator first, then a managing teacher. Administrators can reassign it.
 function reconcileOwners(){for(const c of all('SELECT id FROM courses WHERE id NOT IN (SELECT course_id FROM storage_course_limits)')){let id=one("SELECT actor_id FROM audit WHERE target_id=? AND action IN ('course.create','course.clone') ORDER BY id LIMIT 1",c.id)?.actor_id;
  if(!id||!one('SELECT id FROM users WHERE id=?',id))id=has('course_staff')?one("SELECT s.user_id FROM course_staff s LEFT JOIN user_roles r ON r.user_id=s.user_id AND r.role='teacher' WHERE s.course_id=? ORDER BY s.can_manage DESC,(r.role IS NOT NULL) DESC,s.user_id LIMIT 1",c.id)?.user_id:null;
  setOwner(c.id,id||null);
 }}
 reconcileOwners();
 function inventory(){
  reconcileOwners();const map=new Map(),courses=all('SELECT c.*,s.owner_id,s.limit_bytes FROM courses c LEFT JOIN storage_course_limits s ON s.course_id=c.id'),owners=new Map(courses.map(c=>[c.id,c.owner_id]));
  function add(key,size,name,kind,courseId=null,userId=null,url=''){
   if(!key||typeof key!=='string'||key!==basename(key)||/[\\/\x00]/.test(key))return;
   let f=map.get(key);if(!f){const path=join(uploadsDir,key);let actual=0,missing=false;try{actual=statSync(path).size;}catch{actual=Number(size)||0;missing=true;}f={key,name:name||'Archivo',size:actual,kind,courseIds:new Set(),userIds:new Set(),refs:0,missing,url};map.set(key,f);}f.refs++;
   if(courseId){f.courseIds.add(courseId);const owner=owners.get(courseId);if(owner)f.userIds.add(owner);}if(userId)f.userIds.add(userId);
  }
  for(const r of all('SELECT r.*,m.course_id FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.file_key IS NOT NULL'))add(r.file_key,r.file_size,r.file_name,'material',r.course_id,null,'#curso/'+r.course_id);
  for(const r of all('SELECT * FROM quick_resources WHERE file_key IS NOT NULL'))add(r.file_key,r.file_size,r.file_name,'material',r.course_id,null,'#curso/'+r.course_id);
  for(const r of all('SELECT f.*,a.course_id FROM activity_files f JOIN activities a ON a.id=f.activity_id'))add(r.file_key,r.size,r.name,'activity',r.course_id,null,'#actividad/'+r.activity_id);
  for(const r of all('SELECT s.*,a.course_id FROM submissions s JOIN activities a ON a.id=s.activity_id')){const p=JSON.parse(r.payload);for(const f of p.files??(p.file?[p.file]:[]))add(f.key,f.size,f.name,'submission',r.course_id,r.student_id,'#actividad/'+r.activity_id);}
  if(has('activity_versions'))for(const r of all('SELECT v.files,a.course_id,v.activity_id FROM activity_versions v JOIN activities a ON a.id=v.activity_id'))for(const f of JSON.parse(r.files))add(f.key,f.size,f.name,'history',r.course_id,null,'#actividad/'+r.activity_id);
  if(has('library_items'))for(const r of all('SELECT * FROM library_items')){const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v.file_key)add(v.file_key,v.file_size??v.size,v.file_name??v.name,'library',null,r.owner_id,'#biblioteca');for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);}};walk(JSON.parse(r.payload));}
  if(has('profiles'))for(const p of all('SELECT user_id,length(photo) size FROM profiles WHERE photo IS NOT NULL'))map.set('avatar:'+p.user_id,{key:'avatar:'+p.user_id,name:'Foto de perfil',size:p.size,kind:'avatar',userIds:new Set([p.user_id]),courseIds:new Set(),refs:1,missing:false,url:'#mi-perfil'});
  return {files:[...map.values()],courses};
 }
 function userLimit(id,cfg=settings()){const custom=one('SELECT limit_bytes FROM storage_user_limits WHERE user_id=?',id);return custom?custom.limit_bytes:staff(id)?cfg.teacherBytes:cfg.studentBytes;}
 function courseLimit(id,cfg=settings()){const x=one('SELECT limit_bytes FROM storage_course_limits WHERE course_id=?',id);return x?.limit_bytes??cfg.courseBytes;}
 function checkLimit(used,delta,limit,label){if(delta>0&&limit!==null&&used+delta>limit)fail(413,`${label}: ${bytes(used)} usados de ${bytes(limit)}. Solicita ampliar el cupo desde Almacenamiento. Los enlaces no ocupan este cupo.`,'STORAGE_QUOTA');}
 function assertDisk(extra){const cfg=settings(),disk=capacity();if(disk.freeBytes<extra+cfg.reserveBytes)fail(413,`El disco del servidor no tiene espacio suficiente: ${bytes(disk.freeBytes)} libres y ${bytes(cfg.reserveBytes)} reservados. Administración debe revisar Almacenamiento y optimizar respaldos o ampliar el disco.`,'STORAGE_DISK_FULL');}
 function assertUpload({userId,courseId=null,added=[],removed=[],kind='material'}){
  const extra=sum(added);if(!extra)return;const cfg=settings();assertDisk(extra);
  const {files}=inventory(),released=new Set(removed),freed=files.filter(f=>released.has(f.key)&&f.refs===1),owner=courseId?one('SELECT owner_id FROM storage_course_limits WHERE course_id=?',courseId)?.owner_id:null;
  const userIds=new Set((courseId&&kind!=='submission'?[owner||userId]:[userId,owner]).filter(Boolean));
  for(const id of userIds)checkLimit(sum(files.filter(f=>f.userIds.has(id))),extra-sum(freed.filter(f=>f.userIds.has(id))),userLimit(id,cfg),id===userId?'Cupo de tu cuenta':'Cupo total del docente responsable');
  if(courseId)checkLimit(sum(files.filter(f=>f.courseIds.has(courseId))),extra-sum(freed.filter(f=>f.courseIds.has(courseId))),courseLimit(courseId,cfg),'Cupo del curso o grupo');
  checkLimit(sum(files),extra-sum(freed),cfg.platformBytes,'Cupo total de archivos de la plataforma');
  if(kind==='submission')checkLimit(sum(files.filter(f=>f.kind==='submission')),extra-sum(freed.filter(f=>f.kind==='submission')),cfg.submissionBytes,'Cupo global de entregas');
 }
 function checkCopy({userId,courseId=null,sourceCourseId,payload}){
  let added=[];if(sourceCourseId){const keys=[];for(const r of all('SELECT r.file_key key FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=? UNION ALL SELECT file_key FROM quick_resources WHERE course_id=? UNION ALL SELECT f.file_key FROM activity_files f JOIN activities a ON a.id=f.activity_id WHERE a.course_id=?',sourceCourseId,sourceCourseId,sourceCourseId)){if(r.key)keys.push(r.key);}added=keys.map(key=>({size:statSync(join(uploadsDir,key)).size}));}
  else{const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v.file_key)added.push({size:statSync(join(uploadsDir,v.file_key)).size});for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);}};walk(payload);}
  assertUpload({userId,courseId,added});if(sourceCourseId)checkLimit(0,sum(added),settings().courseBytes,'Cupo del nuevo curso o grupo');
 }
 function report(auth,{full=false}={}){
  const cfg=settings(),inv=inventory(),files=inv.files,disk=capacity(),allUsers=all('SELECT id,name,active FROM users'),isGlobal=global(auth);
  const users=allUsers.map(u=>({...u,roles:roles(u.id),usedBytes:sum(files.filter(f=>f.userIds.has(u.id))),limitBytes:userLimit(u.id,cfg),custom:!!one('SELECT 1 FROM storage_user_limits WHERE user_id=?',u.id),courseCount:inv.courses.filter(c=>c.owner_id===u.id).length}));
  const courses=inv.courses.map(c=>({id:c.id,title:c.title,kind:c.entity_kind||'legacy',code:c.group_code||'',cohort:c.cohort||'',ownerId:c.owner_id,ownerName:allUsers.find(u=>u.id===c.owner_id)?.name||'Sin responsable',usedBytes:sum(files.filter(f=>f.courseIds.has(c.id))),limitBytes:courseLimit(c.id,cfg),custom:c.limit_bytes!==null,materialBytes:sum(files.filter(f=>f.courseIds.has(c.id)&&f.kind!=='submission')),submissionBytes:sum(files.filter(f=>f.courseIds.has(c.id)&&f.kind==='submission'))}));
  const own=users.find(u=>u.id===auth.user.id),visibleCourses=isGlobal?courses:courses.filter(c=>a?.staff(auth)&&a.p.can(auth.user.id,c.id,'view'));
  if(!full)return {own,courses:visibleCourses,warningPercent:cfg.warningPercent};
  requireManager(auth);const backupFiles=diskFiles(join(dataDir,'backups')),uploadFiles=diskFiles(uploadsDir),referenced=new Set(files.map(f=>f.key));
  const rootFiles=diskFiles(dataDir).filter(f=>!f.path.startsWith(join(dataDir,'backups')+'/')&&!f.path.startsWith(join(dataDir,'backups')+'\\')&&!f.path.startsWith(uploadsDir+'/')&&!f.path.startsWith(uploadsDir+'\\'));
  const backups= [...new Set(backupFiles.map(f=>f.path.slice(join(dataDir,'backups').length+1).split(/[\\/]/)[0]))].map(name=>{const fs=backupFiles.filter(f=>f.path.slice(join(dataDir,'backups').length+1).split(/[\\/]/)[0]===name);return {name,logicalBytes:sum(fs),fileCount:fs.length};});
  return {settings:cfg,version:one('SELECT version FROM storage_settings WHERE id=1').version,own,users,courses,disk:{...disk,reserveBytes:cfg.reserveBytes,usableBytes:Math.max(0,disk.freeBytes-cfg.reserveBytes),backupBytes:physicalBytes(backupFiles),backupLogicalBytes:sum(backupFiles),uploadBytes:physicalBytes(uploadFiles),databaseBytes:physicalBytes(rootFiles),unreferencedBytes:sum(uploadFiles.filter(f=>!referenced.has(basename(f.path)))),missingFiles:files.filter(f=>f.missing).length},usedBytes:sum(files),submissionBytes:sum(files.filter(f=>f.kind==='submission')),backups,files:files.sort((x,y)=>y.size-x.size).slice(0,100).map(f=>({name:f.name,size:f.size,kind:f.kind,courseIds:[...f.courseIds],userIds:[...f.userIds],url:f.url,missing:f.missing})),events:all('SELECT e.*,u.name actor_name FROM storage_events e LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT 50').map(e=>({...e,details:JSON.parse(e.details)}))};
 }
 const validateLimit=(value,label,nullable=true)=>{if(nullable&&value===null)return null;if(!Number.isSafeInteger(value)||value<0||value>MAX)fail(400,`${label}: indica un número válido de bytes, entre 0 y 10 TB.`);return value;};
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/storage'))return false;
  if(!auth||auth.assurance!=='password'||auth.preview)fail(403,'Ingresa con contraseña para consultar almacenamiento.');
  const send=x=>{json(res,x);return true;};
  if(path==='/api/storage/mine'&&method==='GET')return send(report(auth));
  requireManager(auth);
  if(path==='/api/storage'&&method==='GET')return send(report(auth,{full:true}));
  if(method!=='PUT'&&method!=='POST')fail(405,'Método no permitido.');
  const b=await readJson(req,10000);auth=readSession(req);requireManager(auth);
  const beforeVersion=one('SELECT version FROM storage_settings WHERE id=1').version;
  if(b.version!==beforeVersion)fail(409,'El panel cambió en otra sesión. Actualiza antes de guardar.');
  if(path==='/api/storage/optimize'&&method==='POST'){if(b.confirmed!==true)fail(400,'Confirma la optimización de respaldos.');const result=optimizeBackups(dataDir);event(auth,'storage.optimize',null,result);run('UPDATE storage_settings SET version=version+1 WHERE id=1');return send(result);}
  db.exec('BEGIN IMMEDIATE');try{
   if(path==='/api/storage/settings'&&method==='PUT'){
    const old=settings(),next={};for(const k of ['teacherBytes','studentBytes','courseBytes','platformBytes','submissionBytes'])next[k]=validateLimit(b[k],k);
    next.reserveBytes=validateLimit(b.reserveBytes,'Reserva',false);if(next.reserveBytes<16*MB||next.reserveBytes>1024*MB)fail(400,'La reserva del sistema debe estar entre 16 y 1024 MB.');
    if(!Number.isInteger(b.warningPercent)||b.warningPercent<50||b.warningPercent>95)fail(400,'La alerta debe estar entre 50 y 95 %.');next.warningPercent=b.warningPercent;
    run('UPDATE storage_settings SET config=? WHERE id=1',JSON.stringify(next));event(auth,'storage.settings',null,{before:old,after:next});
   }else{
    const m=/^\/api\/storage\/(users|courses)\/([^/]+)$/.exec(path);if(!m||method!=='PUT')fail(404,'Configuración no encontrada.');const [,kind,id]=m;
    if(!one(`SELECT id FROM ${kind==='users'?'users':'courses'} WHERE id=?`,id))fail(404,'Registro no encontrado.');
    const value=b.inherit===true?null:validateLimit(b.limitBytes,'Cupo',kind==='users');
    if(kind==='users'){const old=one('SELECT * FROM storage_user_limits WHERE user_id=?',id);if(b.inherit===true)run('DELETE FROM storage_user_limits WHERE user_id=?',id);else run('INSERT INTO storage_user_limits VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET limit_bytes=excluded.limit_bytes,updated_at=excluded.updated_at',id,value,new Date().toISOString());event(auth,'storage.user',id,{before:old?.limit_bytes,after:value,inherit:b.inherit===true});}
    else{const old=one('SELECT * FROM storage_course_limits WHERE course_id=?',id),owner=b.ownerId;if(typeof owner!=='string'||!one('SELECT id FROM users WHERE id=?',owner)||!staff(owner))fail(400,'Selecciona un docente o administrador responsable.');run('INSERT INTO storage_course_limits VALUES(?,?,?,?) ON CONFLICT(course_id) DO UPDATE SET owner_id=excluded.owner_id,limit_bytes=excluded.limit_bytes,updated_at=excluded.updated_at',id,owner,value,new Date().toISOString());event(auth,'storage.course',id,{before:old,after:{ownerId:owner,limitBytes:value}});}
   }
   run('UPDATE storage_settings SET version=version+1 WHERE id=1');db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
  return send({success:true});
 }
 return {handler,assertUpload,assertDisk,checkCopy,setOwner,inventory,report,settings,optimizeBackups:()=>optimizeBackups(dataDir)};
}
