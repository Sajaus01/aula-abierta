import {createCourseInsights} from './course-insights.mjs';

export function createAnalytics({db,accessModel:a,fail,json,readJson,readSession,requireCourse,audit,academics,engagement=null,clock}){
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p);
 const insights=createCourseInsights({db,accessModel:a,academics,engagement,fail,clock});
 async function handler(req,res,path,method,auth){
  const policy=/^\/api\/grade-policy\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if(policy){const id=policy[1];a.requireScope(auth,id,'grade');a.group(id);
   if(method==='GET'){json(res,{overrides:all('SELECT * FROM grade_overrides WHERE activity_id IN (SELECT id FROM activities WHERE course_id=?)',id),history:all('SELECT g.*,s.student_id,s.activity_id,u.name,actor.name actor_name FROM grade_audit g JOIN submissions s ON s.id=g.submission_id JOIN users u ON u.id=s.student_id JOIN users actor ON actor.id=g.actor_id JOIN activities a ON a.id=s.activity_id WHERE a.course_id=? ORDER BY g.id DESC LIMIT 300',id)});return true;}
   if(method==='POST'){const b=await readJson(req);auth=readSession(req);a.requireScope(auth,id,'grade');if(!one('SELECT id FROM activities WHERE id=? AND course_id=?',b.activityId,id)||!one('SELECT id FROM enrollments WHERE course_id=? AND student_id=?',id,b.studentId))fail(400,'Actividad o estudiante fuera del grupo.');if(typeof b.exempt!=='boolean'||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>1000)fail(400,'Indica un motivo y el estado de exención.');db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO grade_overrides VALUES(?,?,?,?,?,?) ON CONFLICT(activity_id,student_id) DO UPDATE SET exempt=excluded.exempt,reason=excluded.reason,actor_id=excluded.actor_id,created_at=excluded.created_at').run(b.activityId,b.studentId,Number(b.exempt),b.reason.trim(),auth.user.id,new Date().toISOString());audit(auth.user,b.exempt?'grade.exempt':'grade.restore',b.activityId+':'+b.studentId);academics.invalidate(id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}json(res,{success:true});return true;}
  }
  if(method==='GET'&&(path==='/api/analytics'||path==='/api/analytics/overview')){json(res,insights.overview(auth,new URL(req.url,'http://localhost').searchParams));return true;}
  const match=/^\/api\/analytics\/([^/]+)$/.exec(path);
  if(match&&method==='GET'){json(res,insights.report(auth,match[1],new URL(req.url,'http://localhost').searchParams));return true;}
  const lab=/^\/api\/labs\/([^/]+)\/results$/.exec(path);
  if(lab){const r=one('SELECT r.*,m.course_id,m.published module_published FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?',lab[1]);if(!r||r.kind!=='lab')fail(404,'Laboratorio no encontrado.');requireCourse(r.course_id,auth);
   if(method==='POST'){const b=await readJson(req);auth=readSession(req);requireCourse(r.course_id,auth);if(r.lab_results==='disabled')fail(400,'Este laboratorio no solicita resultados.');if(auth?.user.role!=='student'||auth.preview||!r.published||!r.module_published)fail(403,'No puedes registrar resultados.');if(typeof b.result!=='string'||!b.result.trim()||b.result.length>10000)fail(400,'Escribe resultados de hasta 10000 caracteres.');db.prepare('INSERT INTO learning_events(user_id,course_id,object_id,action,details,created_at) VALUES(?,?,?,?,?,?)').run(auth.user.id,r.course_id,r.id,'lab.result',JSON.stringify({result:b.result}),new Date().toISOString());audit(auth.user,'lab.result',r.id);json(res,{success:true});return true;}
   if(method==='GET'){const isTeacher=a.staff(auth);if(isTeacher)a.requireScope(auth,r.course_id,'grade');const records=all('SELECT e.user_id,u.name,e.details,e.created_at FROM learning_events e JOIN users u ON u.id=e.user_id WHERE e.object_id=? AND e.action=? ORDER BY e.id DESC',r.id,'lab.result').filter(v=>isTeacher||v.user_id===auth.user.id);json(res,records.map(v=>({...v,result:JSON.parse(v.details).result,details:undefined})));return true;}
  }
  return false;
 }
 return {handler,report:insights.report,overview:insights.overview};
}
