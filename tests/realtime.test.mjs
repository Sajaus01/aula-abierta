import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createApp} from '../server/index.mjs';
import {createRealtime} from '../server/realtime.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'aula-realtime-'));
 const app=await createApp({dataDir:root,realtimeHeartbeatMs:80,env:{NODE_ENV:'test',AULA_MODEL_V2:'1',ADMIN_DOCUMENT:'99998001',ADMIN_PASSWORD:'Realtime-Synthetic-2026!'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port,streams=[];
 t.after(async()=>{for(const stream of streams)await stream.close();if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));await rm(root,{recursive:true,force:true});});
 function client(){let cookie='';return {get cookie(){return cookie;},async call(path,body,method=body?'POST':'GET',expected=200,headers={}){const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert.equal(response.status,expected,path+': '+JSON.stringify(result));return result.data;}};}
 const master=client();await master.call('/auth/login',{document:'99998001',password:'Realtime-Synthetic-2026!'});
 const template=await master.call('/admin/courses',{title:'Tiempo real'},'POST',201),groups=[];
 for(const code of ['A','B']){const group=await master.call('/platform/courses/'+template.id+'/clone',{kind:'group',title:'Tiempo real '+code,cohort:'2026',code},'POST',201);await master.call('/platform/courses/'+group.id+'/state',{state:'active'});await master.call('/chat/courses/'+group.id,{enabled:true,studentStaff:true,studentPeers:true},'PUT');groups.push(group);}
 const people=[];
 for(let i=0;i<3;i++){const document=String(99998003+i),user=await master.call('/platform/users',{document,name:'Persona de prueba '+i,roles:['student']},'POST',201),c=client();await c.call('/auth/login',{document,password:document});await c.call('/auth/first-password',{newPassword:'4567',confirmPassword:'4567'});const enrollment=await master.call('/admin/enrollments',{studentId:user.id,courseId:groups[i===2?1:0].id},'POST',201);people.push({user,c,enrollment,document});}
 async function stream(c,extra=''){
  const controller=new AbortController(),response=await fetch(base+'/api/events?aula_view=learning'+extra,{headers:{Cookie:c.cookie,Origin:base},signal:controller.signal});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/event-stream/);assert.equal(response.headers.get('x-accel-buffering'),'no');
  const reader=response.body.getReader(),events=[],waiters=[];let buffer='',closed=false;
  const pump=(async()=>{try{for(;;){const next=await reader.read();if(next.done)break;buffer+=new TextDecoder().decode(next.value);let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const type=/^event: (.+)$/m.exec(frame)?.[1],raw=/^data: (.+)$/m.exec(frame)?.[1];if(!type||!raw)continue;const event={type,data:JSON.parse(raw)};const waiter=waiters.find(w=>w.match(event));if(waiter){waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}else events.push(event);}}}catch(error){if(error.name!=='AbortError')throw error;}finally{closed=true;}})();
  const connection={events,get closed(){return closed;},next(type='sync',predicate=()=>true,timeout=1800){const match=event=>event.type===type&&predicate(event.data),old=events.findIndex(match);if(old>=0)return Promise.resolve(events.splice(old,1)[0]);return new Promise((resolve,reject)=>{const waiter={match,resolve};waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(Error('No llegó evento '+type));},timeout);waiters.push(waiter);});},async close(){controller.abort();await pump;for(const waiter of waiters)clearTimeout(waiter.timer);}};
  streams.push(connection);await connection.next('ready');return connection;
 }
 return {root,app,base,master,client,groups,people,stream};
}

