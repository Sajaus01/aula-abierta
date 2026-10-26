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
export function chatMessage(m,d,{userId,mini,control,time,day}){
 const mine=m.senderId===userId,reports=m.reports?.filter(r=>!r.resolvedAt)||[];
 const actions=`${!m.deleted&&d.canSend?control('Responder','reply',String(m.id),'back','ghost small'):''}${mine&&!m.deleted&&d.canSend?control('Editar','edit-message',String(m.id),'edit','ghost small'):''}${!m.deleted&&!d.deleted&&(m.canDelete??(mine||d.canModerate))?control('Eliminar','delete-message',String(m.id),'trash','ghost small'):''}${!mine&&!m.deleted&&d.own&&(m.canReport!==false)?control('Reportar','report',String(m.id),'shield','ghost small'):''}`;
 return `<article class="chat-bubble ${mine?'mine':''} ${m.deleted?'deleted':''}" data-message="${m.id}">${m.reply?`<blockquote>${e(m.reply.body)}</blockquote>`:''}<div class="chat-message-text">${m.deleted?'Mensaje eliminado':messageText(m.body)}</div><footer class="chat-message-meta"><time datetime="${e(m.createdAt)}">${time(m.createdAt)}</time>${m.editedAt?'<span>Editado</span>':''}${mine&&d.own&&!m.deleted?messageReceipt(m,d):''}</footer>${actions?`<details class="chat-message-menu"><summary aria-label="Opciones del mensaje" title="Opciones del mensaje"><svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></summary><div class="chat-message-actions">${actions}</div></details>`:''}${(m.canModerate??d.canModerate)&&(m.originalBody||m.history?.length)?`<details class="chat-history"><summary>Historial del mensaje</summary>${m.originalBody?`<p>Original retirado: ${e(m.originalBody)}</p>`:''}${(m.history||[]).map(h=>`<p>${day(h.changedAt)} ${time(h.changedAt)} · ${e(h.body)}</p>`).join('')}</details>`:''}${reports.map(r=>`<div class="chat-report"><strong>Reporte pendiente</strong><p>${e(r.reason)}</p>${control('Resolver','resolve-report',r.id,'check')}</div>`).join('')}</article>`;
}
