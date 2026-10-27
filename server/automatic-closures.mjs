export function setupAutomaticClosures(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS activity_auto_closures(
 activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,revision INTEGER NOT NULL,
 points REAL NOT NULL DEFAULT 0 CHECK(points=0),max_points REAL NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,
 closed_at TEXT NOT NULL,deadline_at TEXT NOT NULL,deadline_source TEXT NOT NULL,
 updated_at TEXT NOT NULL,reopened_at TEXT,PRIMARY KEY(activity_id,student_id,revision));
 CREATE TABLE IF NOT EXISTS activity_auto_closure_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,activity_id TEXT NOT NULL,student_id TEXT NOT NULL,revision INTEGER NOT NULL,
 version INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,deadline_at TEXT,deadline_source TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(activity_id,student_id,revision) REFERENCES activity_auto_closures(activity_id,student_id,revision) ON DELETE CASCADE,
 UNIQUE(activity_id,student_id,revision,version));
 CREATE INDEX IF NOT EXISTS activity_auto_closure_student ON activity_auto_closures(student_id,activity_id,active);`);
}

const instant=value=>new Date(value??Date.now()).toISOString();
const cutoff=policy=>[policy.closesAt,...(!policy.allowLate?[policy.dueAt]:[])].filter(Boolean).sort()[0]||null;
const hasDelivery=records=>records.some(record=>record.submitted_at||record.returned_at||['submitted','graded','returned'].includes(record.state));

export function createAutomaticClosures({db,accessModel,studentDeadline,audit}) {
 const all=(sql,...args)=>db.prepare(sql).all(...args),one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const current=(activityId,studentId,revision)=>one('SELECT * FROM activity_auto_closures WHERE activity_id=? AND student_id=? AND revision=?',activityId,studentId,revision);
 function transition(activity,studentId,previous,closed,policy,at,reason) {
  const revision=previous?.revision??activity.revision,version=(previous?.version||0)+1,deadlineAt=cutoff(policy);
  if(!previous){run('INSERT INTO activity_auto_closures(activity_id,student_id,revision,points,max_points,closed_at,deadline_at,deadline_source,updated_at) VALUES(?,?,?,0,?,?,?,?,?)',activity.id,studentId,revision,activity.maxPoints,at,deadlineAt,policy.source,at);}
  else if(closed)run('UPDATE activity_auto_closures SET active=1,version=?,max_points=?,closed_at=?,deadline_at=?,deadline_source=?,updated_at=?,reopened_at=NULL WHERE activity_id=? AND student_id=? AND revision=?',version,activity.maxPoints,at,deadlineAt,policy.source,at,activity.id,studentId,revision);
  else run('UPDATE activity_auto_closures SET active=0,version=?,updated_at=?,reopened_at=COALESCE(reopened_at,?) WHERE activity_id=? AND student_id=? AND revision=?',version,at,at,activity.id,studentId,revision);
  run('INSERT INTO activity_auto_closure_history(activity_id,student_id,revision,version,state,reason,deadline_at,deadline_source,created_at) VALUES(?,?,?,?,?,?,?,?,?)',activity.id,studentId,revision,version,closed?'closed':'reopened',reason,deadlineAt,policy.source,at);
  audit?.(null,closed?'activity.auto-close':reason==='submission'?'activity.auto-replace':'activity.auto-reopen',activity.id,{studentId,revision,version,points:closed?0:null,deadlineAt,source:policy.source,reason,change:{before:{closed:Boolean(previous?.active),points:previous?.active?0:null},after:{closed,points:closed?0:null}}});
 }
 function reconcile({courseId,studentId,activityId,at:requestedAt}={}) {
  const at=instant(requestedAt),clauses=[],params=[];
  if(courseId){clauses.push('a.course_id=?');params.push(courseId);}if(activityId){clauses.push('a.id=?');params.push(activityId);}
  const activities=all('SELECT a.*,c.published course_published'+(accessModel?',c.entity_kind,c.lifecycle':'')+' FROM activities a JOIN courses c ON c.id=a.course_id'+(clauses.length?' WHERE '+clauses.join(' AND '):''),...params);
  let closed=0,reopened=0;const ownsTransaction=!db.isTransaction;
  if(ownsTransaction)db.exec('BEGIN IMMEDIATE');
  try{
   for(const row of activities){
    const activity={...JSON.parse(row.config),id:row.id,courseId:row.course_id,moduleId:row.module_id,revision:row.revision};
    const validMaximum=Number.isFinite(activity.maxPoints)&&activity.maxPoints>0;
    const published=Boolean(row.course_published&&activity.status==='published'&&(!activity.moduleId||one('SELECT published FROM modules WHERE id=?',activity.moduleId)?.published)&&(!accessModel||row.entity_kind==='group'&&row.lifecycle==='active'));
    const closureRows=all('SELECT * FROM activity_auto_closures WHERE activity_id=?'+(studentId?' AND student_id=?':''),activity.id,...(studentId?[studentId]:[]));
    // Older course metadata may lack an assessment scale. It remains readable,
    // but cannot authorize a new persisted grade with an invented maximum.
    if(!validMaximum&&!closureRows.length)continue;
    if(!closureRows.length&&(!published||(activity.opensAt&&activity.opensAt>at)||!resolveActivityDeadline(activity,null,null,at).closed&&!one('SELECT 1 FROM activity_deadline_extensions WHERE activity_id=? AND active=1 AND due_at IS NOT NULL AND due_at<=?'+(studentId?' AND student_id=?':'')+' LIMIT 1',activity.id,at,...(studentId?[studentId]:[]))))continue;
    const people=all('SELECT u.*'+(accessModel?",EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='student') is_student":'')+' FROM users u WHERE u.id IN(SELECT student_id FROM enrollments WHERE course_id=? UNION SELECT student_id FROM activity_auto_closures WHERE activity_id=?)'+(studentId?' AND u.id=?':''),row.course_id,row.id,...(studentId?[studentId]:[]));
    const recordsByStudent=new Map();for(const record of all('SELECT * FROM submissions WHERE activity_id=? AND superseded=0'+(studentId?' AND student_id=?':'')+' ORDER BY student_id,attempt DESC,updated_at DESC',activity.id,...(studentId?[studentId]:[]))){const history=recordsByStudent.get(record.student_id)||[];history.push(record);recordsByStudent.set(record.student_id,history);}
    const enrolledIds=new Set(all("SELECT student_id FROM enrollments WHERE course_id=? AND status='active' AND (starts_at IS NULL OR starts_at<=?) AND (expires_at IS NULL OR expires_at>?)",activity.courseId,at,at).map(enrollment=>enrollment.student_id));
    const exemptIds=new Set(accessModel?all('SELECT student_id FROM grade_overrides WHERE activity_id=? AND exempt=1',activity.id).map(override=>override.student_id):[]);
    for(const person of people){
     const records=recordsByStudent.get(person.id)||[],latest=records[0];
     const policy=studentDeadline(activity,person.id,latest,at);
     for(const old of closureRows.filter(closure=>closure.student_id===person.id&&closure.revision!==activity.revision&&closure.active)){transition(activity,person.id,old,false,policy,at,'revision');reopened++;}
     const existing=closureRows.find(closure=>closure.student_id===person.id&&closure.revision===activity.revision),delivery=hasDelivery(records),exempt=exemptIds.has(person.id);
     const opened=!activity.opensAt||activity.opensAt<=at;
     const eligible=Boolean(published&&opened&&person.active&&enrolledIds.has(person.id)&&(!accessModel||person.account_status==='active'&&person.is_student));
     if(existing?.active&&(delivery||exempt||!policy.closed||!opened)){transition(activity,person.id,existing,false,policy,at,delivery?'submission':exempt?'exempt':policy.source==='extension'?'extension':'deadline');reopened++;}
     else if(existing&&!existing.active&&delivery&&one('SELECT reason FROM activity_auto_closure_history WHERE activity_id=? AND student_id=? AND revision=? ORDER BY id DESC LIMIT 1',activity.id,person.id,activity.revision)?.reason!=='submission'){transition(activity,person.id,existing,false,policy,at,'submission');reopened++;}
     else if(!existing?.active&&eligible&&validMaximum&&policy.closed&&!delivery&&!exempt){transition(activity,person.id,existing,true,policy,at,'deadline');closed++;}
    }
   }
   if(ownsTransaction)db.exec('COMMIT');
  }catch(error){if(ownsTransaction&&db.isTransaction)db.exec('ROLLBACK');throw error;}
  return {closed,reopened,at};
 }
 function get(activity,studentId,{reconcile:refresh=true,at}={}) {
  if(refresh)reconcile({activityId:activity.id,studentId,at});
  const row=current(activity.id,studentId,activity.revision);if(!row)return null;
  const history=all('SELECT state,reason,created_at,version,deadline_at,deadline_source FROM activity_auto_closure_history WHERE activity_id=? AND student_id=? AND revision=? ORDER BY id DESC LIMIT 30',activity.id,studentId,activity.revision).reverse().map(event=>({state:event.state,reason:event.reason,at:event.created_at,version:event.version,deadlineAt:event.deadline_at,source:event.deadline_source}));
  return {closed:Boolean(row.active),automatic:true,points:row.active?row.points:null,closedAt:row.closed_at,deadlineAt:row.deadline_at,source:row.deadline_source,version:row.version,revision:row.revision,reopenedAt:row.reopened_at||null,history};
 }
 return {reconcile,get};
}
import {resolveActivityDeadline} from './activity-deadlines.mjs';

