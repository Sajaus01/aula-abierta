import {randomUUID} from 'node:crypto';
import {extname,join} from 'node:path';
import {openSync,closeSync,writeFileSync,unlinkSync,statfsSync} from 'node:fs';

const MB=1024*1024;
const starts=(b,bytes)=>b.subarray(0,bytes.length).equals(Buffer.from(bytes));
export function chatFileType(file,fail){
 const b=file.buffer,ext=extname(file.name).toLowerCase(),head=b.subarray(0,65536);
 const image=starts(b,[137,80,78,71,13,10,26,10])?'image/png':starts(b,[255,216,255])?'image/jpeg':/^GIF8[79]a/.test(b.subarray(0,6).toString('ascii'))?'image/gif':b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'?'image/webp':null;
 if(image)return {mime:image,kind:'image'};
 if(['.png','.jpg','.jpeg','.gif','.webp'].includes(ext))fail(400,'El contenido de la imagen no coincide con su formato.');
 const ebml=starts(b,[0x1a,0x45,0xdf,0xa3])&&head.includes(Buffer.from('webm'));
 const ogg=b.subarray(0,4).toString()==='OggS';
 const mp4=b.length>=12&&b.subarray(4,8).toString()==='ftyp';
 const wav=b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE';
 const mp3=b.subarray(0,3).toString()==='ID3'||b.length>=2&&b[0]===255&&(b[1]&0xe0)===0xe0;
 if(ext==='.webm'){if(!ebml)fail(400,'El audio WebM no es válido.');return head.includes(Buffer.from('A_OPUS'))||head.includes(Buffer.from('A_VORBIS'))?{mime:'audio/webm',kind:'audio'}:{mime:'application/octet-stream',kind:'file'};}
 if(ext==='.ogg'||ext==='.oga'){if(!ogg)fail(400,'El audio Ogg no es válido.');return head.includes(Buffer.from('OpusHead'))||head.includes(Buffer.from('vorbis'))?{mime:'audio/ogg',kind:'audio'}:{mime:'application/octet-stream',kind:'file'};}
 if(ext==='.mp4'||ext==='.m4a'){if(!mp4)fail(400,'El audio MP4 no es válido.');return b.includes(Buffer.from('soun'))||b.subarray(8,12).toString()==='M4A '?{mime:'audio/mp4',kind:'audio'}:{mime:'application/octet-stream',kind:'file'};}
 if(ext==='.wav'){if(!wav)fail(400,'El audio WAV no es válido.');return {mime:'audio/wav',kind:'audio'};}
 if(ext==='.mp3'){if(!mp3)fail(400,'El audio MP3 no es válido.');return {mime:'audio/mpeg',kind:'audio'};}
 return {mime:'application/octet-stream',kind:'file'};
}

export function createChatMedia({db,fail,validateFile,uploadsDir,storage}){
 const rows=id=>db.prepare('SELECT id,file_key AS key,name,mime,size,kind FROM chat_files WHERE message_id=? ORDER BY position,id').all(id);
 const publicFiles=id=>rows(id).map(({id,name,mime,size,kind})=>({id,name,mime,size,kind,url:`/api/chat/files/${id}`,downloadUrl:`/api/chat/files/${id}?download=1`}));
 function prepare(inputs=[]){
  if(!Array.isArray(inputs)||inputs.length>5)fail(400,'Puedes adjuntar hasta 5 archivos por mensaje.');
  if(inputs.length&&!validateFile)fail(503,'Los adjuntos no están disponibles.');
  const added=inputs.map(input=>{
   const f=validateFile(input,{any:true});if(f.size>10*MB)fail(413,'Cada archivo admite hasta 10 MB.');
   return {...f,...chatFileType(f,fail),id:randomUUID()};
  });
  const size=added.reduce((n,f)=>n+f.size,0);if(size>20*MB)fail(413,'Los archivos de un mensaje juntos admiten hasta 20 MB.');
  if(size&&!storage){const disk=statfsSync(uploadsDir);if(Number(disk.bavail)*Number(disk.bsize)<size+50*MB)fail(413,'No hay espacio disponible para los adjuntos.');}
  return {added,written:[]};
 }
 function rollback(plan){for(const f of plan.written){try{unlinkSync(join(uploadsDir,f.key));}catch(error){if(error.code!=='ENOENT')console.error('No se pudo retirar un adjunto de chat incompleto.');}}plan.written=[];}
 function save(messageId,plan,{userId,courseId}){
  storage?.assertUpload({userId,courseId,added:plan.added,kind:'chat'});
  const insert=db.prepare('INSERT INTO chat_files(id,message_id,file_key,name,mime,size,kind,position) VALUES(?,?,?,?,?,?,?,?)');
  for(const [position,f] of plan.added.entries()){
   const descriptor=openSync(join(uploadsDir,f.key),'wx',0o600);plan.written.push(f);
   try{writeFileSync(descriptor,f.buffer);}finally{closeSync(descriptor);}
   insert.run(f.id,messageId,f.key,f.name,f.mime,f.size,f.kind,position);
  }
 }
 return {prepare,save,rollback,rows,publicFiles};
}
