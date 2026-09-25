import {randomUUID} from 'node:crypto';
import {copyFileSync,unlinkSync,statSync,statfsSync} from 'node:fs';
import {join,basename,extname} from 'node:path';
import {setupPermissionAudit} from './permissions.mjs';

const now=()=>new Date().toISOString();
const ident=s=>'"'+s.replaceAll('"','""')+'"';
function insert(db,table,row){const keys=Object.keys(row);db.prepare(`INSERT INTO ${ident(table)} (${keys.map(ident)}) VALUES (${keys.map(()=>'?')})`).run(...keys.map(k=>row[k]));}
function add(db,table,name,definition){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);}

// Called inside the upgrade transaction, never automatically by a read request.
export function setupCourseModel(db){
 setupPermissionAudit(db);
 add(db,'courses','entity_kind',"TEXT NOT NULL DEFAULT 'legacy' CHECK(entity_kind IN ('legacy','template','group'))");
 add(db,'courses','template_id','TEXT REFERENCES courses(id) ON DELETE RESTRICT');
 add(db,'courses','cohort',"TEXT NOT NULL DEFAULT ''");
 add(db,'courses','group_code',"TEXT NOT NULL DEFAULT ''");
 add(db,'courses','lifecycle',"TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle IN ('draft','active','archived'))");
 add(db,'resources','lab_results',"TEXT NOT NULL DEFAULT 'optional' CHECK(lab_results IN ('disabled','optional','required'))");
 add(db,'courses','appearance',"TEXT NOT NULL DEFAULT '{}'");
 add(db,'users','account_status',"TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','suspended','deactivated'))");
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS groups_identity ON courses(template_id,cohort,group_code) WHERE entity_kind='group';
 CREATE TABLE IF NOT EXISTS user_roles(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('master','admin','teacher','student')),PRIMARY KEY(user_id,role));
 CREATE TABLE IF NOT EXISTS course_staff(course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,can_edit INTEGER NOT NULL DEFAULT 0 CHECK(can_edit IN (0,1)),can_grade INTEGER NOT NULL DEFAULT 0 CHECK(can_grade IN (0,1)),can_manage INTEGER NOT NULL DEFAULT 0 CHECK(can_manage IN (0,1)),PRIMARY KEY(course_id,user_id));
 CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL,report TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS legacy_course_groups(template_id TEXT PRIMARY KEY REFERENCES courses(id),group_id TEXT NOT NULL UNIQUE REFERENCES courses(id),report TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS enrollment_history(id TEXT PRIMARY KEY,enrollment_id TEXT NOT NULL,student_id TEXT NOT NULL,course_id TEXT NOT NULL,action TEXT NOT NULL,actor_id TEXT,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS new_user_role AFTER INSERT ON users BEGIN INSERT OR IGNORE INTO user_roles(user_id,role) VALUES(NEW.id,NEW.role); END;
 CREATE TRIGGER IF NOT EXISTS enroll_group_insert BEFORE INSERT ON enrollments WHEN (SELECT entity_kind FROM courses WHERE id=NEW.course_id)='template' BEGIN SELECT RAISE(ABORT,'Las matrículas requieren un grupo'); END;
 CREATE TRIGGER IF NOT EXISTS enroll_group_update BEFORE UPDATE OF course_id ON enrollments WHEN (SELECT entity_kind FROM courses WHERE id=NEW.course_id)='template' BEGIN SELECT RAISE(ABORT,'Las matrículas requieren un grupo'); END;`);
}

export function courseInventory(db,id){
 const scalar=(sql)=>db.prepare(sql).get(id).n;
 return {students:scalar('SELECT count(DISTINCT student_id) n FROM enrollments WHERE course_id=?'),enrollments:scalar('SELECT count(*) n FROM enrollments WHERE course_id=?'),modules:scalar('SELECT count(*) n FROM modules WHERE course_id=?'),resources:scalar('SELECT count(*) n FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=?'),progress:scalar('SELECT count(*) n FROM progress p JOIN resources r ON r.id=p.resource_id JOIN modules m ON m.id=r.module_id WHERE m.course_id=?'),submissions:scalar('SELECT count(*) n FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id=?'),graded:scalar('SELECT count(*) n FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id=? AND s.points IS NOT NULL'),activities:scalar('SELECT count(*) n FROM activities WHERE course_id=?'),quickResources:scalar('SELECT count(*) n FROM quick_resources WHERE course_id=?')};
}

// Caller owns the DB transaction and cleans only newly-created files on rollback.
export function copyCourseContent(db,uploadsDir,sourceId,destinationId,createdFiles=[]){
 const all=(sql,...p)=>db.prepare(sql).all(...p),map=new Map();
 const duplicateFile=key=>{if(!key)return key;if(key!==basename(key)||/[\\/\x00]/.test(key))throw Error('Ruta de archivo inválida');const source=join(uploadsDir,key),disk=statfsSync(uploadsDir);if(disk.bavail*disk.bsize<statSync(source).size+67108864)throw Error('Espacio insuficiente para copiar contenidos');const next=randomUUID()+extname(key);copyFileSync(source,join(uploadsDir,next),1);createdFiles.push(next);return next;};
 for(const row of all('SELECT * FROM modules WHERE course_id=?',sourceId)){const id=randomUUID();map.set(row.id,id);insert(db,'modules',{...row,id,course_id:destinationId});}
 for(const row of all('SELECT r.* FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=?',sourceId))insert(db,'resources',{...row,id:randomUUID(),module_id:map.get(row.module_id),file_key:duplicateFile(row.file_key)});
 for(const row of all('SELECT * FROM activities WHERE course_id=?',sourceId)){
  const id=randomUUID();insert(db,'activities',{...row,id,course_id:destinationId,module_id:row.module_id?map.get(row.module_id):null,version:1,revision:1});
  for(const file of all('SELECT * FROM activity_files WHERE activity_id=?',row.id))insert(db,'activity_files',{...file,id:randomUUID(),activity_id:id,file_key:duplicateFile(file.file_key)});
 }
 for(const row of all('SELECT * FROM quick_resources WHERE course_id=?',sourceId))insert(db,'quick_resources',{...row,id:randomUUID(),course_id:destinationId,file_key:duplicateFile(row.file_key),version:1});
 for(const row of all('SELECT * FROM grading_settings WHERE course_id=?',sourceId)){const config=JSON.parse(row.config);config.finalPublished=false;insert(db,'grading_settings',{...row,course_id:destinationId,config:JSON.stringify(config)});}
 for(const row of all('SELECT * FROM course_staff WHERE course_id=?',sourceId))insert(db,'course_staff',{...row,course_id:destinationId});
}

export function cloneCourse(db,uploadsDir,sourceId,{kind='group',title,cohort='',code='',actorId}){
 if(!['group','template'].includes(kind))throw Error('Tipo de copia inválido');
 const files=[];db.exec('BEGIN IMMEDIATE');
 try{
  const source=db.prepare('SELECT * FROM courses WHERE id=?').get(sourceId);if(!source||source.entity_kind==='legacy')throw Error('Curso no disponible');
  if(kind==='group'&&(!cohort.trim()||!code.trim()))throw Error('Indica semestre y código de grupo');
  const id=randomUUID();insert(db,'courses',{...source,id,title:title?.trim()||source.title,entity_kind:kind,template_id:kind==='group'?(source.template_id||source.id):null,cohort:kind==='group'?cohort.trim():'',group_code:kind==='group'?code.trim():'',lifecycle:'draft',published:0,created_at:now(),updated_at:now()});
  copyCourseContent(db,uploadsDir,sourceId,id,files);
  if(actorId)db.prepare('INSERT INTO course_staff VALUES(?,?,1,1,1) ON CONFLICT(course_id,user_id) DO UPDATE SET can_edit=1,can_grade=1,can_manage=1').run(id,actorId);
  db.exec('COMMIT');return id;
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');for(const file of files)unlinkSync(join(uploadsDir,file));throw e;}
}

export function migrateCourseGroups(db,uploadsDir,{masterId}={}){
 const applied=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
 if(applied){const done=db.prepare("SELECT report FROM schema_migrations WHERE name='course-groups-v1'").get();if(done)return {...JSON.parse(done.report),alreadyApplied:true};}
 const admins=db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all();
 if(!masterId&&admins.length===1)masterId=admins[0].id;
 if(!masterId||!admins.some(u=>u.id===masterId))throw Error('Identifica la cuenta administradora actual que será máster antes de migrar.');
 const files=[];db.exec('BEGIN IMMEDIATE');
 try{
  setupCourseModel(db);
  db.exec("INSERT OR IGNORE INTO user_roles SELECT id,role FROM users; UPDATE users SET account_status=CASE WHEN active=1 THEN 'active' ELSE 'deactivated' END");
  db.prepare("INSERT OR IGNORE INTO user_roles VALUES(?,'master')").run(masterId);
  db.prepare('INSERT INTO permission_audit(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)').run(masterId,'roles.migrate',masterId,JSON.stringify({before:['admin'],after:['admin','master']}),now());
  const report={version:1,createdAt:now(),masterId,courses:[]};
  for(const course of db.prepare("SELECT * FROM courses WHERE entity_kind='legacy' ORDER BY id").all()){
   const before=courseInventory(db,course.id);
   const existing=db.prepare("SELECT * FROM courses WHERE template_id=? AND cohort='2026-1' AND group_code='2026-1'").get(course.id);
   const groupId=existing?.id||randomUUID(),existingBefore=existing?courseInventory(db,groupId):null;
   const answersBefore=db.prepare('SELECT * FROM submissions ORDER BY id').all(),progressBefore=db.prepare('SELECT * FROM progress ORDER BY user_id,resource_id').all();
   if(!existing)insert(db,'courses',{...course,id:groupId,entity_kind:'group',template_id:course.id,cohort:'2026-1',group_code:'2026-1',lifecycle:course.published?'active':'draft'});
   // Reconcile enrollments without duplicating accounts or losing their previous access record.
   for(const row of db.prepare('SELECT * FROM enrollments WHERE course_id=?').all(course.id)){
    const previous=db.prepare('SELECT * FROM enrollments WHERE course_id=? AND student_id=?').get(groupId,row.student_id);
    if(previous){insert(db,'enrollment_history',{id:randomUUID(),enrollment_id:previous.id,student_id:row.student_id,course_id:groupId,action:'migration.reconcile',actor_id:masterId,details:JSON.stringify({source:row,destination:previous}),created_at:now()});db.prepare('DELETE FROM enrollments WHERE id=?').run(row.id);}
   }
   // Two different grading schemes cannot be silently replaced. Preserve the group's
   // independent configuration; the original template retains its own scheme.
   const sourceSettings=db.prepare('SELECT * FROM grading_settings WHERE course_id=?').get(course.id),targetSettings=db.prepare('SELECT * FROM grading_settings WHERE course_id=?').get(groupId);
   if(sourceSettings&&targetSettings&&sourceSettings.config!==targetSettings.config)throw Error('El grupo 2026-1 ya existe con otro esquema de notas. Revisa qué esquema conservar antes de conciliar: '+course.id);
   if(sourceSettings&&targetSettings)db.prepare('DELETE FROM grading_settings WHERE course_id=?').run(course.id);
   for(const row of db.prepare('SELECT * FROM course_staff WHERE course_id=?').all(course.id)){db.prepare('INSERT INTO course_staff VALUES(?,?,?,?,?) ON CONFLICT(course_id,user_id) DO UPDATE SET can_edit=max(can_edit,excluded.can_edit),can_grade=max(can_grade,excluded.can_grade),can_manage=max(can_manage,excluded.can_manage)').run(groupId,row.user_id,row.can_edit,row.can_grade,row.can_manage);}
   db.prepare('DELETE FROM course_staff WHERE course_id=?').run(course.id);
   for(const table of ['modules','activities','enrollments','grading_settings','quick_resources'])db.prepare(`UPDATE ${table} SET course_id=? WHERE course_id=?`).run(groupId,course.id);
   if(JSON.stringify(answersBefore)!==JSON.stringify(db.prepare('SELECT * FROM submissions ORDER BY id').all())||JSON.stringify(progressBefore)!==JSON.stringify(db.prepare('SELECT * FROM progress ORDER BY user_id,resource_id').all()))throw Error('La conciliación alteró resultados históricos');
   db.prepare('INSERT OR IGNORE INTO course_staff VALUES(?,?,1,1,1)').run(groupId,masterId);
   copyCourseContent(db,uploadsDir,groupId,course.id,files);
   db.prepare("UPDATE courses SET entity_kind='template',lifecycle=CASE WHEN published=1 THEN 'active' ELSE 'draft' END WHERE id=?").run(course.id);
   const after=courseInventory(db,groupId);if(!existing&&JSON.stringify(before)!==JSON.stringify(after))throw Error('La integridad del grupo no coincide con el curso: '+course.id);
   const item={templateId:course.id,groupId,title:course.title,before,after,existingBefore,reusedExistingGroup:!!existing,verified:true};
   insert(db,'legacy_course_groups',{template_id:course.id,group_id:groupId,report:JSON.stringify(item)});report.courses.push(item);
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('La migración produjo relaciones inválidas');
  insert(db,'schema_migrations',{name:'course-groups-v1',applied_at:now(),report:JSON.stringify(report)});
  db.prepare('INSERT INTO audit(actor_id,action,target_id,created_at) VALUES (?,?,?,?)').run(masterId,'migration.course-groups-v1',masterId,now());
  db.exec('COMMIT');return report;
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');for(const file of files)unlinkSync(join(uploadsDir,file));throw e;}
}
