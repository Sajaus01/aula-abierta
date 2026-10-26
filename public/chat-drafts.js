const draftKey=(owner,id)=>`aula-chat-${owner}-${id}`;
const recoveryKey=(owner,id)=>`aula-chat-recovered-${owner}-${id}`;
const read=(storage,key)=>{try{return storage.getItem(key);}catch{return null;}};
const nonempty=body=>typeof body==='string'&&Boolean(body.trim());
const parse=value=>{try{const list=JSON.parse(value);return Array.isArray(list)?list:[];}catch{return [];}};

export function createDraftStorage(getStorage=()=>window.sessionStorage){
 const memory=new Map();
 return {
  getItem(key){if(memory.has(key))return memory.get(key);try{return getStorage().getItem(key);}catch{return null;}},
  setItem(key,value){const body=String(value);memory.set(key,body);try{getStorage().setItem(key,body);}catch{}},
  removeItem(key){memory.set(key,null);try{getStorage().removeItem(key);}catch{}}
 };
}

function uniqueBodies(entries){
 const bodies=new Map();
 for(const entry of entries){
  if(!nonempty(entry?.body))continue;
  const sources=[entry.source,...(Array.isArray(entry.duplicateSources)?entry.duplicateSources:[])].filter(source=>typeof source==='string'&&source);
  if(!bodies.has(entry.body))bodies.set(entry.body,{body:entry.body,source:sources[0]||'',duplicateSources:[]});
  const saved=bodies.get(entry.body);
  for(const source of sources)if(source!==saved.source&&!saved.duplicateSources.includes(source))saved.duplicateSources.push(source);
 }
 return [...bodies.values()];
}

export function recoverChatDrafts(storage,owner,conversation,requestedId=''){
 const canonical=conversation?.id;if(!owner||!canonical)return {draft:'',source:'',duplicateSources:[],alternatives:[]};
 const ids=[...new Set([canonical,requestedId,...(conversation.legacyIds||[])].filter(id=>typeof id==='string'&&id))];
 const allowed=new Set(ids.map(id=>draftKey(owner,id))),canonicalKey=draftKey(owner,canonical),entries=[];
 for(const id of ids){const source=draftKey(owner,id),body=read(storage,source);if(nonempty(body))entries.push({body,source});}
 for(const id of ids)for(const entry of parse(read(storage,recoveryKey(owner,id)))){
  if(!entry||!nonempty(entry.body))continue;
  const sources=[entry.source,...(Array.isArray(entry.duplicateSources)?entry.duplicateSources:[])].filter(source=>allowed.has(source));
  entries.push({body:entry.body,source:sources[0]||canonicalKey,duplicateSources:sources.slice(1)});
 }
 const [current,...alternatives]=uniqueBodies(entries);
 return {draft:current?.body||'',source:current?.source||'',duplicateSources:current?.duplicateSources||[],alternatives};
}

export function persistDraftAlternatives(storage,owner,conversationId,list){
 if(!owner||!conversationId)return false;
 const prefix=`aula-chat-${owner}-`,canonical=draftKey(owner,conversationId),entries=[];
 for(const entry of Array.isArray(list)?list:[]){
  if(!entry||!nonempty(entry.body))continue;
  const sources=[entry.source,...(Array.isArray(entry.duplicateSources)?entry.duplicateSources:[])].filter(source=>typeof source==='string'&&source.startsWith(prefix));
  entries.push({body:entry.body,source:sources[0]||canonical,duplicateSources:sources.slice(1)});
 }
 try{const unique=uniqueBodies(entries),key=recoveryKey(owner,conversationId);if(unique.length)storage.setItem(key,JSON.stringify(unique));else storage.removeItem(key);return true;}catch{return false;}
}

export function ackDraftSource(storage,source){
 let ok=true;
 for(const key of new Set(Array.isArray(source)?source:[source])){
  if(typeof key!=='string'||!key.startsWith('aula-chat-')||key.startsWith('aula-chat-recovered-'))continue;
  try{storage.removeItem(key);}catch{ok=false;}
 }
 return ok;
}
