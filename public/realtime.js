const channels=new Set(['chat','notifications']);
export function realtimeScope(state){const roles=state?.user?.roles;if(!Array.isArray(roles)||!roles.length||state.assurance!=='password'||state.preview||state.user.mustChangePassword)return null;const view=state.viewMode==='learning'?'learning':'teaching';return {key:state.user.id+':'+view+':'+[...roles].sort().join(','),userId:state.user.id,view};}

// A single authenticated connection serves both inboxes in this browser tab.
// Hints contain no messages; the normal APIs recheck access before returning data.
export function createRealtimeClient({Source=globalThis.EventSource,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const listeners=new Set();let source=null,scope=null,connected=false,retry=null,blocked=null,epoch=0;
 function close(){epoch++;clearTimer(retry);retry=null;source?.close();source=null;connected=false;}
 function deliver(kind,payload={}){const wanted=kind==='sync'&&Array.isArray(payload.channels)?payload.channels:['chat','notifications'];for(const listener of listeners){if(!wanted.includes(listener.channel)||realtimeScope(listener.getState())?.key!==scope?.key)continue;try{listener.onSync({type:kind,...payload});}catch{}}}
 function connect(){
  if(!scope||!Source||blocked===scope.key)return;
  const version=++epoch;let candidate;try{candidate=new Source('/api/events?'+new URLSearchParams({aula_view:scope.view}),{withCredentials:true});}catch{retry=setTimer(connect,5000);return;}source=candidate;
  const current=()=>source===candidate&&epoch===version;
  candidate.addEventListener('open',()=>{if(!current())return;connected=true;deliver('reconnected');});
  candidate.addEventListener('sync',event=>{if(!current())return;try{const payload=JSON.parse(event.data);if(payload&&Array.isArray(payload.channels)&&payload.channels.some(channel=>channels.has(channel)))deliver('sync',payload);}catch{}});
  candidate.addEventListener('revoked',()=>{if(!current())return;blocked=scope.key;close();deliver('revoked');});
  candidate.addEventListener('error',()=>{if(!current())return;connected=false;deliver('disconnected');if(candidate.readyState===2){candidate.close();source=null;retry=setTimer(connect,5000);}});
 }
 function sync(getState){const next=realtimeScope(getState());if(!next){close();scope=null;blocked=null;return;}if(next.key!==scope?.key){close();scope=next;blocked=null;}if(!source&&!retry&&blocked!==scope.key)connect();}
 function subscribe(channel,getState,onSync){if(!channels.has(channel))throw Error('Unknown realtime channel');const listener={channel,getState,onSync};listeners.add(listener);return {sync:()=>sync(getState),isConnected:()=>connected&&realtimeScope(getState())?.key===scope?.key,dispose(){listeners.delete(listener);if(!listeners.size){close();scope=null;blocked=null;}}};}
 return {subscribe,stop:close,isConnected:()=>connected};
}
export const realtime=createRealtimeClient();

// Preserve an event arriving during a fetch, rather than waiting for a timer.
export function createRefreshQueue(run,{schedule=queueMicrotask}={}){
 let running=false,pending=false,againForce=false;
 async function refresh(force=false){if(running){pending=true;againForce||=force;return;}running=true;try{return await run(force);}finally{running=false;if(pending){const nextForce=againForce;pending=false;againForce=false;schedule(()=>void refresh(nextForce));}}}
 return {refresh,isRunning:()=>running};
}

export function incomingChatArrivals(data,seen,{ready,userId}){
 const incoming=[];for(const item of data.conversations||[]){if(!item.own)continue;const previous=seen.get(item.id)||0;if(ready&&!item.muted&&!item.deleted&&item.unread>0&&item.lastSenderId!==userId&&item.lastId>previous)incoming.push(item);seen.set(item.id,Math.max(previous,item.lastId||0));}return incoming;
}
