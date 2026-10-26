import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('service worker separates chat/course alert IDs and deduplicates chat SSE fallback against Push',async()=>{
 const listeners=new Map(),stored=new Map(),notifications=[],messages=[],windows=[];
 const self={location:{origin:'https://aula.example'},addEventListener:(name,fn)=>listeners.set(name,fn),skipWaiting(){},clients:{claim(){},matchAll:async()=>windows},registration:{showNotification:async(title,options)=>notifications.push({title,...options})}};
 const caches={open:async()=>({match:async url=>stored.get(url)?.clone(),put:async(url,response)=>stored.set(url,response.clone())})};
 vm.runInContext(await readFile(new URL('../public/notifications-sw.js',import.meta.url),'utf8'),vm.createContext({self,caches,URL,Response,Number,Set,Promise}));
 const dispatch=async(name,data)=>{const waits=[];listeners.get(name)({...data,waitUntil:promise=>waits.push(promise)});await Promise.all(waits);};
 const push=data=>dispatch('push',{data:{json:()=>data}});
 await dispatch('message',{data:{type:'aula-notification-alert',options:{data:{href:'#curso/a'}},eventIds:[7]}});
 await dispatch('message',{data:{type:'aula-chat-alert',messageId:7,conversationId:'abc',body:'Private response'}});
 assert.equal(notifications.length,2,'a chat message and a course inbox entry with the same numeric ID both alert');
 assert.equal(notifications[1].body,'Tienes un mensaje nuevo.');assert.equal(notifications[1].data.href,'#mensajes');assert.equal(notifications[1].tag,'aula-chat-abc');
 await push({title:'Private sender',body:'Private response',kind:'chat',eventId:7,conversationId:'abc'});assert.equal(notifications.length,2);
 windows.push({visibilityState:'visible',focused:true,postMessage:message=>messages.push(message)});
 await push({title:'Private sender',body:'Private response',kind:'chat',eventId:8,conversationId:'abc',url:'https://external.example'});
 assert.equal(notifications.length,3);assert.equal(notifications[2].title,'Aula Abierta');assert.equal(notifications[2].body,'Tienes un mensaje nuevo.');assert.equal(notifications[2].data.href,'#mensajes');assert.equal(notifications[2].silent,true);
 assert.equal(messages[0].type,'aula-chat-push-update');assert.equal(messages[0].conversationId,'abc');
 await dispatch('message',{data:{type:'aula-notification-preferences',sounds:false}});windows.length=0;
 await push({title:'Aula',kind:'chat',eventId:9});assert.equal(notifications[3].silent,true);
 await push({title:'Malformed chat',kind:'chat',eventId:null});assert.equal(notifications.length,4);
 const state=await stored.get('https://aula.example/__aula_notification_seen').clone().json();assert.ok(state.includes('chat:7'));assert.ok(state.includes('course:7'));
});
