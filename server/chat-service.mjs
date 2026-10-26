import {randomUUID} from 'node:crypto';
import {presenceOnline} from './presence.mjs';
import {join} from 'node:path';
import {createChatMedia} from './chat-media.mjs';
import {createChatContext} from './chat-context.mjs';

export function createChat({db,accessModel:a,fail,json,readJson,readSession,isEnrolled,audit,storage,validateFile,uploadsDir,fileResponse}){
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p),now=()=>new Date().toISOString();
 const globalOn=()=>!!one('SELECT enabled FROM chat_settings WHERE id=1').enabled;
 const supervisor=(id,c)=>Boolean(c&&a.p.can(id,c.id,'view'));
 const supervises=(auth,c)=>a.staff(auth)&&supervisor(auth.user.id,c);
 const member=(id,c)=>a.p.active(id)&&(supervisor(id,c)||c.lifecycle==='active'&&!!c.published&&isEnrolled(id,c.id));
 const allGroups=()=>all("SELECT * FROM courses WHERE entity_kind='group' ORDER BY title,cohort,group_code");
 const groups=auth=>allGroups().filter(c=>a.staff(auth)?supervisor(auth.user.id,c):c.lifecycle==='active'&&!!c.published&&isEnrolled(auth.user.id,c.id));
 const shared=(from,to)=>allGroups().filter(c=>c.lifecycle==='active'&&!!c.published&&member(from,c)&&member(to,c));
 const config=c=>{const s=one('SELECT * FROM chat_courses WHERE course_id=?',c.id);return {id:c.id,title:c.title,code:c.group_code,cohort:c.cohort,enabled:!!s?.enabled,studentStaff:s?!!s.student_staff:true,studentPeers:!!s?.student_peers};};
 const course=(id,auth)=>{const c=a.group(id);if(!groups(auth).some(g=>g.id===c.id))fail(403,'No tienes acceso al chat de este grupo.');return c;};
 const accepted=id=>one('SELECT accept_students FROM chat_preferences WHERE user_id=?',id)?.accept_students!==0;
 const person=(id,c=null)=>{const u=one('SELECT u.id,u.name,p.photo_version FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?',id);return u?{id:u.id,name:u.name,roles:c?(supervisor(id,c)?a.p.roles(id).filter(r=>r!=='student'):['student']):a.p.roles(id),avatarUrl:u.photo_version?`/api/community/avatar/${id}?v=${u.photo_version}`:null,online:presenceOnline(db,id)}:null;};
 const origins=v=>all('SELECT c.*,g.deleted_at AS chat_deleted_at FROM chat_conversation_groups g JOIN courses c ON c.id=g.course_id WHERE g.conversation_id=? ORDER BY c.title,c.id',v.id);
 const removed=(v,c)=>Boolean(one('SELECT deleted_at FROM chat_conversation_groups WHERE conversation_id=? AND course_id=?',v.id,c.id)?.deleted_at);
 const media=createChatMedia({db,fail,storage,validateFile,uploadsDir});
 const context=createChatContext({db,fail,supervises,person,permission,removed});
 const filePreview=id=>{const files=media.rows(id);return files.length?(files.every(f=>f.kind==='audio')?'Audio':files.every(f=>f.kind==='image')?(files.length===1?'Imagen':'Imágenes'):`${files.length} archivo${files.length===1?'':'s'}`):'';};
 function permission(c,from,to){
  const s=config(c),fs=supervisor(from,c),ts=supervisor(to,c);
  if(!globalOn())return 'La mensajería está desactivada por la administración.';
  if(!s.enabled)return 'El chat de este grupo está desactivado.';
  if(!member(from,c)||!member(to,c))return 'Una de las personas ya no tiene acceso activo a este grupo.';
  if(one('SELECT 1 FROM chat_blocks WHERE course_id=? AND user_id=?',c.id,from))return 'El docente ha suspendido tu envío de mensajes en este grupo.';
  if(!fs&&!ts&&!s.studentPeers)return 'El docente no ha habilitado mensajes entre estudiantes.';
  if(!fs&&ts&&(!s.studentStaff||!accepted(to)))return 'Este docente no está recibiendo mensajes de estudiantes.';
  return '';
 }
 const associate=(v,c)=>run('INSERT OR IGNORE INTO chat_conversation_groups(conversation_id,course_id) VALUES(?,?)',v.id,c.id);
 function conversation(id,auth,scope=''){
  const v=one('SELECT * FROM chat_conversations WHERE id=?',id)||one('SELECT v.* FROM chat_conversation_aliases x JOIN chat_conversations v ON v.id=x.conversation_id WHERE x.id=?',id);
  if(!v)fail(404,'Conversación no disponible.');
  const own=[v.user_a,v.user_b].includes(auth.user.id),other=own?(v.user_a===auth.user.id?v.user_b:v.user_a):null;
  const common=own?shared(auth.user.id,other):[],registered=origins(v),monitored=registered.filter(c=>supervises(auth,c));
  let c,visible;
  if(own){
   if(!common.length)fail(403,'Ya no compartes un grupo activo con esta persona.');
   if(scope&&!common.some(g=>g.id===scope))fail(403,'No compartes ese grupo con esta persona.');
   const candidates=common.filter(g=>(!scope||g.id===scope)&&(!removed(v,g)||supervises(auth,g)));
   if(!candidates.length)fail(404,'La conversación fue retirada por un docente.');
   c=candidates.find(g=>!permission(g,auth.user.id,other))||candidates[0];
   visible=registered.filter(g=>(member(auth.user.id,g)||supervises(auth,g))&&(!g.chat_deleted_at||supervises(auth,g))).map(g=>g.id);
  }else{
   const candidates=monitored.filter(g=>!scope||g.id===scope);
   if(!candidates.length)fail(403,'No puedes acceder a esta conversación.');
   c=candidates[0];visible=candidates.map(g=>g.id);
  }
  return {v,c,own,other,common,visible,originById:new Map(registered.map(g=>[g.id,g])),monitor:supervises(auth,c),auth,scope};
 }
 const messageFilter=(ctx,alias='m')=>({sql:`${alias}.conversation_id=? AND COALESCE(${alias}.course_id,?) IN (${ctx.visible.length?ctx.visible.map(()=>'?').join(','):'NULL'})`,params:[ctx.v.id,ctx.v.course_id,...ctx.visible]});
 const canModerateMessage=(ctx,m)=>{const c=ctx.originById.get(m.course_id||ctx.v.course_id);return Boolean(c&&ctx.visible.includes(c.id)&&supervises(ctx.auth,c));};
 function view(ctx){
  const {v,auth,c,own,other}=ctx,m=own?one('SELECT * FROM chat_members WHERE conversation_id=? AND user_id=?',v.id,auth.user.id):null;
  const filter=messageFilter(ctx),last=one(`SELECT m.* FROM chat_messages m WHERE ${filter.sql} ORDER BY m.id DESC LIMIT 1`,...filter.params),common=own?ctx.common:[...ctx.originById.values()].filter(g=>ctx.visible.includes(g.id)),available=own?common.filter(g=>!removed(v,g)):[];
  const send=available.find(g=>g.id===c.id&&!permission(g,auth.user.id,other))||available.find(g=>!permission(g,auth.user.id,other));
  const unreadSummary=own?one(`SELECT count(*) n,MIN(m.id) first FROM chat_messages m WHERE ${filter.sql} AND m.sender_id<>? AND m.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM chat_message_reads r WHERE r.message_id=m.id AND r.user_id=?)`,...filter.params,auth.user.id,auth.user.id):{n:0},unread=unreadSummary.n;
  const moderated=[...ctx.originById.values()].filter(g=>ctx.visible.includes(g.id)&&supervises(auth,g)).map(g=>g.id);
  const pendingReports=moderated.length?one(`SELECT count(*) n FROM chat_reports r JOIN chat_messages m ON m.id=r.message_id WHERE ${filter.sql} AND COALESCE(m.course_id,?) IN (${moderated.map(()=>'?').join(',')}) AND r.resolved_at IS NULL`,...filter.params,v.course_id,...moderated).n:0;
  const peer=own&&last?one('SELECT read_at FROM chat_message_reads WHERE message_id=? AND user_id=?',last.id,other):null;
  return {id:v.id,...(own?{legacyIds:all('SELECT id FROM chat_conversation_aliases WHERE conversation_id=? ORDER BY id',v.id).map(x=>x.id)}:{}),group:config(c),groups:common.map(config),visibleGroupIds:ctx.visible,sendGroupId:send?.id||null,participants:[person(v.user_a,c),person(v.user_b,c)],own,supervised:!own,pendingReports,deleted:removed(v,c),archived:!!m?.archived,hidden:!!m&&m.hidden_id>=Number(last?.id||0),muted:!!m?.muted,unread,readId:unread?Math.min(m?.read_id||0,unreadSummary.first-1):m?.read_id||0,peerReadId:own?one('SELECT read_id FROM chat_members WHERE conversation_id=? AND user_id=?',v.id,other)?.read_id||0:0,lastId:Number(last?.id||0),lastAt:last?.created_at||v.created_at,lastSenderId:last?.sender_id||null,lastReadByPeer:!!peer,preview:last?(last.deleted_at?'Mensaje eliminado':last.body.slice(0,150)||filePreview(last.id)):'Sin mensajes',canSend:!!send,reason:!own?'Modo de supervisión: solo lectura.':send?'':removed(v,c)?'Conversación retirada en este grupo.':permission(c,auth.user.id,other),canModerate:supervises(auth,c),moderationGroups:origins(v).filter(g=>supervises(auth,g)).map(config)};
 }
 function inbox(auth,q){
  const gs=groups(auth),scope=q.get('group')||'',mode=q.get('mode')||'inbox';
  if(scope&&!gs.some(c=>c.id===scope))fail(403,'Grupo no disponible.');
  if(!['inbox','supervision'].includes(mode))fail(400,'Vista de mensajes no válida.');
  if(mode==='supervision'&&!a.staff(auth))fail(403,'Solo docentes pueden supervisar chats.');
  const rows=mode==='supervision'?all('SELECT * FROM chat_conversations'):all('SELECT * FROM chat_conversations WHERE user_a=? OR user_b=?',auth.user.id,auth.user.id),result=[];
  for(const v of rows){try{const ctx=conversation(v.id,auth,scope);if(mode==='supervision'&&!ctx.monitor)continue;result.push(view(ctx));}catch(error){if(![403,404].includes(error.status))throw error;}}
  result.sort((x,y)=>y.lastAt.localeCompare(x.lastAt));
  const query=(q.get('search')||'').toLocaleLowerCase('es').slice(0,160),filtered=result.filter(v=>!query||[...v.groups.map(g=>g.title),...v.participants.map(p=>p.name)].join(' ').toLocaleLowerCase('es').includes(query));
  return {groups:gs.map(c=>({...config(c),canManage:supervises(auth,c)})),globalEnabled:globalOn(),canManageGlobal:a.global(auth),canSupervise:a.staff(auth),acceptStudents:accepted(auth.user.id),unread:result.filter(v=>v.own&&!v.hidden&&!v.deleted&&!v.muted).reduce((n,v)=>n+v.unread,0),conversations:filtered.slice(0,300),truncated:filtered.length>300};
 }
 function messages(ctx,q){
  const before=q.get('before');if(before&&!/^\d+$/.test(before))fail(400,'Página no válida.');
  const filter=messageFilter(ctx),rows=all(`SELECT m.* FROM chat_messages m WHERE ${filter.sql} ${before?'AND m.id<?':''} ORDER BY m.id DESC LIMIT 60`,...filter.params,...(before?[Number(before)]:[])).reverse();
  return {...view(ctx),messages:rows.map(m=>{
   const moderate=canModerateMessage(ctx,m),reply=m.reply_id?one(`SELECT m.* FROM chat_messages m WHERE ${filter.sql} AND m.id=?`,...filter.params,m.reply_id):null,receipt=ctx.own?one('SELECT read_at FROM chat_message_reads WHERE message_id=? AND user_id=?',m.id,ctx.other):null;
   return {id:m.id,senderId:m.sender_id,groupId:m.course_id||ctx.v.course_id,body:m.deleted_at?'':m.body,files:!m.deleted_at||moderate?media.publicFiles(m.id):[],context:(!m.deleted_at||moderate)&&m.context_json?JSON.parse(m.context_json):null,createdAt:m.created_at,editedAt:m.edited_at,deleted:!!m.deleted_at,replyId:reply?m.reply_id:null,reply:reply?{senderId:reply.sender_id,body:reply.deleted_at?'Mensaje eliminado':reply.body.slice(0,200)||filePreview(reply.id)}:null,readByPeer:!!receipt,readAt:receipt?.read_at||null,canModerate:moderate,canDelete:!m.deleted_at&&(moderate||ctx.own&&m.sender_id===ctx.auth.user.id),canReport:ctx.own,...(moderate?{originalBody:m.deleted_at?m.body:null,history:all('SELECT body,changed_at AS changedAt FROM chat_edits WHERE message_id=? ORDER BY id DESC LIMIT 20',m.id),reports:all('SELECT id,reason,created_at AS createdAt,resolved_at AS resolvedAt FROM chat_reports WHERE message_id=?',m.id)}:{})};
  }),hasOlder:!!rows.length&&!!one(`SELECT 1 FROM chat_messages m WHERE ${filter.sql} AND m.id<? LIMIT 1`,...filter.params,rows[0].id),typing:ctx.own?all('SELECT user_id FROM chat_typing WHERE conversation_id=? AND user_id<>? AND expires_at>?',ctx.v.id,ctx.auth.user.id,now()).filter(r=>ctx.common.some(c=>member(r.user_id,c))&&presenceOnline(db,r.user_id)).map(r=>person(r.user_id,ctx.c)):[]};
 }
 const bool=(b,k)=>{if(typeof b[k]!=='boolean')fail(400,'Revisa las opciones del chat.');return Number(b[k]);};
 const text=(b,k,max)=>{if(typeof b[k]!=='string'||!b[k].trim()||b[k].trim().length>max)fail(400,`Escribe ${k==='body'?'un mensaje':'un motivo'} de entre 1 y ${max} caracteres.`);return b[k].trim();};
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/chat'))return false;
  if(!auth)fail(401,'Inicia sesión para usar mensajes.');
  if(auth.preview||auth.assurance!=='password')fail(403,'Los mensajes requieren tu sesión personal con contraseña.');
  const q=new URL(req.url,'http://localhost').searchParams,scope=q.get('group')||'',send=(d,s=200)=>{json(res,d,s);return true;};
  const body=async(limit=24000)=>{const b=await readJson(req,limit),fresh=readSession(req);if(!fresh||fresh.user.id!==auth.user.id||fresh.preview||fresh.assurance!=='password'||fresh.user.must_change_password)fail(401,'La sesión terminó.');auth=fresh;return b;};
  if(path==='/api/chat'&&method==='GET')return send(inbox(auth,q));
  if(path==='/api/chat/context'&&method==='GET'){const input=Object.fromEntries(q),c=course(input.courseId,auth);return send({context:context.resolve(input,auth,c),teachers:context.teachers(auth,c)});}
  const fileRoute=/^\/api\/chat\/files\/([^/]+)$/.exec(path);
  if(fileRoute&&['GET','HEAD'].includes(method)){
   const f=one('SELECT f.*,m.conversation_id,m.course_id,m.deleted_at FROM chat_files f JOIN chat_messages m ON m.id=f.message_id WHERE f.id=?',fileRoute[1]);if(!f)fail(404,'Archivo no disponible.');
   const ctx=conversation(f.conversation_id,auth,scope),origin=ctx.originById.get(f.course_id||ctx.v.course_id),moderate=canModerateMessage(ctx,f);
   if(!origin||!ctx.visible.includes(origin.id)||!moderate&&(!member(auth.user.id,origin)||removed(ctx.v,origin)||f.deleted_at))fail(403,'No puedes acceder a este archivo.');
   res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
   fileResponse(req,res,join(uploadsDir,f.file_key),f.mime,f.name,f.kind==='file'||q.get('download')==='1',true);return true;
  }
  if(path==='/api/chat/global'&&method==='PUT'){const b=await body();a.requireGlobal(auth);run('UPDATE chat_settings SET enabled=? WHERE id=1',bool(b,'enabled'));audit(auth.user,'chat.global',null,{enabled:b.enabled});return send({enabled:globalOn()});}
  if(path==='/api/chat/preferences'&&method==='PUT'){const b=await body();if(!a.staff(auth))fail(403,'Esta opción es para docentes.');run('INSERT INTO chat_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET accept_students=excluded.accept_students',auth.user.id,bool(b,'acceptStudents'));return send({acceptStudents:accepted(auth.user.id)});}
  const setting=/^\/api\/chat\/courses\/([^/]+)$/.exec(path);
  if(setting){if(method==='GET'){const c=course(setting[1],auth);return send({...config(c),canManage:supervises(auth,c),globalEnabled:globalOn()});}if(method==='PUT'){const b=await body(),c=course(setting[1],auth);if(!supervises(auth,c))fail(403,'Solo el docente de este grupo puede configurar su chat.');run('INSERT INTO chat_courses VALUES(?,?,?,?) ON CONFLICT(course_id) DO UPDATE SET enabled=excluded.enabled,student_staff=excluded.student_staff,student_peers=excluded.student_peers',c.id,bool(b,'enabled'),bool(b,'studentStaff'),bool(b,'studentPeers'));audit(auth.user,'chat.configure',c.id,{courseId:c.id,...b});return send(config(c));}}
  if(path==='/api/chat/contacts'&&method==='GET'){
   const selected=scope?course(scope,auth):null,search=(q.get('search')||'').toLocaleLowerCase('es').slice(0,160),gs=groups(auth),people=[];
   for(const u of all("SELECT id FROM users WHERE active=1 AND account_status='active' AND id<>? ORDER BY name",auth.user.id)){
    const common=shared(auth.user.id,u.id).filter(c=>!selected||c.id===selected.id);if(!common.length)continue;
    const pair=[auth.user.id,u.id].sort(),existing=one('SELECT * FROM chat_conversations WHERE user_a=? AND user_b=?',...pair),available=common.find(c=>!permission(c,auth.user.id,u.id)&&(!existing||!removed(existing,c))),c=available||common[0],p=person(u.id,c);if(search&&!p.name.toLocaleLowerCase('es').includes(search))continue;
    people.push({...p,groups:common.map(config),groupIds:common.map(c=>c.id),sendGroupId:available?.id||null,canMessage:!!available,reason:available?'':existing&&removed(existing,c)?'El docente retiró esta conversación en este grupo.':permission(c,auth.user.id,u.id),blocked:!!selected&&supervises(auth,selected)&&!!one('SELECT 1 FROM chat_blocks WHERE course_id=? AND user_id=?',selected.id,u.id)});
   }
   return send({group:selected?config(selected):null,groups:gs.map(config),people:people.slice(0,100),truncated:people.length>100});
  }
  const block=/^\/api\/chat\/courses\/([^/]+)\/users\/([^/]+)$/.exec(path);
  if(block&&method==='PUT'){const b=await body(),c=course(block[1],auth);if(!supervises(auth,c))fail(403,'Solo docentes pueden moderar este grupo.');if(supervisor(block[2],c)||!member(block[2],c))fail(400,'Selecciona un estudiante del grupo.');if(bool(b,'blocked'))run('INSERT OR IGNORE INTO chat_blocks VALUES(?,?)',c.id,block[2]);else run('DELETE FROM chat_blocks WHERE course_id=? AND user_id=?',c.id,block[2]);audit(auth.user,'chat.moderate',block[2],{courseId:c.id,blocked:b.blocked});return send({ok:true});}
  if(path==='/api/chat/conversations'&&method==='POST'){
   const b=await body();if(typeof b.userId!=='string'||b.userId===auth.user.id)fail(400,'Selecciona otra persona.');
   const candidates=shared(auth.user.id,b.userId),c=b.groupId?course(b.groupId,auth):candidates.find(c=>!permission(c,auth.user.id,b.userId));
   if(!c)fail(403,'No compartes un grupo habilitado con esta persona.');const reason=permission(c,auth.user.id,b.userId);if(reason)fail(403,reason);
   const pair=[auth.user.id,b.userId].sort();let v;
   db.exec('BEGIN IMMEDIATE');try{
    v=one('SELECT * FROM chat_conversations WHERE user_a=? AND user_b=?',...pair);
    if(v&&removed(v,c))fail(409,'El docente retiró esta conversación en este grupo. Solicita su restauración.');
    if(!v){const id=randomUUID();run('INSERT INTO chat_conversations(id,course_id,user_a,user_b,created_at) VALUES(?,?,?,?,?)',id,c.id,...pair,now());v=one('SELECT * FROM chat_conversations WHERE id=?',id);for(const user of pair)run('INSERT INTO chat_members(conversation_id,user_id) VALUES(?,?)',id,user);}
    associate(v,c);run('UPDATE chat_members SET hidden_id=-1,archived=0 WHERE conversation_id=? AND user_id=?',v.id,auth.user.id);db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return send(view(conversation(v.id,auth,c.id)),201);
  }
  const route=/^\/api\/chat\/conversations\/([^/]+)(?:\/(messages|read|state|typing|remove|restore))?$/.exec(path);
  if(route){
   const tail=route[2];if(!tail&&method==='GET')return send(messages(conversation(route[1],auth,scope),q));
   if(tail==='messages'&&method==='POST'){
    const b=await body(29*1024*1024),ctx=conversation(route[1],auth,scope),{v}=ctx,id=v.id;
    if(!ctx.own)fail(403,'Esta conversación es de solo lectura.');
    const candidates=ctx.common.filter(c=>!removed(v,c)),c=b.groupId?candidates.find(c=>c.id===b.groupId):candidates.find(c=>!permission(c,auth.user.id,ctx.other));
    if(!c)fail(403,'No hay un grupo compartido habilitado para enviar.');const reason=permission(c,auth.user.id,ctx.other);if(reason)fail(403,reason);
    if(typeof b.clientKey!=='string'||! /^[\w-]{16,80}$/.test(b.clientKey))fail(400,'Identificador de envío no válido.');
    const existing=(route[1]!==id?one('SELECT m.* FROM chat_legacy_keys k JOIN chat_messages m ON m.id=k.message_id WHERE k.conversation_id=? AND k.client_key=? AND m.sender_id=?',route[1],b.clientKey,auth.user.id):null)||one('SELECT * FROM chat_messages WHERE conversation_id=? AND sender_id=? AND client_key=?',id,auth.user.id,b.clientKey);if(existing)return send({id:existing.id,files:ctx.visible.includes(existing.course_id||v.course_id)&&(!existing.deleted_at||canModerateMessage(ctx,existing))?media.publicFiles(existing.id):[]});
    if(b.body!==undefined&&typeof b.body!=='string'||typeof b.body==='string'&&b.body.trim().length>5000)fail(400,'El mensaje admite hasta 5000 caracteres.');
    const content=(b.body||'').trim(),plan=media.prepare(b.files);if(!content&&!plan.added.length)fail(400,'Escribe un mensaje o adjunta un archivo.');
    const origin=b.context==null?null:context.resolve(b.context,auth,c);
    if(origin&&!supervises(auth,c)&&!context.teachers(auth,c).some(p=>p.id===ctx.other))fail(403,'Envía esta pregunta a un docente del curso.');
    if(b.replyId!=null&&(!Number.isSafeInteger(b.replyId)||!(()=>{const f=messageFilter(ctx);return one(`SELECT 1 FROM chat_messages m WHERE ${f.sql} AND m.id=?`,...f.params,b.replyId);})()))fail(400,'El mensaje citado no pertenece a esta conversación.');
    if(one('SELECT count(*) n FROM chat_messages WHERE sender_id=? AND created_at>?',auth.user.id,new Date(Date.now()-60000).toISOString()).n>=40)fail(429,'Has enviado muchos mensajes. Espera un minuto.');
    db.exec('BEGIN IMMEDIATE');let message;try{associate(v,c);message=Number(run('INSERT INTO chat_messages(conversation_id,sender_id,body,created_at,reply_id,client_key,course_id,context_json) VALUES(?,?,?,?,?,?,?,?)',id,auth.user.id,content,now(),b.replyId||null,b.clientKey,c.id,origin?JSON.stringify(origin):null).lastInsertRowid);media.save(message,plan,{userId:auth.user.id,courseId:c.id});run('UPDATE chat_members SET archived=0 WHERE conversation_id=?',id);run('DELETE FROM chat_typing WHERE conversation_id=? AND user_id=?',id,auth.user.id);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');media.rollback(plan);throw error;}
    audit(auth.user,'chat.message.send',String(message),{courseId:c.id,object:{id,title:'Conversación personal',type:'chat'}});return send({id:message,files:media.publicFiles(message),context:origin},201);
   }
   if(tail==='read'&&method==='POST'){
    const b=await body(),ctx=conversation(route[1],auth,scope);if(!ctx.own)fail(403,'La supervisión no modifica las confirmaciones de lectura.');
    const filter=messageFilter(ctx),last=Number(one(`SELECT COALESCE(MAX(m.id),0) n FROM chat_messages m WHERE ${filter.sql}`,...filter.params).n);if(!Number.isSafeInteger(b.id)||b.id<0||b.id>last)fail(400,'Lectura no válida.');
    db.exec('BEGIN IMMEDIATE');try{run(`INSERT OR IGNORE INTO chat_message_reads(message_id,user_id,read_at) SELECT m.id,?,? FROM chat_messages m WHERE ${filter.sql} AND m.id<=? AND m.sender_id<>?`,auth.user.id,now(),...filter.params,b.id,auth.user.id);run('UPDATE chat_members SET read_id=MAX(read_id,?) WHERE conversation_id=? AND user_id=?',b.id,ctx.v.id,auth.user.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return send({ok:true});
   }
   if(tail==='typing'&&method==='POST'){
    const b=await body(),ctx=conversation(route[1],auth,scope);if(!ctx.own||!view(ctx).canSend)fail(403,'No puedes escribir en esta conversación.');
    if(bool(b,'typing')){run('DELETE FROM chat_typing WHERE expires_at<?',now());run('INSERT INTO chat_typing VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET expires_at=excluded.expires_at',ctx.v.id,auth.user.id,new Date(Date.now()+7000).toISOString());}else run('DELETE FROM chat_typing WHERE conversation_id=? AND user_id=?',ctx.v.id,auth.user.id);return send({ok:true});
   }
   if(tail==='state'&&method==='PUT'){
    const b=await body(),ctx=conversation(route[1],auth,scope);if(!ctx.own)fail(403,'Solo puedes organizar tus propias conversaciones.');
    const id=ctx.v.id;if(b.hidden===true){const f=messageFilter(ctx),last=Number(one(`SELECT COALESCE(MAX(m.id),0) n FROM chat_messages m WHERE ${f.sql}`,...f.params).n);run('UPDATE chat_members SET hidden_id=? WHERE conversation_id=? AND user_id=?',last,id,auth.user.id);}else if(b.hidden===false)run('UPDATE chat_members SET hidden_id=-1 WHERE conversation_id=? AND user_id=?',id,auth.user.id);
    for(const [key,column] of [['archived','archived'],['muted','muted']])if(b[key]!==undefined)run(`UPDATE chat_members SET ${column}=? WHERE conversation_id=? AND user_id=?`,bool(b,key),id,auth.user.id);return send({ok:true});
   }
   if(['remove','restore'].includes(tail)&&method==='POST'){
    const b=await body(),ctx=conversation(route[1],auth,scope||b.groupId||'');if(!ctx.monitor)fail(403,'Solo docentes pueden retirar conversaciones en sus grupos.');
    if(b.confirm!==ctx.v.id&&b.confirm!==route[1])fail(400,'Confirma la conversación que deseas gestionar.');
    run('UPDATE chat_conversation_groups SET deleted_at=?,deleted_by=? WHERE conversation_id=? AND course_id=?',tail==='remove'?now():null,tail==='remove'?auth.user.id:null,ctx.v.id,ctx.c.id);run('DELETE FROM chat_typing WHERE conversation_id=?',ctx.v.id);audit(auth.user,`chat.${tail}`,ctx.v.id,{courseId:ctx.c.id});return send({ok:true});
   }
  }
  const messageRoute=/^\/api\/chat\/messages\/(\d+)(?:\/(report))?$/.exec(path);
  if(messageRoute){
   if(!['PATCH','DELETE','POST'].includes(method))fail(404,'Opción de mensajes no encontrada.');
   const b=await body(),m=one('SELECT * FROM chat_messages WHERE id=?',Number(messageRoute[1]));if(!m)fail(404,'Mensaje no disponible.');
   const ctx=conversation(m.conversation_id,auth,scope);if(!ctx.visible.includes(m.course_id||ctx.v.course_id))fail(403,'No puedes acceder a este mensaje.');
   const origin=one('SELECT * FROM courses WHERE id=?',m.course_id||ctx.v.course_id),moderate=canModerateMessage(ctx,m);
   if(messageRoute[2]==='report'&&method==='POST'){if(!ctx.own)fail(403,'Solo participantes pueden reportar un mensaje.');run('INSERT INTO chat_reports VALUES(?,?,?,?,?,NULL) ON CONFLICT(message_id,reporter_id) DO UPDATE SET reason=excluded.reason,resolved_at=NULL',randomUUID(),m.id,auth.user.id,text(b,'reason',1000),now());audit(auth.user,'chat.report',String(m.id),{courseId:origin.id});return send({ok:true});}
   if(['PATCH','DELETE'].includes(method)){
    if(removed(ctx.v,origin))fail(403,'La conversación está retirada en este grupo.');
    if(!ctx.own&&!moderate||m.sender_id!==auth.user.id&&!moderate)fail(403,'No puedes modificar mensajes de otra persona.');
    if(method==='PATCH'){
     if(m.sender_id!==auth.user.id||m.deleted_at||permission(origin,auth.user.id,ctx.other))fail(403,'No puedes editar este mensaje.');const content=text(b,'body',5000);
     db.exec('BEGIN IMMEDIATE');try{run('INSERT INTO chat_edits(message_id,body,changed_at) VALUES(?,?,?)',m.id,m.body,now());run('UPDATE chat_messages SET body=?,edited_at=? WHERE id=?',content,now(),m.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    }else{run('UPDATE chat_messages SET deleted_at=COALESCE(deleted_at,?) WHERE id=?',now(),m.id);audit(auth.user,'chat.message.remove',String(m.id),{courseId:origin.id});}return send({ok:true});
   }
  }
  const report=/^\/api\/chat\/reports\/([^/]+)$/.exec(path);
  if(report&&method==='PUT'){await body();const r=one('SELECT r.*,m.conversation_id,m.course_id FROM chat_reports r JOIN chat_messages m ON m.id=r.message_id WHERE r.id=?',report[1]);if(!r)fail(404,'Reporte no disponible.');const ctx=conversation(r.conversation_id,auth,scope);if(!canModerateMessage(ctx,{course_id:r.course_id}))fail(403,'Solo docentes del grupo de este mensaje pueden resolver reportes.');run('UPDATE chat_reports SET resolved_at=? WHERE id=?',now(),r.id);return send({ok:true});}
  fail(404,'Opción de mensajes no encontrada.');
 }
 return {handler,canMessage:(auth,c,target)=>{if(auth?.assurance!=='password'||auth.preview||auth.user.id===target||!member(auth.user.id,c)||permission(c,auth.user.id,target))return false;const pair=[auth.user.id,target].sort(),v=one('SELECT * FROM chat_conversations WHERE user_a=? AND user_b=?',...pair);return !v||!removed(v,c);}};
}
