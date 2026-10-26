const preferenceKey='aula-arrival-sounds',leaseKey='aula-arrival-sound-lease';
const read=key=>{try{return globalThis.localStorage?.getItem(key);}catch{return null;}};
const write=(key,value)=>{try{globalThis.localStorage?.setItem(key,value);}catch{}};
let preferenceOverride=null;
export const soundsEnabled=()=>preferenceOverride??(read(preferenceKey)!=='off');
export function setSoundsEnabled(enabled){preferenceOverride=Boolean(enabled);write(preferenceKey,enabled?'on':'off');}
export function createArrivalSoundGate({now=()=>Date.now(),burstMs=2000,maxKeys=300}={}){const seen=new Map();let last=-Infinity;return {remember(key,played=false){if(played)last=now();seen.set(String(key),now());if(seen.size>maxKeys)seen.delete(seen.keys().next().value);},accept(key,{enabled=true,suppressed=false,ready=true}={}){key=String(key||'');if(!key||seen.has(key))return false;const time=now();seen.set(key,time);if(seen.size>maxKeys)seen.delete(seen.keys().next().value);if(!enabled||suppressed||!ready||time-last<burstMs)return false;last=time;return true;}};}
const gate=createArrivalSoundGate();let context=null,suppressed=false,channel=null,interacted=false;
const pendingResume=new Set();let resumePromise=null;
try{if(typeof window!=='undefined'&&typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('aula-arrival-sounds');channel.onmessage=event=>{if(typeof event.data?.key==='string')gate.remember(event.data.key,true);};}}catch{}
if(typeof window!=='undefined')window.addEventListener?.('storage',event=>{if(event.key===preferenceKey)preferenceOverride=event.newValue!=='off';});
function unlock(){const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;interacted=true;try{context??=new Audio();if(context.state==='suspended'||context.state==='interrupted')void context.resume().catch(()=>{});}catch{}}
if(typeof document!=='undefined'){document.addEventListener('pointerdown',unlock,{capture:true,passive:true});document.addEventListener('keydown',unlock,{capture:true,passive:true});}
export function suppressArrivalSounds(value){suppressed=Boolean(value);}
// A quiet, rounded two-note chime. Fixed pitches avoid the old rising chirp.
export function scheduleArrivalChime(audio){
 const start=audio.currentTime;
 for(const [delay,frequency,volume]of [[0,659.25,.035],[.115,523.25,.028]]){
  const oscillator=audio.createOscillator(),gain=audio.createGain(),at=start+delay;
  oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,at);
  gain.gain.setValueAtTime(.0001,at);
  gain.gain.exponentialRampToValueAtTime(volume,at+.012);
  gain.gain.exponentialRampToValueAtTime(.0001,at+.23);
  oscillator.connect(gain);gain.connect(audio.destination);
  oscillator.start(at);oscillator.stop(at+.25);
  oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
 }
}
export function playArrivalSound(key){
 // Browsers may suspend an already unlocked audio context while a tab is idle.
 // Resume that context on arrival; the first unlock still requires interaction.
 if(interacted&&(context?.state==='suspended'||context?.state==='interrupted')&&soundsEnabled()&&!suppressed){
  if(!pendingResume.has(key)){
   pendingResume.add(key);resumePromise??=Promise.resolve().then(()=>context.resume()).finally(()=>{resumePromise=null;});
   void resumePromise.then(()=>{if(context.state==='running')playArrivalSound(key);}).catch(()=>{}).finally(()=>pendingResume.delete(key));
  }
  return false;
 }
 if(!gate.accept(key,{enabled:soundsEnabled(),suppressed,ready:context?.state==='running'}))return false;const now=Date.now();let lease;try{lease=JSON.parse(read(leaseKey)||'null');}catch{}if(lease&&now-Number(lease.at)<2000)return false;write(leaseKey,JSON.stringify({key:String(key),at:now}));try{channel?.postMessage({key:String(key)});scheduleArrivalChime(context);return true;}catch{return false;}
}
