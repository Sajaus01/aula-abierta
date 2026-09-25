import {randomUUID} from 'node:crypto';
import {cloneCourse} from './course-model.mjs';

export function createPlatform(ctx){
 const {db,accessModel:a,fail,json,readJson,readSession,uploadsDir,addStudent,activation,hashPassword,token,audit,courseView,string,webUrl}=ctx;
 const all=(sql,...p)=>db.prepare(sql).all(...p),one=(sql,...p)=>db.prepare(sql).get(...p),run=(sql,...p)=>db.prepare(sql).run(...p),now=()=>new Date().toISOString();
 const clean=u=>({id:u.id,name:u.name,document:u.document,email:u.email,roles:a.p.roles(u.id),accountStatus:u.account_status,active:Boolean(u.active),mustChangePassword:Boolean(u.must_change_password)});
 const transactions=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/platform/'))return false;
  const send=(data,status)=>{json(res,data,status);return true;};
  const staff=()=>{if(!a.staff(auth))fail(403,'Se requiere acceso docente.');};
  const body=async()=>{const b=await readJson(req);auth=readSession(req);return b;};let m;
  if(path==='/api/platform/users'){
   a.requireGlobal(auth);
   if(method==='GET')return send(all('SELECT * FROM users ORDER BY name').map(clean));
   if(method==='POST'){const b=await body();a.requireGlobal(auth);if(!Array.isArray(b.roles)||!b.roles.length||b.roles.some(r=>!['master','admin','teacher','student'].includes(r)))fail(400,'Selecciona roles válidos.');if(b.roles.includes('master')&&!a.p.roles(auth.user.id).includes('master'))fail(403,'Solo el máster puede conceder ese rol.');const student=await addStudent(b);a.p.setRoles(auth.user.id,student.id,b.roles);audit(auth.user,'user.create',student.id);return send(clean(one('SELECT * FROM users WHERE id=?',student.id)),201);}
  }
  m=/^\/api\/platform\/users\/([^/]+)(?:\/(roles|status|recover))?$/.exec(path);
  if(m){const [,id,action]=m;staff();const user=one('SELECT * FROM users WHERE id=?',id);if(!user)fail(404,'Cuenta no encontrada.');
   if(!action&&method==='GET'){
    const related=all('SELECT e.*,c.title,c.cohort,c.group_code FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=?',id).filter(e=>a.p.can(auth.user.id,e.course_id,'view'));
    if(!a.global(auth)&&!related.length)fail(403,'Este perfil no pertenece a tus grupos.');
    return send({...clean(user),enrollments:related,courses:all('SELECT c.*,s.can_edit,s.can_grade,s.can_manage FROM course_staff s JOIN courses c ON c.id=s.course_id WHERE s.user_id=?',id).filter(c=>a.p.can(auth.user.id,c.id,'view')).map(c=>({id:c.id,title:c.title,entityKind:c.entity_kind,cohort:c.cohort,code:c.group_code,edit:!!c.can_edit,grade:!!c.can_grade,manage:!!c.can_manage}))});
   }
   if(method==='POST'){const b=await body();a.requireGlobal(auth);
    if(action==='roles')return send({roles:a.p.setRoles(auth.user.id,id,b.roles)});
    if(action==='status')return send({status:a.p.setStatus(auth.user.id,id,b.status)});
    if(action==='recover'){
     if(a.p.roles(id).includes('master')&&!a.p.roles(auth.user.id).includes('master'))fail(403,'Solo un máster puede recuperar otra cuenta máster.');
     if(!user.active)fail(400,'Activa la cuenta antes de recuperar el acceso.');
     const replacementHash=await hashPassword(token());auth=readSession(req);a.requireGlobal(auth);run('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?',replacementHash,id);run('DELETE FROM sessions WHERE user_id=?',id);audit(auth.user,'user.recovery',id);return send(activation(id));
    }
   }
  }
  if(path==='/api/platform/collaborators'&&method==='GET'){staff();return send(all("SELECT DISTINCT u.id,u.name FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active=1 AND r.role IN ('master','admin','teacher') ORDER BY u.name"));}
  m=/^\/api\/platform\/courses\/([^/]+)\/(clone|staff|state|appearance|groups)$/.exec(path);
  if(m){const [,id,action]=m;staff();a.requireScope(auth,id,action==='groups'?'view':action==='appearance'?'edit':'manage');
   if(action==='groups'&&method==='GET')return send(all("SELECT * FROM courses WHERE template_id=? AND entity_kind='group'",id).filter(c=>a.p.can(auth.user.id,c.id,'view')).map(c=>courseView(c,auth)));
   if(action==='staff'&&method==='GET')return send(all('SELECT s.*,u.name FROM course_staff s JOIN users u ON u.id=s.user_id WHERE s.course_id=?',id));
   if(method==='POST'){
    const b=await body();a.requireScope(auth,id,action==='appearance'?'edit':'manage');
    if(action==='clone'){
     const title=string(b.title,'el título',200,true),cohort=string(b.cohort,'el semestre',60),code=string(b.code,'el código',60);
     let next;try{next=cloneCourse(db,uploadsDir,id,{kind:b.kind,title,cohort,code,actorId:auth.user.id});}catch(e){if(e.code?.startsWith('ERR_SQLITE')||/UNIQUE/.test(e.message))fail(409,'Ya existe ese grupo en el semestre.');fail(400,e.message);}
     audit(auth.user,'course.clone',next);return send(courseView(one('SELECT * FROM courses WHERE id=?',next),auth,true),201);
    }
    if(action==='staff')return send(a.p.assign(auth.user.id,id,b.userId,b));
    if(action==='state'){
     if(!['draft','active','archived'].includes(b.state))fail(400,'Estado no válido.');
     run('UPDATE courses SET lifecycle=?,published=?,updated_at=? WHERE id=?',b.state,Number(b.state==='active'),now(),id);audit(auth.user,'course.'+b.state,id);return send({success:true});
    }
    if(action==='appearance'){
     const color=String(b.color||'#315b4b');if(!/^#[\da-f]{6}$/i.test(color))fail(400,'Color no válido.');
     const rgb=color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
     if(1.05/(luminance+.05)<4.5)fail(400,'Selecciona un color más oscuro para conservar contraste con el texto blanco.');
     if(!['system','serif','mono'].includes(b.font)||!Number.isInteger(b.fontSize)||b.fontSize<16||b.fontSize>22)fail(400,'Tipografía o tamaño no válido.');
     const appearance={color,font:b.font,fontSize:b.fontSize,background:webUrl(b.background)};
     run('UPDATE courses SET appearance=?,cover_url=?,updated_at=? WHERE id=?',JSON.stringify(appearance),webUrl(b.coverUrl),now(),id);audit(auth.user,'course.appearance',id);return send(appearance);
    }
   }
  }
  m=/^\/api\/platform\/enrollments\/([^/]+)\/move$/.exec(path);
  if(m&&method==='POST'){
   const b=await body(),old=one('SELECT * FROM enrollments WHERE id=?',m[1]);if(!old)fail(404,'Matrícula no encontrada.');a.requireScope(auth,old.course_id,'manage');a.requireScope(auth,b.groupId,'manage');a.group(b.groupId);if(old.course_id===b.groupId)fail(400,'Selecciona otro grupo.');
   const result=transactions(()=>{run("UPDATE enrollments SET status='revoked' WHERE id=?",old.id);let target=one('SELECT id FROM enrollments WHERE student_id=? AND course_id=?',old.student_id,b.groupId);if(target)run("UPDATE enrollments SET status='active',starts_at=NULL,expires_at=NULL WHERE id=?",target.id);else{target={id:randomUUID()};run("INSERT INTO enrollments(id,student_id,course_id,status,created_at) VALUES(?,?,?,'active',?)",target.id,old.student_id,b.groupId,now());}
    run('INSERT INTO enrollment_history VALUES(?,?,?,?,?,?,?,?)',randomUUID(),old.id,old.student_id,old.course_id,'move',auth.user.id,JSON.stringify({destination:b.groupId,enrollmentId:target.id,reason:string(b.reason,'el motivo',1000,true)}),now());audit(auth.user,'enrollment.move',old.id);return target;});return send(result);
  }
  if(path==='/api/platform/migration'&&method==='GET'){a.requireGlobal(auth);return send(all('SELECT template_id,group_id,report FROM legacy_course_groups').map(r=>JSON.parse(r.report)));}
  fail(404,'Función de gestión no encontrada.');
 }
 return {handler};
}
