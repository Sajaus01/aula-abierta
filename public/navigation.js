const namespace='aulaNavigation',storageKey='aula-navigation-v1';
const pages=new Set(['inicio','catalogo','login','crear-contrasena','mis-cursos','tareas','cursos','grupos','estudiantes','matriculas','biblioteca','ajustes','cuenta','usuarios','perfil','curso','actividad','actividades','calificaciones','estadisticas','panorama','notificaciones','mensajes','comunidad','mi-perfil','almacenamiento']);
const controls=['#search','#group-search','#user-search','#user-role','#user-status','#academic-submission-search','#academic-submission-filter','#gradebook-search','#gradebook-filter','[data-course-search]','[data-analytics-search]','[data-analytics-state]','[data-analytics-sort]'];
const scrollers='.table-wrap,.analytics-table-wrap,[data-nav-scroll]';
const queryKeys={curso:['resource','material','module','capitulo','quickResource'],actividad:['submission'],actividades:[],calificaciones:['from','to','student','view','activity'],estadisticas:['from','to','student','studentId','activity','activityId','group','groupId','tab'],panorama:['group','student','activity','from','to','mode','template','person','category','search','page'],mensajes:['group','mode','tab','search'],comunidad:['group','search','status','role'],notificaciones:['course']};
export function navigationRoute(value){
 const route=String(value||'').replace(/^#/,'');
 if(route.length>4096||/[\u0000-\u0020\\]/.test(route))return null;
 const [path,search='']=route.split('?'),parts=path.split('/');
 if(route.split('?').length>2||[...new URLSearchParams(search).keys()].some(key=>!(queryKeys[parts[0]]||[]).includes(key)))return null;
 return parts.length<=2&&pages.has(parts[0])&&(!parts[1]||/^[\w.%~-]+$/.test(parts[1]))?route:null;
}
export function navigationScope(state){
 return JSON.stringify([state.user?.id||'public',state.previewUser?.id||'',state.viewMode||'',state.user?.role||'',[...(state.user?.roles||[])].sort(),state.user?.primaryRole||'',state.assurance||'',state.preview||'',state.previewActivity||'',Boolean(state.user?.mustChangePassword)]);
}
export const navigationFamily=route=>String(route||'').split('?')[0];
export function navigationLabel(route,state={}){
 const [page,id]=navigationFamily(route).split('/');
 if(page==='curso')return state.courses?.find(course=>course.id===id)?.entityKind==='template'?'Volver al curso':'Volver al grupo';
 return {grupos:'Volver a los grupos',cursos:'Volver a los cursos',actividades:'Volver a actividades',actividad:'Volver a la actividad',calificaciones:'Volver a calificaciones',estadisticas:'Volver a Seguimiento',panorama:'Volver a Panorama','mis-cursos':'Volver a mi aprendizaje',tareas:'Volver a mis actividades',catalogo:'Volver al catálogo',inicio:'Volver al inicio',perfil:'Volver al perfil'}[page]||'Volver a la página anterior';
}
function appSnapshot(state){return {query:state.query||'',filter:state.filter||'all',resourceFilter:state.resourceFilter||'all',courseContentQuery:state.courseContentQuery||'',courseOpenChapters:state.courseOpenChapters instanceof Set?[...state.courseOpenChapters]:null};}
function applyApp(state,snapshot={}){state.query=snapshot.query||'';state.filter=snapshot.filter||'all';state.resourceFilter=snapshot.resourceFilter||'all';state.courseContentQuery=snapshot.courseContentQuery||'';state.courseOpenChapters=Array.isArray(snapshot.courseOpenChapters)?new Set(snapshot.courseOpenChapters):null;}
const detailKey=(node,index)=>node.dataset.moduleId?'module:'+node.dataset.moduleId:node.id?'id:'+node.id:'detail:'+index+':'+node.className;
function focusKey(node,root){
 if(!node||!root?.contains(node))return null;
 for(const selector of controls)if(node.matches(selector))return {selector};
 if(/^(?:resource:|study:|academic-(?:grade|gradebook|new|new-module|edit):|edit-course:|new-resource:|new-module:|platform-(?:activity-)?preview:|quick-view:)/.test(node.dataset?.action||''))return {action:node.dataset.action};
 if(node.tagName==='A'&&navigationRoute(node.getAttribute('href')))return {href:node.getAttribute('href')};
 return null;
}
function findFocus(key,root){if(!key||!root)return null;if(key.selector&&controls.includes(key.selector))return root.querySelector(key.selector);return [...root.querySelectorAll(key.action?'[data-action]':'a[href]')].find(node=>key.action?node.dataset.action===key.action:node.getAttribute('href')===key.href);}

// Snapshots contain navigation controls, never answers, grades, passwords or file contents.
export function captureNavigationUI(state,root,env){
 const values=[];
 for(const selector of controls){const node=root?.querySelector(selector);if(node)values.push({selector,value:String(node.value).slice(0,2000)});}
 const app=appSnapshot(state),chapters=root?.querySelectorAll('.course-chapter');if(chapters?.length)app.courseOpenChapters=[...chapters].filter(node=>node.open).map(node=>node.dataset.moduleId);
 return {app,values,details:[...(root?.querySelectorAll('details')||[])].map((node,index)=>({key:detailKey(node,index),open:node.open})),tables:[...(root?.querySelectorAll(scrollers)||[])].map((node,index)=>({index,left:node.scrollLeft,top:node.scrollTop})),x:env.scrollX||0,y:env.scrollY||0,focus:focusKey(env.document?.activeElement,root)};
}
export function restoreNavigationUI(snapshot,root,env){
 if(!snapshot||!root)return;
 for(const value of snapshot.values||[]){if(!controls.includes(value.selector))continue;const node=root.querySelector(value.selector);if(!node)continue;node.value=value.value;if(!['#search','[data-course-search]'].includes(value.selector))node.dispatchEvent(new env.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));}
 [...root.querySelectorAll('details')].forEach((node,index)=>{const value=snapshot.details?.find(item=>item.key===detailKey(node,index));if(value)node.open=value.open;});
 const tables=[...root.querySelectorAll(scrollers)];for(const table of snapshot.tables||[]){if(tables[table.index]){tables[table.index].scrollLeft=table.left;tables[table.index].scrollTop=table.top;}}
 findFocus(snapshot.focus,root)?.focus({preventScroll:true});env.scrollTo(snapshot.x||0,snapshot.y||0);
}

