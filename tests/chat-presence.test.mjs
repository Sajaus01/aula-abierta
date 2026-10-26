import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setupCommunity} from '../server/community.mjs';
import {PRESENCE_TTL,recordPresence,presenceOnline,activePresenceRows} from '../server/presence.mjs';
import {createCommunityUI} from '../public/community.js';

const at=Date.parse('2026-10-26T12:00:00.000Z');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,active INTEGER DEFAULT 1,account_status TEXT DEFAULT 'active',must_change_password INTEGER DEFAULT 0);
 CREATE TABLE user_roles(user_id TEXT REFERENCES users(id),role TEXT);
 CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at TEXT);
 CREATE TABLE courses(id TEXT PRIMARY KEY);
 INSERT INTO courses VALUES('g');
 INSERT INTO users(id,name) VALUES('student','Student'),('teacher','Teacher');
 INSERT INTO user_roles VALUES('student','student'),('teacher','teacher');
 CREATE TABLE presence(session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,tab_id TEXT NOT NULL,course_id TEXT REFERENCES courses(id),seen_at TEXT NOT NULL,PRIMARY KEY(session_hash,tab_id));`);
 const expires=new Date(at+3_600_000).toISOString();for(const [token,user]of [['student-session','student'],['second-session','student'],['teacher-session','teacher']])db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,user,expires);
 setupCommunity(db);
 const pulse=(tabId,eventSeq,extra={})=>recordPresence(db,{sessionHash:'student-session',tabId,eventSeq,courseId:'g',at,...extra});
 return {db,pulse};
}

test('ordered per-tab events cannot revive a hidden tab or hide a later active tab',t=>{
 const {db,pulse}=fixture(t);
 pulse('tab-A',1);assert.equal(presenceOnline(db,'student',{at}),true);
 pulse('tab-A',3,{leave:true});assert.equal(presenceOnline(db,'student',{at}),false);
 assert.equal(pulse('tab-A',2).applied,false);assert.equal(presenceOnline(db,'student',{at}),false);
 pulse('tab-A',4);assert.equal(presenceOnline(db,'student',{at}),true);
 assert.equal(pulse('tab-A',3,{leave:true}).applied,false);assert.equal(presenceOnline(db,'student',{at}),true);
 pulse('tab-B',1);pulse('tab-A',5,{leave:true});assert.equal(presenceOnline(db,'student',{at}),true);
 assert.deepEqual(activePresenceRows(db,{at}).map(p=>p.tab_id),['tab-B']);
 pulse('tab-B',2,{leave:true});assert.equal(presenceOnline(db,'student',{at}),false);
});

test('presence expires promptly and logout removes only that session, with no disclosure of hidden staff',t=>{
 const {db,pulse}=fixture(t);pulse('tab-A',1);
 assert.equal(presenceOnline(db,'student',{at:at+PRESENCE_TTL-1}),true);assert.equal(presenceOnline(db,'student',{at:at+PRESENCE_TTL}),false);
 recordPresence(db,{sessionHash:'second-session',tabId:'tab-B',eventSeq:1,at});
 db.prepare('DELETE FROM sessions WHERE token_hash=?').run('student-session');assert.equal(presenceOnline(db,'student',{at}),true);
 db.prepare('DELETE FROM sessions WHERE token_hash=?').run('second-session');assert.equal(presenceOnline(db,'student',{at}),false);
 recordPresence(db,{sessionHash:'teacher-session',tabId:'tab-T',eventSeq:1,at});assert.equal(presenceOnline(db,'teacher',{at}),true);
 db.prepare('INSERT INTO profiles(user_id,hidden,updated_at) VALUES(?,1,?)').run('teacher',new Date(at).toISOString());assert.equal(presenceOnline(db,'teacher',{at}),false);assert.equal(activePresenceRows(db,{at}).length,0);
 db.prepare('UPDATE profiles SET hidden=0').run();db.prepare("UPDATE users SET account_status='suspended' WHERE id='teacher'").run();assert.equal(presenceOnline(db,'teacher',{at}),false);
 db.prepare("UPDATE users SET account_status='active',must_change_password=1 WHERE id='teacher'").run();assert.equal(presenceOnline(db,'teacher',{at}),false);
 db.prepare("UPDATE users SET must_change_password=0 WHERE id='teacher'").run();db.prepare("UPDATE sessions SET expires_at=? WHERE user_id='teacher'").run(new Date(at).toISOString());assert.equal(presenceOnline(db,'teacher',{at}),false);
});

test('migration does not reuse old leases and repeated setup preserves current ordered events',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE courses(id TEXT PRIMARY KEY);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY);
 CREATE TABLE presence(session_hash TEXT NOT NULL,tab_id TEXT NOT NULL,course_id TEXT,seen_at TEXT NOT NULL,PRIMARY KEY(session_hash,tab_id));
 INSERT INTO presence VALUES('old-session','old-tab',NULL,'2026-10-26T12:00:00.000Z');`);
 setupCommunity(db);assert.equal(db.prepare('SELECT active FROM presence').get().active,0);
 recordPresence(db,{sessionHash:'old-session',tabId:'old-tab',eventSeq:7,at});const before=db.prepare('SELECT * FROM presence').all();setupCommunity(db);assert.deepEqual(db.prepare('SELECT * FROM presence').all(),before);
});

