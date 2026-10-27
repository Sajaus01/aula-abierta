import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationRoute,navigationScope,navigationFamily,navigationLabel,captureNavigationUI,restoreNavigationUI,createNavigation} from '../public/navigation.js';

const stateFor=(id='teacher-one',extra={})=>({user:{id,role:'admin',roles:['teacher']},viewMode:'teaching',assurance:'password',query:'',filter:'all',resourceFilter:'all',courseContentQuery:'',courseOpenChapters:null,courses:[{id:'group-a',entityKind:'group'},{id:'template-a',entityKind:'template'}],...extra});
class NodeMock{
 constructor(tagName='DIV',options={}){Object.assign(this,{tagName,id:'',className:'',dataset:{},attributes:{},value:'',open:false,scrollLeft:0,scrollTop:0,childNodes:[],events:[],focused:0,clicked:0,selectors:[],parent:null},options);}
 matches(selector){return this.selectors.includes(selector)||selector==='#'+this.id;}
 getAttribute(name){return this.attributes[name]??null;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 hasAttribute(name){return Object.hasOwn(this.attributes,name);}
 querySelector(selector){return selector==='[data-nav-label]'?this.label||null:null;}
 querySelectorAll(){return [];}
 dispatchEvent(event){this.events.push(event.type);this.onEvent?.(event);return true;}
 focus(options){this.focused++;this.focusOptions=options;this.environment.document.activeElement=this;}
 click(){this.clicked++;this.onClick?.();}
 append(node){this.childNodes.push(node);}
 closest(selector){if(selector==='a[href]'&&this.tagName==='A'&&this.hasAttribute('href'))return this;return this.parent?.closest?.(selector)||null;}
}
function rootMock(environment){
 const search=new NodeMock('INPUT',{id:'search',selectors:['#search']}),filter=new NodeMock('SELECT',{id:'gradebook-filter',selectors:['#gradebook-filter'],value:'all'});
 const answer=new NodeMock('TEXTAREA',{value:'Never persist the student answer',selectors:['[name=answer]']});
 const password=new NodeMock('INPUT',{value:'Never persist a password',selectors:['[type=password]']});
 const chapter=new NodeMock('DETAILS',{dataset:{moduleId:'chapter-a'},className:'course-chapter'}),table=new NodeMock('DIV',{className:'table-wrap'});
 const action=new NodeMock('BUTTON',{dataset:{action:'resource:material-a'}}),quizAnswer=new NodeMock('BUTTON',{dataset:{action:'quiz-option:question-one:2'}});
 const link=new NodeMock('A',{attributes:{href:'#actividad/task-a'}}),back=new NodeMock('A',{attributes:{href:'#curso/fallback','data-nav-back':''},label:{textContent:''}});
 const nodes=[search,filter,answer,password,chapter,table,action,quizAnswer,link,back];for(const node of nodes)node.environment=environment;
 const root={nodes,search,filter,answer,password,chapter,table,action,quizAnswer,link,back,contains:node=>nodes.includes(node),querySelector:selector=>nodes.find(node=>node.matches(selector))||null,querySelectorAll:selector=>selector==='details'?[chapter]:selector==='.table-wrap,.analytics-table-wrap,[data-nav-scroll]'?[table]:selector==='[data-nav-back]'?[back]:selector==='[data-action]'?[action,quizAnswer]:selector==='a[href]'?[link,back]:[]};
 return root;
}
function browserMock(initial='grupos',persisted=null){
 const data=persisted||{entries:[{hash:'#'+initial,state:{unrelated:'preserved'}}],index:0,storage:new Map()},listeners=new Map(),documentListeners=new Map();
 const on=(map,type,callback)=>{if(!map.has(type))map.set(type,[]);map.get(type).push(callback);};
 const emit=(map,type,event={})=>{for(const listener of map.get(type)||[])listener(event);};
 const env={scrollX:0,scrollY:0,Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},crypto:{randomUUID:()=>randomId()},document:{activeElement:null,addEventListener:(type,listener)=>on(documentListeners,type,listener),createTextNode:text=>({nodeType:3,textContent:text,remove(){}})},addEventListener:(type,listener)=>on(listeners,type,listener),sessionStorage:{getItem:key=>data.storage.get(key)||null,setItem:(key,value)=>data.storage.set(key,String(value))},scrollTo:(x,y)=>{env.scrollX=x;env.scrollY=y;},requestAnimationFrame:callback=>queueMicrotask(callback)};
 data.ids??=0;function randomId(){return 'navigation-entry-'+(++data.ids);}
 const change=(index,{pop=false}={})=>{if(index<0||index>=data.entries.length)return;const previous=data.entries[data.index].hash;data.index=index;queueMicrotask(()=>{if(pop)emit(listeners,'popstate',{state:env.history.state});if(previous!==data.entries[data.index].hash)emit(listeners,'hashchange');});};
 env.location={get hash(){return data.entries[data.index].hash;},set hash(value){const hash='#'+String(value).replace(/^#/,'');if(hash===this.hash)return;data.entries.splice(data.index+1);data.entries.push({hash,state:null});change(data.entries.length-1);}};
 env.history={scrollRestoration:'auto',get state(){return structuredClone(data.entries[data.index].state);},replaceState:(state,_title,url)=>{data.entries[data.index]={hash:url===undefined?env.location.hash:String(url),state:structuredClone(state)};},pushState:(state,_title,url)=>{data.entries.splice(data.index+1);data.entries.push({hash:String(url),state:structuredClone(state)});data.index=data.entries.length-1;},go:delta=>change(data.index+Number(delta),{pop:true}),back:()=>change(data.index-1,{pop:true}),forward:()=>change(data.index+1,{pop:true})};
 return {environment:env,data,emit:type=>emit(listeners,type),click:(target,options={})=>{let prevented=false;const event={target,button:0,defaultPrevented:false,...options,preventDefault(){prevented=true;this.defaultPrevented=true;}};emit(documentListeners,'click',event);return prevented;}};
}
function harness({initial='grupos',state=stateFor(),persisted=null,guard=async()=>true}={}){
 const browser=browserMock(initial,persisted),env=browser.environment;let root=rootMock(env),renders=0,modal=false,closed=0,reopened=0,guardFn=guard;
 const render=async()=>{const token=navigation.beginRender();renders++;root=rootMock(env);navigation.completeRender(token);};
 const navigation=createNavigation({getState:()=>state,getRoute:()=>env.location.hash.slice(1),render,beforeLeave:options=>guardFn(options),root:()=>root,environment:env,isModalOpen:()=>modal,closeModal:()=>{closed++;modal=false;}});
 navigation.start();
 const settle=async()=>{for(let index=0;index<10;index++){await Promise.resolve();await navigation.whenSettled();}};
 const ready=async()=>{await render();await settle();};
 return {navigation,browser,environment:env,state,ready,settle,render,get root(){return root;},get renders(){return renders;},set guard(value){guardFn=value;},get closed(){return closed;},get reopened(){return reopened;},get modal(){return modal;},openModal(options){modal=true;navigation.openOverlay(()=>{modal=true;reopened++;},options);}};
}

test('routes accept application context while rejecting document anchors, external addresses and secret query values',()=>{
 const route='estadisticas/group-a?from=2026-10-01&to=2026-10-27&student=student-a';
 assert.equal(navigationRoute('#'+route),route);assert.equal(navigationFamily(route),'estadisticas/group-a');
 for(const invalid of ['#main','#review','https://example.com/#curso/a','//example.com','javascript:alert(1)','curso/a/extra','curso/a\\b','curso/a\n','other/a'])assert.equal(navigationRoute(invalid),null,invalid);
 for(const unsafe of ['actividad/a?answer=private-response','actividad/a?password=private-password','calificaciones/a?points=4&feedback=private-feedback']){const value=navigationRoute(unsafe);assert.ok(value===null||!value.includes('private-')&&!value.includes('points='),'non-navigation data cannot enter persisted routes');}
 assert.equal(navigationLabel('curso/group-a',stateFor()),'Volver al grupo');assert.equal(navigationLabel('curso/template-a',stateFor()),'Volver al curso');
});

test('navigation scope isolates the actor, canonical roles, view and preview target',()=>{
 const base=stateFor(),key=navigationScope(base);
 for(const changed of [stateFor('another'),{...base,viewMode:'learning'},{...base,assurance:'document'},{...base,preview:'group-a'},{...base,previewActivity:'activity-a'},{...base,user:{...base.user,mustChangePassword:true}},{...base,user:{...base.user,roles:['master']}}])assert.notEqual(navigationScope(changed),key);
 const preview={...base,preview:'group-a',previewUser:{id:'student-a'}};
 assert.notEqual(navigationScope(preview),navigationScope({...preview,user:{...preview.user,id:'another-teacher'}}),'preview target identity cannot replace the authenticated actor');
});

test('snapshots preserve only whitelisted controls and cannot capture answers, passwords or quiz selections',()=>{
 const {environment:env}=browserMock(),root=rootMock(env),state=stateFor();root.search.value='Circuitos';root.filter.value='pending';root.chapter.open=true;root.table.scrollLeft=87;root.table.scrollTop=34;env.scrollTo(5,420);env.document.activeElement=root.search;
 state.courseOpenChapters=new Set(['chapter-a']);state.courseContentQuery='simulación';
 const snapshot=captureNavigationUI(state,root,env),serialized=JSON.stringify(snapshot);
 assert.deepEqual(snapshot.values.map(value=>value.selector),['#search','#gradebook-filter']);assert.ok(!serialized.includes(root.answer.value));assert.ok(!serialized.includes(root.password.value));
 env.document.activeElement=root.quizAnswer;assert.equal(captureNavigationUI(state,root,env).focus,null,'answer-choice actions are not navigation controls');
 const restored=rootMock(env);restoreNavigationUI({...snapshot,values:[...snapshot.values,{selector:'[name=answer]',value:'injected answer'}]},restored,env);
 assert.equal(restored.search.value,'Circuitos');assert.equal(restored.filter.value,'pending');assert.equal(restored.answer.value,'Never persist the student answer');assert.equal(restored.chapter.open,true);assert.equal(restored.table.scrollLeft,87);assert.equal(restored.table.scrollTop,34);assert.equal(env.scrollY,420);assert.deepEqual(restored.search.events,[]);assert.deepEqual(restored.filter.events,['change']);assert.equal(env.document.activeElement,restored.search);
});

test('the in-app return restores the real origin, its filters, chapter state, horizontal scroll and focus',async()=>{
 const h=harness({initial:'calificaciones/group-a?student=student-a&view=matrix'});await h.ready();
 h.root.search.value='Sofía';h.root.filter.value='pending';h.root.chapter.open=true;h.root.table.scrollLeft=190;h.root.table.scrollTop=46;h.environment.scrollTo(0,615);h.environment.document.activeElement=h.root.search;
 h.state.courseOpenChapters=new Set(['chapter-a']);h.state.courseContentQuery='tema';h.state.resourceFilter='activities';
 await h.navigation.go('actividad/task-a');await h.settle();assert.equal(h.root.back.getAttribute('href'),'#calificaciones/group-a?student=student-a&view=matrix');
 await h.navigation.back('curso/fallback');await h.settle();
 assert.equal(h.environment.location.hash,'#calificaciones/group-a?student=student-a&view=matrix');assert.equal(h.root.search.value,'Sofía');assert.equal(h.root.filter.value,'pending');assert.equal(h.root.chapter.open,true);assert.equal(h.root.table.scrollLeft,190);assert.equal(h.environment.scrollY,615);assert.equal(h.environment.document.activeElement,h.root.search);assert.equal(h.state.courseContentQuery,'tema');assert.equal(h.state.resourceFilter,'activities');assert.deepEqual([...h.state.courseOpenChapters],['chapter-a']);
});

test('return skips query-only entries of the same activity and reaches the course context',async()=>{
 const h=harness({initial:'curso/group-a?module=chapter-a'});await h.ready();
 await h.navigation.go('actividad/task-a?submission=one');await h.settle();await h.navigation.go('actividad/task-a?submission=two');await h.settle();
 await h.navigation.back('grupos');await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a?module=chapter-a');
});

test('native browser back and forward preserve each page snapshot and do not create duplicate history entries',async()=>{
 const h=harness();await h.ready();h.root.search.value='Grupo A';h.environment.scrollTo(0,300);
 await h.navigation.go('curso/group-a');await h.settle();h.root.chapter.open=true;h.environment.scrollTo(0,750);
 await h.navigation.go('actividad/task-a');await h.settle();const length=h.browser.data.entries.length;
 h.environment.history.back();await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a');assert.equal(h.root.chapter.open,true);assert.equal(h.environment.scrollY,750);
 h.environment.history.back();await h.settle();assert.equal(h.root.search.value,'Grupo A');assert.equal(h.environment.scrollY,300);
 h.environment.history.forward();await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a');assert.equal(h.environment.scrollY,750);assert.equal(h.browser.data.entries.length,length);
});

test('same-hash overlays close on browser back and reopen on forward while keeping the course context',async()=>{
 const h=harness({initial:'curso/group-a'});await h.ready();h.environment.document.activeElement=h.root.action;
 h.openModal();assert.equal(h.modal,true);assert.equal(h.browser.data.entries.length,2);
 h.environment.history.back();await h.settle();assert.equal(h.modal,false);assert.equal(h.closed,1);assert.equal(h.environment.location.hash,'#curso/group-a');
 h.environment.history.forward();await h.settle();assert.equal(h.modal,true);assert.equal(h.reopened,1);
 h.navigation.closeOverlay();await h.settle();assert.equal(h.modal,false);
});

test('a reload restores persisted context for the same user and retains the real parent entry',async()=>{
 const h=harness({initial:'grupos'});await h.ready();h.root.search.value='Grupo B';h.environment.scrollTo(0,275);
 await h.navigation.go('curso/group-a');await h.settle();h.root.chapter.open=true;h.environment.scrollTo(0,480);h.navigation.checkpoint();
 const reloaded=harness({persisted:h.browser.data,state:stateFor()});await reloaded.ready();
 assert.equal(reloaded.root.chapter.open,true);assert.equal(reloaded.environment.scrollY,480);assert.equal(reloaded.root.back.getAttribute('href'),'#grupos');
 await reloaded.navigation.back('catalogo');await reloaded.settle();assert.equal(reloaded.root.search.value,'Grupo B');assert.equal(reloaded.environment.scrollY,275);
});

test('switching user or role discards prior UI snapshots and stale rendering tokens',async()=>{
 const h=harness();await h.ready();h.root.search.value='Private prior group';await h.navigation.go('curso/group-a');await h.settle();const previous=h.navigation.currentToken();
 h.state.user={...h.state.user,id:'other-user'};await h.render();await h.settle();assert.equal(h.root.search.value,'');assert.equal(h.root.back.getAttribute('href'),'#curso/fallback');
 h.environment.scrollTo(0,23);h.navigation.completeRender(previous);await h.settle();assert.equal(h.environment.scrollY,23,'an old user render cannot restore scroll or focus');
});

test('a rejected or failed async leave guard rolls browser navigation back without losing context',async()=>{
 for(const rejects of [false,true]){
  const h=harness({initial:'curso/group-a?module=chapter-a'});await h.ready();await h.navigation.go('actividad/task-a');await h.settle();h.environment.scrollTo(0,610);h.root.filter.value='returned';
  let calls=0;h.guard=async()=>{calls++;await Promise.resolve();if(rejects)throw Error('Save failed');return false;};
  h.environment.history.back();await h.settle();assert.equal(h.environment.location.hash,'#actividad/task-a');assert.equal(h.environment.scrollY,610);assert.equal(h.root.filter.value,'returned');assert.equal(calls,1);
  h.guard=async()=>true;h.environment.history.back();await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a?module=chapter-a');
 }
});

test('a scope change while an asynchronous guard is pending cannot navigate as the prior account',async()=>{
 let release;const h=harness({guard:()=>new Promise(resolve=>{release=resolve;})});await h.ready();
 const pending=h.navigation.go('curso/group-a');await Promise.resolve();h.state.user={...h.state.user,id:'new-user'};release(true);await pending;await h.settle();assert.equal(h.environment.location.hash,'#grupos');
});

test('document anchors, external links, downloads and modified clicks remain outside the router',async()=>{
 const h=harness();await h.ready();
 for(const href of ['#main','#review','https://example.com','/api/resources/a/file']){const link=new NodeMock('A',{attributes:{href}});assert.equal(h.browser.click(link),false);}
 const download=new NodeMock('A',{attributes:{href:'#curso/group-a',download:''}});assert.equal(h.browser.click(download),false);await h.settle();assert.equal(h.environment.location.hash,'#grupos');
 const link=new NodeMock('A',{attributes:{href:'#curso/group-a'}});for(const options of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}])assert.equal(h.browser.click(link,options),false);assert.equal(h.browser.click(link),true);await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a');
});

test('the latest navigation intent wins when asynchronous leave approvals finish out of order',async()=>{
 const approvals=[],h=harness({guard:()=>new Promise(resolve=>approvals.push(resolve))});await h.ready();
 const first=h.navigation.go('curso/group-a'),second=h.navigation.go('curso/group-b');
 approvals[1](true);await second;await h.settle();assert.equal(h.environment.location.hash,'#curso/group-b');
 approvals[0](true);await first;await h.settle();assert.equal(h.environment.location.hash,'#curso/group-b');
});

test('confirming a deferred in-app return restores the original entry rather than creating an empty replacement',async()=>{
 const h=harness({initial:'calificaciones/group-a?view=matrix&student=student-a'});await h.ready();h.root.search.value='Saved filter';h.environment.scrollTo(0,820);
 await h.navigation.go('actividad/task-a');await h.settle();let retry;
 h.guard=async options=>{retry=options.retry;return false;};await h.navigation.back('grupos');assert.equal(h.environment.location.hash,'#actividad/task-a');
 h.guard=async()=>true;await retry();await h.settle();assert.equal(h.environment.location.hash,'#calificaciones/group-a?view=matrix&student=student-a');assert.equal(h.root.search.value,'Saved filter');assert.equal(h.environment.scrollY,820);
});

test('discarding a dirty dialog after browser Back does not travel twice when its close event precedes history completion',async()=>{
 const h=harness({initial:'inicio'});await h.ready();await h.navigation.go('actividad/task-a');await h.settle();h.openModal();
 let retry;h.guard=async options=>{retry=options.retry;return false;};
 h.environment.history.back();await h.settle();assert.equal(h.modal,true);assert.equal(h.browser.data.index,2);
 const originalGo=h.environment.history.go;h.environment.history.go=delta=>queueMicrotask(()=>originalGo(delta));
 const returning=retry();h.navigation.closeOverlay();await returning;await h.settle();
 assert.equal(h.environment.location.hash,'#actividad/task-a');assert.equal(h.browser.data.index,1);assert.equal(h.modal,false);
});

test('a rejected browser guard cannot roll an old account route over a newly rendered account',async()=>{
 const h=harness({initial:'curso/group-a'});await h.ready();await h.navigation.go('actividad/task-a');await h.settle();let release;
 h.guard=()=>new Promise(resolve=>{release=resolve;});h.environment.history.back();for(let index=0;index<10&&!release;index++)await Promise.resolve();assert.ok(release);
 h.state.user={...h.state.user,id:'another-account'};await h.render();h.guard=async()=>true;release(false);await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a');
});

test('navigation remains usable when session storage is unavailable and expired entries remain a scope boundary',async()=>{
 const h=harness();h.environment.sessionStorage={getItem(){throw Error('Storage disabled');},setItem(){throw Error('Storage disabled');}};await h.ready();
 await h.navigation.go('curso/group-a');await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a');await h.navigation.back('catalogo');await h.settle();assert.equal(h.environment.location.hash,'#grupos');
 const previous=h.navigation.currentToken();h.state.user={...h.state.user,roles:['master']};await h.render();await h.settle();assert.equal(h.root.back.getAttribute('href'),'#curso/fallback');h.navigation.completeRender(previous);
});

test('a material opened from learning or notifications returns directly to its origin while a direct link keeps the course fallback',async()=>{
 for(const origin of ['mis-cursos','notificaciones?course=group-a']){
  const h=harness({initial:origin});await h.ready();h.root.search.value='Original course filter';h.environment.scrollTo(0,475);
  await h.navigation.go('curso/group-a?resource=material-a');await h.settle();h.navigation.replaceRoute('curso/group-a');
  h.openModal({replacePage:true});assert.equal(h.modal,true);assert.equal(h.browser.data.entries.length,2,'the intermediate course is replaced by its material overlay');
  h.environment.history.back();await h.settle();assert.equal(h.environment.location.hash,'#'+origin);assert.equal(h.modal,false);assert.equal(h.root.search.value,'Original course filter');assert.equal(h.environment.scrollY,475);
  h.environment.history.forward();await h.settle();assert.equal(h.environment.location.hash,'#curso/group-a');assert.equal(h.modal,true);assert.equal(h.reopened,1);assert.equal(h.browser.data.entries.length,2);
  h.navigation.closeOverlay();await h.settle();assert.equal(h.environment.location.hash,'#'+origin);assert.equal(h.modal,false);
 }
 const direct=harness({initial:'curso/group-a?resource=material-a'});await direct.ready();direct.navigation.replaceRoute('curso/group-a');direct.openModal({replacePage:true});
 assert.equal(direct.browser.data.entries.length,2);direct.environment.history.back();await direct.settle();assert.equal(direct.environment.location.hash,'#curso/group-a');assert.equal(direct.modal,false);
});
