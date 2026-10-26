import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('arrival audio unlocks only after interaction and respects silence and recording without audio hardware',async()=>{
 const keys=['document','window','AudioContext','localStorage','BroadcastChannel'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),listeners=new Map(),values=new Map(),tones=[];
 const parameter=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
 class AudioMock{state='suspended';currentTime=1;destination={};resume(){this.state='running';return Promise.resolve();}createOscillator(){return {frequency:parameter(),connect(){},disconnect(){},start(){tones.push('start');},stop(){tones.push('stop');}};}createGain(){return {gain:parameter(),connect(){},disconnect(){}};}}
 try{
  Object.assign(globalThis,{document:{addEventListener:(name,fn)=>listeners.set(name,fn)},window:{},AudioContext:AudioMock,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},BroadcastChannel:class{postMessage(){}}});
  const sound=await import('../public/notification-sound.js?runtime-test');
  assert.equal(sound.playArrivalSound('initial-history'),false);assert.equal(tones.length,0);
  listeners.get('pointerdown')();assert.equal(sound.playArrivalSound('initial-history'),false);
  assert.equal(sound.playArrivalSound('new-incoming'),true);assert.deepEqual(tones,['start','stop','start','stop']);
  sound.suppressArrivalSounds(true);assert.equal(sound.playArrivalSound('during-recording'),false);
  sound.suppressArrivalSounds(false);sound.setSoundsEnabled(false);assert.equal(sound.soundsEnabled(),false);assert.equal(sound.playArrivalSound('muted'),false);
 }finally{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

test('service worker deduplicates pushes and polling, uses generic content and silences foreground notifications',async()=>{
 const listeners=new Map(),stored=new Map(),notifications=[],messages=[],windows=[],opened=[];
 const self={location:{origin:'https://aula.example'},addEventListener:(name,fn)=>listeners.set(name,fn),skipWaiting(){},clients:{claim(){},matchAll:async()=>windows,openWindow:async url=>opened.push(url)},registration:{showNotification:async(title,options)=>notifications.push({title,...options})}};
 const caches={open:async()=>({match:async url=>stored.get(url)?.clone(),put:async(url,response)=>stored.set(url,response.clone())})};
 vm.runInContext(await readFile(new URL('../public/notifications-sw.js',import.meta.url),'utf8'),vm.createContext({self,caches,URL,Response,Number,Set,Promise}));
 const dispatch=async(name,data)=>{const waits=[];listeners.get(name)({...data,waitUntil:promise=>waits.push(promise)});await Promise.all(waits);};
 await dispatch('message',{data:{type:'aula-notification-alert',title:'Private grade',options:{body:'9/10',tag:'aula-course-a',data:{href:'#curso/a'}},eventIds:[7]}});
 assert.equal(notifications.length,1);assert.equal(notifications[0].title,'Aula Abierta');assert.equal(notifications[0].body,'Tienes novedades en uno de tus cursos.');assert.equal(notifications[0].silent,false);
 await dispatch('push',{data:{json:()=>({title:'Private grade',body:'9/10',eventId:7,url:'#curso/a'})}});assert.equal(notifications.length,1);
 windows.push({visibilityState:'visible',focused:true,url:'https://aula.example/',postMessage:message=>messages.push(message)});
 await dispatch('push',{data:{json:()=>({title:'Aula',eventId:8,url:'#actividad/a'})}});assert.equal(notifications.length,2);assert.equal(notifications[1].silent,true);assert.equal(messages[0].type,'aula-push-update');
 await dispatch('message',{data:{type:'aula-notification-preferences',sounds:false}});windows.length=0;
 await dispatch('push',{data:{json:()=>({title:'Aula',eventId:9,url:'https://external.example'})}});assert.equal(notifications[2].silent,true);assert.equal(notifications[2].data.href,'#notificaciones');
 await dispatch('notificationclick',{notification:{data:{href:'javascript:alert(1)'},close(){}}});assert.deepEqual(opened,['/#notificaciones']);
});

test('notification permission requires a click and a pending opt-in cannot transfer to another account',async()=>{
 const keys=['document','window','navigator','Notification','location','localStorage','BroadcastChannel','setTimeout','clearTimeout'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),listeners=new Map(),values=new Map(),requests=[];
 let permissionCalls=0,resolvePermission,userId='first';
 class NotificationMock{static permission='default';static requestPermission(){permissionCalls++;return new Promise(resolve=>resolvePermission=resolve);}}
 const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 try{
  const fake={document:{addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,hasFocus:()=>true,visibilityState:'visible',hidden:false},window:{addEventListener(){}},navigator:{},Notification:NotificationMock,location:{hash:'#mis-cursos'},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},BroadcastChannel:class{postMessage(){}},setTimeout:()=>0,clearTimeout(){}};
  for(const [key,value]of Object.entries(fake))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const {createNotificationsUI}=await import('../public/notifications.js?permission-runtime');
  const ui=createNotificationsUI({api:async path=>{requests.push(path);return {items:[],courses:[],unread:0,cursor:10};},getState:()=>({user:{id:userId,roles:['student']},assurance:'password',viewMode:'learning'}),heading:()=>'',toast(){},render(){}});
  ui.enhance();await flush();assert.equal(permissionCalls,0);assert.deepEqual(requests,['/notifications']);
  const action={dataset:{notificationAction:'enable-browser'}};listeners.get('click')[0]({preventDefault(){},target:{closest:selector=>selector==='[data-notification-action]'?action:null}});assert.equal(permissionCalls,1);
  userId='second';ui.enhance();await flush();resolvePermission('granted');await flush();
  assert.equal(values.get('aula-browser-notifications-first'),undefined);assert.equal(values.get('aula-browser-notifications-second'),undefined);assert.equal(requests.some(path=>path.includes('/push/')),false);
  await ui.beforeLogout();
 }finally{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
