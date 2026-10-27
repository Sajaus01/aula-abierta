import {randomUUID} from 'node:crypto';

export const ENGAGEMENT_IDLE_MS=60_000;
export const ENGAGEMENT_SESSION_MS=30*60_000;
export const ENGAGEMENT_MAX_GAP_MS=30_000;
const iso=at=>new Date(at).toISOString();
const day=at=>new Date(at-5*3600_000).toISOString().slice(0,10);
const seconds=ms=>Math.round(ms/10)/100;
const parseTime=(value,fallback)=>value===undefined||value===null?fallback:typeof value==='number'?value:Date.parse(value);
export const engagementDefinitions={
 visits:'Un ingreso inicia una sesión de trabajo en el grupo. Se abre otra sesión después de 30 minutos sin actividad. Recargar o cambiar de material dentro de la sesión no suma otro ingreso.',
 active:'Tiempo medido entre señales de una pestaña visible, en primer plano y con interacción reciente (hasta 60 segundos). Las señales se envían cada 15 segundos; un intervalo sin conexión de más de 30 segundos no se acredita. No demuestra atención ni aprendizaje. La lectura pasiva, la reproducción de videos y la interacción dentro de marcos o contenidos externos no se pueden confirmar y no se estiman.',
 averageSession:'Promedio del tiempo activo medido por sesión con inicio o actividad en el periodo; no es el tiempo durante el cual una pestaña permaneció abierta.',
 elapsed:'La duración registrada entre inicio y última señal describe el intervalo de la sesión; no se suma al tiempo activo.',
 coverage:'La medición empieza desde esta actualización. No se reconstruyen ingresos o duración a partir de presencia ni de consultas automáticas anteriores.',
 daily:'Fechas en America/Bogota. Una sesión que tiene actividad en varios días aparece en cada día; las sesiones diarias no se deben sumar para obtener el total del periodo.'
};

