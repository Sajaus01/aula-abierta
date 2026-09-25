const parse=v=>{try{return JSON.parse(v||'{}');}catch{return {};}};
export function eventContext(db,actor,action,target,extra={}){
 const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),id=target?.split(':')[0];
 const person=uid=>{const u=one('SELECT id,name FROM users WHERE id=?',uid||'');return u?{...u,roles:all('SELECT role FROM user_roles WHERE user_id=?',uid).map(r=>r.role)}:null;};
 const course=cid=>{const c=one('SELECT id,title,group_code code,cohort,entity_kind kind,template_id templateId,lifecycle,published FROM courses WHERE id=?',cid||'');if(c?.templateId)c.templateTitle=one('SELECT title FROM courses WHERE id=?',c.templateId)?.title;return c;};
 let object=null,group=null,module=null,student=null,submission=null;
 const sub=one('SELECT s.*,a.course_id,a.module_id,a.config FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE s.id=?',id||'');
 if(sub){object={id:sub.activity_id,title:parse(sub.config).title,type:'activity'};group=course(sub.course_id);student=person(sub.student_id);const payload=parse(sub.payload);submission={id:sub.id,attempt:sub.attempt,state:sub.state,revision:sub.revision,files:(payload.files||[]).length,points:sub.points,published:!!sub.published};module=sub.module_id;}
 else{
  const activity=one('SELECT * FROM activities WHERE id=?',id||'');
  const resource=one('SELECT r.*,m.course_id FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?',id||'');
  const chapter=one('SELECT * FROM modules WHERE id=?',id||'');
  const quick=one('SELECT * FROM quick_resources WHERE id=?',id||'');
  const enrollment=one('SELECT * FROM enrollments WHERE id=?',id||'');
  if(activity){const cfg=parse(activity.config);object={id:activity.id,title:cfg.title,type:'activity',status:cfg.status,kind:cfg.kind,weight:cfg.weight,dueAt:cfg.dueAt,maxPoints:cfg.maxPoints,revision:activity.revision};group=course(activity.course_id);module=activity.module_id;if(action.startsWith('grade.'))student=person(target.split(':')[1]);}
  else if(resource){object={id:resource.id,title:resource.title,type:'resource',published:!!resource.published};group=course(resource.course_id);module=resource.module_id;}
  else if(chapter){object={id:chapter.id,title:chapter.title,type:'module',published:!!chapter.published};group=course(chapter.course_id);}
  else if(quick){object={id:quick.id,title:quick.title,type:'quick-resource'};group=course(quick.course_id);}
  else if(enrollment){student=person(enrollment.student_id);group=course(enrollment.course_id);object={id:enrollment.id,title:student?.name,type:'enrollment',status:enrollment.status,startsAt:enrollment.starts_at,expiresAt:enrollment.expires_at};if(action==='enrollment.move'){const h=one('SELECT details FROM enrollment_history WHERE enrollment_id=? ORDER BY created_at DESC LIMIT 1',id);const d=parse(h?.details);extra={...extra,destination:course(d.destination),reason:d.reason};}}
  else if(course(id)){group=course(id);object={id,title:group.title,type:'course',status:group.lifecycle,published:!!group.published};}
  else if(person(id))object={id,title:person(id).name,type:'user'};
 }
 if(typeof module==='string')module=one('SELECT id,title FROM modules WHERE id=?',module)||null;
 const memberships=actor?.id&&action.startsWith('auth.')?all(`SELECT DISTINCT c.id,c.title,c.group_code code,c.cohort FROM courses c WHERE c.entity_kind='group' AND (EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.student_id=? AND e.status='active' AND (e.starts_at IS NULL OR e.starts_at<=?) AND (e.expires_at IS NULL OR e.expires_at>?)) OR EXISTS(SELECT 1 FROM course_staff s WHERE s.course_id=c.id AND s.user_id=?))`,actor.id,new Date().toISOString(),new Date().toISOString(),actor.id):[];
 return {actor:person(actor?.id),object,group,module,student,submission,memberships,...extra};
}

