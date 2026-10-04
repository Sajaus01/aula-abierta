import {readdirSync,lstatSync,statfsSync,openSync,readSync,closeSync,renameSync,linkSync,unlinkSync,existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// Only immutable backup files are deduplicated. Live uploads and databases are never linked.
export function diskFiles(root) {
 const result=[];if(!existsSync(root))return result;
 function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name),s=lstatSync(path);if(s.isSymbolicLink())continue;if(s.isDirectory())walk(path);else if(s.isFile())result.push({path,size:s.size,allocated:s.blocks===undefined?s.size:s.blocks*512,identity:`${s.dev}:${s.ino}`,links:s.nlink});}}
 walk(root);return result;
}
export function physicalBytes(files){const seen=new Set();return files.reduce((n,f)=>{if(seen.has(f.identity))return n;seen.add(f.identity);return n+f.allocated;},0);}
export function diskCapacity(root){const d=statfsSync(root);return {totalBytes:Number(d.blocks)*Number(d.bsize),freeBytes:Number(d.bavail)*Number(d.bsize)};}
function hash(path){const fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');try{let n;while((n=readSync(fd,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}}
export function optimizeBackups(dataDir){
 const root=resolve(dataDir,'backups'),before=diskCapacity(dataDir),files=diskFiles(root),groups=new Map(),beforeBytes=physicalBytes(files);let linked=0;
 for(const f of files){if(!f.path.startsWith(root+sep))throw Error('Respaldo fuera del directorio permitido.');if(!f.size||f.path.endsWith('.storage-tmp'))continue;const key=`${f.size}:${hash(f.path)}`,prior=groups.get(key);if(!prior){groups.set(key,f);continue;}if(prior.identity===f.identity)continue;
  const temp=f.path+'.'+randomUUID()+'.storage-tmp';renameSync(f.path,temp);
  try{linkSync(prior.path,f.path);}catch(error){renameSync(temp,f.path);throw error;}
  // A hard link references precisely the verified bytes. All backup paths stay intact.
  unlinkSync(temp);linked++;
 }
 const after=diskCapacity(dataDir);return {linked,savedBytes:Math.max(0,beforeBytes-physicalBytes(diskFiles(root))),freeBefore:before.freeBytes,freeAfter:after.freeBytes};
}