test('SSE delivers incoming messages, reads, edits and typing immediately without receiver requests or interaction',async t=>{
 const {groups:[group],people:[sender,recipient,outsider],stream}=await fixture(t);
 const conversation=await sender.c.call('/chat/conversations',{groupId:group.id,userId:recipient.user.id},'POST',201),path='/chat/conversations/'+conversation.id;
 const incoming=await stream(recipient.c),outgoing=await stream(sender.c),unrelated=await stream(outsider.c);
 const start=performance.now(),message=await sender.c.call(path+'/messages',{body:'Mensaje recibido sin tocar la página',clientKey:'realtime-message-0001'},'POST',201);
 const event=await incoming.next('sync',data=>data.channels.includes('chat'));
 const latency=performance.now()-start;t.diagnostic('Arrival latency: '+Math.round(latency)+' ms');assert.ok(latency<1000,'delivery does not wait for the old six/twenty second poll');
 assert.deepEqual(event.data,{channels:['chat']});assert.equal(JSON.stringify(event).includes('Mensaje recibido'),false);
 await outgoing.next('sync',data=>data.channels.includes('chat'));
 assert.equal((await recipient.c.call(path)).messages[0].id,message.id);
 await recipient.c.call(path+'/read',{id:message.id});await outgoing.next('sync',data=>data.channels.includes('chat'));await incoming.next('sync',data=>data.channels.includes('chat'));
 assert.equal((await sender.c.call(path)).messages[0].readByPeer,true);
 await sender.c.call('/chat/messages/'+message.id,{body:'Mensaje editado'},'PATCH');await incoming.next('sync',data=>data.channels.includes('chat'));await outgoing.next('sync',data=>data.channels.includes('chat'));
 assert.equal((await recipient.c.call(path)).messages[0].body,'Mensaje editado');
 await sender.c.call(path+'/messages',{body:'Reintento',clientKey:'realtime-message-0001'});await recipient.c.call(path+'/read',{id:message.id});
 await assert.rejects(incoming.next('sync',()=>true,150),/No llegó/,'idempotent reads/sends do not create refresh loops');
 await sender.c.call(path+'/typing',{typing:true});await incoming.next('sync',data=>data.channels.includes('chat'));await outgoing.next('sync',data=>data.channels.includes('chat'));
 await sender.c.call(path+'/typing',{typing:false});await incoming.next('sync',data=>data.channels.includes('chat'));
 assert.equal(unrelated.events.filter(e=>e.type==='sync').length,0,'other course members receive no event about this private conversation');
});

test('SSE checks authentication and origin, revalidates membership and closes revoked sessions without polling',async t=>{
 const {base,app,groups:[group],people:[sender,recipient],master,client,stream}=await fixture(t);
 await client().call('/events',undefined,'GET',401);
 await sender.c.call('/events',undefined,'GET',403,{'X-Aula-Preview':group.id});
 const foreign=await fetch(base+'/api/events',{headers:{Cookie:sender.c.cookie,Origin:'https://unrelated.example'}});assert.equal(foreign.status,403);await foreign.arrayBuffer();
 const live=await stream(recipient.c);
 await master.call('/admin/enrollments/'+recipient.enrollment.id,{status:'revoked'},'PATCH');
 const update=await live.next('sync',data=>data.channels.includes('chat'));assert.ok(update.data.channels.includes('notifications'));
 assert.equal(live.closed,false,'account can retain its other course streams');
 await recipient.c.call('/auth/logout',{});await live.next('revoked');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(app.realtime.size,0);
});

test('SSE heartbeat catches expired sessions and active streams do not block server shutdown',async t=>{
 const {app,people:[sender,recipient],stream}=await fixture(t);app.db.prepare('UPDATE enrollments SET expires_at=? WHERE id=?').run(new Date(Date.now()+300).toISOString(),recipient.enrollment.id);const first=await stream(sender.c),second=await stream(recipient.c);
 app.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE user_id=?").run(sender.user.id);
 await first.next('revoked');assert.equal(app.realtime.size,1);await second.next('sync',data=>data.channels.includes('chat')&&data.channels.includes('notifications'));assert.deepEqual((await recipient.c.call('/chat')).groups,[],'enrollment expiry invalidates access without receiver requests');
 await Promise.race([new Promise(resolve=>app.server.close(resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error('SSE blocked shutdown')),1500))]);
 assert.equal(app.realtime.size,0);await second.close();
});

test('SSE bounds connections, drops backpressure and removes closed clients',async()=>{
 const auth={tokenHash:'token',assurance:'password',user:{id:'person',roles:['student']}},fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 const realtime=createRealtime({readSession:()=>auth,fail,maxPerUser:1,maxClients:2,coalesceMs:1,heartbeatMs:100000});
 function connection(){const req={headers:{host:'localhost'},socket:{setNoDelay(){}}},res=new EventEmitter();Object.assign(res,{writableLength:0,writeHead(){},flushHeaders(){},setTimeout(){},write(){},end(){this.emit('close');}});return {req,res};}
 const first=connection();assert.equal(realtime.handler(first.req,first.res,'/api/events','GET',auth),true);assert.equal(realtime.size,1);
 const second=connection();assert.throws(()=>realtime.handler(second.req,second.res,'/api/events','GET',auth),error=>error.status===429);
 first.res.writableLength=70000;realtime.notifyUsers(['person'],['chat','untrusted-channel']);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(realtime.size,0);
 assert.equal(realtime.handler(second.req,second.res,'/api/events','GET',auth),true);second.res.emit('close');assert.equal(realtime.size,0);realtime.stop();
});
