import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {createBackup} from './backup.mjs';
import {migrateCourseGroups} from './course-model.mjs';
import {setupPermissionAudit} from './permissions.mjs';

// Run with the application stopped, or against an isolated restored backup.
// Kept separate from startup until the API and UI support the new model.
export function upgradeData(directory,{masterId}={}){
 const root=resolve(directory),db=new DatabaseSync(join(root,'aula.sqlite'));
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000');
 try{
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()){
   const applied=db.prepare("SELECT report FROM schema_migrations WHERE name='course-groups-v1'").get();
   if(applied)return {...JSON.parse(applied.report),alreadyApplied:true};
  }
  const backup=createBackup(root,{label:'before-course-groups-v1'});
  const report=migrateCourseGroups(db,join(root,'uploads'),{masterId});
  setupPermissionAudit(db);
  const result={...report,backupDirectory:backup.directory,rollback:'Restaura el respaldo en un directorio vacío y arranca la versión anterior con ese DATA_DIR.'};
  writeFileSync(join(backup.directory,'migration-report.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  return result;
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv[2]!=='--offline'||!process.argv[3])throw Error('Uso: node server/upgrade.mjs --offline DATA_DIR [MASTER_ID]. Detén el servidor o usa una copia aislada.');
  console.log(JSON.stringify(upgradeData(process.argv[3],{masterId:process.argv[4]}),null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
