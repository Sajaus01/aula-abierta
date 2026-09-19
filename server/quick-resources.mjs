import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFileSync,unlinkSync,statfsSync} from 'node:fs';

export function setupQuickResources(db){db.exec(`CREATE TABLE IF NOT EXISTS quick_resources (
 id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,url TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '',visible INTEGER NOT NULL DEFAULT 1,position REAL NOT NULL DEFAULT 0,
 file_key TEXT,file_name TEXT,file_mime TEXT,file_size INTEGER,version INTEGER NOT NULL DEFAULT 1
);CREATE INDEX IF NOT EXISTS quick_resources_course ON quick_resources(course_id);`);}

export function createQuickResources(ctx){
 const {db,fail,json,readJson,readSession,requireAdmin,requireCourse,validateFile,fileResponse,uploadsDir,audit,string,webUrl,boolean}=ctx;
 const one=(sql,...p)=>db.prepare(sql).get(...p),all=(sql,...p)=>db.prepare(sql).all(...p),run=(sql,...p)=>db.prepare(sql).run(...p);
 const teacher=a=>a?.user.role==='admin'&&a.assurance==='password';
 const view=r=>({id:r.id,courseId:r.course_id,title:r.title,description:r.description,kind:r.kind,url:r.url,imageUrl:r.image_url,visible:Boolean(r.visible),position:r.position,version:r.version,fileName:r.file_name,fileSize:r.file_size,fileUrl:r.file_key?`/api/quick-resources/${r.id}/file`:null});
 const list=(id,auth)=>all('SELECT * FROM quick_resources WHERE course_id=? ORDER BY position,id',id).filter(r=>teacher(auth)||r.visible).map(view);
 const get=id=>{const r=one('SELECT * FROM quick_resources WHERE id=?',id);if(!r)fail(404,'Recurso rápido no encontrado.');return r;};
 const remove=key=>{if(key)try{unlinkSync(join(uploadsDir,key));}catch(e){if(e.code!=='ENOENT')console.error('No se pudo retirar un archivo de recursos rápidos.');}};
 async function handler(req,res,path,method,auth){
  let m=/^\/api\/quick-resources\/([^/]+)\/file$/.exec(path);
  if(m&&['GET','HEAD'].includes(method)){const r=get(m[1]);requireCourse(r.course_id,auth);if(!teacher(auth)&&!r.visible)fail(404,'Recurso no disponible.');if(!r.file_key)fail(404,'Archivo no disponible.');fileResponse(req,res,join(uploadsDir,r.file_key),r.file_mime,r.file_name,true,true);return true;}
  const create=/^\/api\/admin\/courses\/([^/]+)\/quick-resources$/.exec(path);
  const edit=/^\/api\/admin\/quick-resources\/([^/]+)$/.exec(path);
  if(!(create&&method==='POST')&&!(edit&&['PATCH','DELETE'].includes(method)))return false;
  requireAdmin(auth);const body=await readJson(req,29*1024*1024);auth=readSession(req);requireAdmin(auth);
  const old=edit?get(edit[1]):null,courseId=old?.course_id||create[1];requireCourse(courseId,auth);
  if(old&&body.version!==old.version)fail(409,'El recurso cambió en otra pestaña. Recarga el curso antes de editarlo.');
  const send=(data,status=200)=>{json(res,data,status);return true;};
  if(method==='DELETE'){run('DELETE FROM quick_resources WHERE id=?',old.id);remove(old.file_key);audit(auth.user,'quick-resource.delete',old.id);return send({success:true});}
  if(body.move!==undefined){
   if(!old||!['up','down'].includes(body.move))fail(400,'Movimiento no válido.');
   const rows=all('SELECT * FROM quick_resources WHERE course_id=? ORDER BY position,id',courseId),i=rows.findIndex(r=>r.id===old.id),j=i+(body.move==='up'?-1:1);
   if(j>=0&&j<rows.length){[rows[i],rows[j]]=[rows[j],rows[i]];db.exec('BEGIN IMMEDIATE');try{rows.forEach((r,n)=>run('UPDATE quick_resources SET position=?,version=version+1 WHERE id=?',n,r.id));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}audit(auth.user,'quick-resource.reorder',old.id);}
   return send(view(get(old.id)));
  }
  const title=string(body.title??old?.title,'el título',180,true),description=string(body.description??old?.description,'la descripción',2000);
  const kind=body.kind??old?.kind??'link';if(!['video','download','link'].includes(kind))fail(400,'Tipo de recurso no válido.');
  const url=webUrl(body.url??old?.url),image=webUrl(body.imageUrl??old?.image_url);
  const visible=body.visible===undefined?(old?.visible??1):boolean(body.visible,'Visible');
  const source=body.source??(old?.file_key?'file':'link');if(!['file','link'].includes(source))fail(400,'Elige un enlace o un archivo.');
  if(source==='link'&&(!url||body.file))fail(400,'Escribe un enlace válido y no adjuntes un archivo.');
  if(source==='file'&&kind==='video')fail(400,'Para videos, usa un enlace.');
  let file=null;
  if(source==='file'&&body.file){if(!/\.(pdf|pptx|docx|xlsx|csv|png|jpe?g|gif|webp|txt)$/i.test(body.file.name||''))fail(400,'Sube PDF, documentos, hojas de cálculo o imágenes. Para aplicaciones, usa un enlace.');file=validateFile(body.file);const disk=statfsSync(uploadsDir);if(Number(disk.bavail)*Number(disk.bsize)<file.size+50*1024*1024)fail(413,'No hay espacio suficiente. Usa un enlace de descarga.');}
  if(source==='file'&&!file&&!old?.file_key)fail(400,'Selecciona un archivo.');
  if(!old&&one('SELECT COUNT(*) n FROM quick_resources WHERE course_id=?',courseId).n>=30)fail(400,'Puedes añadir hasta 30 recursos rápidos por curso.');
  const id=old?.id||randomUUID(),key=source==='link'?null:file?.key||old.file_key;
  try{
   if(file)writeFileSync(join(uploadsDir,file.key),file.buffer,{flag:'wx',mode:0o600});
   if(old)run('UPDATE quick_resources SET title=?,description=?,kind=?,url=?,image_url=?,visible=?,file_key=?,file_name=?,file_mime=?,file_size=?,version=version+1 WHERE id=?',title,description,kind,source==='link'?url:'',image,visible,key,key?(file?.name||old.file_name):null,key?(file?.mime||old.file_mime):null,key?(file?.size||old.file_size):null,id);
   else run('INSERT INTO quick_resources(id,course_id,title,description,kind,url,image_url,visible,position,file_key,file_name,file_mime,file_size) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,courseId,title,description,kind,source==='link'?url:'',image,visible,one('SELECT COALESCE(MAX(position),-1)+1 n FROM quick_resources WHERE course_id=?',courseId).n,key,file?.name||null,file?.mime||null,file?.size||null);
  }catch(e){if(file)remove(file.key);throw e;}
  if(old?.file_key&&old.file_key!==key)remove(old.file_key);audit(auth.user,old?'quick-resource.edit':'quick-resource.create',id);return send(view(get(id)),old?200:201);
 }
 return {list,handler};
}
