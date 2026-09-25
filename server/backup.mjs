import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,copyFileSync,readFileSync,writeFileSync,statSync,statfsSync,readdirSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
function tables(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);}
function fileKeys(db){
 const names=tables(db),keys=new Set();
 for(const table of ['resources','quick_resources','activity_files'])if(names.includes(table))for(const row of db.prepare(`SELECT file_key FROM ${table} WHERE file_key IS NOT NULL`).all())keys.add(row.file_key);
 if(names.includes('submissions'))for(const row of db.prepare('SELECT payload FROM submissions').all()){const p=JSON.parse(row.payload);for(const f of p.files??(p.file?[p.file]:[]))keys.add(f.key);}
 if(names.includes('activity_versions'))for(const row of db.prepare('SELECT files FROM activity_versions').all())for(const f of JSON.parse(row.files))keys.add(f.key);
 if(names.includes('library_items')){const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(k==='file_key'&&x)keys.add(x);else walk(x);}};for(const row of db.prepare('SELECT payload FROM library_items').all())walk(JSON.parse(row.payload));}
 return [...keys].sort().map(key=>{if(typeof key!=='string'||key!==basename(key)||/[\\/\x00]/.test(key))throw Error('Ruta de adjunto no válida: se canceló el respaldo.');return key;});
}
export function createBackup(dataDirectory,{label='manual'}={}){
 const root=resolve(dataDirectory),source=join(root,'aula.sqlite');if(!existsSync(source))throw Error('No existe una base de datos para respaldar.');
 const holder=new DatabaseSync(source);holder.exec('PRAGMA busy_timeout=15000; BEGIN IMMEDIATE');let reader;
 try{
  reader=new DatabaseSync(source,{readOnly:true});
  const keys=fileKeys(reader),bytes=statSync(source).size+keys.reduce((n,k)=>n+statSync(join(root,'uploads',k)).size,0),disk=statfsSync(root);
  if(Number(disk.bavail)*Number(disk.bsize)<bytes+64*1024*1024)throw Error('Espacio insuficiente para una copia completa y 64 MB de reserva.');
  const destination=join(root,'backups',`${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${randomUUID()}`);mkdirSync(join(destination,'uploads'),{recursive:true,mode:0o700});
  reader.exec(`VACUUM INTO ${quote(join(destination,'aula.sqlite'))}`);
  const files=keys.map(key=>{const from=join(root,'uploads',key),to=join(destination,'uploads',key);copyFileSync(from,to);return {key,size:statSync(to).size,sha256:sha(to)};});
  const counts=Object.fromEntries(tables(reader).map(t=>[t,reader.prepare(`SELECT COUNT(*) n FROM "${t.replaceAll('"','""')}"`).get().n]));
  const check=new DatabaseSync(join(destination,'aula.sqlite'),{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw Error('El respaldo no supera la comprobación de integridad.');}finally{check.close();}
  const manifest={format:1,label,createdAt:new Date().toISOString(),databaseSha256:sha(join(destination,'aula.sqlite')),counts,files};
  writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});holder.exec('COMMIT');return {directory:destination,...manifest};
 }catch(error){if(holder.isTransaction)holder.exec('ROLLBACK');throw error;}finally{reader?.close();holder.close();}
}
export function restoreBackup(backupDirectory,destinationDirectory){
 const source=resolve(backupDirectory),target=resolve(destinationDirectory);if(source===target||target.startsWith(source+'/')||target.startsWith(source+'\\'))throw Error('El destino debe ser independiente del respaldo.');
 if(existsSync(target)&&readdirSync(target).length)throw Error('Restaura en un directorio vacío: no se sobrescriben datos.');
 const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
 if(manifest.format!==1||sha(join(source,'aula.sqlite'))!==manifest.databaseSha256)throw Error('Base de respaldo alterada o formato no reconocido.');
 for(const file of manifest.files){if(file.key!==basename(file.key)||/[\\/\x00]/.test(file.key)||sha(join(source,'uploads',file.key))!==file.sha256)throw Error('Adjunto de respaldo alterado.');}
 mkdirSync(join(target,'uploads'),{recursive:true,mode:0o700});copyFileSync(join(source,'aula.sqlite'),join(target,'aula.sqlite'));for(const f of manifest.files)copyFileSync(join(source,'uploads',f.key),join(target,'uploads',f.key));return {directory:target,counts:manifest.counts,files:manifest.files.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [action,from,to]=process.argv.slice(2);if(action==='create'){const r=createBackup(from||process.env.DATA_DIR,{label:'pre-upgrade'});console.log(JSON.stringify({directory:r.directory,counts:r.counts,files:r.files.length,verified:true},null,2));}else if(action==='restore'&&from&&to)console.log(JSON.stringify(restoreBackup(from,to),null,2));else throw Error('Uso: node server/backup.mjs create DATA_DIR | restore BACKUP DIRECTORIO_VACIO');}catch(error){console.error(error.message);process.exitCode=1;}
}
