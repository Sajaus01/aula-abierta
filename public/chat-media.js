import {escapeHtml as e} from './lib.js';

export const CHAT_FILE_LIMIT=10*1024*1024,CHAT_TOTAL_LIMIT=20*1024*1024,CHAT_FILE_COUNT=5;
export const mediaKind=file=>/^image\/(png|jpeg|gif|webp)$/i.test(file.type||'')?'image':/^audio\//i.test(file.type||'')?'audio':'file';
export function validateChatFiles(files){
 if(files.length>CHAT_FILE_COUNT)throw Error('Puedes adjuntar hasta 5 archivos por mensaje.');
 if(files.some(f=>!Number.isFinite(f.size)||f.size<=0))throw Error('El archivo está vacío o no se puede leer.');
 if(files.some(f=>f.size>CHAT_FILE_LIMIT))throw Error('Cada archivo admite hasta 10 MB.');
 if(files.reduce((n,f)=>n+f.size,0)>CHAT_TOTAL_LIMIT)throw Error('Los archivos juntos pueden pesar hasta 20 MB.');
 return files;
}
export const mediaSize=n=>n<1048576?Math.max(1,Math.ceil(n/1024))+' KB':(n/1048576).toLocaleString('es-CO',{maximumFractionDigits:1})+' MB';
export const recordingTime=seconds=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
export const mediaIcon=name=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${({attach:'m8 12 7-7a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7L13 1m-7 13 9-9',mic:'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8',stop:'M6 6h12v12H6Z',close:'m6 6 12 12M6 18 18 6',file:'M14 3H5v18h14V8l-5-5Zm0 0v6h5M8 13h8m-8 4h6'})[name]||'M5 5h14v14H5Z'}"/></svg>`;

export function pendingMediaHTML(state){
 return `${state.requesting?'<p class="chat-media-status" role="status">Permite el micrófono para grabar…</p>':''}${state.recording?`<div class="chat-recording" role="status"><i></i><strong>Grabando ${recordingTime(state.seconds)}</strong><button type="button" data-chat-media="stop" aria-label="Detener grabación">${mediaIcon('stop')}Listo</button><button type="button" data-chat-media="cancel" aria-label="Cancelar grabación">${mediaIcon('close')}</button></div>`:''}${state.items.length?`<div class="chat-pending-files">${state.items.map(item=>`<article class="chat-pending-attachment" data-pending-file="${e(item.id)}">${item.kind==='image'?`<img src="${e(item.url)}" alt="Vista previa de ${e(item.file.name)}">`:item.kind==='audio'?`<audio controls preload="metadata" src="${e(item.url)}" aria-label="Escuchar audio antes de enviar"></audio>`:`<span class="chat-pending-file-icon">${mediaIcon('file')}</span>`}<span><strong>${e(item.file.name)}</strong><small>${mediaSize(item.file.size)}</small></span><button type="button" data-chat-media="remove" data-media-id="${e(item.id)}" aria-label="Retirar ${e(item.file.name)}">${mediaIcon('close')}</button></article>`).join('')}</div><p class="chat-media-hint">Revisa los adjuntos y pulsa Enviar.</p>`:''}`;
}

