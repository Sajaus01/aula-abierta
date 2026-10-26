import {escapeHtml as e} from './lib.js';

export function messageText(value){return String(value).split(/(https?:\/\/[^\s<>"']+)/g).map((part,i)=>{if(i%2===0)return e(part);let url;try{url=new URL(part);}catch{return e(part);}return !url.username&&!url.password?`<a href="${e(url.href)}" target="_blank" rel="noopener noreferrer">${e(part)}</a>`:e(part);}).join('');}
export function otherParticipants(conversation,userId){return (conversation.participants||[]).filter(p=>!conversation.own||p.id!==userId);}
export function peerIsOnline(conversation,userId){return otherParticipants(conversation,userId).some(p=>p.online===true);}
export function messageReceipt(message,conversation){
 const read=typeof message.readByPeer==='boolean'?message.readByPeer:(conversation.peerReadId||0)>=message.id;
 const label=read?'Leído':'Enviado';
 return `<span class="chat-receipt ${read?'read':'sent'}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 8 4 4L16 2"/>${read?'<path d="m10 11 2 1L22 2"/>':''}</svg></span>`;
}
export function canAcknowledgeMessages({own,minimized,visible,focused,connected,inViewport,atEnd,lastVisible,lastId,readId}){
 return Boolean(own&&!minimized&&visible&&focused&&connected&&inViewport&&atEnd&&lastVisible&&lastId>readId);
}
const privateAsset=value=>typeof value==='string'&&/^\/api\/chat\/files\/[\w-]+(?:\?[^#]*)?$/.test(value)?value:'';
export function chatContextHTML(context,{pending=false}={}){
 if(!context)return '';const href=typeof (context.href||context.url)==='string'&&/^#(?:curso|actividad)\/[\w-]+(?:\?[^\s"<>]*)?$/.test(context.href||context.url)?context.href||context.url:'';
 const content=`<span class="chat-context-kind">${pending?'Pregunta sobre':context.activityId?'Consulta sobre la actividad':'Consulta sobre el material'}</span><strong>${e(context.title||context.courseTitle||'Contenido del curso')}</strong><small>${[context.courseTitle,context.moduleTitle].filter(Boolean).map(e).join(' · ')}</small>`;
 return href&&!pending?`<a class="chat-context-card" href="${e(href)}">${content}<span>Ver contenido ↗</span></a>`:`<div class="chat-context-card ${pending?'pending':''}">${content}</div>`;
}
export function chatAttachmentsHTML(files=[]){
 return files.map(file=>{const url=privateAsset(file.url),download=privateAsset(file.downloadUrl)||url;if(!url)return '';const name=e(file.name||'Archivo'),size=Number(file.size)||0,label=size<1048576?Math.max(1,Math.ceil(size/1024))+' KB':(size/1048576).toLocaleString('es-CO',{maximumFractionDigits:1})+' MB';
  const visual=file.kind==='image'&&/^image\/(png|jpeg|gif|webp)$/i.test(file.mime||'')?`<a class="chat-sent-image" href="${e(url)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="${e(url)}" alt="${name}"></a>`:file.kind==='audio'&&/^audio\//.test(file.mime||'')?`<audio controls preload="metadata" src="${e(url)}" aria-label="Escuchar ${name}"></audio>`:'';
  return `<div class="chat-sent-attachment ${visual?'with-preview':''}">${visual}<a class="chat-sent-file" href="${e(download)}" download><span><strong>${name}</strong><small>${label}</small></span><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/></svg></a></div>`;
 }).join('');
}
export function chatMessage(m,d,{userId,mini,control,time,day}){
 const mine=m.senderId===userId,reports=m.reports?.filter(r=>!r.resolvedAt)||[];
 const actions=`${!m.deleted&&d.canSend?control('Responder','reply',String(m.id),'back','ghost small'):''}${mine&&!m.deleted&&d.canSend&&m.body?control('Editar','edit-message',String(m.id),'edit','ghost small'):''}${!m.deleted&&!d.deleted&&(m.canDelete??(mine||d.canModerate))?control('Eliminar','delete-message',String(m.id),'trash','ghost small'):''}${!mine&&!m.deleted&&d.own&&(m.canReport!==false)?control('Reportar','report',String(m.id),'shield','ghost small'):''}`;
 return `<article class="chat-bubble ${mine?'mine':''} ${m.deleted?'deleted':''} ${m.files?.length?'has-attachments':''}" data-message="${m.id}">${!m.deleted?chatContextHTML(m.context):''}${m.reply?`<blockquote>${e(m.reply.body||'Archivo adjunto')}</blockquote>`:''}<div class="chat-message-text">${m.deleted?'Mensaje eliminado':messageText(m.body||'')}</div>${!m.deleted?chatAttachmentsHTML(m.files):''}<footer class="chat-message-meta"><time datetime="${e(m.createdAt)}">${time(m.createdAt)}</time>${m.editedAt?'<span>Editado</span>':''}${mine&&d.own&&!m.deleted?messageReceipt(m,d):''}</footer>${actions?`<details class="chat-message-menu"><summary aria-label="Opciones del mensaje" title="Opciones del mensaje"><svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></summary><div class="chat-message-actions">${actions}</div></details>`:''}${(m.canModerate??d.canModerate)&&(m.originalBody||m.history?.length)?`<details class="chat-history"><summary>Historial del mensaje</summary>${m.originalBody?`<p>Original retirado: ${e(m.originalBody)}</p>`:''}${(m.history||[]).map(h=>`<p>${day(h.changedAt)} ${time(h.changedAt)} · ${e(h.body)}</p>`).join('')}</details>`:''}${reports.map(r=>`<div class="chat-report"><strong>Reporte pendiente</strong><p>${e(r.reason)}</p>${control('Resolver','resolve-report',r.id,'check')}</div>`).join('')}</article>`;
}
