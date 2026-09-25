import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/database.mjs';
import {migrateCourseGroups,cloneCourse,courseInventory,setupCourseModel} from '../server/course-model.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'aula-groups-')),db=openDatabase(root),uploads=join(root,'uploads');
 db.exec(`INSERT INTO users(id,document,name,role,created_at,updated_at) VALUES('owner','12345','Owner','admin','2026','2026'),('student','12346','Student','student','2026','2026');
 INSERT INTO courses(id,title,published,created_at,updated_at) VALUES('course','Course',1,'2026','2026'),('empty','Empty course',0,'2026','2026');
 INSERT INTO modules(id,course_id,title) VALUES('chapter','course','Chapter');
 INSERT INTO resources(id,module_id,title,kind,file_key,created_at,updated_at) VALUES('material','chapter','PDF','pdf','original.pdf','2026','2026');
 INSERT INTO progress(user_id,resource_id,completed,updated_at,opened_at) VALUES('student','material',1,'2026','2026');
 INSERT INTO enrollments(id,student_id,course_id,created_at) VALUES('enrollment','student','course','2026');
 INSERT INTO activities(id,course_id,module_id,config,created_at) VALUES('activity','course','chapter','{"title":"Quiz","questions":[]}', '2026');
 INSERT INTO submissions(id,activity_id,student_id,request_key,attempt,state,payload,points,published,updated_at) VALUES('answer','activity','student','request',1,'graded','{"text":"answer"}',90,1,'2026');
 INSERT INTO grading_settings VALUES('course','{"scaleMax":5,"finalPublished":true}');`);
 writeFileSync(join(uploads,'original.pdf'),'unchanged material');
 return {root,db,uploads,close(){db.close();rmSync(root,{recursive:true,force:true});}};
}
test('2026-1 migration preserves all academic IDs, grades and content; every template receives a group; rerun is idempotent',()=>{
 const f=fixture();try{
  const before=f.db.prepare('SELECT * FROM submissions').all(),progress=f.db.prepare('SELECT * FROM progress').all();
  const report=migrateCourseGroups(f.db,f.uploads);assert.equal(report.courses.length,2);
  const group=report.courses.find(c=>c.templateId==='course').groupId;
  assert.deepEqual(f.db.prepare('SELECT * FROM submissions').all(),before);assert.deepEqual(f.db.prepare('SELECT * FROM progress').all(),progress);
  assert.equal(f.db.prepare('SELECT course_id FROM enrollments').get().course_id,group);
  assert.equal(courseInventory(f.db,'course').enrollments,0);assert.equal(courseInventory(f.db,'course').submissions,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM user_roles WHERE role='master'").get().n,1);
  assert.equal(f.db.prepare("SELECT user_id FROM user_roles WHERE role='master'").get().user_id,'owner');
  const templateFile=f.db.prepare("SELECT r.file_key FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id='course'").get().file_key;
  assert.notEqual(templateFile,'original.pdf');assert.equal(readFileSync(join(f.uploads,templateFile),'utf8'),'unchanged material');
  assert.equal(migrateCourseGroups(f.db,f.uploads).alreadyApplied,true);assert.equal(f.db.prepare('SELECT count(*) n FROM courses').get().n,4);
  assert.throws(()=>f.db.exec("INSERT INTO enrollments(id,student_id,course_id,created_at) VALUES('illegal','student','course','2026')"),/grupo/);
 }finally{f.close();}
});
test('cloning groups is independent and does not clone student results',()=>{
 const f=fixture();try{
  const report=migrateCourseGroups(f.db,f.uploads),first=report.courses.find(c=>c.templateId==='course').groupId;
  const second=cloneCourse(f.db,f.uploads,'course',{cohort:'2026-2',code:'B',actorId:'owner'});
  f.db.prepare('UPDATE resources SET title=? WHERE module_id IN(SELECT id FROM modules WHERE course_id=?)').run('Changed',second);
  assert.equal(f.db.prepare("SELECT title FROM resources WHERE id='material'").get().title,'PDF');
  assert.equal(courseInventory(f.db,first).submissions,1);assert.equal(courseInventory(f.db,second).submissions,0);
  assert.throws(()=>cloneCourse(f.db,f.uploads,'course',{cohort:'2026-2',code:'B'}),/UNIQUE/);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.close();}
});
test('missing file rolls the whole migration back, including roles and schema changes',()=>{
 const f=fixture();try{
  f.db.exec("UPDATE resources SET file_key='missing.pdf'");
  assert.throws(()=>migrateCourseGroups(f.db,f.uploads),/ENOENT/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM courses').get().n,2);
  assert.equal(f.db.prepare('SELECT course_id FROM enrollments').get().course_id,'course');
  assert.ok(!f.db.prepare('PRAGMA table_info(courses)').all().some(c=>c.name==='entity_kind'));
 }finally{f.close();}
});

test('migration reuses a pre-existing 2026-1 and reconciles overlapping enrollment without losing results',()=>{
 const f=fixture();try{
  setupCourseModel(f.db);
  f.db.exec("INSERT INTO courses(id,title,published,created_at,updated_at,entity_kind,template_id,cohort,group_code) VALUES('existing','Existing group',1,'2026','2026','group','course','2026-1','2026-1'); INSERT INTO enrollments(id,student_id,course_id,created_at) VALUES('existing-enrollment','student','existing','2026');");
  const answers=f.db.prepare('SELECT * FROM submissions').all(),progress=f.db.prepare('SELECT * FROM progress').all();
  const report=migrateCourseGroups(f.db,f.uploads),item=report.courses.find(c=>c.templateId==='course');
  assert.equal(item.groupId,'existing');assert.equal(item.reusedExistingGroup,true);
  assert.equal(f.db.prepare("SELECT count(*) n FROM courses WHERE template_id='course'").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM enrollments WHERE course_id='existing'").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM enrollment_history WHERE action='migration.reconcile'").get().n,1);
  assert.deepEqual(f.db.prepare('SELECT * FROM submissions').all(),answers);assert.deepEqual(f.db.prepare('SELECT * FROM progress').all(),progress);
  assert.equal(migrateCourseGroups(f.db,f.uploads).alreadyApplied,true);
 }finally{f.close();}
});

test('conflicting grading schemes roll reconciliation back instead of silently changing grades',()=>{
 const f=fixture();try{
  setupCourseModel(f.db);f.db.exec("INSERT INTO courses(id,title,created_at,updated_at,entity_kind,template_id,cohort,group_code) VALUES('existing','Existing','2026','2026','group','course','2026-1','2026-1'); INSERT INTO grading_settings VALUES('existing','{\"scaleMax\":100}');");
  assert.throws(()=>migrateCourseGroups(f.db,f.uploads),/otro esquema de notas/);
  assert.equal(f.db.prepare("SELECT course_id FROM enrollments WHERE id='enrollment'").get().course_id,'course');
  assert.equal(f.db.prepare("SELECT count(*) n FROM schema_migrations").get().n,0);
 }finally{f.close();}
});
