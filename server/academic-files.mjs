import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {writeFileSync,unlinkSync,statfsSync} from 'node:fs';

export const submissionFiles = payload => payload.files ?? (payload.file ? [{...payload.file,id:'legacy'}] : []);
export function createAcademicFiles({db,fail,validateFile,uploadsDir}) {
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const instructionFiles=id=>all('SELECT id,file_key AS key,name,mime,size FROM activity_files WHERE activity_id=? ORDER BY position,id',id);
 function remove(file){try{unlinkSync(join(uploadsDir,file.key));}catch(error){if(error.code!=='ENOENT')console.error('No se pudo retirar un adjunto académico.');}}
 function prepare(existing,uploads,retainIds,{teacher=false}={}){
  if(uploads===undefined)uploads=[];
  if(!Array.isArray(uploads)||uploads.length>5)fail(400,'Puedes adjuntar hasta 5 archivos.');
  if(retainIds===undefined)retainIds=existing.map(f=>f.id);
  if(!Array.isArray(retainIds)||retainIds.some(id=>typeof id!=='string'||!existing.some(f=>f.id===id))||new Set(retainIds).size!==retainIds.length)fail(400,'La selección de archivos guardados no es válida.');
  const kept=existing.filter(f=>retainIds.includes(f.id));
  if(kept.length+uploads.length>5)fail(400,'Puedes conservar hasta 5 archivos en total.');
  const added=uploads.map(input=>{
   if(!/\.(pdf|png|jpe?g|webp|gif|xlsx|csv|docx|pptx|txt)$/i.test(input?.name||''))fail(400,'Adjunta PDF, imágenes, PPTX, DOCX, XLSX, CSV o TXT.');
   const file=validateFile(input);
   if(file.size>(teacher?20:10)*1024*1024)fail(413,`Cada archivo admite hasta ${teacher?20:10} MB.`);
   return {...file,id:randomUUID()};
  });
  const metadata=f=>({id:f.id,key:f.key,name:f.name,mime:f.mime,size:f.size});
  const files=[...kept,...added.map(metadata)];
  if(files.reduce((n,f)=>n+f.size,0)>20*1024*1024)fail(413,'Los archivos juntos no pueden superar los 20 MB.');
  if(added.length){const disk=statfsSync(uploadsDir);if(Number(disk.bavail)*Number(disk.bsize)<added.reduce((n,f)=>n+f.size,0)+50*1024*1024)fail(413,'No hay espacio disponible. Usa un enlace o consulta con tu docente.');}
  return {files,added,removed:existing.filter(f=>!retainIds.includes(f.id))};
 }
 function write(plan){const written=[];try{for(const f of plan.added){writeFileSync(join(uploadsDir,f.key),f.buffer,{flag:'wx',mode:0o600});written.push(f);}}catch(error){written.forEach(remove);throw error;}}
 function storeInstructions(activityId,plan){db.prepare('DELETE FROM activity_files WHERE activity_id=?').run(activityId);const insert=db.prepare('INSERT INTO activity_files(id,activity_id,file_key,name,mime,size,position) VALUES (?,?,?,?,?,?,?)');plan.files.forEach((f,i)=>insert.run(f.id,activityId,f.key,f.name,f.mime,f.size,i));}
 function usedBytes(){return db.prepare("SELECT COALESCE(SUM(CASE WHEN json_type(payload,'$.files') IS NULL THEN COALESCE(json_extract(payload,'$.file.size'),0) ELSE (SELECT COALESCE(SUM(json_extract(value,'$.size')),0) FROM json_each(payload,'$.files')) END),0) n FROM submissions").get().n;}
 function publicFiles(files,base){return files.map(f=>({id:f.id,name:f.name,mime:f.mime,size:f.size,url:`${base}/${encodeURIComponent(f.id)}`,downloadUrl:`${base}/${encodeURIComponent(f.id)}?download=1`}));}
 function courseFiles(id){return [...all('SELECT s.payload FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id=?',id).flatMap(s=>submissionFiles(JSON.parse(s.payload))),...all('SELECT f.file_key AS key FROM activity_files f JOIN activities a ON a.id=f.activity_id WHERE a.course_id=?',id)].map(f=>({file_key:f.key}));}
 return {instructionFiles,prepare,write,storeInstructions,usedBytes,publicFiles,courseFiles,remove};
}
