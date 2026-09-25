import {createPermissions} from './permissions.mjs';

// The legacy UI uses admin/student for layout. Authority comes exclusively from
// canonical roles and course_staff; the compatibility label grants no scope.
export function createAccessModel(db,fail){
 const p=createPermissions(db),one=(sql,...v)=>db.prepare(sql).get(...v);
 const staff=a=>Boolean(a?.assurance==='password'&&!a.preview&&p.staff(a.user.id));
 const global=a=>Boolean(a?.assurance==='password'&&!a.preview&&p.global(a.user.id));
 function decorate(user){if(!user)return user;const roles=p.roles(user.id);return {...user,roles,primaryRole:['master','admin','teacher','student'].find(r=>roles.includes(r)),role:roles.some(r=>r!=='student')?'admin':'student'};}
 function requireScope(a,id,action='view'){if(!staff(a)||!p.can(a.user.id,id,action))fail(403,'No tienes permiso para esta acción en el curso o grupo.','SCOPE_REQUIRED');}
 function requireGlobal(a){if(!global(a))fail(403,'Se requiere una cuenta máster o administrativa.','ADMIN_REQUIRED');}
 function group(id){const c=one('SELECT * FROM courses WHERE id=?',id);if(!c)fail(404,'Grupo no encontrado.');if(c.entity_kind!=='group')fail(400,'Matricula estudiantes en un grupo, no en la plantilla.');return c;}
 function resolve(type,id){if(type==='courses')return id;
  const sql={modules:'SELECT course_id FROM modules WHERE id=?',resources:'SELECT m.course_id FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?',enrollments:'SELECT course_id FROM enrollments WHERE id=?','quick-resources':'SELECT course_id FROM quick_resources WHERE id=?',activities:'SELECT course_id FROM activities WHERE id=?',submissions:'SELECT a.course_id FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE s.id=?'}[type];
  const row=sql&&one(sql,id);if(!row)fail(404,'Registro no encontrado.');return row.course_id;
 }
 function authorize(req,auth,body){const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),method=req.method;
  if(path.startsWith('/api/admin/')){
   if(!staff(auth))fail(403,'Se requiere acceso docente o administrativo.','ADMIN_REQUIRED');
   if(/^\/api\/admin\/(settings|migration|audit|students)(?:\/|$)/.test(path)){
    if(path==='/api/admin/students'&&method==='GET')return;
    requireGlobal(auth);return;
   }
   if(path==='/api/admin/courses'&&['GET','POST'].includes(method))return;
   if(path==='/api/admin/enrollments'){
    if(method==='GET')return;
    if(method==='POST'&&body){group(body.courseId);requireScope(auth,body.courseId,'manage');}return;
   }
   const m=/^\/api\/admin\/(courses|modules|resources|enrollments|quick-resources)\/([^/]+)(.*)$/.exec(path);
   if(!m){requireGlobal(auth);return;}
   const id=resolve(m[1],m[2]),action=method==='GET'?'view':m[1]==='enrollments'||m[3].includes('/enrollments')?'manage':m[1]==='courses'&&method==='DELETE'?'manage':'edit';
   requireScope(auth,id,action);if(m[1]==='enrollments'||m[3].includes('/enrollments'))group(id);return;
  }
  if(path.startsWith('/api/academics/')&&staff(auth)){
   if(path==='/api/academics/courses'||path==='/api/academics/storage')return;
   const m=/^\/api\/academics\/(courses|activities|submissions)\/([^/]+)(.*)$/.exec(path);if(!m)fail(403,'Ruta académica no autorizada.');
   const id=resolve(m[1],m[2]);let action='view';
   if(m[1]==='submissions'||/\/(gradebook|release|settings|submissions)$/.test(m[3]))action='grade';
   else if(!['GET','HEAD'].includes(method))action='edit';
   requireScope(auth,id,action);
  }
 }
 return {p,staff,global,decorate,requireScope,requireGlobal,group,resolve,authorize};
}
