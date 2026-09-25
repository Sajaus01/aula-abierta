import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/database.mjs';
import {migrateCourseGroups} from '../server/course-model.mjs';
import {createPermissions,setupPermissionAudit} from '../server/permissions.mjs';

test('roles and scoped capabilities enforce master protection, account state and audited changes',()=>{
 const root=mkdtempSync(join(tmpdir(),'aula-permissions-')),db=openDatabase(root);
 try{
  for(const [id,role] of [['owner','admin'],['administrative','student'],['teacher','student'],['outsider','student'],['student','student']])db.prepare('INSERT INTO users(id,document,name,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,id,id,role,'2026','2026');
  db.exec("INSERT INTO courses(id,title,created_at,updated_at) VALUES('one','One','2026','2026'),('two','Two','2026','2026')");
  migrateCourseGroups(db,join(root,'uploads'));setupPermissionAudit(db);const p=createPermissions(db);
  assert.throws(()=>p.setRoles('owner','owner',['admin']),/última/);
  assert.throws(()=>p.setStatus('owner','owner','suspended'),/última/);
  p.setRoles('owner','administrative',['admin']);
  assert.throws(()=>p.setRoles('administrative','student',['master']),/Solo el máster/);
  p.setRoles('administrative','teacher',['teacher']);p.setRoles('administrative','outsider',['teacher']);
  p.assign('owner','one','teacher',{edit:true,grade:false,manage:false});
  assert.equal(p.can('teacher','one','edit'),true);assert.equal(p.can('teacher','one','grade'),false);
  assert.equal(p.can('teacher','two','edit'),false);assert.equal(p.can('outsider','one'),false);
  assert.throws(()=>p.assign('teacher','one','outsider',{edit:true,grade:true,manage:true}),/gestionar/);
  assert.throws(()=>p.setRoles('teacher','student',['admin']),/administración/);
  p.setStatus('administrative','teacher','suspended');assert.equal(p.can('teacher','one','edit'),false);
  p.setStatus('administrative','teacher','active');assert.equal(p.can('teacher','one','edit'),true);
  assert.equal(db.prepare('SELECT count(*) n FROM permission_audit').get().n,6);
  assert.equal(db.prepare('SELECT count(*) n FROM enrollments').get().n,0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
