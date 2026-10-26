import {randomUUID,randomBytes,createHash,createCipheriv,createDecipheriv,ECDH} from 'node:crypto';
import webpush from 'web-push';

const stamp=()=>new Date().toISOString();
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const clockSql="strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// Events are journaled by the same SQLite transaction as the publication. Only
// future writes are captured: installing this schema never replays old content.
export function setupNotifications(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS notification_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,object_type TEXT NOT NULL,object_id TEXT NOT NULL,student_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,cancelled INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS notification_events_course ON notification_events(course_id,id);
 CREATE TABLE IF NOT EXISTS notification_recipients(
 event_id INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
 delivered_at TEXT,PRIMARY KEY(event_id,user_id));
 CREATE TABLE IF NOT EXISTS notification_inbox(
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,read_at TEXT,UNIQUE(event_id,user_id));
 CREATE INDEX IF NOT EXISTS notification_inbox_user ON notification_inbox(user_id,id);
 CREATE TABLE IF NOT EXISTS notification_announcements(
 id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,
 client_key TEXT NOT NULL,UNIQUE(course_id,actor_id,client_key));
 CREATE TABLE IF NOT EXISTS notification_secrets(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_push_subscriptions(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint_hash TEXT NOT NULL UNIQUE,cipher TEXT NOT NULL,after_inbox_id INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_push_deliveries(
 inbox_id INTEGER NOT NULL REFERENCES notification_inbox(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES notification_push_subscriptions(id) ON DELETE CASCADE,
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
 PRIMARY KEY(inbox_id,subscription_id));
 CREATE INDEX IF NOT EXISTS notification_push_pending ON notification_push_deliveries(state,next_attempt);
 CREATE TRIGGER IF NOT EXISTS notification_capture_recipients AFTER INSERT ON notification_events BEGIN
 INSERT OR IGNORE INTO notification_recipients(event_id,user_id,enrollment_id)
 SELECT NEW.id,e.student_id,e.id FROM enrollments e JOIN users u ON u.id=e.student_id
 WHERE e.course_id=NEW.course_id AND e.status='active' AND (e.expires_at IS NULL OR e.expires_at>${clockSql})
 AND u.active=1 AND u.account_status='active' AND (NEW.student_id IS NULL OR NEW.student_id=e.student_id);
 END;
 `);
 const sourceCourse={module:'NEW.course_id',resource:'(SELECT course_id FROM modules WHERE id=NEW.module_id)',activity:'NEW.course_id',quick:'NEW.course_id'};
 const spec=[
  ['module','modules',"NEW.published=1","OLD.published=0 OR OLD.title IS NOT NEW.title",'NEW.title',"'Nuevo capítulo'"],
  ['resource','resources',"NEW.published=1","OLD.published=0 OR OLD.title IS NOT NEW.title OR OLD.url IS NOT NEW.url OR OLD.content IS NOT NEW.content OR OLD.file_key IS NOT NEW.file_key",'NEW.title',"'Material disponible'"],
  ['activity','activities',"json_extract(NEW.config,'$.status')='published'","json_extract(OLD.config,'$.status') IS NOT 'published' OR OLD.config IS NOT NEW.config OR OLD.module_id IS NOT NEW.module_id OR OLD.revision IS NOT NEW.revision","COALESCE(json_extract(NEW.config,'$.title'),'Actividad')","'Actividad disponible'"],
  ['quick','quick_resources','NEW.visible=1','OLD.visible=0 OR OLD.title IS NOT NEW.title OR OLD.description IS NOT NEW.description OR OLD.url IS NOT NEW.url OR OLD.file_key IS NOT NEW.file_key','NEW.title',"'Recurso disponible'"]
 ];
 for(const [type,table,visible,changed,title,body] of spec){
  const course=sourceCourse[type],group=`EXISTS(SELECT 1 FROM courses WHERE id=${course} AND entity_kind='group')`;
  const insert=`INSERT INTO notification_events(course_id,kind,object_type,object_id,title,body,created_at) VALUES(${course},'${type}','${type}',NEW.id,${title},${body},${clockSql});`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS notification_${type}_create AFTER INSERT ON ${table} WHEN ${visible} AND ${group} BEGIN ${insert} END;
  CREATE TRIGGER IF NOT EXISTS notification_${type}_update AFTER UPDATE ON ${table} WHEN (${visible}) AND (${changed}) AND ${group} BEGIN
  UPDATE notification_events SET cancelled=1 WHERE object_type='${type}' AND object_id=NEW.id AND NOT EXISTS(SELECT 1 FROM notification_recipients r WHERE r.event_id=notification_events.id AND r.delivered_at IS NOT NULL);
  ${insert} END;
  CREATE TRIGGER IF NOT EXISTS notification_${type}_hide AFTER UPDATE ON ${table} WHEN NOT (${visible}) BEGIN
  UPDATE notification_events SET cancelled=1 WHERE object_type='${type}' AND object_id=NEW.id; END;
  CREATE TRIGGER IF NOT EXISTS notification_${type}_delete AFTER DELETE ON ${table} BEGIN
  UPDATE notification_events SET cancelled=1 WHERE object_type='${type}' AND object_id=OLD.id; END;`);
 }
 db.exec(`
 CREATE TRIGGER IF NOT EXISTS notification_course_publish AFTER UPDATE ON courses
 WHEN NEW.entity_kind='group' AND NEW.published=1 AND NEW.lifecycle='active' AND (OLD.published=0 OR OLD.lifecycle IS NOT 'active') BEGIN
 INSERT INTO notification_events(course_id,kind,object_type,object_id,title,body,created_at)
 VALUES(NEW.id,'course','course',NEW.id,NEW.title,'El curso ya está disponible.',${clockSql}); END;
 CREATE TRIGGER IF NOT EXISTS notification_course_hide AFTER UPDATE ON courses
 WHEN NEW.published=0 OR NEW.lifecycle IS NOT 'active' BEGIN
 UPDATE notification_events SET cancelled=1 WHERE course_id=NEW.id
 AND NOT EXISTS(SELECT 1 FROM notification_recipients r WHERE r.event_id=notification_events.id AND r.delivered_at IS NOT NULL);
 UPDATE notification_push_deliveries SET state='cancelled' WHERE state='pending' AND inbox_id IN
 (SELECT i.id FROM notification_inbox i JOIN notification_events e ON e.id=i.event_id WHERE e.course_id=NEW.id); END;
 CREATE TRIGGER IF NOT EXISTS notification_parent_hide AFTER UPDATE ON modules WHEN NEW.published=0 BEGIN
 UPDATE notification_events SET cancelled=1 WHERE (object_type='resource' AND object_id IN(SELECT id FROM resources WHERE module_id=NEW.id)
 OR object_type='activity' AND object_id IN(SELECT id FROM activities WHERE module_id=NEW.id))
 AND NOT EXISTS(SELECT 1 FROM notification_recipients r WHERE r.event_id=notification_events.id AND r.delivered_at IS NOT NULL); END;
 CREATE TRIGGER IF NOT EXISTS notification_announcement AFTER INSERT ON notification_announcements BEGIN
 INSERT INTO notification_events(course_id,kind,object_type,object_id,title,body,created_at)
 VALUES(NEW.course_id,'announcement','announcement',NEW.id,NEW.title,NEW.body,NEW.created_at); END;
 CREATE TRIGGER IF NOT EXISTS notification_final_grade AFTER UPDATE ON grading_settings
 WHEN json_extract(NEW.config,'$.finalPublished')=1 AND COALESCE(json_extract(OLD.config,'$.finalPublished'),0)=0
 AND EXISTS(SELECT 1 FROM courses WHERE id=NEW.course_id AND entity_kind='group') BEGIN
 INSERT INTO notification_events(course_id,kind,object_type,object_id,title,body,created_at)
 VALUES(NEW.course_id,'grades','final',NEW.course_id,'Notas finales disponibles','Ya puedes consultar tus notas finales.',${clockSql}); END;
 CREATE TRIGGER IF NOT EXISTS notification_grade AFTER UPDATE ON submissions
 WHEN NEW.published=1 AND NEW.superseded=0 AND (OLD.published=0 OR OLD.points IS NOT NEW.points OR OLD.feedback IS NOT NEW.feedback)
 AND EXISTS(SELECT 1 FROM activities a JOIN courses c ON c.id=a.course_id WHERE a.id=NEW.activity_id AND c.entity_kind='group') BEGIN
 INSERT INTO notification_events(course_id,kind,object_type,object_id,student_id,title,body,created_at)
 SELECT a.course_id,'grade','submission',NEW.id,NEW.student_id,'Calificación disponible',
 'Ya puedes consultar la calificación y los comentarios de '||COALESCE(json_extract(a.config,'$.title'),'la actividad')||'.',${clockSql}
 FROM activities a WHERE a.id=NEW.activity_id; END;
 CREATE TRIGGER IF NOT EXISTS notification_correction AFTER UPDATE ON submissions
 WHEN NEW.state='returned' AND NEW.superseded=0 AND (OLD.returned_at IS NOT NEW.returned_at OR OLD.state IS NOT 'returned' OR OLD.feedback IS NOT NEW.feedback OR OLD.return_due_at IS NOT NEW.return_due_at)
 AND EXISTS(SELECT 1 FROM activities a JOIN courses c ON c.id=a.course_id WHERE a.id=NEW.activity_id AND c.entity_kind='group') BEGIN
 INSERT INTO notification_events(course_id,kind,object_type,object_id,student_id,title,body,created_at)
 SELECT a.course_id,'correction','submission',NEW.id,NEW.student_id,'Revisa tu entrega',
 'Tu docente pidió cambios en '||COALESCE(json_extract(a.config,'$.title'),'la actividad')||'.',${clockSql}
 FROM activities a WHERE a.id=NEW.activity_id; END;
 `);
}

export function validPushSubscription(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.endpoint!=='string'||value.endpoint.length>2048)return false;
 let url;try{url=new URL(value.endpoint);}catch{return false;}
 // These are browser push services, never user-provided application servers.
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||!(['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com'].includes(host)||/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(host)))return false;
 const key=value.keys?.p256dh,auth=value.keys?.auth;
 if(typeof key!=='string'||typeof auth!=='string'||!/^[A-Za-z0-9_-]{87}=?$/.test(key)||!/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth))return false;
 const bytes=Buffer.from(key,'base64url');
 if(bytes.length!==65||bytes[0]!==4||Buffer.from(auth,'base64url').length!==16)return false;
 try{ECDH.convertKey(bytes,'prime256v1');}catch{return false;}
 if(value.expirationTime!=null&&(typeof value.expirationTime!=='number'||!Number.isFinite(value.expirationTime)||value.expirationTime<=Date.now()))return false;
 return {endpoint:url.href,expirationTime:value.expirationTime??null,keys:{p256dh:key,auth}};
}

