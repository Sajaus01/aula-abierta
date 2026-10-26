import test from 'node:test';
import assert from 'node:assert/strict';
import {messageText,otherParticipants,peerIsOnline,messageReceipt,canAcknowledgeMessages,chatMessage} from '../public/chat-message.js';

const conversation={own:true,canSend:true,canModerate:false,peerReadId:0,participants:[{id:'self',name:'Camila',online:true},{id:'peer',name:'Daniel',online:false}]};
const message={id:42,senderId:'self',body:'Mensaje breve',createdAt:'2026-10-26T17:00:00.000Z'};
const render=(m=message,d=conversation)=>chatMessage(m,d,{userId:'self',time:()=> '12:00',day:()=> '26 oct',mini:()=>'',control:(label,action,id)=>`<button data-action="${action}" data-id="${id}">${label}</button>`});

test('online status belongs to the other person, not to the viewer’s own active session',()=>{
 assert.deepEqual(otherParticipants(conversation,'self').map(p=>p.id),['peer']);
 assert.equal(peerIsOnline(conversation,'self'),false);
 assert.equal(peerIsOnline({...conversation,participants:[{...conversation.participants[0],online:false},{...conversation.participants[1],online:true}]},'self'),true);
 assert.equal(peerIsOnline({...conversation,participants:[conversation.participants[0]]},'self'),false);
 assert.deepEqual(otherParticipants({...conversation,own:false},'moderator').map(p=>p.id),['self','peer']);
});

test('individual unread state survives a larger receipt watermark from a merged legacy conversation',()=>{
 assert.match(messageReceipt({...message,readByPeer:false},{peerReadId:999}),/class="chat-receipt sent"/);
 assert.match(messageReceipt({...message,readByPeer:true},{peerReadId:0}),/class="chat-receipt read"/);
 assert.match(messageReceipt(message,{peerReadId:41}),/aria-label="Enviado"/);
 assert.match(messageReceipt(message,{peerReadId:42}),/aria-label="Leído"/);
 const sent=messageReceipt({...message,readByPeer:false},conversation),read=messageReceipt({...message,readByPeer:true},conversation);
 assert.equal((sent.match(/<path /g)||[]).length,1);assert.equal((read.match(/<path /g)||[]).length,2);
});

test('receipts require an actually visible message in the active personal conversation',()=>{
 const eligible={own:true,minimized:false,visible:true,focused:true,connected:true,inViewport:true,atEnd:true,lastVisible:true,lastId:42,readId:41};
 assert.equal(canAcknowledgeMessages(eligible),true);
 for(const [key,value]of [['own',false],['minimized',true],['visible',false],['focused',false],['connected',false],['inViewport',false],['atEnd',false],['lastVisible',false]])assert.equal(canAcknowledgeMessages({...eligible,[key]:value}),false,key);
 assert.equal(canAcknowledgeMessages({...eligible,readId:42}),false);
 assert.equal(canAcknowledgeMessages({...eligible,lastId:0,readId:0}),false);
});

test('compact personal messages keep content and time while moving secondary actions into a disclosure',()=>{
 const html=render({...message,readByPeer:true,editedAt:'2026-10-26T17:05:00.000Z'});
 assert.match(html,/Mensaje breve/);assert.match(html,/<time datetime="2026-10-26T17:00:00.000Z">12:00<\/time>/);
 assert.match(html,/Editado/);assert.match(html,/<details class="chat-message-menu">/);assert.match(html,/aria-label="Opciones del mensaje"/);
 assert.match(html,/data-action="reply"/);assert.match(html,/data-action="edit-message"/);assert.match(html,/data-action="delete-message"/);
 assert.doesNotMatch(html,/chat-sender/);assert.match(html,/aria-label="Leído"/);
 const peer=render({...message,senderId:'peer'});assert.doesNotMatch(peer,/chat-receipt/);assert.match(peer,/data-action="report"/);
 const removed=render({...message,deleted:true,body:'Contenido retirado'});assert.match(removed,/Mensaje eliminado/);assert.doesNotMatch(removed,/Contenido retirado|chat-receipt|chat-message-menu/);
});

test('per-message origin permissions limit moderation controls even when another group is supervised',()=>{
 const html=render({...message,senderId:'peer',canDelete:false,canReport:false,canModerate:false,history:[{body:'Historial ajeno',changedAt:message.createdAt}]},{...conversation,canSend:false,canModerate:true});
 assert.doesNotMatch(html,/data-action="delete-message"|data-action="report"|Historial ajeno/);
 const allowed=render({...message,senderId:'peer',canDelete:true,canModerate:true,originalBody:'Original <protegido>',history:[{body:'Versión <anterior>',changedAt:message.createdAt}]},{...conversation,own:false,canSend:false,canModerate:true});
 assert.match(allowed,/data-action="delete-message"/);assert.match(allowed,/Original &lt;protegido&gt;/);assert.match(allowed,/Versión &lt;anterior&gt;/);
});

test('message bodies, replies and links retain text without accepting executable markup or embedded credentials',()=>{
 const html=render({...message,body:'<img src=x onerror=alert(1)> https://example.com/?a=1&b=2',reply:{body:'<script>quoted</script>'}});
 assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;quoted&lt;\/script&gt;/);
 assert.match(html,/href="https:\/\/example.com\/\?a=1&amp;b=2"/);assert.match(html,/rel="noopener noreferrer"/);
 assert.doesNotMatch(messageText('https://user:password@example.com/private'),/<a /);
 assert.doesNotMatch(messageText('javascript:alert(1)'),/<a /);
});
