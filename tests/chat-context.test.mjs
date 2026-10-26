import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createChatContext} from '../server/chat-context.mjs';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE modules(id TEXT PRIMARY KEY,course_id TEXT,title TEXT,published INTEGER);
 CREATE TABLE resources(id TEXT PRIMARY KEY,module_id TEXT,title TEXT,kind TEXT,published INTEGER);
 CREATE TABLE quick_resources(id TEXT PRIMARY KEY,course_id TEXT,title TEXT,kind TEXT,visible INTEGER);
 CREATE TABLE activities(id TEXT PRIMARY KEY,course_id TEXT,module_id TEXT,config TEXT);
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,active INTEGER,account_status TEXT);
 CREATE TABLE course_staff(course_id TEXT,user_id TEXT);
 CREATE TABLE storage_course_limits(course_id TEXT,owner_id TEXT);
 CREATE TABLE chat_conversations(id TEXT PRIMARY KEY,user_a TEXT,user_b TEXT);
 INSERT INTO modules VALUES('chapter','course','Medición',1),('draft-chapter','course','Capítulo secreto',0),('other-chapter','other','Otro curso',1);
 INSERT INTO resources VALUES('resource','chapter','Simulador','link',1),('draft','chapter','Material secreto','link',0),('hidden-parent','draft-chapter','Hijo oculto','link',1),('foreign','other-chapter','Material ajeno','link',1);
 INSERT INTO quick_resources VALUES('quick','course','Apoyo rápido','link',1),('hidden-quick','course','Apoyo oculto','link',0);
 INSERT INTO users VALUES('teacher','Docente',1,'active'),('inactive','Inactivo',0,'active'),('owner','Responsable',1,'active');
 INSERT INTO course_staff VALUES('course','teacher'),('course','inactive');INSERT INTO storage_course_limits VALUES('course','owner');`);
 for(const [id,moduleId,config]of [['activity','chapter',{title:'Cuestionario abierto',kind:'quiz',status:'published'}],['draft-activity','chapter',{title:'Borrador secreto',kind:'quiz',status:'draft'}],['future','chapter',{title:'Actividad futura',kind:'quiz',status:'published',opensAt:'2999-01-01T00:00:00Z'}],['hidden-activity','draft-chapter',{title:'Actividad oculta',kind:'task',status:'published'}]])db.prepare('INSERT INTO activities VALUES(?,?,?,?)').run(id,'course',moduleId,JSON.stringify(config));
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 const context=createChatContext({db,fail,supervises:auth=>auth.user.id==='teacher',person:id=>({id,name:id,roles:['teacher'],avatarUrl:null,online:false}),permission:(_c,_from,to)=>to==='teacher'?'El docente no recibe mensajes.':'',removed:()=>false});
 return {db,context,course:{id:'course',title:'Electrónica'},student:{user:{id:'student'}},teacher:{user:{id:'teacher'}}};
}

test('context resolves only IDs and current student-visible course, chapter, resource and activity',t=>{
 const {context,course,student,teacher}=fixture(t),resolve=ids=>context.resolve({courseId:'course',...ids},student,course);
 assert.equal(resolve({}).type,'course');assert.equal(resolve({moduleId:'chapter'}).title,'Medición');
 const resource=resolve({resourceId:'resource',title:'Ataque',href:'javascript:alert(1)'});assert.equal(resource.title,'Simulador');assert.equal(resource.moduleTitle,'Medición');assert.equal(resource.href,'#curso/course?resource=resource');assert.equal(resource.type,'resource');
 const activity=resolve({activityId:'activity'});assert.equal(activity.kind,'quiz');assert.equal(activity.href,'#actividad/activity');
 assert.equal(resolve({quickResourceId:'quick'}).href,'#curso/course?quickResource=quick');
 for(const ids of [{resourceId:'draft'},{resourceId:'hidden-parent'},{resourceId:'foreign'},{resourceId:'resource',moduleId:'other-chapter'},{activityId:'draft-activity'},{activityId:'future'},{activityId:'hidden-activity'},{moduleId:'draft-chapter'},{quickResourceId:'hidden-quick'}])assert.throws(()=>resolve(ids),e=>e.status===404);
 assert.throws(()=>resolve({courseId:'other',resourceId:'foreign'}),e=>e.status===400);assert.throws(()=>resolve({resourceId:'resource',activityId:'activity'}),e=>e.status===400);
 assert.equal(context.resolve({courseId:'course',activityId:'future'},teacher,course).title,'Actividad futura');
});

test('context teacher choices use assigned active teachers, current messaging policy and owner fallback',t=>{
 const {db,context,course,student}=fixture(t);
 let people=context.teachers(student,course);assert.deepEqual(people.map(p=>p.id),['teacher']);assert.equal(people[0].canMessage,false);assert.equal(people[0].sendGroupId,null);assert.ok(people[0].reason);
 db.prepare("DELETE FROM course_staff WHERE user_id='teacher'").run();people=context.teachers(student,course);assert.deepEqual(people.map(p=>p.id),['owner']);assert.equal(people[0].canMessage,true);assert.equal(people[0].sendGroupId,'course');
});
