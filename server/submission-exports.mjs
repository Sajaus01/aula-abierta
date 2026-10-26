import archiver from 'archiver';
import {createHash} from 'node:crypto';
import {createReadStream,realpathSync,statSync} from 'node:fs';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {Readable} from 'node:stream';
import {submissionFiles} from './academic-files.mjs';

// Every archive path is built from individual sanitized segments, never upload paths.
export function exportSegment(value,fallback='Archivo') {
 const cleaned=String(value??'').toWellFormed().normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'-').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
 let name=Array.from(cleaned).slice(0,100).join('').replace(/[. ]+$/g,'')||fallback;
 if(name==='.'||name==='..'||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='_'+name;
 return name;
}
const suffix=id=>createHash('sha256').update(String(id)).digest('hex').slice(0,12);
const named=(name,id)=>`${exportSegment(name)} (${suffix(id)})`;
const parse=value=>JSON.parse(value||'{}');
const stateLabel=row=>row.state==='draft'?(row.returned_at?'Corrección en curso':'Avance sin enviar'):({submitted:'Entregada',graded:'Calificada',returned:'Devuelta para corregir'}[row.state]||row.state);

export function createSubmissionExports({db,uploadsDir,requireAdmin,requireCourse,accessModel,fail,audit}) {
 const all=(sql,...values)=>db.prepare(sql).all(...values),one=(sql,...values)=>db.prepare(sql).get(...values);
 const hasVersions=Boolean(one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_versions'"));

 function buildPlan(course,activities,activityOnly) {
  const entries=[],missing=[],names=new Set(),students=new Map();
  // Physical upload paths are checked independently of the names in the ZIP.
  const root=realpathSync(uploadsDir);
  function unique(name) {let out=name,n=2;while(names.has(out.toLocaleLowerCase('en-US'))){const dot=name.lastIndexOf('.'),slash=name.lastIndexOf('/');out=dot>slash?`${name.slice(0,dot)} (${n++})${name.slice(dot)}`:`${name} (${n++})`;}names.add(out.toLocaleLowerCase('en-US'));return out;}
  const addText=(path,text)=>entries.push({name:unique(path),text});
  function addFile(folder,file) {
   const entry=unique(`${folder}/${exportSegment(file.name)}`);
   const key=String(file.key||'');
   if(!key||key!==basename(key)||/[\\/]/.test(key)){missing.push(entry);return;}
   try {
    const filePath=realpathSync(resolve(root,key)),rel=relative(root,filePath),stats=statSync(filePath);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||resolve(filePath)===root||!stats.isFile()){missing.push(entry);return;}
    entries.push({name:entry,path:filePath,date:stats.mtime});
   }catch(error){if(['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))missing.push(entry);else throw error;}
  }
  for(const activity of activities) {
   const config=parse(activity.config),activityFolder=named(config.title||'Actividad',activity.id);
   const instructions=`Instrucciones/${activityFolder}`;
   const materialText=[config.title||'Actividad',config.description||'',config.instructionUrl?`Enlace de instrucciones: ${config.instructionUrl}`:'',...(config.questions||[]).flatMap((q,i)=>[`Pregunta ${i+1}: ${q.prompt||''}`,...(q.options||[]).map((v,j)=>`  ${j+1}. ${v}`)])].filter(Boolean).join('\n\n');
   addText(`${instructions}/Actividad.txt`,materialText+'\n');
   for(const file of all('SELECT file_key AS key,name FROM activity_files WHERE activity_id=? ORDER BY position,id',activity.id))addFile(instructions,file);
   if(hasVersions)for(const old of all('SELECT revision,files FROM activity_versions WHERE activity_id=? ORDER BY revision',activity.id))for(const file of JSON.parse(old.files))addFile(`${instructions}/Version ${old.revision}`,file);
   for(const row of all('SELECT s.*,u.name AS student_name FROM submissions s JOIN users u ON u.id=s.student_id WHERE s.activity_id=? ORDER BY u.name,s.student_id,s.revision,s.attempt,s.id',activity.id)) {
    if(!students.has(row.student_id))students.set(row.student_id,named(row.student_name,row.student_id));
    const studentFolder=students.get(row.student_id),payload=parse(row.payload),version=payload.previousActivity||config;
    const attempt=`Intento ${row.attempt} - version ${row.revision}${row.superseded?' - historial':''} (${suffix(row.id)})`;
    const folder=`${studentFolder}/${activityOnly?'':activityFolder+'/'}${attempt}`;
    const summary=[`Estudiante: ${row.student_name}`,`Actividad: ${version.title||config.title||'Actividad'}`,`Intento: ${row.attempt}`,`Versión: ${row.revision}${row.superseded?' (historial)':''}`,`Estado: ${stateLabel(row)}`,row.submitted_at?`Enviada: ${row.submitted_at}`:`Guardada: ${row.updated_at}`,payload.text?`\nRespuesta:\n${payload.text}`:'',payload.url?`\nEnlace entregado: ${payload.url}`:'',payload.procedureNote?`\nNota de procedimientos:\n${payload.procedureNote}`:''];
    for(const [index,q] of (version.questions||[]).entries()) {
     const answer=payload.answers?.[q.id];
     const readable=Array.isArray(answer)?answer.map(i=>`${i+1}. ${q.options?.[i]??'Opción no disponible'}`).join('\n'):String(answer??'');
     summary.push(`\nPregunta ${index+1}: ${q.prompt||''}\n${readable||'Sin respuesta'}`);
    }
    addText(`${folder}/Respuesta.txt`,summary.filter(Boolean).join('\n')+'\n');
    for(const file of submissionFiles(payload))addFile(`${folder}/Archivos`,file);
   }
  }
  const title=activityOnly?parse(activities[0].config).title:course.title;
  addText('LEEME.txt',[`Aula Abierta — ${title}`,'Se incluyen todos los intentos, el historial y los avances guardados.','Cada estudiante tiene una sola carpeta. Los intentos y las versiones se conservan por separado.','Las respuestas y los enlaces se guardan en Respuesta.txt. Los enlaces externos no se descargan.',`Estudiantes con respuestas: ${students.size}.`,missing.length?`\nArchivos no disponibles (${missing.length}):\n${missing.join('\n')}`:''].filter(Boolean).join('\n')+'\n');
  return {entries,title};
 }

 async function handler(req,res,path,method,auth) {
  const match=/^\/api\/academics\/(activities|courses)\/([^/]+)\/download$/.exec(path);
  if(!match||!['GET','HEAD'].includes(method))return false;
  requireAdmin(auth);
  if(auth?.preview||auth?.view==='learning')fail(403,'Esta descarga requiere acceso docente.');
  const activityOnly=match[1]==='activities',activity=activityOnly?one('SELECT * FROM activities WHERE id=?',match[2]):null;
  if(activityOnly&&!activity)fail(404,'Actividad no encontrada.');
  const courseId=activityOnly?activity.course_id:match[2],course=requireCourse(courseId,auth);
  if(accessModel)accessModel.requireScope(auth,courseId,'grade');
  const activities=activityOnly?[activity]:all('SELECT * FROM activities WHERE course_id=? ORDER BY created_at,id',courseId);
  const plan=buildPlan(course,activities,activityOnly),filename=exportSegment(plan.title||'Entregas')+' - entregas.zip';
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition',`attachment; filename="entregas.zip"; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`);
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(method==='HEAD'){res.end();return true;}
  audit(auth.user,'submissions.download',activityOnly?activity.id:courseId,{scope:activityOnly?'activity':'course',entries:plan.entries.length});
  // ZIP64 supports archives above 4 GB. Sources are opened only when consumed,
  // and the response stream applies backpressure without a temporary ZIP file.
  const archive=archiver('zip',{zlib:{level:1},forceZip64:true}),sources=new Set();
  let failed=false;
  const stop=()=>{archive.abort();for(const source of sources)source.destroy();archive.destroy();};
  res.once('close',()=>{if(!res.writableFinished)stop();});
  archive.on('error',()=>{if(failed)return;failed=true;stop();res.destroy(new Error('No se pudo completar la descarga ZIP.'));});
  archive.on('warning',()=>{if(failed)return;failed=true;stop();res.destroy(new Error('No se pudo completar la descarga ZIP.'));});
  archive.pipe(res);
  for(const entry of plan.entries) {
   if(entry.text!==undefined){archive.append(entry.text,{name:entry.name});continue;}
   const source=Readable.from((async function*(){const file=createReadStream(entry.path);try{for await(const chunk of file)yield chunk;}finally{file.destroy();}})());
   sources.add(source);source.once('close',()=>sources.delete(source));
   archive.append(source,{name:entry.name,date:entry.date});
  }
  archive.finalize().catch(()=>{if(!failed){failed=true;stop();res.destroy(new Error('No se pudo completar la descarga ZIP.'));}});
  return true;
 }
 return {handler};
}
