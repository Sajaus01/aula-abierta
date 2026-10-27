export function setupActivityDeadlines(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS activity_deadline_extensions(
 activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 due_at TEXT,active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revoked_at TEXT,actor_id TEXT NOT NULL,
 PRIMARY KEY(activity_id,student_id));`);
}

export function extensionView(row) {
 if(!row)return null;
 return {active:Boolean(row.active),dueAt:row.due_at??null,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,revokedAt:row.revoked_at??null};
}

// Corrections and individual extensions authorize the same response. The last
// explicit authorization wins; neither authorization creates another attempt.
export function resolveActivityDeadline(activity,extension=null,submission=null,at=new Date().toISOString()) {
 const correction=submission?.returned_at&&['returned','draft'].includes(submission.state)?submission:null;
 const useExtension=Boolean(extension?.active&&(!correction||extension.updatedAt>=correction.returned_at));
 const source=useExtension?'extension':correction?'correction':'activity';
 const dueAt=useExtension?extension.dueAt:correction?correction.return_due_at??null:activity.dueAt??null;
 const closesAt=source==='activity'?activity.closesAt??null:dueAt;
 const allowLate=source==='activity'?Boolean(activity.allowLate):false;
 const closed=Boolean((closesAt&&at>=closesAt)||(!allowLate&&dueAt&&at>=dueAt));
 return {source,opensAt:activity.opensAt??null,dueAt,closesAt,allowLate,closed,updatedAt:useExtension?extension.updatedAt:correction?.returned_at??null,extension};
}

export function validateExtensionDueAt(value,activity,fail,at=new Date().toISOString()) {
 if(value===null)return null;
 const match=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match)fail(400,'Fecha no válida; incluye la fecha completa y su zona horaria.');
 const [,year,month,day,hour,minute,second='0',,zone]=match;
 const y=Number(year),m=Number(month),d=Number(day),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 const zoneHour=zone==='Z'?0:Number(zone.slice(1,3)),zoneMinute=zone==='Z'?0:Number(zone.slice(4));
 if(y<1||m<1||m>12||d<1||d>days[m-1]||Number(hour)>23||Number(minute)>59||Number(second)>59||zoneHour>14||zoneMinute>59||(zoneHour===14&&zoneMinute)||!Number.isFinite(Date.parse(value)))fail(400,'La fecha indicada no existe.');
 const dueAt=new Date(value).toISOString();
 if(dueAt<=at)fail(400,'El nuevo plazo debe estar en el futuro.');
 if(activity.opensAt&&dueAt<=activity.opensAt)fail(400,'El nuevo plazo debe ser posterior a la apertura de la actividad.');
 return dueAt;
}

export function createActivityDeadlines({db,fail}) {
 const raw=(activityId,studentId)=>db.prepare('SELECT * FROM activity_deadline_extensions WHERE activity_id=? AND student_id=?').get(activityId,studentId);
 const get=(activityId,studentId)=>extensionView(raw(activityId,studentId));
 function checkVersion(current,version) {
  if(!Number.isSafeInteger(version)||version<0)fail(400,'Incluye la versión vigente del plazo individual.');
  if((current?.version||0)!==version)fail(409,'El plazo individual cambió. Actualiza antes de guardar.');
 }
 function grant(activity,studentId,dueAt,version,actorId,at=new Date().toISOString()) {
  const current=raw(activity.id,studentId);checkVersion(current,version);
  dueAt=validateExtensionDueAt(dueAt,activity,fail,at);
  db.prepare(`INSERT INTO activity_deadline_extensions(activity_id,student_id,due_at,active,version,created_at,updated_at,revoked_at,actor_id)
  VALUES(?,?,?,1,1,?,?,NULL,?) ON CONFLICT(activity_id,student_id) DO UPDATE SET due_at=excluded.due_at,active=1,version=activity_deadline_extensions.version+1,updated_at=excluded.updated_at,revoked_at=NULL,actor_id=excluded.actor_id`).run(activity.id,studentId,dueAt,at,at,actorId);
  return get(activity.id,studentId);
 }
 function revoke(activityId,studentId,version,actorId,at=new Date().toISOString()) {
  const current=raw(activityId,studentId);checkVersion(current,version);
  if(!current?.active)fail(409,'Este estudiante no tiene un plazo individual vigente.');
  db.prepare('UPDATE activity_deadline_extensions SET active=0,version=version+1,updated_at=?,revoked_at=?,actor_id=? WHERE activity_id=? AND student_id=?').run(at,at,actorId,activityId,studentId);
  return get(activityId,studentId);
 }
 return {get,grant,revoke};
}