export function createNavigation({getState,getRoute,render,beforeLeave=async()=>true,isModalOpen=()=>false,closeModal=()=>{},root=()=>document.querySelector('main'),environment=globalThis}){
 const env=environment,history=env.history,location=env.location;
 let scope=null,current=null,renderedId=null,records=new Map(),bypass=null,chain=Promise.resolve(),started=false,restoring=false,intentVersion=0,pendingTraversal=null;
 const restorers=new Map();
 const save=()=>{try{env.sessionStorage?.setItem(storageKey,JSON.stringify({scope,records:[...records.values()].slice(-80)}));}catch{/* Navigation still works if browser storage is unavailable. */}};
 const stateFor=entry=>({...history.state,[namespace]:{id:entry.id,scope:entry.scope,route:entry.route,index:entry.index,parent:entry.parent,overlay:entry.overlay}});
 const write=entry=>history.replaceState(stateFor(entry),'','#'+entry.route);
 const token=()=>current?{id:current.id,scope,route:current.route}:null;
 const valid=t=>Boolean(t&&current?.id===t.id&&scope===t.scope&&navigationScope(getState())===t.scope&&getRoute()===t.route);
 function syncScope(){
  const next=navigationScope(getState());if(next===scope)return;
  scope=next;current=null;renderedId=null;records=new Map();restorers.clear();bypass=null;pendingTraversal=null;
  try{const stored=JSON.parse(env.sessionStorage?.getItem(storageKey)||'null');if(stored?.scope===scope)for(const entry of stored.records||[])if(entry.scope===scope&&navigationRoute(entry.route))records.set(entry.id,entry);}catch{/* Ignore incomplete browser storage. */}
 }
 function checkpoint(){if(current&&renderedId===current.id&&navigationScope(getState())===scope){current.ui=captureNavigationUI(getState(),root(),env);save();}}
 function adopt(route){
  const meta=history.state?.[namespace],known=meta?.scope===scope&&meta.route===route?records.get(meta.id):null;
  if(known)current=known;
  else {const parent=meta&&!known?null:current;current={id:env.crypto?.randomUUID?.()||Date.now()+'-'+Math.random(),scope,route,index:parent?parent.index+1:0,parent:parent?.id||null,overlay:false,ui:null};if(navigationRoute(route))records.set(current.id,current);}
  if(records.size>80){for(const id of [...records.keys()].slice(0,records.size-80))records.delete(id);}
  if(navigationRoute(route))write(current);save();applyApp(getState(),current.ui?.app);return current;
 }
 function beginRender(route=getRoute()){
  syncScope();
  const meta=history.state?.[namespace];
  if(current?.route!==route||meta?.id!==current?.id){checkpoint();adopt(route);}else{checkpoint();applyApp(getState(),current.ui?.app);}
  return token();
 }
 function backEntry(){
  let entry=current,seen=new Set();
  while(entry?.parent&&!seen.has(entry.parent)){seen.add(entry.parent);entry=records.get(entry.parent);if(!entry||entry.scope!==scope)return null;if(!entry.overlay&&navigationFamily(entry.route)!==navigationFamily(current.route)&&!['login','crear-contrasena'].includes(navigationFamily(entry.route)))return entry;}
  return null;
 }
 function enhance(){
  const back=backEntry();for(const link of root()?.querySelectorAll('[data-nav-back]')||[]){if(!link.dataset.navFallback)link.dataset.navFallback=link.getAttribute('href');link.setAttribute('href',back?'#'+back.route:link.dataset.navFallback);if(back){const label=navigationLabel(back.route,getState());const span=link.querySelector('[data-nav-label]');if(span)span.textContent=label;else{for(const child of [...link.childNodes])if(child.nodeType===3)child.remove();link.append(env.document.createTextNode(label));}link.setAttribute('aria-label',label);}}
 }
 function completeRender(t){
  if(!valid(t))return;renderedId=current.id;enhance();restoring=true;
  try{if(current.ui)restoreNavigationUI(current.ui,root(),env);else env.scrollTo(0,0);}finally{restoring=false;}
  // A second frame covers layout after bindings without overwriting a newer route or user scroll.
  const y=env.scrollY;env.requestAnimationFrame?.(()=>{if(valid(t)&&env.scrollY===y&&current.ui)env.scrollTo(current.ui.x||0,current.ui.y||0);});
 }
 async function guard(retry){try{return await beforeLeave({retry})!==false;}catch{return false;}}
 async function go(route,{skipGuard=false}={}){
  route=navigationRoute(route);if(!route||route===getRoute())return;
  const intent=++intentVersion;checkpoint();const requestedScope=navigationScope(getState());
  if(!skipGuard&&!await guard(()=>go(route,{skipGuard:true})))return;
  if(intent!==intentVersion||requestedScope!==navigationScope(getState()))return;
  bypass={scope:requestedScope,route};location.hash=route;
 }
 async function travel(entry,{skipGuard=false}={}){
  if(!entry||entry.scope!==scope||!records.has(entry.id))return;
  const intent=++intentVersion;checkpoint();const from=current;if(!skipGuard&&!await guard(()=>travel(entry,{skipGuard:true})))return;
  if(intent!==intentVersion||current!==from||scope!==navigationScope(getState()))return;
  bypass={scope,route:entry.route};pendingTraversal={from:current.id,to:entry.id};history.go(entry.index-current.index);
 }
 async function back(fallback){const entry=backEntry();return entry?travel(entry):go(fallback);}
 async function transition(){
  syncScope();const destination=getRoute(),meta=history.state?.[namespace];
  if(!pages.has(navigationFamily(destination).split('/')[0]))return;
  if(current&&meta?.id===current.id&&current.route===destination){if(pendingTraversal?.to===current.id)pendingTraversal=null;return;}
  const previous=current;checkpoint();
  const target=meta?.scope===scope&&meta.route===destination?records.get(meta.id):null;
  const approved=bypass?.scope===scope&&bypass.route===destination;bypass=null;
  const allowed=!previous||approved||await guard(()=>target?travel(target,{skipGuard:true}):go(destination,{skipGuard:true}));
  if(previous&&(current!==previous||scope!==previous.scope||scope!==navigationScope(getState())))return;
  if(!allowed){
   const delta=target?previous.index-target.index:-1;
   if(delta){pendingTraversal={from:previous.id,to:previous.id};history.go(delta);}else write(previous);
   return;
  }
  if(destination!==getRoute()||scope!==navigationScope(getState()))return;
  if(isModalOpen())closeModal();
  adopt(destination);pendingTraversal=null;await render();
  if(current.overlay&&!isModalOpen()){
   const reopen=restorers.get(current.id);if(reopen)reopen();else{current.overlay=false;write(current);save();}
  }
 }
 const schedule=()=>{chain=chain.then(transition,transition);return chain;};
 function openOverlay(reopen,{replacePage=false}={}){
  syncScope();if(!current)adopt(getRoute());checkpoint();
  if(current.overlay){if(reopen)restorers.set(current.id,reopen);return;}
  if(replacePage&&current.parent){current.overlay=true;renderedId=current.id;restorers.set(current.id,reopen);write(current);save();return;}
  const parent=current;current={...parent,id:env.crypto?.randomUUID?.()||Date.now()+'-'+Math.random(),index:parent.index+1,parent:parent.id,overlay:true};records.set(current.id,current);renderedId=current.id;
  if(!reopen){const key=parent.ui?.focus;reopen=()=>findFocus(key,root())?.click();}
  restorers.set(current.id,reopen);history.pushState(stateFor(current),'','#'+current.route);save();
 }
 function closeOverlay(){if(pendingTraversal?.from===current?.id)return;if(current?.overlay&&history.state?.[namespace]?.id===current.id&&getRoute()===current.route){pendingTraversal={from:current.id,to:current.parent};history.back();}}
 function replaceRoute(route){if(!navigationRoute(route))return;if(current){current.route=route;write(current);save();}else history.replaceState(history.state,'','#'+route);}
 function start(){if(started)return;started=true;try{history.scrollRestoration='manual';}catch{/* Older browsers retain native behavior. */}
  env.addEventListener('hashchange',schedule);env.addEventListener('popstate',schedule);env.addEventListener('pagehide',checkpoint);
  env.document?.addEventListener('click',event=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const link=event.target.closest?.('a[href]');if(!link||link.target&&link.target!=='_self'||link.hasAttribute('download'))return;
   const raw=link.getAttribute('href');if(!raw?.startsWith('#'))return;
   const route=navigationRoute(raw);if(!route||route===getRoute()&&!link.hasAttribute('data-nav-back'))return;
   event.preventDefault();if(link.hasAttribute('data-nav-back'))void back(route);else void go(route);
  },true);
 }
 return {start,beginRender,completeRender,checkpoint,go,back,enhance,openOverlay,closeOverlay,replaceRoute,whenSettled:()=>chain,isRestoring:()=>restoring,hasSnapshot:()=>Boolean(current?.ui),originLabel:()=>{const entry=backEntry();return entry?navigationLabel(entry.route,getState()):null;},overlayOriginLabel:()=>{const entry=current?.overlay&&records.get(current.parent);return entry&&entry.route!==current.route?navigationLabel(entry.route,getState()):null;},currentToken:token};
}
