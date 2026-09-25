import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createBackup,restoreBackup} from '../server/backup.mjs';

test('backup includes WAL changes and attachments; restore preserves history without overwriting',()=>{
 const root=mkdtempSync(join(tmpdir(),'aula-backup-'));
 const source=join(root,'source');mkdirSync(join(source,'uploads'),{recursive:true});
 const db=new DatabaseSync(join(source,'aula.sqlite'));
 try{
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE resources(id TEXT PRIMARY KEY,file_key TEXT); CREATE TABLE submissions(id TEXT PRIMARY KEY,payload TEXT); INSERT INTO resources VALUES('material','material.pdf')");
  db.prepare('INSERT INTO submissions VALUES(?,?)').run('historical',JSON.stringify({files:[{key:'answer.pdf'}]}));
  writeFileSync(join(source,'uploads','material.pdf'),'original material');writeFileSync(join(source,'uploads','answer.pdf'),'original answer');
  const backup=createBackup(source);assert.equal(backup.files.length,2);assert.equal(backup.counts.submissions,1);
  db.exec('DELETE FROM submissions');
  const destination=join(root,'restored');restoreBackup(backup.directory,destination);
  const restored=new DatabaseSync(join(destination,'aula.sqlite'));try{assert.equal(restored.prepare('SELECT count(*) n FROM submissions').get().n,1);}finally{restored.close();}
  assert.equal(readFileSync(join(destination,'uploads','answer.pdf'),'utf8'),'original answer');
  assert.throws(()=>restoreBackup(backup.directory,destination),/vacío/);
  writeFileSync(join(backup.directory,'uploads','answer.pdf'),'tampered');
  assert.throws(()=>restoreBackup(backup.directory,join(root,'tampered')),/alterado/);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

test('backup rejects missing referenced files rather than claiming success',()=>{
 const root=mkdtempSync(join(tmpdir(),'aula-backup-missing-'));mkdirSync(join(root,'uploads'));
 const db=new DatabaseSync(join(root,'aula.sqlite'));db.exec("CREATE TABLE resources(file_key TEXT); INSERT INTO resources VALUES('missing.pdf')");
 try{assert.throws(()=>createBackup(root),/ENOENT/);db.exec("INSERT INTO resources VALUES('another.pdf')");}finally{db.close();rmSync(root,{recursive:true,force:true});}
});
