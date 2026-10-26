import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealtimeClient,createRefreshQueue,realtimeScope,incomingChatArrivals} from '../public/realtime.js';

const userState=(id='one',viewMode='learning')=>({user:{id,roles:['student']},viewMode,assurance:'password'});
class SourceMock extends EventTarget{
 static instances=[];readyState=0;closed=false;
 constructor(url,options){super();this.url=url;this.options=options;SourceMock.instances.push(this);}
 close(){this.closed=true;this.readyState=2;}
 emit(name,value){if(name==='open')this.readyState=1;this.dispatchEvent(new MessageEvent(name,{data:typeof value==='string'?value:JSON.stringify(value)}));}
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

test('one live connection refreshes both inboxes without page interaction, including background state',()=>{
 SourceMock.instances=[];let state={...userState(),hidden:true};const client=createRealtimeClient({Source:SourceMock}),chat=[],notifications=[];
 const a=client.subscribe('chat',()=>state,event=>chat.push(event.type)),b=client.subscribe('notifications',()=>state,event=>notifications.push(event.type));
 a.sync();b.sync();assert.equal(SourceMock.instances.length,1);const source=SourceMock.instances[0];assert.equal(source.url,'/api/events?aula_view=learning');assert.deepEqual(source.options,{withCredentials:true});
 source.emit('open');assert.equal(a.isConnected(),true);assert.deepEqual(chat,['reconnected']);assert.deepEqual(notifications,['reconnected']);
 source.emit('sync',{channels:['chat']});assert.equal(chat.length,2);assert.equal(notifications.length,1);
 source.emit('sync',{channels:['notifications']});assert.equal(notifications.length,2);
 source.emit('sync','invalid json');source.emit('sync',{channels:['private-content']});assert.equal(chat.length,2);assert.equal(notifications.length,2);
 a.dispose();assert.equal(source.closed,false);b.dispose();assert.equal(source.closed,true);
});

test('realtime closes for previews and role/account changes; revoked sessions cannot reconnect or deliver stale events',()=>{
 SourceMock.instances=[];let state=userState();const calls=[],client=createRealtimeClient({Source:SourceMock}),subscription=client.subscribe('chat',()=>state,event=>calls.push(event.type));
 subscription.sync();const first=SourceMock.instances[0];first.emit('open');first.emit('revoked');assert.equal(first.closed,true);assert.deepEqual(calls,['reconnected','revoked']);
 subscription.sync();assert.equal(SourceMock.instances.length,1);first.emit('sync',{channels:['chat']});assert.equal(calls.length,2);
 state=userState('two','teaching');subscription.sync();assert.equal(SourceMock.instances.length,2);assert.equal(SourceMock.instances[1].url,'/api/events?aula_view=teaching');first.emit('open');assert.equal(calls.length,2);
 state={...state,preview:'student'};subscription.sync();assert.equal(SourceMock.instances[1].closed,true);assert.equal(realtimeScope(state),null);
 state=userState('two');subscription.sync();assert.equal(SourceMock.instances.length,3);state={...state,user:{...state.user,mustChangePassword:true}};subscription.sync();assert.equal(SourceMock.instances[2].closed,true);subscription.dispose();
});

test('connection errors preserve native reconnection and expose fallback state until delivery resumes',()=>{
 SourceMock.instances=[];const pending=[],client=createRealtimeClient({Source:SourceMock,setTimer:callback=>{pending.push(callback);return pending.length;},clearTimer(){}}),subscription=client.subscribe('chat',()=>userState(),()=>{});
 subscription.sync();const first=SourceMock.instances[0];first.emit('open');assert.equal(subscription.isConnected(),true);first.readyState=0;first.emit('error');assert.equal(subscription.isConnected(),false);assert.equal(SourceMock.instances.length,1);
 first.emit('open');assert.equal(subscription.isConnected(),true);first.readyState=2;first.emit('error');assert.equal(pending.length,1);pending.shift()();assert.equal(SourceMock.instances.length,2);subscription.dispose();
});

test('an invalidation received during a slow fetch runs immediately afterwards and coalesces further events',async()=>{
 const scheduled=[],releases=[],calls=[],queue=createRefreshQueue(async force=>{calls.push(force);await new Promise(resolve=>releases.push(resolve));},{schedule:callback=>scheduled.push(callback)});
 const first=queue.refresh();void queue.refresh();void queue.refresh(true);void queue.refresh();assert.deepEqual(calls,[false]);releases.shift()();await first;assert.equal(scheduled.length,1);
 scheduled.shift()();assert.deepEqual(calls,[false,true]);releases.shift()();await flush();assert.equal(queue.isRunning(),false);assert.equal(scheduled.length,0);
});

test('chat arrivals ignore history, own messages and muted threads while alerting for an unopened new conversation',()=>{
 const seen=new Map(),conversation={id:'a',own:true,unread:2,lastId:8,lastSenderId:'peer'},pick=(items,ready=true)=>incomingChatArrivals({conversations:items},seen,{ready,userId:'me'});
 assert.deepEqual(pick([conversation],false),[]);assert.deepEqual(pick([conversation]),[]);
 assert.equal(pick([{...conversation,id:'unopened',lastId:9}]).length,1);
 assert.deepEqual(pick([{...conversation,lastId:10,lastSenderId:'me'}]),[]);
 assert.deepEqual(pick([{...conversation,lastId:11,muted:true}]),[]);assert.deepEqual(pick([{...conversation,lastId:11,muted:false}]),[]);
 assert.deepEqual(pick([{...conversation,own:false,lastId:100}]),[]);assert.equal(pick([{...conversation,lastId:12}]).length,1);
});

test('idle background chat and notification UIs react to server events without visibility, focus or pointer events',async()=>{
 const keys=['document','window','navigator','location','localStorage','BroadcastChannel','setTimeout','clearTimeout'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),handlers={},requests=[],state=userState(),local=new Map();
 const root={querySelector:()=>null,querySelectorAll:()=>[],replaceChildren(){},remove(){},insertAdjacentHTML(){}};
 const body={append:node=>{node.parentElement=body;}};
 const environment={document:{body,hidden:true,visibilityState:'hidden',hasFocus:()=>false,activeElement:{matches:()=>false},createElement:()=>({...root}),querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}},window:{addEventListener(){}},navigator:{},location:{hash:'#mis-cursos'},localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)},BroadcastChannel:class{postMessage(){}},setTimeout:()=>0,clearTimeout(){}};
 let chatVersion=0,notificationVersion=0;
 const live={subscribe(channel,getState,callback){handlers[channel]=callback;return {sync(){},isConnected:()=>true};},stop(){}};
 try{
  for(const [key,value]of Object.entries(environment))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const [{createChatUI},{createNotificationsUI}]=await Promise.all([import('../public/chat.js'),import('../public/notifications.js')]);
  const api=async path=>{requests.push(path);return path.startsWith('/chat')?{globalEnabled:true,groups:[],unread:chatVersion,conversations:chatVersion?[{id:'new',own:true,unread:1,lastId:chatVersion,lastSenderId:'other',participants:[]}]:[]}:{items:notificationVersion?[{id:notificationVersion,course:{id:'group'}}]:[],courses:[],unread:notificationVersion,cursor:notificationVersion};};
  const options={api,getState:()=>state,heading:()=>'',toast(){},openModal(){},render(){},realtimeClient:live};
  const chat=createChatUI(options),notifications=createNotificationsUI(options);chat.enhance();notifications.enhance();await flush();assert.deepEqual(requests,['/chat','/notifications']);
  chatVersion=1;notificationVersion=1;handlers.chat({type:'sync'});handlers.notifications({type:'sync'});await flush();assert.equal(requests.filter(path=>path==='/chat').length,2);assert.equal(requests.filter(path=>path==='/notifications?after=0&limit=60').length,1);
  state.user=null;chat.enhance();notifications.enhance();await flush();
 }finally{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