export function createNotifications(ctx){
 const {db,accessModel:a,fail,json,readJson,readSession,isEnrolled,audit}=ctx;
 setupNotifications(db);
 const all=(sql,...v)=>db.prepare(sql).all(...v),one=(sql,...v)=>db.prepare(sql).get(...v),run=(sql,...v)=>db.prepare(sql).run(...v);
 const maximum=()=>Number(one('SELECT COALESCE(MAX(id),0) n FROM notification_inbox').n);
 const getCourse=id=>one("SELECT * FROM courses WHERE id=? AND entity_kind='group'",id);
 const activeCourse=c=>Boolean(c&&c.published&&c.lifecycle==='active');
 const currentUser=id=>Boolean(one("SELECT id FROM users WHERE id=? AND active=1 AND account_status='active'",id));
 const enrolled=(id,course)=>currentUser(id)&&isEnrolled(id,course);
 const teaching=(auth,id)=>a.staff(auth)&&a.p.can(auth.user.id,id,'view');
 const profile=c=>({id:c.id,title:c.title,coverUrl:c.cover_url||'',code:c.group_code||'',cohort:c.cohort||''});
 function requireAuth(auth){if(!auth)fail(401,'Inicia sesión para consultar tus avisos.');if(auth.preview||auth.assurance!=='password'||auth.user.must_change_password||!currentUser(auth.user.id))fail(403,'Ingresa con tu contraseña personal para consultar los avisos.');}
 function requireCourse(auth,id){const c=getCourse(id);if(!c)fail(404,'Grupo no encontrado.');if(!teaching(auth,id)&&!(activeCourse(c)&&enrolled(auth.user.id,id)))fail(403,'No tienes acceso a los avisos de este grupo.');return c;}
 function activityVisible(row,time){if(!row)return false;const cfg=parse(row.config);return cfg.status==='published'&&(!cfg.opensAt||cfg.opensAt<=time)&&(!row.module_id||Boolean(one('SELECT id FROM modules WHERE id=? AND published=1',row.module_id)));}
 function visible(event,time=stamp()){
  if(event.cancelled||!activeCourse(getCourse(event.course_id)))return false;
  switch(event.object_type){
   case 'course':return true;
   case 'module':return Boolean(one('SELECT id FROM modules WHERE id=? AND course_id=? AND published=1',event.object_id,event.course_id));
   case 'resource':return Boolean(one('SELECT r.id FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=? AND m.course_id=? AND r.published=1 AND m.published=1',event.object_id,event.course_id));
   case 'activity':return activityVisible(one('SELECT * FROM activities WHERE id=? AND course_id=?',event.object_id,event.course_id),time);
   case 'quick':return Boolean(one('SELECT id FROM quick_resources WHERE id=? AND course_id=? AND visible=1',event.object_id,event.course_id));
   case 'announcement':return Boolean(one('SELECT id FROM notification_announcements WHERE id=? AND course_id=?',event.object_id,event.course_id));
   case 'final':return Boolean(parse(one('SELECT config FROM grading_settings WHERE course_id=?',event.course_id)?.config).finalPublished);
   case 'submission':{const s=one('SELECT s.*,a.config,a.module_id FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE s.id=? AND a.course_id=?',event.object_id,event.course_id);return Boolean(s&&!s.superseded&&s.student_id===event.student_id&&activityVisible(s,time)&&(event.kind==='grade'?s.published:s.state==='returned'||s.state==='draft'&&s.returned_at));}
   default:return false;
  }
 }
 function href(event){const course=encodeURIComponent(event.course_id),id=encodeURIComponent(event.object_id);
  if(event.object_type==='activity')return '#actividad/'+id;
  if(event.object_type==='submission'){const s=one('SELECT activity_id FROM submissions WHERE id=?',event.object_id);return s?'#actividad/'+encodeURIComponent(s.activity_id):'#curso/'+course;}
  if(event.object_type==='resource')return '#curso/'+course+'?resource='+id;
  if(event.object_type==='module')return '#curso/'+course+'?module='+id;
  if(event.object_type==='final')return '#calificaciones/'+course;
  if(event.object_type==='announcement')return '#notificaciones?course='+course;
  return '#curso/'+course;
 }
 function item(event,inbox){const url=href(event);return {id:inbox?.id??'event-'+event.id,kind:event.kind,title:event.title,body:event.body,url,href:url,course:profile(getCourse(event.course_id)),createdAt:inbox?.created_at||event.created_at,readAt:inbox?inbox.read_at:event.created_at,read:inbox?Boolean(inbox.read_at):true,personal:Boolean(event.student_id)};}
 function secret(key,generate){let row=one('SELECT value FROM notification_secrets WHERE key=?',key);if(!row){run('INSERT OR IGNORE INTO notification_secrets VALUES(?,?)',key,generate());row=one('SELECT value FROM notification_secrets WHERE key=?',key);}return row.value;}
 const vapid=parse(secret('vapid',()=>JSON.stringify(webpush.generateVAPIDKeys())));
 const encryptionKey=Buffer.from(secret('subscriptions-encryption',()=>randomBytes(32).toString('base64')),'base64');
 function encrypt(subscription){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv),data=Buffer.concat([cipher.update(JSON.stringify(subscription),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
 function decrypt(value){const data=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',encryptionKey,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));}
 function reconcile(){
  if(db.isTransaction)return;
  const time=stamp();db.exec('BEGIN IMMEDIATE');
  try{
   const visibility=new Map();
   const pending=all(`SELECT e.*,r.user_id FROM notification_recipients r JOIN notification_events e ON e.id=r.event_id
    JOIN enrollments m ON m.id=r.enrollment_id AND m.student_id=r.user_id AND m.course_id=e.course_id
    JOIN users u ON u.id=r.user_id JOIN courses c ON c.id=e.course_id
    WHERE r.delivered_at IS NULL AND e.cancelled=0 AND m.status='active' AND u.active=1 AND u.account_status='active'
    AND (m.starts_at IS NULL OR m.starts_at<=?) AND (m.expires_at IS NULL OR m.expires_at>?)
    AND c.entity_kind='group' AND c.published=1 AND c.lifecycle='active' ORDER BY e.id`,time,time);
   for(const r of pending){
    if(!visibility.has(r.id))visibility.set(r.id,visible(r,time));if(!visibility.get(r.id))continue;
    run('INSERT OR IGNORE INTO notification_inbox(event_id,user_id,created_at) VALUES(?,?,?)',r.id,r.user_id,time);
    run('UPDATE notification_recipients SET delivered_at=? WHERE event_id=? AND user_id=?',time,r.id,r.user_id);
   }
   run(`INSERT OR IGNORE INTO notification_push_deliveries(inbox_id,subscription_id,next_attempt)
    SELECT i.id,s.id,? FROM notification_inbox i JOIN notification_push_subscriptions s ON s.user_id=i.user_id
    WHERE i.id>s.after_inbox_id AND i.read_at IS NULL AND NOT EXISTS
    (SELECT 1 FROM notification_push_deliveries d WHERE d.inbox_id=i.id AND d.subscription_id=s.id)`,time);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function ownItems(auth){return all('SELECT i.*,e.id event_id,e.course_id,e.kind,e.object_type,e.object_id,e.student_id,e.title,e.body,e.created_at event_created_at,e.cancelled FROM notification_inbox i JOIN notification_events e ON e.id=i.event_id WHERE i.user_id=? ORDER BY i.id DESC',auth.user.id).filter(r=>enrolled(auth.user.id,r.course_id)&&visible({...r,id:r.event_id}));}
 function list(auth,search,courseId){
  reconcile();if(courseId)requireCourse(auth,courseId);
  const after=search.has('after')?Number(search.get('after')):null,before=search.has('before')?Number(search.get('before')):null,limit=search.has('limit')?Number(search.get('limit')):60;
  if(after!==null&&(!Number.isSafeInteger(after)||after<0)||before!==null&&(!Number.isSafeInteger(before)||before<1)||after!==null&&before!==null||!Number.isInteger(limit)||limit<1||limit>100)fail(400,'La página de avisos no es válida.');
  const ownRows=ownItems(auth),courseRows=all("SELECT * FROM courses WHERE entity_kind='group' ORDER BY title").filter(c=>teaching(auth,c.id)||activeCourse(c)&&enrolled(auth.user.id,c.id));
  const courses=courseRows.map(c=>({...profile(c),unread:ownRows.filter(r=>r.course_id===c.id&&!r.read_at).length,canAnnounce:Boolean(activeCourse(c)&&a.staff(auth)&&a.p.can(auth.user.id,c.id,'edit'))}));
  let rows=ownRows.filter(r=>!courseId||r.course_id===courseId);
  if(after!==null)rows=rows.filter(r=>r.id>after).sort((x,y)=>x.id-y.id);
  if(before!==null)rows=rows.filter(r=>r.id<before);
  let hasMore=rows.length>limit;const selected=rows.slice(0,limit),cursor=after!==null&&hasMore?selected[selected.length-1].id:maximum();
  let nextBefore=selected.length?selected[selected.length-1].id:null;
  let items=selected.map(r=>item({...r,id:r.event_id,created_at:r.event_created_at},r));
  if(courseId&&teaching(auth,courseId)&&!enrolled(auth.user.id,courseId)){
   const feed=all('SELECT * FROM notification_events WHERE course_id=? AND student_id IS NULL ORDER BY id DESC',courseId).filter(e=>visible(e)&&(before===null||e.id<before));
   hasMore=feed.length>limit;const page=feed.slice(0,limit);items=page.map(e=>item(e));nextBefore=page.length?page[page.length-1].id:null;
  }
  return {items,courses,unread:ownRows.filter(r=>!r.read_at).length,cursor,hasMore,nextBefore, ...(courseId?{course:courses.find(c=>c.id===courseId)}:{})};
 }
 let running=null,stopped=false;
 async function flush(){
  if(stopped||db.isTransaction)return;if(running)return running;
  running=(async()=>{
   reconcile();const time=stamp();
   const pending=all(`SELECT d.*,s.user_id,s.cipher,i.event_id,i.read_at FROM notification_push_deliveries d
    JOIN notification_push_subscriptions s ON s.id=d.subscription_id JOIN notification_inbox i ON i.id=d.inbox_id
    WHERE d.state='pending' AND d.next_attempt<=? ORDER BY d.inbox_id LIMIT 30`,time);
   for(const delivery of pending){
    if(stopped)break;
    if(!one('SELECT id FROM notification_push_subscriptions WHERE id=? AND user_id=?',delivery.subscription_id,delivery.user_id))continue;
    const event=one('SELECT * FROM notification_events WHERE id=?',delivery.event_id);
    const inbox=one('SELECT read_at FROM notification_inbox WHERE id=?',delivery.inbox_id);
    if(!inbox||inbox.read_at||!currentUser(delivery.user_id)||!event||!enrolled(delivery.user_id,event.course_id)||!visible(event)){
     run("UPDATE notification_push_deliveries SET state='cancelled' WHERE inbox_id=? AND subscription_id=?",delivery.inbox_id,delivery.subscription_id);continue;
    }
    // Claim before network I/O: an application restart never sends a completed
    // delivery again. A timed-out claim is retried by the durable queue.
    const retryAt=new Date(Date.now()+60000).toISOString();
    const claim=run("UPDATE notification_push_deliveries SET attempts=attempts+1,next_attempt=? WHERE inbox_id=? AND subscription_id=? AND state='pending' AND next_attempt<=?",retryAt,delivery.inbox_id,delivery.subscription_id,time);
    if(!claim.changes)continue;
    try{
     const subscription=decrypt(delivery.cipher);if(!validPushSubscription(subscription))throw Object.assign(new Error('Invalid subscription'),{statusCode:410});
     const payload=JSON.stringify({title:'Aula Abierta',body:'Tienes novedades en uno de tus cursos.',url:'#notificaciones?course='+encodeURIComponent(event.course_id),tag:'aula-course-'+event.course_id,eventId:delivery.inbox_id});
     await (ctx.pushSend||webpush.sendNotification.bind(webpush))(subscription,payload,{TTL:3600,urgency:'normal',timeout:10000,vapidDetails:{subject:ctx.appOrigin||'https://aula-abierta.onrender.com',publicKey:vapid.publicKey,privateKey:vapid.privateKey}});
     if(!stopped)run("UPDATE notification_push_deliveries SET state='sent' WHERE inbox_id=? AND subscription_id=?",delivery.inbox_id,delivery.subscription_id);
    }catch(error){
     if(stopped)break;
     const status=Number(error.statusCode)||0;
     if(status===404||status===410){run('DELETE FROM notification_push_subscriptions WHERE id=?',delivery.subscription_id);continue;}
     const attempts=delivery.attempts+1,retry=attempts<5&&(!status||status===429||status>=500);
     run('UPDATE notification_push_deliveries SET state=?,next_attempt=? WHERE inbox_id=? AND subscription_id=?',retry?'pending':'failed',new Date(Date.now()+Math.min(3600000,60000*2**attempts)).toISOString(),delivery.inbox_id,delivery.subscription_id);
    }
   }
  })().finally(()=>{running=null;});return running;
 }
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/notifications'))return false;requireAuth(auth);
  const send=(value,status=200)=>{json(res,value,status);return true;};
  const url=new URL(req.url,'http://localhost');let match;
  if(path==='/api/notifications'&&method==='GET')return send(list(auth,url.searchParams,url.searchParams.get('course')));
  if(path==='/api/notifications/push/config'&&method==='GET')return send({enabled:true,publicKey:vapid.publicKey});
  if(path==='/api/notifications/push/subscriptions'&&['POST','DELETE'].includes(method)){
   const body=await readJson(req);auth=readSession(req);requireAuth(auth);
   if(method==='DELETE'){
    if(typeof body.endpoint!=='string'||body.endpoint.length>2048)fail(400,'Suscripción no válida.');
    run('DELETE FROM notification_push_subscriptions WHERE user_id=? AND endpoint_hash=?',auth.user.id,createHash('sha256').update(body.endpoint).digest('hex'));return send({enabled:false});
   }
   const subscription=validPushSubscription(body.subscription);if(!subscription)fail(400,'La suscripción del navegador no es válida.');
   const count=one('SELECT COUNT(*) n FROM notification_push_subscriptions WHERE user_id=?',auth.user.id).n;
   const hash=createHash('sha256').update(subscription.endpoint).digest('hex'),old=one('SELECT * FROM notification_push_subscriptions WHERE endpoint_hash=?',hash);
   if(!old&&count>=12)fail(400,'Desactiva los avisos en un navegador anterior antes de añadir otro.');
   const id=old?.id||randomUUID(),time=stamp();reconcile();
   run(`INSERT INTO notification_push_subscriptions VALUES(?,?,?,?,?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET
    user_id=excluded.user_id,cipher=excluded.cipher,after_inbox_id=CASE WHEN notification_push_subscriptions.user_id=excluded.user_id THEN notification_push_subscriptions.after_inbox_id ELSE excluded.after_inbox_id END,updated_at=excluded.updated_at`,id,auth.user.id,hash,encrypt(subscription),maximum(),time,time);
   if(old&&old.user_id!==auth.user.id)run('DELETE FROM notification_push_deliveries WHERE subscription_id=?',id);
   return send({id,enabled:true},201);
  }
  if(path==='/api/notifications/read'&&method==='POST'){
   const body=await readJson(req);auth=readSession(req);requireAuth(auth);reconcile();
   if(body.all!==true&&(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>200||body.ids.some(id=>!Number.isSafeInteger(id)||id<1)))fail(400,'Selecciona avisos válidos.');
   if(body.courseId!==undefined&&(typeof body.courseId!=='string'||!body.courseId||body.courseId.length>100))fail(400,'Selecciona un grupo válido.');
   if(body.courseId)requireCourse(auth,body.courseId);
   const ids=new Set(body.all===true?[]:body.ids),time=stamp();
   for(const row of ownItems(auth))if(!row.read_at&&(!body.courseId||row.course_id===body.courseId)&&(body.all===true||ids.has(row.id)))run('UPDATE notification_inbox SET read_at=? WHERE id=? AND user_id=?',time,row.id,auth.user.id);
   return send(list(auth,new URLSearchParams(),body.courseId));
  }
  match=/^\/api\/notifications\/courses\/([^/]+)(?:\/(announcements))?$/.exec(path);
  if(match){const id=decodeURIComponent(match[1]);requireCourse(auth,id);
   if(!match[2]&&method==='GET')return send(list(auth,url.searchParams,id));
   if(match[2]&&method==='POST'){
    const body=await readJson(req);auth=readSession(req);requireAuth(auth);requireCourse(auth,id);
    if(!a.staff(auth)||!a.p.can(auth.user.id,id,'edit'))fail(403,'Solo el docente con permiso de edición puede publicar avisos.');
    if(!activeCourse(getCourse(id)))fail(400,'Publica y activa el grupo antes de enviar un aviso.');
    if(typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>180||typeof body.body!=='string'||!body.body.trim()||body.body.trim().length>4000)fail(400,'Escribe un título de hasta 180 caracteres y un mensaje de hasta 4000.');
    const clientKey=body.clientKey??randomUUID();if(typeof clientKey!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(clientKey))fail(400,'El identificador del aviso no es válido.');
    const existing=one('SELECT id FROM notification_announcements WHERE course_id=? AND actor_id=? AND client_key=?',id,auth.user.id,clientKey);if(existing)return send({id:existing.id});
    const note=randomUUID();run('INSERT INTO notification_announcements VALUES(?,?,?,?,?,?,?)',note,id,auth.user.id,body.title.trim(),body.body.trim(),stamp(),clientKey);audit(auth.user,'course.announcement',id);reconcile();return send({id:note},201);
   }
  }
  fail(404,'Ruta de avisos no encontrada.');
 }
 return {handler,flush,reconcile,stop(){stopped=true;},settled:()=>running};
}
