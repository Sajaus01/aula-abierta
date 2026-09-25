import {randomUUID} from 'node:crypto';
import {copyFileSync,unlinkSync,statSync,statfsSync,readFileSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
export function createLibrary(ctx){
 const {db,uploadsDir,accessModel:a,readJson,readSession,json,fail,audit,string,fileResponse}=ctx;
 db.exec(`CREATE TABLE IF NOT EXISTS library_items(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,shared INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);`);
 const all=(s,...p)=>db.prepare(s).all(...p),one=(s,...p)=>db.prepare(s).get(...p),run=(s,...p)=>db.prepare(s).run(...p);
 function add(table,row){const keys=Object.keys(row);db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?')})`).run(...Object.values(row));}
 const owned=(id,auth)=>{const r=one('SELECT * FROM library_items WHERE id=?',id);if(!r||(!r.shared&&r.owner_id!==auth.user.id&&!a.global(auth)))fail(404,'Elemento de biblioteca no encontrado.');return r;};
 function copyFile(key,created){if(!key)return key;if(key!==basename(key)||/[\\/\x00]/.test(key))fail(400,'Archivo inválido.');const disk=statfsSync(uploadsDir);if(disk.bavail*disk.bsize<statSync(join(uploadsDir,key)).size+67108864)fail(413,'No hay espacio para copiar el archivo.');const next=randomUUID()+extname(key);copyFileSync(join(uploadsDir,key),join(uploadsDir,next),1);created.push(next);return next;}
 function remapFiles(value,created){if(Array.isArray(value))return value.map(x=>remapFiles(x,created));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='file_key'?copyFile(v,created):remapFiles(v,created)]));return value;}
 function transact(fn){const created=[];db.exec('BEGIN IMMEDIATE');try{const result=fn(created);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');for(const f of created)unlinkSync(join(uploadsDir,f));throw e;}}
 function snapshot(kind,id){
  if(kind==='module'){const item=one('SELECT * FROM modules WHERE id=?',id);if(!item)fail(404,'Capítulo no encontrado.');return {item,resources:all('SELECT * FROM resources WHERE module_id=? ORDER BY position',id),activities:all('SELECT id FROM activities WHERE module_id=?',id).map(x=>snapshot('activity',x.id))};}
  if(kind==='activity'){const item=one('SELECT * FROM activities WHERE id=?',id);if(!item)fail(404,'Actividad no encontrada.');return {item,files:all('SELECT * FROM activity_files WHERE activity_id=?',id)};}
  const item=one('SELECT * FROM resources WHERE id=?',id);if(!item)fail(404,'Material no encontrado.');return {item};
 }
 function place(kind,payload,courseId,moduleId){
  const id=randomUUID();
  if(kind==='module'){add('modules',{...payload.item,id,course_id:courseId,published:0});for(const r of payload.resources)add('resources',{...r,id:randomUUID(),module_id:id,published:0});for(const act of payload.activities)place('activity',act,courseId,id);}
  else if(kind==='activity'){const config=JSON.parse(payload.item.config);Object.assign(config,{status:'draft',weight:0,periodId:'',opensAt:null,dueAt:null,closesAt:null});add('activities',{...payload.item,id,course_id:courseId,module_id:moduleId||null,config:JSON.stringify(config),version:1,revision:1});for(const f of payload.files)add('activity_files',{...f,id:randomUUID(),activity_id:id});}
  else add('resources',{...payload.item,id,module_id:moduleId,published:0});
  return id;
 }
 function snapshotAssets(payload){return [payload.item,...(payload.resources||[]),...(payload.files||[]).map(f=>({...f,file_name:f.name,file_mime:f.mime})),...(payload.activities||[]).flatMap(snapshotAssets)];}
 function previewTree(payload,item){const assets=snapshotAssets(payload),assetView=r=>{const index=assets.indexOf(r);return {title:r.title||r.file_name||r.name,kind:r.kind,content:r.content,url:r.url,fileName:r.file_name||r.name,mime:r.file_mime||r.mime,fileUrl:r.file_key?`/api/library/${item.id}/file?asset=${index}`:null,previewUrl:['html','lab'].includes(r.kind)?`/api/library/${item.id}/preview?asset=${index}`:null};};
  function tree(p){if(p.item.config){const config=JSON.parse(p.item.config);return {...config,type:'activity',files:(p.files||[]).map(f=>{const index=assets.findIndex(x=>x.id===f.id&&x.file_key===f.file_key);return {...assetView(assets[index]),fileUrl:`/api/library/${item.id}/file?asset=${index}`};})};}if(p.resources)return {type:'module',title:p.item.title,materials:p.resources.map(assetView),activities:(p.activities||[]).map(tree)};return assetView(p.item);}return tree(payload);
 }
 async function handler(req,res,path,method,auth){
  if(!path.startsWith('/api/library'))return false;if(!a.staff(auth))fail(403,'La biblioteca requiere una sesión docente.');
  const send=(data,status)=>{json(res,data,status);return true;};
  if(path==='/api/library'&&method==='GET')return send(all('SELECT id,owner_id,title,kind,shared,created_at FROM library_items WHERE owner_id=? OR shared=1 OR ?=1 ORDER BY title',auth.user.id,Number(a.global(auth))).map(r=>({...r,owned:r.owner_id===auth.user.id})));
  if(path==='/api/library'&&method==='POST'){
   const b=await readJson(req);auth=readSession(req);if(!a.staff(auth))fail(403,'La sesión cambió.');if(!['module','resource','activity'].includes(b.kind))fail(400,'Tipo no válido.');
   const type={module:'modules',resource:'resources',activity:'activities'}[b.kind],courseId=a.resolve(type,b.sourceId);a.requireScope(auth,courseId,'edit');
   const id=transact(created=>{const payload=remapFiles(snapshot(b.kind,b.sourceId),created),id=randomUUID();run('INSERT INTO library_items VALUES(?,?,?,?,?,?,?)',id,auth.user.id,string(b.title,'el título',200,true),b.kind,JSON.stringify(payload),Number(b.shared===true),new Date().toISOString());audit(auth.user,'library.create',id);return id;});return send({id},201);
  }
  const m=/^\/api\/library\/([^/]+)(?:\/(use|sharing|preview|file))?$/.exec(path);
  if(m){let item=owned(m[1],auth);
   if(['preview','file'].includes(m[2])&&['GET','HEAD'].includes(method)){
    const assets=snapshotAssets(JSON.parse(item.payload)),key=new URL(req.url,'http://localhost').searchParams.get('asset')||'0',r=assets[Number(key)];if(!/^\d+$/.test(key)||!r)fail(404,'Archivo no encontrado.');
    if(m[2]==='preview'){if(!['html','lab'].includes(r.kind))fail(404,'Vista no disponible.');const content=r.content||(r.file_key?readFileSync(join(uploadsDir,r.file_key),'utf8'):'');res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");res.setHeader('Content-Type','text/html; charset=utf-8');res.end(method==='HEAD'?undefined:content);return true;}
    if(!r.file_key)fail(404,'Archivo no encontrado.');fileResponse(req,res,join(uploadsDir,r.file_key),r.file_mime,r.file_name,!['application/pdf'].includes(r.file_mime)&&!r.file_mime.startsWith('image/'),true);return true;
   }
   if(!m[2]&&method==='GET'){const payload=JSON.parse(item.payload);return send({id:item.id,title:item.title,kind:item.kind,shared:!!item.shared,preview:previewTree(payload,item)});}
   if(method==='POST'){const b=await readJson(req);auth=readSession(req);if(!a.staff(auth))fail(403,'La sesión cambió.');item=owned(m[1],auth);
    if(m[2]==='sharing'){if(item.owner_id!==auth.user.id&&!a.global(auth))fail(403,'Solo el propietario puede compartir.');if(typeof b.shared!=='boolean')fail(400,'Estado no válido.');run('UPDATE library_items SET shared=? WHERE id=?',Number(b.shared),item.id);audit(auth.user,'library.share',item.id);return send({success:true});}
    if(m[2]==='use'){a.requireScope(auth,b.courseId,'edit');if(item.kind==='resource'&&!b.moduleId)fail(400,'Selecciona el capítulo de destino.');if(b.moduleId&&!one('SELECT id FROM modules WHERE id=? AND course_id=?',b.moduleId,b.courseId))fail(400,'Capítulo no válido.');const id=transact(created=>place(item.kind,remapFiles(JSON.parse(item.payload),created),b.courseId,b.moduleId));audit(auth.user,'library.use',id);return send({id,courseId:b.courseId,kind:item.kind},201);}
   }
  }
  fail(404,'Acción de biblioteca no encontrada.');
 }
 return {handler};
}