test('client leaves on lost focus and ignores a heartbeat completed after leave',async()=>{
 const saved=new Map(['window','document','navigator','location','setInterval'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const winEvents=new Map(),docEvents=new Map(),beacons=[],calls=[],classes=new Set();let focused=true,resolvePulse,first=true;
 const status={innerHTML:'',textContent:'',classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key),remove:key=>classes.delete(key)}};
 try{
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:(key,fn)=>winEvents.set(key,fn)}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false,hasFocus:()=>focused,querySelectorAll:()=>[],getElementById:id=>id==='self-presence'?status:null,addEventListener:(key,fn)=>docEvents.set(key,fn)}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{sendBeacon:(url,blob)=>{beacons.push({url,blob});return true;}}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{hash:'#mensajes'}});
  Object.defineProperty(globalThis,'setInterval',{configurable:true,value:(_fn,ms)=>{assert.equal(ms,15_000);return 1;}});
  const state={user:{id:'student',roles:['student'],name:'Student'},preview:false};
  const api=async(path,options)=>{calls.push({path,body:options?.body});if(path==='/community/heartbeat'){if(first){first=false;return await new Promise(r=>{resolvePulse=r;});}return {applied:true,ttlSeconds:45,hidden:false};}return {id:'student',name:'Student',roles:['student'],hidden:false};};
  const ui=createCommunityUI({api,getState:()=>state,heading:()=>'',toast:()=>{}});
  const pending=ui.tick();assert.equal(calls[0].body.eventSeq,1);
  focused=false;winEvents.get('blur')();const leave=JSON.parse(await beacons[0].blob.text());assert.equal(leave.leave,true);assert.equal(leave.eventSeq,2);assert.equal(leave.tabId,calls[0].body.tabId);
  resolvePulse({applied:true,hidden:false});await pending;assert.equal(calls.some(c=>c.path==='/community/profile'),false);assert.equal(classes.has('online'),false);
  focused=true;await ui.tick();assert.equal(calls.filter(c=>c.path==='/community/heartbeat').at(-1).body.eventSeq,3);assert.equal(classes.has('online'),true);
  document.hidden=true;docEvents.get('visibilitychange')();assert.equal(classes.has('online'),false);assert.equal(JSON.parse(await beacons.at(-1).blob.text()).eventSeq,4);
  await ui.tick();assert.equal(calls.filter(c=>c.path==='/community/heartbeat').length,2);
 }finally{for(const [key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
