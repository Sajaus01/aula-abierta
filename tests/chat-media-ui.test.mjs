import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatMedia,validateChatFiles,mediaKind,pendingMediaHTML} from '../public/chat-media.js';
import {chatAttachmentsHTML,chatContextHTML} from '../public/chat-message.js';

const sample=(name='resultado.txt',text='Resultado',type='text/plain')=>new File([text],name,{type,lastModified:10});
const setup=options=>{const revoked=[],state=createChatMedia({makeUrl:f=>'blob:'+encodeURIComponent(f.name),revokeUrl:url=>revoked.push(url),...options});return {state,revoked};};
test('attachments enforce limits before mutating pending files and are released after removing/sending',async()=>{
 const {state,revoked}=setup();state.addFiles([sample()]);state.addFiles([sample()]);assert.equal(state.state.items.length,1);
 assert.throws(()=>state.addFiles([sample('empty','')]),/vacío/);assert.equal(state.state.items.length,1);
 assert.throws(()=>validateChatFiles([{size:11*1048576}]),/10 MB/);assert.throws(()=>validateChatFiles(Array(6).fill({size:1})),/5 archivos/);assert.throws(()=>validateChatFiles(Array(3).fill({size:8*1048576})),/20 MB/);
 assert.equal((await state.payload())[0].base64,Buffer.from('Resultado').toString('base64'));
 const id=state.state.items[0].id;state.remove(id);assert.equal(state.state.items.length,0);assert.equal(revoked.length,1);
});
test('file previews escape names and render only expected image/audio types',()=>{
 const {state}=setup();state.addFiles([sample('<foto>.png','png','image/png'),sample('voz.webm','audio','audio/webm'),sample('archivo.svg','svg','image/svg+xml')]);
 const html=pendingMediaHTML(state.state);assert.match(html,/&lt;foto&gt;.png/);assert.match(html,/<audio controls/);assert.match(html,/chat-pending-file-icon/);assert.equal(mediaKind(sample('archivo.svg','svg','image/svg+xml')),'file');state.dispose();
});
class Recorder extends EventTarget{
 static isTypeSupported=mime=>mime==='audio/webm;codecs=opus';
 constructor(stream,options){super();this.mimeType=options?.mimeType;this.state='inactive';}
 start(){this.state='recording';}
 stop(){this.state='inactive';queueMicrotask(()=>{const event=new Event('dataavailable');event.data=new Blob(['synthetic audio'],{type:'audio/webm'});this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));});}
}
test('recording stops microphone tracks and produces a preview before any send',async()=>{
 let stops=0,timer,stamp=1000;const {state}=setup({Recorder,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})},now:()=>stamp,setTimer:fn=>(timer=fn,1),clearTimer:()=>{}});
 await state.begin();assert.equal(state.state.recording,true);assert.equal(state.state.items.length,0);
 await assert.rejects(state.payload(),/Termina o cancela/);stamp=6000;timer();assert.equal(state.state.seconds,5);
 const first=state.stop(),second=state.stop();assert.equal(first,second);await first;assert.equal(stops,1);assert.equal(state.state.recording,false);assert.equal(state.state.items.length,1);assert.equal(state.state.items[0].kind,'audio');state.dispose();
});
test('cancelling recording and denied microphone permission never create or send audio',async()=>{
 let stops=0;const {state}=setup({Recorder,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})},setTimer:()=>1,clearTimer:()=>{}});
 await state.begin();state.cancel();await Promise.resolve();await Promise.resolve();assert.equal(stops,1);assert.equal(state.state.items.length,0);assert.equal(state.state.recording,false);
 const denied=setup({Recorder,mediaDevices:{getUserMedia:async()=>{throw Object.assign(Error('Blocked'),{name:'NotAllowedError'});}}}).state;
 await assert.rejects(denied.begin(),/micrófono está bloqueado/);assert.equal(denied.state.requesting,false);
});
test('late microphone permissions are cleaned up after cancelling and recordings end at their duration cap',async()=>{
 let resolve,stops=0,timer,stamp=0;const deferred=setup({Recorder,mediaDevices:{getUserMedia:()=>new Promise(done=>resolve=done)}}).state;
 const request=deferred.begin();deferred.cancel();resolve({getTracks:()=>[{stop:()=>stops++}]});await request;assert.equal(stops,1);assert.equal(deferred.state.recording,false);
 const capped=setup({Recorder,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})},now:()=>stamp,maxSeconds:3,setTimer:fn=>(timer=fn,1),clearTimer:()=>{}}).state;
 await capped.begin();stamp=5000;timer();await Promise.resolve();await Promise.resolve();assert.equal(capped.state.recording,false);assert.equal(capped.state.items.length,1);capped.dispose();
});
test('sent files and context cards permit only authenticated chat assets and internal course links',()=>{
 const files=[{id:'f',name:'<img>.png',mime:'image/png',kind:'image',size:12,url:'/api/chat/files/abc',downloadUrl:'/api/chat/files/abc?download=1'},{id:'a',name:'audio.webm',mime:'audio/webm',kind:'audio',size:12,url:'/api/chat/files/def'}];
 const html=chatAttachmentsHTML(files);assert.match(html,/&lt;img&gt;.png/);assert.match(html,/<img loading/);assert.match(html,/<audio controls/);
 assert.equal(chatAttachmentsHTML([{...files[0],url:'https://untrusted.example/private'}]),'');
 const card=chatContextHTML({title:'<Tarea>',courseTitle:'Curso',moduleTitle:'Capítulo',href:'#actividad/abc',activityId:'abc'});assert.match(card,/&lt;Tarea&gt;/);assert.match(card,/href="#actividad\/abc"/);
 assert.doesNotMatch(chatContextHTML({title:'Texto',href:'javascript:alert(1)'}),/href=/);
});

test('rejection from a cancelled microphone request cannot stop a newer recording',async()=>{
 let rejectOld,calls=0,stops=0;
 const state=setup({Recorder,mediaDevices:{getUserMedia:()=>++calls===1?new Promise((_resolve,reject)=>rejectOld=reject):Promise.resolve({getTracks:()=>[{stop:()=>stops++}]})},setTimer:()=>1,clearTimer:()=>{}}).state;
 const old=state.begin();state.cancel();await state.begin();assert.equal(state.state.recording,true);
 rejectOld(Object.assign(Error('Old request denied'),{name:'NotAllowedError'}));await old;
 assert.equal(state.state.recording,true);assert.equal(stops,0);await state.stop();assert.equal(stops,1);assert.equal(state.state.items.length,1);state.dispose();
});

test('a recorder stop exception releases tracks and permits a later recording to stop normally',async()=>{
 let stopCalls=0,stops=0;
 class FailsOnce extends Recorder{stop(){if(++stopCalls===1)throw Error('Recorder failed');super.stop();}}
 const state=setup({Recorder:FailsOnce,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})},setTimer:()=>1,clearTimer:()=>{}}).state;
 await state.begin();await state.stop();assert.equal(state.state.recording,false);assert.equal(stops,1);
 await state.begin();await state.stop();assert.equal(stopCalls,2);assert.equal(stops,2);assert.equal(state.state.recording,false);assert.equal(state.state.items.length,1);state.dispose();
});