export function createChatMedia({onChange=()=>{},mediaDevices=globalThis.navigator?.mediaDevices,Recorder=globalThis.MediaRecorder,makeUrl=file=>URL.createObjectURL(file),revokeUrl=url=>URL.revokeObjectURL(url),makeFile=(parts,name,options)=>new File(parts,name,options),now=()=>Date.now(),setTimer=setInterval,clearTimer=clearInterval,maxSeconds=180}={}){
 const state={items:[],recording:false,requesting:false,seconds:0};
 let recorder=null,stream=null,chunks=[],clock=null,start=0,cancelled=false,disposed=false,epoch=0,finishing=null,stopPromise=null;
 const changed=()=>onChange(state);
 const stopTracks=()=>{for(const track of stream?.getTracks?.()||[])track.stop();stream=null;clearTimer(clock);clock=null;};
 function addFiles(files){
  const fresh=[...files].filter(file=>!state.items.some(item=>item.file.name===file.name&&item.file.size===file.size&&item.file.lastModified===file.lastModified));
  validateChatFiles([...state.items.map(item=>item.file),...fresh]);
  const made=[];try{for(const file of fresh)made.push({id:globalThis.crypto.randomUUID(),file,kind:mediaKind(file),url:makeUrl(file)});}catch(error){made.forEach(item=>revokeUrl(item.url));throw error;}
  state.items.push(...made);changed();
 }
 function remove(id){const index=state.items.findIndex(item=>item.id===id);if(index<0)return;revokeUrl(state.items[index].url);state.items.splice(index,1);changed();}
 function clear(){state.items.forEach(item=>revokeUrl(item.url));state.items=[];changed();}
 async function begin(){
  if(disposed||state.recording||state.requesting)return;
  if(!mediaDevices?.getUserMedia||!Recorder)throw Error('Tu navegador no permite grabar aquí. Puedes adjuntar un audio desde tus archivos.');
  if(state.items.length>=CHAT_FILE_COUNT)throw Error('Retira un archivo antes de añadir el audio.');
  const current=++epoch;state.requesting=true;changed();
  try{
   const acquired=await mediaDevices.getUserMedia({audio:true});
   if(disposed||current!==epoch){acquired.getTracks().forEach(track=>track.stop());return;}
   stream=acquired;chunks=[];cancelled=false;
   const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>Recorder.isTypeSupported?.(type));
   recorder=mime?new Recorder(stream,{mimeType:mime}):new Recorder(stream);
   recorder.addEventListener('dataavailable',event=>{if(event.data?.size)chunks.push(event.data);if(chunks.reduce((n,chunk)=>n+chunk.size,0)>CHAT_FILE_LIMIT)void stop();});
   recorder.addEventListener('stop',()=>{
    stopTracks();state.recording=false;state.requesting=false;
    try{if(!cancelled&&!disposed&&chunks.length){const type=recorder.mimeType?.split(';')[0]||chunks[0].type?.split(';')[0]||'audio/webm',extension=type.includes('ogg')?'ogg':type.includes('mp4')?'m4a':'webm';addFiles([makeFile(chunks,'Audio-'+new Date(now()).toISOString().slice(0,19).replaceAll(':','-')+'.'+extension,{type})]);}}
    catch(error){state.error=error.message;}
    recorder=null;chunks=[];changed();finishing?.();finishing=null;stopPromise=null;
   },{once:true});
   recorder.addEventListener('error',()=>{state.error='No se pudo terminar el audio. Intenta otra vez o adjunta un archivo.';cancel();});
   recorder.start(1000);state.recording=true;state.requesting=false;state.seconds=0;start=now();
   clock=setTimer(()=>{state.seconds=Math.min(maxSeconds,Math.floor((now()-start)/1000));changed();if(state.seconds>=maxSeconds)void stop();},500);changed();
  }catch(error){if(disposed||current!==epoch)return;stopTracks();state.recording=false;state.requesting=false;changed();if(error.name==='NotAllowedError'||error.name==='SecurityError')throw Error('El micrófono está bloqueado. Permítelo en el navegador o adjunta un audio desde tus archivos.');throw Error(error.message||'No se pudo acceder al micrófono.');}
 }
 function stop(){if(stopPromise)return stopPromise;if(!state.recording||!recorder)return Promise.resolve();const result=new Promise(resolve=>{finishing=resolve;});stopPromise=result;try{recorder.stop();}catch{stopTracks();state.recording=false;recorder=null;finishing?.();finishing=null;stopPromise=null;changed();}return result;}
 function cancel(){epoch++;cancelled=true;state.requesting=false;if(recorder&&recorder.state!=='inactive')void stop();else{stopTracks();state.recording=false;changed();}}
 function dispose(){disposed=true;cancel();clear();}
 async function payload(){
  if(state.recording||state.requesting)throw Error('Termina o cancela la grabación antes de enviar.');
  validateChatFiles(state.items.map(item=>item.file));
  return Promise.all(state.items.map(async item=>{const bytes=new Uint8Array(await item.file.arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return {name:item.file.name,mime:item.file.type||'application/octet-stream',kind:item.kind,base64:btoa(raw)};}));
 }
 return {state,addFiles,remove,clear,begin,stop,cancel,dispose,payload,setOnChange(callback){onChange=typeof callback==='function'?callback:()=>{};}};
}
