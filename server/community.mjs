import {createHash} from 'node:crypto';

export const PRESENCE_TTL = 90_000;
export function setupCommunity(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
  photo BLOB, photo_mime TEXT, photo_version TEXT, updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS presence (
  session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  tab_id TEXT NOT NULL, course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  seen_at TEXT NOT NULL, PRIMARY KEY(session_hash,tab_id)
 );
 CREATE INDEX IF NOT EXISTS presence_seen ON presence(seen_at);
 CREATE INDEX IF NOT EXISTS presence_course ON presence(course_id,seen_at);`);
}

// Small raster avatars only. The browser resizes/re-encodes photographs before upload.
export function decodeAvatar(value,fail) {
 if(typeof value!=='string'||value.length>360_000)fail(400,'La foto debe pesar menos de 256 KB.');
 const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!m)fail(400,'Usa una imagen PNG o JPG.');
 const bytes=Buffer.from(m[2],'base64');
 if(bytes.length>256*1024||bytes.length<24||bytes.toString('base64')!==m[2])fail(400,'Imagen no válida o demasiado grande.');
 let width=0,height=0;
 if(m[1]==='png'){
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR'||!bytes.includes(Buffer.from('IEND')))fail(400,'PNG no válido.');
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
 }else{
  if(bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)fail(400,'JPG no válido.');
  for(let i=2;i+8<bytes.length;){if(bytes[i]!==255)break;const marker=bytes[i+1];if(marker===0xda||marker===0xd9)break;const size=bytes.readUInt16BE(i+2);if(size<2||i+2+size>bytes.length)break;if([0xc0,0xc1,0xc2].includes(marker)){height=bytes.readUInt16BE(i+5);width=bytes.readUInt16BE(i+7);break;}i+=2+size;}
 }
 if(!width||!height||width>2048||height>2048)fail(400,'La imagen debe medir entre 1 y 2048 píxeles por lado.');
 return {bytes,mime:'image/'+m[1],version:createHash('sha256').update(bytes).digest('hex').slice(0,16)};
}

export function createCommunity({db,accessModel:a,fail,json,readJson,readSession,requireCourse,isEnrolled,audit,clock=Date.now}) {
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 const now=()=>new Date(clock()).toISOString(),cutoff=()=>new Date(clock()-PRESENCE_TTL).toISOString();
 const membership=`(EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role IN ('master','admin')) OR (EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='teacher') AND EXISTS(SELECT 1 FROM course_staff s WHERE s.user_id=u.id AND s.course_id=c.id)) OR (c.lifecycle='active' AND c.published=1 AND EXISTS(SELECT 1 FROM enrollments e WHERE e.student_id=u.id AND e.course_id=c.id AND e.status='active' AND (e.starts_at IS NULL OR e.starts_at<=?) AND (e.expires_at IS NULL OR e.expires_at>?))))`;
 const groupsFor=id=>all(`SELECT c.* FROM courses c JOIN users u ON u.id=? WHERE c.entity_kind='group' AND ${membership} ORDER BY c.title,c.cohort,c.group_code`,id,now(),now());
 const member=(id,c)=>a.p.can(id,c.id)||c.lifecycle==='active'&&c.published&&isEnrolled(id,c.id);
 const visibleGroups=auth=>groupsFor(auth.user.id).filter(c=>a.staff(auth)||c.access_mode==='document'||auth.assurance==='password');
 const canSee=(auth,target)=>a.p.active(target)&&(auth.user.id===target||a.global(auth)||visibleGroups(auth).some(c=>member(target,c)));
 function profile(u,self=false){const p=one('SELECT bio,hidden,photo_version FROM profiles WHERE user_id=?',u.id);return {id:u.id,name:u.name,roles:a.p.roles(u.id),bio:p?.bio||'',avatarUrl:p?.photo_version?`/api/community/avatar/${u.id}?v=${p.photo_version}`:null,...(self?{hidden:!!p?.hidden&&a.p.staff(u.id),canHide:a.p.staff(u.id)}:{})};}
 function roster(auth,q){
  const groupId=q.get('group')||'',groups=visibleGroups(auth),group=groups.find(c=>c.id===groupId);
  if(groupId&&!group)fail(403,'No tienes acceso a la comunidad de ese grupo.');
  if(groupId)requireCourse(groupId,auth);
  if(!groupId&&!a.staff(auth))fail(400,'Selecciona un grupo para ver a tus compañeros.');
  const live=all('SELECT s.user_id,p.course_id FROM presence p JOIN sessions s ON s.token_hash=p.session_hash WHERE p.seen_at>? AND s.expires_at>?',cutoff(),now());
  const ids=group?[group.id]:groups.map(g=>g.id),scoped=group||!a.global(auth);
  let people=all(`SELECT u.id,u.name,p.hidden,p.bio,p.photo_version,(SELECT json_group_array(role) FROM user_roles WHERE user_id=u.id) roles FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.active=1 AND u.account_status='active' AND u.must_change_password=0 ${scoped?`AND EXISTS(SELECT 1 FROM courses c WHERE c.id IN (${ids.map(()=>'?').join(',')||'NULL'}) AND ${membership})`:''} ORDER BY u.name COLLATE NOCASE`,...(scoped?[...ids,now(),now()]:[]));
  const term=(q.get('search')||'').trim().toLocaleLowerCase('es').slice(0,160),role=q.get('role'),status=q.get('status');
  people=people.map(u=>{const roles=JSON.parse(u.roles),hidden=!!u.hidden&&roles.some(r=>r!=='student'),online=!hidden&&live.some(p=>p.user_id===u.id),inGroup=online&&!!group&&live.some(p=>p.user_id===u.id&&p.course_id===group.id);return {id:u.id,name:u.name,bio:u.bio||'',roles,avatarUrl:u.photo_version?`/api/community/avatar/${u.id}?v=${u.photo_version}`:null,online,inGroup};}).filter(u=>(!term||u.name.toLocaleLowerCase('es').includes(term))&&(!role||u.roles.includes(role)));
  const total=people.length,online=people.filter(u=>u.online).length,inGroup=people.filter(u=>u.inGroup).length;
  if(status==='online')people=people.filter(u=>u.online);if(status==='offline')people=people.filter(u=>!u.online);
  people.sort((x,y)=>Number(y.inGroup)-Number(x.inGroup)||Number(y.online)-Number(x.online)||x.name.localeCompare(y.name,'es'));
  const page=Math.max(1,Math.min(Math.max(1,Math.ceil(people.length/50)),Math.floor(Number(q.get('page'))||1))),limit=50;
  return {people:people.slice((page-1)*limit,page*limit),total,online,inGroup,filtered:people.length,page,pages:Math.ceil(people.length/limit),groupId,groups:groups.map(c=>({id:c.id,title:c.title,code:c.group_code,cohort:c.cohort})),updatedAt:now(),ttlSeconds:PRESENCE_TTL/1000};
 }
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/community/'))return false;
  if(!auth)fail(401,'Inicia sesión para ver tu comunidad.');
  if(auth.preview)fail(403,'La vista previa no participa en la comunidad.');
  const send=data=>{json(res,data);return true;};
  if(path==='/api/community/heartbeat'&&method==='POST'){
   const b=await readJson(req,2048);auth=readSession(req);if(!auth)fail(401,'La sesión terminó.');
   if(typeof b.tabId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(b.tabId))fail(400,'Pestaña no válida.');
   if(b.leave===true){run('DELETE FROM presence WHERE session_hash=? AND tab_id=?',auth.tokenHash,b.tabId);return send({ok:true});}
   let group=null;if(b.groupId){group=a.group(b.groupId);requireCourse(group.id,auth);}
   run('DELETE FROM presence WHERE seen_at<=?',cutoff());
   if(!one('SELECT 1 FROM presence WHERE session_hash=? AND tab_id=?',auth.tokenHash,b.tabId)&&one('SELECT count(*) n FROM presence WHERE session_hash=?',auth.tokenHash).n>=20)fail(429,'Demasiadas pestañas activas.');
   run('INSERT INTO presence VALUES(?,?,?,?) ON CONFLICT(session_hash,tab_id) DO UPDATE SET course_id=excluded.course_id,seen_at=excluded.seen_at',auth.tokenHash,b.tabId,group?.id||null,now());
   return send({ok:true,hidden:profile(auth.user,true).hidden,updatedAt:now()});
  }
  if(path==='/api/community/presence'&&method==='GET')return send(roster(auth,new URL(req.url,'http://localhost').searchParams));
  if(path==='/api/community/profile'){
   if(method==='GET')return send(profile(auth.user,true));
   if(method==='PUT'){
    if(auth.assurance!=='password')fail(403,'Ingresa con contraseña para editar tu perfil.');
    const b=await readJson(req,370_000);auth=readSession(req);if(!auth||auth.assurance!=='password')fail(401,'La sesión terminó.');
    if(typeof b.bio!=='string'||b.bio.length>240||typeof b.hidden!=='boolean'||(b.removePhoto!==undefined&&typeof b.removePhoto!=='boolean'))fail(400,'Revisa la presentación y la visibilidad.');
    if(b.hidden&&!a.p.staff(auth.user.id))fail(403,'Solo docentes y personal administrativo pueden ocultar su estado.');
    const old=one('SELECT * FROM profiles WHERE user_id=?',auth.user.id),photo=b.photo?decodeAvatar(b.photo,fail):null;
    run(`INSERT INTO profiles VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio,hidden=excluded.hidden,photo=excluded.photo,photo_mime=excluded.photo_mime,photo_version=excluded.photo_version,updated_at=excluded.updated_at`,auth.user.id,b.bio.trim(),Number(b.hidden),b.removePhoto?null:photo?.bytes||old?.photo||null,b.removePhoto?null:photo?.mime||old?.photo_mime||null,b.removePhoto?null:photo?.version||old?.photo_version||null,now());
    audit(auth.user,'profile.update',auth.user.id);return send(profile(auth.user,true));
   }
  }
  const avatar=/^\/api\/community\/avatar\/([^/]+)$/.exec(path);
  if(avatar&&method==='GET'){
   if(!canSee(auth,avatar[1]))fail(404,'Foto no disponible.');
   const p=one('SELECT photo,photo_mime FROM profiles WHERE user_id=?',avatar[1]);if(!p?.photo)fail(404,'Foto no disponible.');
   res.setHeader('Content-Type',p.photo_mime);res.setHeader('Content-Length',p.photo.length);res.end(Buffer.from(p.photo));return true;
  }
  fail(404,'Opción de comunidad no encontrada.');
 }
 return {handler,roster,profile};
}