export function setupEngagement(db,{at=Date.now()}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS learning_measurement_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS learning_work_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,started_at TEXT NOT NULL,last_activity_at TEXT NOT NULL,last_active_at TEXT);
 CREATE INDEX IF NOT EXISTS work_sessions_scope ON learning_work_sessions(course_id,user_id,started_at);
 CREATE INDEX IF NOT EXISTS work_sessions_latest ON learning_work_sessions(user_id,course_id,last_activity_at);
 CREATE TABLE IF NOT EXISTS learning_active_intervals(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES learning_work_sessions(id) ON DELETE CASCADE,started_at TEXT NOT NULL,ended_at TEXT NOT NULL,CHECK(ended_at>=started_at));
 CREATE INDEX IF NOT EXISTS active_intervals_session ON learning_active_intervals(session_id,started_at,ended_at);
 CREATE TABLE IF NOT EXISTS learning_measurement_cursors(auth_hash TEXT NOT NULL,tab_id TEXT NOT NULL,user_id TEXT NOT NULL,course_id TEXT NOT NULL,event_seq INTEGER NOT NULL,last_at TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),session_id TEXT,PRIMARY KEY(auth_hash,tab_id));
 CREATE INDEX IF NOT EXISTS measurement_cursor_age ON learning_measurement_cursors(last_at);`);
 db.prepare('INSERT OR IGNORE INTO learning_measurement_meta(key,value) VALUES(?,?)').run('startedAt',iso(at));
}

export function createEngagement({db,fail,json,readJson,readSession,requireCourse,accessModel,clock=Date.now}){
 const all=(sql,...args)=>db.prepare(sql).all(...args),one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const measurementStartedAt=()=>one('SELECT value FROM learning_measurement_meta WHERE key=?','startedAt')?.value||null;
 function authorize(auth,courseId,at){
  if(!auth)fail(401,'Inicia sesión para registrar la actividad.');
  if(auth.preview||auth.assurance!=='password'||auth.user.role!=='student'||auth.user.must_change_password||auth.user.mustChangePassword)fail(403,'La medición corresponde únicamente al espacio del estudiante con contraseña.');
  const course=requireCourse(courseId,auth);
  if(course.entity_kind!=='group'||course.lifecycle!=='active'||!course.published)fail(403,'El grupo no está disponible para registrar actividad.');
  const enrollment=one("SELECT 1 FROM enrollments WHERE student_id=? AND course_id=? AND status='active' AND (starts_at IS NULL OR starts_at<=?) AND (expires_at IS NULL OR expires_at>?)",auth.user.id,courseId,iso(at),iso(at));
  if(!enrollment)fail(403,'La matrícula no está vigente.');
  return course;
 }
 function record(auth,b,at){
  const old=one('SELECT * FROM learning_measurement_cursors WHERE auth_hash=? AND tab_id=?',auth.tokenHash,b.tabId);
  if(old&&b.eventSeq<=old.event_seq)return {applied:false,eventSeq:old.event_seq,creditedSeconds:0};
  if(!old&&one('SELECT count(*) n FROM learning_measurement_cursors WHERE auth_hash=? AND last_at>?',auth.tokenHash,iso(at-60_000)).n>=20)fail(429,'Hay demasiadas pestañas enviando actividad.');
  let session=one('SELECT * FROM learning_work_sessions WHERE user_id=? AND course_id=? ORDER BY last_activity_at DESC,started_at DESC LIMIT 1',auth.user.id,b.courseId);
  const active=b.kind!=='leave'&&b.active===true;
  if((b.kind==='enter'||active)&&(!session||at-Date.parse(session.last_activity_at)>=ENGAGEMENT_SESSION_MS)){
   session={id:randomUUID(),user_id:auth.user.id,course_id:b.courseId,started_at:iso(at),last_activity_at:iso(at),last_active_at:null};
   run('INSERT INTO learning_work_sessions(id,user_id,course_id,started_at,last_activity_at) VALUES(?,?,?,?,?)',session.id,session.user_id,session.course_id,session.started_at,session.last_activity_at);
  }
  let credited=0;
  if(active&&session){
   const priorAt=old?Date.parse(old.last_at):NaN,gap=at-priorAt;
   if(b.kind==='pulse'&&old?.active&&old.course_id===b.courseId&&old.session_id===session.id&&gap>0&&gap<=ENGAGEMENT_MAX_GAP_MS){
    const previous=one('SELECT * FROM learning_active_intervals WHERE session_id=? ORDER BY ended_at DESC,id DESC LIMIT 1',session.id);
    const start=Math.max(priorAt,previous?Date.parse(previous.ended_at):priorAt);
    if(at>start){
     credited=at-start;
     if(previous&&Date.parse(previous.ended_at)===start)run('UPDATE learning_active_intervals SET ended_at=? WHERE id=?',iso(at),previous.id);
     else run('INSERT INTO learning_active_intervals(session_id,started_at,ended_at) VALUES(?,?,?)',session.id,iso(start),iso(at));
    }
   }
   run('UPDATE learning_work_sessions SET last_activity_at=?,last_active_at=? WHERE id=?',iso(at),iso(at),session.id);
  }
  run(`INSERT INTO learning_measurement_cursors(auth_hash,tab_id,user_id,course_id,event_seq,last_at,active,session_id) VALUES(?,?,?,?,?,?,?,?)
   ON CONFLICT(auth_hash,tab_id) DO UPDATE SET user_id=excluded.user_id,course_id=excluded.course_id,event_seq=excluded.event_seq,last_at=excluded.last_at,active=excluded.active,session_id=excluded.session_id`,auth.tokenHash,b.tabId,auth.user.id,b.courseId,b.eventSeq,iso(at),Number(active),session?.id||null);
  run('DELETE FROM learning_measurement_cursors WHERE last_at<?',iso(at-2*86400_000));
  return {applied:true,eventSeq:b.eventSeq,sessionId:session?.id||null,creditedSeconds:seconds(credited)};
 }
 async function handler(req,res,path,method,auth){
  if(path!=='/api/learning-activity'||method!=='POST')return false;
  if(!auth)fail(401,'Inicia sesión para registrar la actividad.');
  const body=await readJson(req,4096),current=readSession(req);
  if(!current||current.tokenHash!==auth.tokenHash||current.user.id!==auth.user.id)fail(401,'La sesión cambió.');
  if(!body||typeof body.courseId!=='string'||body.courseId.length>100||typeof body.tabId!=='string'||!/^[A-Za-z0-9-]{16,80}$/.test(body.tabId)||!Number.isSafeInteger(body.eventSeq)||body.eventSeq<1||!['enter','pulse','leave'].includes(body.kind)||typeof body.active!=='boolean')fail(400,'La señal de actividad no es válida.');
  const at=clock();authorize(current,body.courseId,at);
  db.exec('BEGIN IMMEDIATE');let result;
  try{result=record(current,body,at);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  json(res,{...result,measurementStartedAt:measurementStartedAt(),idleSeconds:ENGAGEMENT_IDLE_MS/1000,sessionIdleMinutes:30});return true;
 }
 function records(courseId,{from,to,userIds}={}){
  const start=parseTime(from,Date.parse('0001-01-01T00:00:00.000Z')),end=parseTime(to,Date.parse('9999-12-31T23:59:59.999Z'));
  if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)throw Error('Intervalo de medición no válido.');
  const requested=Array.isArray(userIds)?new Set(userIds):null;
  const sessions=all('SELECT * FROM learning_work_sessions WHERE course_id=? AND started_at<=? AND last_activity_at>=? ORDER BY started_at,id',courseId,iso(end),iso(start)).filter(s=>!requested||requested.has(s.user_id));
  const intervals=all('SELECT i.*,s.user_id FROM learning_active_intervals i JOIN learning_work_sessions s ON s.id=i.session_id WHERE s.course_id=? AND i.ended_at>? AND i.started_at<? ORDER BY i.started_at,i.id',courseId,iso(start),iso(end)).filter(i=>!requested||requested.has(i.user_id)).map(i=>({...i,start:Math.max(start,Date.parse(i.started_at)),end:Math.min(end,Date.parse(i.ended_at))})).filter(i=>i.end>i.start);
  return {start,end,sessions,intervals};
 }
 function summary(courseId,options={}){
  const {start,end,sessions,intervals}=records(courseId,options),ids=[...new Set(options.userIds||sessions.map(s=>s.user_id))],lastRecorded=new Map(all('SELECT user_id,max(last_active_at) at FROM learning_work_sessions WHERE course_id=? GROUP BY user_id',courseId).map(row=>[row.user_id,row.at]));
  const students=ids.map(userId=>{
   const own=sessions.filter(s=>s.user_id===userId),ownIntervals=intervals.filter(i=>i.user_id===userId),total=ownIntervals.reduce((n,i)=>n+i.end-i.start,0),daily=new Map();
   const entry=date=>{if(!daily.has(date))daily.set(date,{date,visits:0,activeMs:0,sessionIds:new Set()});return daily.get(date);};
   for(const s of own){const started=Date.parse(s.started_at);if(started>=start&&started<=end){const d=entry(day(started));d.visits++;d.sessionIds.add(s.id);}const last=Date.parse(s.last_active_at);if(last>=start&&last<=end)entry(day(last)).sessionIds.add(s.id);}
   for(const interval of ownIntervals){let cursor=interval.start;while(cursor<interval.end){const date=day(cursor),next=Date.parse(date+'T00:00:00.000-05:00')+86400_000,until=Math.min(next,interval.end),d=entry(date);d.activeMs+=until-cursor;d.sessionIds.add(interval.session_id);cursor=until;}}
   const included=new Set(own.filter(s=>Date.parse(s.started_at)>=start&&Date.parse(s.started_at)<=end||s.last_active_at&&Date.parse(s.last_active_at)>=start&&Date.parse(s.last_active_at)<=end).map(s=>s.id));for(const i of ownIntervals)included.add(i.session_id);
   const candidates=own.map(s=>s.last_active_at).filter(v=>v&&Date.parse(v)>=start&&Date.parse(v)<=end).concat(ownIntervals.map(i=>iso(i.end))).sort();
   return {userId,visits:own.filter(s=>Date.parse(s.started_at)>=start&&Date.parse(s.started_at)<=end).length,sessions:included.size,activeSeconds:seconds(total),averageSessionSeconds:included.size?seconds(total/included.size):null,lastActiveAt:candidates.at(-1)||null,lastActiveAtAllTime:lastRecorded.get(userId)||null,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(({activeMs,sessionIds,...d})=>({...d,activeSeconds:seconds(activeMs),sessions:sessionIds.size}))};
  });
  const aggregate=new Map();for(const student of students)for(const d of student.daily){if(!aggregate.has(d.date))aggregate.set(d.date,{date:d.date,visits:0,sessions:0,activeSeconds:0});const target=aggregate.get(d.date);target.visits+=d.visits;target.sessions+=d.sessions;target.activeSeconds=Math.round((target.activeSeconds+d.activeSeconds)*100)/100;}
  const started=measurementStartedAt();return {measurementStartedAt:started,metadata:{measurementStartedAt:started},timezone:'America/Bogota',students,daily:[...aggregate.values()].sort((a,b)=>a.date.localeCompare(b.date)),definitions:engagementDefinitions};
 }
 function details(courseId,userId,options={}){
  const scoped={...options,userIds:[userId]},data=records(courseId,scoped),student=summary(courseId,scoped).students[0];
  const sessions=data.sessions.map(s=>({id:s.id,startedAt:s.started_at,lastActiveAt:s.last_active_at,activeSeconds:seconds(data.intervals.filter(i=>i.session_id===s.id).reduce((n,i)=>n+i.end-i.start,0)),elapsedSeconds:seconds(Math.max(0,Math.min(data.end,Date.parse(s.last_activity_at))-Math.max(data.start,Date.parse(s.started_at))))})).filter(s=>Date.parse(s.startedAt)>=data.start&&Date.parse(s.startedAt)<=data.end||s.activeSeconds>0||s.lastActiveAt&&Date.parse(s.lastActiveAt)>=data.start&&Date.parse(s.lastActiveAt)<=data.end);
  return {measurementStartedAt:measurementStartedAt(),student,sessions,intervals:data.intervals.map(i=>({startedAt:iso(i.start),endedAt:iso(i.end),seconds:seconds(i.end-i.start)})),definitions:engagementDefinitions};
 }
 return {handler,summary,details};
}
