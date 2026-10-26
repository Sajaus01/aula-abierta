import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverChatDrafts,persistDraftAlternatives,ackDraftSource,createDraftStorage} from '../public/chat-drafts.js';

const storage=initial=>{const values=new Map(Object.entries(initial||{}));return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};};
const conversation={id:'canonical',legacyIds:['old-a','old-b']};

test('canonical draft wins while conflicting legacy drafts remain recoverable without mutation',()=>{
 const s=storage({'aula-chat-user-canonical':'Borrador principal','aula-chat-user-old-a':'Respuesta de otro grupo','aula-chat-user-old-b':'Otra explicación'}),before=[...s.values];
 const result=recoverChatDrafts(s,'user',conversation,'old-b');
 assert.equal(result.draft,'Borrador principal');assert.equal(result.source,'aula-chat-user-canonical');
 assert.deepEqual(result.alternatives.map(x=>x.body),['Otra explicación','Respuesta de otro grupo']);
 assert.deepEqual([...s.values],before);
});

test('direct canonical access recovers legacy text, preferring the requested alias when present',()=>{
 const s=storage({'aula-chat-user-old-a':'Texto A','aula-chat-user-old-b':'Texto B'});
 assert.equal(recoverChatDrafts(s,'user',conversation).draft,'Texto A');
 assert.equal(recoverChatDrafts(s,'user',conversation,'old-b').draft,'Texto B');
 assert.equal(recoverChatDrafts(s,'different-user',conversation).draft,'');
});

test('identical bodies are shown once and acknowledgement clears only their known source keys',()=>{
 const s=storage({'aula-chat-user-canonical':'El mismo texto','aula-chat-user-old-a':'El mismo texto','aula-chat-user-old-b':'El mismo texto',unrelated:'Conservar'});
 const result=recoverChatDrafts(s,'user',conversation);
 assert.equal(result.alternatives.length,0);assert.deepEqual(result.duplicateSources,['aula-chat-user-old-a','aula-chat-user-old-b']);
 ackDraftSource(s,[result.source,...result.duplicateSources]);
 assert.equal(recoverChatDrafts(s,'user',conversation).draft,'');assert.equal(s.getItem('unrelated'),'Conservar');
});

test('stored alternatives survive choosing another text and sending the current draft',()=>{
 const s=storage({'aula-chat-user-canonical':'Texto actual','aula-chat-user-old-a':'Texto recuperado'});
 const first=recoverChatDrafts(s,'user',conversation),alternative=first.alternatives[0];
 assert.equal(persistDraftAlternatives(s,'user','canonical',[{body:first.draft,source:first.source}]),true);
 s.setItem('aula-chat-user-canonical',alternative.body);
 ackDraftSource(s,['aula-chat-user-canonical',alternative.source]);
 const reopened=recoverChatDrafts(s,'user',conversation);assert.equal(reopened.draft,'Texto actual');
 assert.equal(persistDraftAlternatives(s,'user','canonical',[]),true);assert.equal(recoverChatDrafts(s,'user',conversation).draft,'');
});

test('malformed recovery data and foreign sources cannot overwrite or remove another conversation',()=>{
 const s=storage({'aula-chat-recovered-user-canonical':'{invalid','aula-chat-user-unrelated':'No tocar'});
 assert.equal(recoverChatDrafts(s,'user',conversation).draft,'');
 s.setItem('aula-chat-recovered-user-canonical',JSON.stringify([{body:'Recuperar texto',source:'aula-chat-user-unrelated'},{body:42},{body:'',source:'x'}]));
 const result=recoverChatDrafts(s,'user',conversation);assert.equal(result.draft,'Recuperar texto');assert.equal(result.source,'aula-chat-user-canonical');
 ackDraftSource(s,result.source);assert.equal(s.getItem('aula-chat-user-unrelated'),'No tocar');
 ackDraftSource(s,'aula-chat-recovered-user-canonical');assert.ok(s.getItem('aula-chat-recovered-user-canonical'));
});

test('storage denial leaves recovery and send flows usable without discarding in-memory alternatives',()=>{
 const unavailable={getItem(){throw Error('Denied');},setItem(){throw Error('Quota');},removeItem(){throw Error('Denied');}};
 assert.equal(recoverChatDrafts(unavailable,'user',conversation).draft,'');
 assert.equal(persistDraftAlternatives(unavailable,'user','canonical',[{body:'Texto conservado',source:'aula-chat-user-old-a'}]),false);
 assert.equal(ackDraftSource(unavailable,'aula-chat-user-old-a'),false);
});

test('in-memory draft wins over a stale browser value when a write exceeds browser storage quota',()=>{
 const browser=storage({'aula-chat-user-canonical':'Texto anterior'}),wrapped=createDraftStorage(()=>({...browser,setItem(){throw Error('Quota exceeded');}}));
 assert.equal(wrapped.getItem('aula-chat-user-canonical'),'Texto anterior');
 wrapped.setItem('aula-chat-user-canonical','Texto nuevo conservado');
 assert.equal(browser.getItem('aula-chat-user-canonical'),'Texto anterior');
 assert.equal(recoverChatDrafts(wrapped,'user',conversation).draft,'Texto nuevo conservado');
});

test('failed browser removal cannot resurrect a successfully sent draft in the current page',()=>{
 const browser=storage({'aula-chat-user-canonical':'Ya enviado'}),wrapped=createDraftStorage(()=>({...browser,removeItem(){throw Error('Blocked');}}));
 ackDraftSource(wrapped,'aula-chat-user-canonical');
 assert.equal(browser.getItem('aula-chat-user-canonical'),'Ya enviado');assert.equal(wrapped.getItem('aula-chat-user-canonical'),null);
 assert.equal(recoverChatDrafts(wrapped,'user',conversation).draft,'');
 wrapped.setItem('aula-chat-user-canonical','Siguiente mensaje');assert.equal(wrapped.getItem('aula-chat-user-canonical'),'Siguiente mensaje');
});

test('unavailable session storage still keeps unsent texts and recovery choices in memory',()=>{
 const wrapped=createDraftStorage(()=>{throw Error('Security policy');});
 wrapped.setItem('aula-chat-user-old-a','Borrador local');assert.equal(recoverChatDrafts(wrapped,'user',conversation).draft,'Borrador local');
 persistDraftAlternatives(wrapped,'user','canonical',[{body:'Otra respuesta',source:'aula-chat-user-old-b'}]);
 assert.deepEqual(recoverChatDrafts(wrapped,'user',conversation).alternatives.map(x=>x.body),['Otra respuesta']);
});
