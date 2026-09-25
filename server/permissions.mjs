const validRoles=new Set(['master','admin','teacher','student']);
const permissions={edit:'can_edit',grade:'can_grade',manage:'can_manage'};
export class PermissionError extends Error{constructor(message,status=403){super(message);this.status=status;this.code='PERMISSION_DENIED';}}
export function createPermissions(db){
 const all=(sql,...args)=>db.prepare(sql).all(...args),one=(sql,...args)=>db.prepare(sql).get(...args);
 const roles=id=>all('SELECT role FROM user_roles WHERE user_id=? ORDER BY role',id).map(r=>r.role);
 const active=id=>Boolean(one("SELECT id FROM users WHERE id=? AND active=1 AND account_status='active'",id));
 const global=id=>active(id)&&roles(id).some(r=>r==='master'||r==='admin');
 const staff=id=>active(id)&&roles(id).some(r=>['master','admin','teacher'].includes(r));
 function can(id,courseId,action='view'){
  if(!active(id)||!one('SELECT id FROM courses WHERE id=?',courseId))return false;
  if(global(id))return true;
  if(!roles(id).includes('teacher'))return false;
  const row=one('SELECT * FROM course_staff WHERE user_id=? AND course_id=?',id,courseId);
  return Boolean(row&&(action==='view'||(permissions[action]&&row[permissions[action]])));
 }
 const assert=(condition,message)=>{if(!condition)throw new PermissionError(message);};
 function log(actor,action,target,details){db.prepare('INSERT INTO permission_audit(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)').run(actor,action,target,JSON.stringify(details),new Date().toISOString());}
 function atomic(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
 function protectLastMaster(target,nextRoles,nextStatus){
  if(roles(target).includes('master')&&active(target)&&(!nextRoles.includes('master')||nextStatus!=='active'))assert(Boolean(one("SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='master' AND u.id<>? AND u.active=1 AND u.account_status='active'",target)),'No puedes retirar ni suspender la última cuenta máster activa.');
 }
 function setRoles(actor,target,next){return atomic(()=>{
  assert(global(actor),'Solo administración puede modificar roles.');
  assert(one('SELECT id FROM users WHERE id=?',target),'Cuenta no encontrada.');
  assert(Array.isArray(next)&&next.length>0&&new Set(next).size===next.length&&next.every(r=>validRoles.has(r)),'Selecciona roles válidos.');
  const previous=roles(target),masterChange=previous.includes('master')!==next.includes('master');
  assert(!masterChange||roles(actor).includes('master'),'Solo el máster puede conceder o retirar ese rol.');
  protectLastMaster(target,next,one('SELECT account_status FROM users WHERE id=?',target).account_status);
  db.prepare('DELETE FROM user_roles WHERE user_id=?').run(target);
  for(const role of next)db.prepare('INSERT INTO user_roles VALUES(?,?)').run(target,role);
  // Legacy column remains for compatibility with older backups, never authority.
  db.prepare('UPDATE users SET role=?,updated_at=? WHERE id=?').run(next.some(r=>r==='master'||r==='admin')?'admin':'student',new Date().toISOString(),target);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(target);
  log(actor,'roles.change',target,{before:previous,after:next});return next;
 });}
 function setStatus(actor,target,status){return atomic(()=>{
  assert(global(actor),'Solo administración puede cambiar el estado de una cuenta.');
  assert(['active','suspended','deactivated'].includes(status),'Estado no válido.');
  const user=one('SELECT * FROM users WHERE id=?',target);assert(user,'Cuenta no encontrada.');
  assert(!roles(target).includes('master')||roles(actor).includes('master'),'Solo el máster puede cambiar el estado de otra cuenta máster.');
  protectLastMaster(target,roles(target),status);
  db.prepare('UPDATE users SET account_status=?,active=?,updated_at=? WHERE id=?').run(status,Number(status==='active'),new Date().toISOString(),target);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(target);log(actor,'account.status',target,{before:user.account_status,after:status});return status;
 });}
 function assign(actor,courseId,target,rights){return atomic(()=>{
  assert(can(actor,courseId,'manage'),'No puedes gestionar colaboradores de este curso o grupo.');
  assert(active(target)&&roles(target).some(r=>['teacher','admin','master'].includes(r)),'El colaborador debe tener un perfil docente o administrativo activo.');
  assert(rights&&Object.keys(permissions).every(k=>typeof rights[k]==='boolean'),'Define los permisos de edición, calificación y gestión.');
  assert(global(actor)||Object.keys(permissions).every(k=>!rights[k]||can(actor,courseId,k)),'No puedes conceder permisos que tú no tienes.');
  db.prepare('INSERT INTO course_staff VALUES(?,?,?,?,?) ON CONFLICT(course_id,user_id) DO UPDATE SET can_edit=excluded.can_edit,can_grade=excluded.can_grade,can_manage=excluded.can_manage').run(courseId,target,Number(rights.edit),Number(rights.grade),Number(rights.manage));
  log(actor,'collaborator.permissions',target,{courseId,...rights});return rights;
 });}
 return {roles,active,global,staff,can,setRoles,setStatus,assign};
}
export function setupPermissionAudit(db){db.exec(`CREATE TABLE IF NOT EXISTS permission_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);`);}