export function setupPanorama(db){
 if(!db.prepare('PRAGMA table_info(learning_events)').all().some(c=>c.name==='context'))db.exec('ALTER TABLE learning_events ADD COLUMN context TEXT');
 if(!db.prepare('PRAGMA table_info(audit)').all().some(c=>c.name==='context')){
  db.exec('BEGIN IMMEDIATE');
  try{db.exec('ALTER TABLE audit ADD COLUMN context TEXT');
   for(const row of db.prepare('SELECT * FROM audit').all())db.prepare('UPDATE audit SET context=? WHERE id=?').run(JSON.stringify(eventContext(db,{id:row.actor_id},row.action,row.target_id,{reconstructed:true})),row.id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 db.exec(`CREATE INDEX IF NOT EXISTS audit_created ON audit(created_at,id);
 CREATE INDEX IF NOT EXISTS audit_actor ON audit(actor_id,created_at);
 CREATE INDEX IF NOT EXISTS audit_group ON audit(json_extract(context,'$.group.id'),created_at);
 CREATE INDEX IF NOT EXISTS learning_created ON learning_events(created_at,id);
 CREATE INDEX IF NOT EXISTS learning_course ON learning_events(course_id,created_at);`);
}

export function createPanorama({db,accessModel:a,fail,json}){
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p);
 const source=`WITH events AS (
  SELECT 'audit' source,id,actor_id,action,target_id,created_at,context,json_extract(context,'$.group.id') course_id,'{}' details FROM audit
  UNION ALL SELECT 'permission',id,actor_id,action,target_id,created_at,json_extract(details,'$.context'),json_extract(details,'$.courseId'),details FROM permission_audit
  UNION ALL SELECT 'learning',id,user_id,action,object_id,created_at,context,course_id,'{}' FROM learning_events WHERE action<>'lab.result'
 ), scoped AS (SELECT ev.*,u.name actor_name,CASE WHEN action LIKE 'auth.%' THEN 'access' WHEN action='submission.grade' THEN 'grades' WHEN action LIKE 'submission.%' THEN 'submissions' WHEN action LIKE 'grade%' THEN 'grades' WHEN source='permission' THEN 'permissions' WHEN source='learning' OR action LIKE 'resource.open%' OR action LIKE 'resource.complete%' OR action='resource.pending' OR action='lab.result' THEN 'learning' ELSE 'management' END category FROM events ev LEFT JOIN users u ON u.id=ev.actor_id)
 `;
 async function handler(req,res,path,method,auth){
  if(path!=='/api/platform/overview'||method!=='GET')return false;
  if(!a.staff(auth))fail(403,'Panorama requiere acceso docente o administrativo.');
  const q=new URL(req.url,'http://localhost').searchParams,global=a.global(auth),courses=all('SELECT id,title,entity_kind kind,group_code code,cohort,template_id templateId FROM courses ORDER BY title,cohort,group_code').filter(c=>a.p.can(auth.user.id,c.id));
  const permitted=courses.map(c=>c.id),group=q.get('group'),template=q.get('template'),clauses=[],params=[];
  const sqlIds=ids=>ids.length?ids.map(()=>'?').join(','):'NULL';
  // Group-less login events are matched by recorded membership, never labelled as a group visit.
  function scope(ids){clauses.push(`(course_id IN (${sqlIds(ids)}) OR (action LIKE 'auth.%' AND EXISTS(SELECT 1 FROM json_each(json_extract(context,'$.memberships')) j WHERE json_extract(j.value,'$.id') IN (${sqlIds(ids)}))))`);params.push(...ids,...ids);}
  if(!global){scope(permitted);const graded=permitted.filter(id=>a.p.can(auth.user.id,id,'grade'));clauses.push(`(category NOT IN ('grades','submissions') OR course_id IN (${sqlIds(graded)}))`);params.push(...graded);}
  if(group){if(!permitted.includes(group))fail(403,'Grupo fuera de tu alcance.');scope([group]);}
  if(template){if(!permitted.includes(template))fail(403,'Curso fuera de tu alcance.');scope(courses.filter(c=>c.id===template||c.templateId===template).map(c=>c.id));}
  if(q.get('person')){clauses.push("(actor_id=? OR json_extract(context,'$.student.id')=? OR (json_extract(context,'$.object.type')='user' AND target_id=?))");params.push(q.get('person'),q.get('person'),q.get('person'));}
  const category=q.get('category');if(category){if(!['access','submissions','grades','permissions','learning','management'].includes(category))fail(400,'Tipo de registro no válido.');clauses.push('category=?');params.push(category);}
  for(const [key,op] of [['from','>='],['to','<=']])if(q.get(key)){const v=q.get(key);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail(400,'Fecha no válida.');clauses.push(`created_at${op}?`);params.push(new Date(v+(key==='from'?'T00:00:00.000-05:00':'T23:59:59.999-05:00')).toISOString());}
  if(q.get('from')&&q.get('to')&&q.get('from')>q.get('to'))fail(400,'La fecha inicial debe ser anterior a la final.');
  if(q.get('search')){const term='%'+q.get('search').trim().slice(0,160).replace(/[\\%_]/g,'\\$&')+'%';clauses.push("(actor_name LIKE ? ESCAPE '\\' OR json_extract(context,'$.object.title') LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR json_extract(context,'$.student.name') LIKE ? ESCAPE '\\')");params.push(term,term,term,term);}
  const filtered=source+'SELECT * FROM scoped'+(clauses.length?' WHERE '+clauses.join(' AND '):''),total=one(`SELECT count(*) n FROM (${filtered})`,...params).n;
  const pages=Math.max(1,Math.ceil(total/50)),page=Math.min(pages,Math.max(1,Math.floor(Number(q.get('page'))||1)));
  const events=all(filtered+' ORDER BY created_at DESC,source DESC,id DESC LIMIT 50 OFFSET ?',...params,(page-1)*50).map(v=>{
   const c=v.context?parse(v.context):eventContext(db,{id:v.actor_id},v.action,v.target_id,{reconstructed:true});
   if(!c.group&&v.course_id)c.group=one('SELECT id,title,group_code code,cohort,entity_kind kind,template_id templateId,lifecycle,published FROM courses WHERE id=?',v.course_id)||null;
   if(!global)c.memberships=(c.memberships||[]).filter(g=>permitted.includes(g.id));
   const details=parse(v.details);
   return {id:v.source+'-'+v.id,source:v.source,action:v.action,category:v.category,createdAt:v.created_at,actor_name:c.actor?.name||v.actor_name||'Sistema',target_name:c.object?.title||'',actor:c.actor||{id:v.actor_id,name:v.actor_name||'Sistema',roles:[]},context:c,details:v.source==='permission'?details:{}};
  });
  const stats=all(`SELECT category,count(*) count FROM (${filtered}) GROUP BY category`,...params);
  const byGroup=all(`SELECT course_id,count(*) count FROM (${filtered}) WHERE course_id IS NOT NULL GROUP BY course_id ORDER BY count DESC LIMIT 12`,...params).map(v=>({...v,group:courses.find(c=>c.id===v.course_id)||events.find(e=>e.context.group?.id===v.course_id)?.context.group})).filter(v=>v.group);
  const people=all('SELECT id,name FROM users ORDER BY name').filter(u=>global||all('SELECT course_id FROM enrollments WHERE student_id=? UNION SELECT course_id FROM course_staff WHERE user_id=?',u.id,u.id).some(r=>permitted.includes(r.course_id)));
  json(res,{events,total,page,pages,stats,byGroup,people,courses,scope:global?'global':'assigned',updatedAt:new Date().toISOString(),timezone:'America/Bogota'});return true;
 }
 return {handler};
}
