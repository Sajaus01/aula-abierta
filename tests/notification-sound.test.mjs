import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleArrivalChime} from '../public/notification-sound.js';

test('the arrival chime uses short fixed notes with a soft envelope and releases its audio nodes',()=>{
 const oscillators=[],gains=[];
 const audio={currentTime:2,destination:{},createOscillator(){const oscillator={frequency:{values:[],setValueAtTime(...value){this.values.push(value);}},connect(){},start(at){this.startAt=at;},stop(at){this.stopAt=at;},disconnect(){this.disconnected=true;}};oscillators.push(oscillator);return oscillator;},createGain(){const gain={gain:{values:[],setValueAtTime(...value){this.values.push(value);},exponentialRampToValueAtTime(...value){this.values.push(value);}},connect(){},disconnect(){this.disconnected=true;}};gains.push(gain);return gain;}};
 scheduleArrivalChime(audio);
 assert.equal(oscillators.length,2);
 assert.deepEqual(oscillators.map(node=>node.frequency.values[0][0]),[659.25,523.25]);
 assert.ok(oscillators.every(node=>node.type==='sine'&&node.stopAt-node.startAt<=.251));
 assert.ok(oscillators[1].stopAt-audio.currentTime<.4);
 assert.ok(gains.every(node=>Math.max(...node.gain.values.map(([value])=>value))<=.035));
 for(const node of oscillators)node.onended();
 assert.ok([...oscillators,...gains].every(node=>node.disconnected));
});

test('an arrival resumes audio suspended by an idle browser without requiring a second interaction',async()=>{
 const keys=['document','window','AudioContext','localStorage','BroadcastChannel'],previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),listeners=new Map(),values=new Map(),tones=[];let instance;
 const parameter=()=>({setValueAtTime(){},exponentialRampToValueAtTime(){}});
 class AudioMock{constructor(){instance=this;}state='running';currentTime=1;destination={};resume(){this.state='running';return Promise.resolve();}createOscillator(){return {frequency:parameter(),connect(){},disconnect(){},start(){tones.push('start');},stop(){}};}createGain(){return {gain:parameter(),connect(){},disconnect(){}};}}
 try{
  const fake={document:{addEventListener:(name,fn)=>listeners.set(name,fn)},window:{addEventListener(){}},AudioContext:AudioMock,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},BroadcastChannel:class{postMessage(){}}};
  for(const [key,value]of Object.entries(fake))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const sound=await import('../public/notification-sound.js?idle-resume-test');
  assert.equal(sound.playArrivalSound('before-interaction'),false);assert.equal(instance,undefined);
  listeners.get('pointerdown')();instance.state='suspended';
  sound.playArrivalSound('idle-incoming');sound.playArrivalSound('idle-incoming');
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(instance.state,'running');assert.equal(tones.length,2);
  assert.equal(sound.playArrivalSound('idle-incoming'),false);
 }finally{for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
