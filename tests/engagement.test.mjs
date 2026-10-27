import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setupEngagement,createEngagement} from '../server/engagement.mjs';
import {engagementContext,engagementActive,createEngagementTracker} from '../public/engagement.js';

function fixture(t,{at=Date.parse('2026-10-27T15:00:00.000Z')}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE courses(id TEXT PRIMARY KEY,entity_kind TEXT,lifecycle TEXT,published INTEGER);CREATE TABLE enrollments(student_id TEXT,course_id TEXT,status TEXT,starts_at TEXT,expires_at TEXT);INSERT INTO users VALUES('learner'),('other'),('teacher');INSERT INTO courses VALUES('group','group','active',1),('foreign','group','active',1),('template','template','active',1);INSERT INTO enrollments VALUES('learner','group','active',NULL,NULL),('other','foreign','active',NULL,NULL);`);
 setupEngagement(db,{at});let time=at;
 const student={user:{id:'learner',role:'student',roles:['student']},assurance:'password',tokenHash:'test-auth-hash'};
 let current=student,body;
 const fail=(status,message)=>{const error=new Error(message);error.status=status;throw error;};
 const engagement=createEngagement({db,fail,json:(res,data)=>{res.data=data;},readJson:async()=>body,readSession:()=>current,requireCourse:id=>{const course=db.prepare('SELECT * FROM courses WHERE id=?').get(id);if(!course)fail(404,'Missing');return course;},accessModel:{},clock:()=>time});
 const sequences=new Map();
 const call=async(options={},initial=current)=>{const tabId=options.tabId||'tab-00000000-0000-0000';const eventSeq=options.eventSeq??(sequences.get(tabId)||0)+1;sequences.set(tabId,Math.max(sequences.get(tabId)||0,eventSeq));body={courseId:'group',kind:'pulse',active:true,tabId,eventSeq,...options};const res={};assert.equal(await engagement.handler({},res,'/api/learning-activity','POST',initial),true);return res.data;};
 return {db,engagement,student,call,setAuth:value=>{current=value;},at:value=>{time=value;},advance:value=>{time+=value;},now:()=>time,row:(options={})=>engagement.summary('group',{userIds:['learner'],...options}).students[0]};
}

test('measurement begins once and a passive open tab adds no active time',async t=>{
 const f=fixture(t),started=f.engagement.summary('group').measurementStartedAt;
 await f.call({kind:'enter',active:false});f.advance(15_000);await f.call({active:false});
 assert.deepEqual([f.row().visits,f.row().sessions,f.row().activeSeconds,f.row().averageSessionSeconds],[1,1,0,0]);
 assert.equal(f.row().lastActiveAt,null);
 setupEngagement(f.db,{at:f.now()+86400_000});assert.equal(f.engagement.summary('group').measurementStartedAt,started);
 assert.equal(f.engagement.summary('group',{userIds:['learner','other']}).students[1].averageSessionSeconds,null);
 assert.equal(f.engagement.summary('group',{userIds:['learner','other']}).students[1].visits,0);
});

test('active server intervals merge while leaving and a long network gap never earn retroactive time',async t=>{
 const f=fixture(t);await f.call({kind:'enter',active:false});f.advance(1000);await f.call();
 assert.equal(f.row().activeSeconds,0);f.advance(15_000);await f.call();f.advance(15_000);await f.call();
 assert.equal(f.row().activeSeconds,30);assert.equal(f.db.prepare('SELECT count(*) n FROM learning_active_intervals').get().n,1);
 f.advance(5_000);await f.call({kind:'leave',active:false});f.advance(5_000);await f.call();assert.equal(f.row().activeSeconds,30);
 f.advance(15_000);await f.call();assert.equal(f.row().activeSeconds,45);
 f.advance(31_000);await f.call();assert.equal(f.row().activeSeconds,45);
 f.advance(15_000);await f.call();assert.equal(f.row().activeSeconds,60);
 assert.equal(f.row().visits,1);assert.equal(f.row().averageSessionSeconds,60);
});

test('several tabs and reloads share a session and overlapping activity counts once',async t=>{
 const f=fixture(t),tabA='tab-aaaaaaaa-0000-0000',tabB='tab-bbbbbbbb-0000-0000';
 await f.call({kind:'enter',tabId:tabA});f.advance(5000);await f.call({kind:'enter',tabId:tabB});
 f.advance(10_000);await f.call({tabId:tabA});f.advance(5000);await f.call({tabId:tabB});f.advance(10_000);await f.call({tabId:tabA});
 assert.equal(f.row().activeSeconds,30);assert.equal(f.row().visits,1);assert.equal(f.row().sessions,1);
 const duplicate=await f.call({tabId:tabA,eventSeq:3,elapsedSeconds:999999});assert.equal(duplicate.applied,false);assert.equal(f.row().activeSeconds,30);
 await f.call({kind:'enter',active:false,tabId:'tab-reloaded-00000000'});assert.equal(f.row().visits,1);
});

test('thirty minutes without activity starts a new visit without crediting the idle gap',async t=>{
 const f=fixture(t);await f.call({kind:'enter'});f.advance(15_000);await f.call();f.advance(30*60_000);await f.call();
 assert.equal(f.row().visits,2);assert.equal(f.row().activeSeconds,15);assert.equal(f.row().averageSessionSeconds,7.5);
 f.advance(15_000);await f.call();assert.equal(f.row().activeSeconds,30);
});

test('course authority, identity and enrollment are checked after reading every signal',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>f.call({},null),error=>error.status===401);
 for(const changed of [{...f.student,preview:{}},{...f.student,assurance:'document'},{...f.student,user:{id:'learner',role:'admin'}},{...f.student,user:{id:'learner',role:'student',must_change_password:1}}]){f.setAuth(changed);await assert.rejects(()=>f.call(),error=>error.status===403);}
 f.setAuth({...f.student,tokenHash:'changed-token'});await assert.rejects(()=>f.call({},f.student),error=>error.status===401);
 f.setAuth(f.student);await assert.rejects(()=>f.call({courseId:'foreign'}),error=>error.status===403);await assert.rejects(()=>f.call({courseId:'template'}),error=>error.status===403);
 f.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id='learner'").run();await assert.rejects(()=>f.call(),error=>error.status===403);
 f.db.prepare("UPDATE enrollments SET status='active',expires_at=? WHERE student_id='learner'").run(new Date(f.now()).toISOString());await assert.rejects(()=>f.call(),error=>error.status===403);
 assert.equal(f.db.prepare('SELECT count(*) n FROM learning_work_sessions').get().n,0);
});

test('invalid signals cannot inject client durations, reset sequences or create unbounded tabs',async t=>{
 const f=fixture(t);
 for(const options of [{tabId:'short'},{eventSeq:0},{eventSeq:1.2},{kind:'unknown'},{active:'yes'}])await assert.rejects(()=>f.call(options),error=>error.status===400);
 await f.call({kind:'enter',eventSeq:10,elapsedSeconds:3600});f.advance(1000);assert.equal((await f.call({eventSeq:9})).applied,false);assert.equal(f.row().activeSeconds,0);
 for(let index=0;index<19;index++)await f.call({kind:'enter',tabId:'extra-tab-'+String(index).padStart(16,'0')});
 await assert.rejects(()=>f.call({kind:'enter',tabId:'twenty-first-tab-0000'}),error=>error.status===429);
});

test('date filters clip active intervals and the daily series uses Bogota midnight',async t=>{
 const initial=Date.parse('2026-10-27T23:59:45.000-05:00'),f=fixture(t,{at:initial});
 await f.call({kind:'enter'});f.advance(15_000);await f.call();f.advance(15_000);await f.call();
 const full=f.row();assert.deepEqual(full.daily.map(d=>[d.date,d.activeSeconds,d.visits,d.sessions]),[['2026-10-27',15,1,1],['2026-10-28',15,0,1]]);
 const from='2026-10-28T00:00:00.000-05:00',to='2026-10-28T00:00:10.000-05:00',filtered=f.row({from,to});
 assert.equal(filtered.activeSeconds,10);assert.equal(filtered.visits,0);assert.equal(filtered.sessions,1);assert.equal(filtered.averageSessionSeconds,10);
 const detail=f.engagement.details('group','learner',{from,to});assert.equal(detail.intervals[0].seconds,10);assert.equal(detail.sessions[0].activeSeconds,10);assert.equal(detail.sessions[0].elapsedSeconds,10);
 assert.equal(f.engagement.summary('foreign',{userIds:['learner']}).students[0].activeSeconds,0);
});

test('client policy excludes staff, previews, inactive pages and old interaction',()=>{
 const state={user:{id:'student',role:'student'},assurance:'password',currentCourse:{id:'group',entityKind:'group'}};
 assert.deepEqual(engagementContext(state,'#actividad/task'),{userId:'student',courseId:'group'});
 for(const changed of [{...state,preview:{}},{...state,assurance:'document'},{...state,user:{id:'teacher',role:'admin'},viewMode:'teaching'}])assert.equal(engagementContext(changed,'#curso/group'),null);
 assert.equal(engagementContext(state,'#mis-cursos'),null);
 assert.equal(engagementActive({hidden:false,focused:true,lastInputAt:null,at:1000}),false);
 assert.equal(engagementActive({hidden:false,focused:true,lastInputAt:0,at:60_000}),true);
 assert.equal(engagementActive({hidden:false,focused:true,lastInputAt:0,at:60_001}),false);
 assert.equal(engagementActive({hidden:true,focused:true,lastInputAt:1000,at:1001}),false);
 assert.equal(engagementActive({hidden:false,focused:false,lastInputAt:1000,at:1001}),false);
});

test('the real tracker sends active pulses only after trusted interaction and stops while idle or hidden',async()=>{
 const callbacks=new Map(),windowCallbacks=new Map(),calls=[];let time=0,focused=true,interval;
 const state={user:{id:'student',role:'student'},assurance:'password',currentCourse:{id:'group',entityKind:'group'}};
 const doc={hidden:false,hasFocus:()=>focused,addEventListener:(name,fn)=>callbacks.set(name,fn)},win={location:{hash:'#curso/group'},addEventListener:(name,fn)=>windowCallbacks.set(name,fn)};
 const tracker=createEngagementTracker({api:async(path,request)=>{calls.push({path,...request.body});},getState:()=>state,environment:{window:win,document:doc,navigator:{onLine:true},clock:()=>time,setInterval:fn=>{interval=fn;},uuid:()=> 'test-tracker-00000000'}});
 tracker.enhance();time=15_000;interval();assert.equal(calls.length,1);assert.equal(calls[0].active,false);
 callbacks.get('pointerdown')({isTrusted:false});assert.equal(calls.length,1);
 callbacks.get('pointerdown')({isTrusted:true});assert.equal(calls.at(-1).kind,'pulse');assert.equal(calls.at(-1).active,true);
 time=30_000;interval();assert.equal(calls.at(-1).active,true);
 time=80_001;interval();assert.equal(calls.at(-1).kind,'leave');const idleCalls=calls.length;time=100_000;interval();assert.equal(calls.length,idleCalls);
 doc.hidden=true;callbacks.get('pointerdown')({isTrusted:true});assert.equal(calls.length,idleCalls);
 callbacks.get('visibilitychange')();assert.equal(calls.at(-1).active,false);
 doc.hidden=false;focused=false;windowCallbacks.get('focus')();assert.equal(calls.at(-1).active,false);
 focused=true;callbacks.get('keydown')({isTrusted:true});assert.equal(calls.at(-1).active,true);
 assert.ok(calls.every(call=>!Object.hasOwn(call,'elapsedSeconds')));
 await Promise.resolve();
});
