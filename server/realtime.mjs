// Streams contain invalidation hints only. Every refresh still goes through the
// normal API permissions; reconnecting clients fetch current state, not a replay.
export function createRealtime({readSession,fail,appOrigin=null,scopeSignature=()=>'',heartbeatMs=15000,coalesceMs=20,maxPerUser=8,maxClients=500}={}){
 const clients=new Set(),pending=new Map();let batch=null,stopped=false;
 const allowed=new Set(['chat','notifications']);
 const identity=auth=>JSON.stringify([auth?.user?.id,auth?.tokenHash,auth?.assurance,auth?.view||'teaching',[...(auth?.user?.roles||[])].sort()]);
 const eligible=auth=>Boolean(auth?.user?.id&&auth.user.roles?.length&&auth.assurance==='password'&&!auth.preview&&!auth.user.must_change_password&&!auth.user.mustChangePassword);
 function remove(client){if(!clients.delete(client))return;clearInterval(client.timer);client.res.off('close',client.cleanup);client.res.off('error',client.cleanup);}
 function end(client,{revoked=false}={}){if(!clients.has(client))return;if(revoked&&!client.res.destroyed&&!client.res.writableEnded)client.res.write('event: revoked\ndata: {"channels":["chat","notifications"]}\n\n');remove(client);client.res.end();}
 function fresh(client){try{const auth=readSession(client.req);if(!eligible(auth)||identity(auth)!==client.identity){end(client,{revoked:true});return null;}return auth;}catch{end(client,{revoked:true});return null;}}
 function write(client,event,data){if(!fresh(client))return false;if(client.res.destroyed||client.res.writableEnded||client.res.writableLength>65536){end(client);return false;}client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);return true;}
 function drain(){batch=null;const updates=new Map(pending);pending.clear();for(const client of [...clients]){const channels=updates.get(client.userId);if(channels?.size)write(client,'sync',{channels:[...channels]});}}
 function notifyUsers(ids,channels=['chat']){if(stopped)return;const values=channels.filter(value=>allowed.has(value)),connected=new Set([...clients].map(client=>client.userId));if(!values.length)return;for(const id of new Set(ids||[])){if(typeof id!=='string'||!connected.has(id))continue;let set=pending.get(id);if(!set){set=new Set();pending.set(id,set);}values.forEach(value=>set.add(value));}if(pending.size&&!batch){batch=setTimeout(drain,coalesceMs);batch.unref?.();}}
 function revalidate(){for(const client of [...clients]){const auth=fresh(client);if(!auth)continue;let next;try{next=scopeSignature(auth);}catch{end(client,{revoked:true});continue;}if(next!==client.scope){client.scope=next;notifyUsers([client.userId],['chat','notifications']);}}}
 function handler(req,res,path,method,auth){
  if(path!=='/api/events')return false;
  if(method!=='GET')fail(405,'La conexión en directo solo permite lectura.');
  if(stopped)fail(503,'La conexión en directo se está reiniciando.');
  if(!auth)fail(401,'Inicia sesión para recibir las actualizaciones.');
  if(!eligible(auth))fail(403,'La conexión en directo requiere tu sesión personal con contraseña.');
  if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==(appOrigin||`http://${req.headers.host}`))fail(403,'Origen de solicitud no permitido.');
  if(clients.size>=maxClients||[...clients].filter(client=>client.userId===auth.user.id).length>=maxPerUser)fail(429,'Hay demasiadas conexiones en directo. Cierra una pestaña o espera un momento.');
  const scope=scopeSignature(auth),client={req,res,userId:auth.user.id,identity:identity(auth),scope};
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders?.();req.socket?.setNoDelay?.(true);res.setTimeout?.(0);
  client.cleanup=()=>remove(client);res.on('close',client.cleanup);res.on('error',client.cleanup);clients.add(client);
  res.write('retry: 1500\nevent: ready\ndata: {"channels":["chat","notifications"]}\n\n');
  client.timer=setInterval(()=>{revalidateClient(client);if(clients.has(client))res.write(': heartbeat\n\n');},heartbeatMs);client.timer.unref?.();
  return true;
 }
 function revalidateClient(client){const auth=fresh(client);if(!auth)return;try{const scope=scopeSignature(auth);if(scope!==client.scope){client.scope=scope;notifyUsers([client.userId],['chat','notifications']);}}catch{end(client,{revoked:true});}}
 function stop(){stopped=true;clearTimeout(batch);batch=null;pending.clear();for(const client of [...clients])end(client);}
 return {handler,notifyUsers,revalidate,stop,get size(){return clients.size;}};
}
