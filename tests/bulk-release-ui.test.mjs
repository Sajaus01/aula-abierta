import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcademicUI} from '../public/academics.js';

function fixture({apiResult={releasedCount:2,skippedCount:1},apiError=null,renderError=null}={}){
 const calls=[],messages=[];let renders=0;
 const ui=createAcademicUI({api:async(path,options)=>{calls.push({path,options});if(apiError)throw apiError;return apiResult;},getState:()=>({user:{id:'teacher',role:'admin',roles:['teacher']},viewMode:'teaching',assurance:'password',courses:[]}),openModal(){},toast:message=>messages.push(message),render:async()=>{renders++;if(renderError)throw renderError;},modal:{},btn:()=>'',icon:()=>'',heading:()=>'',empty:()=>''});
 const element={disabled:true,isConnected:true,getAttribute:name=>name==='aria-busy'?'true':null};
 return {ui,calls,messages,element,get renders(){return renders;}};
}

function dispatch(ui,element){
 return async()=>{if(element.disabled)return;const [action,id]=element.dataset.action.split(':');element.disabled=true;try{await ui.action(action,id,element);}finally{if(element.isConnected)element.disabled=false;}};
}

for(const [action,resource]of [['academic-release-activity','activities'],['academic-release','courses']]){
 test(`the external ${resource} return action accepts the button already locked by the global dispatcher`,async()=>{
  const value=fixture();await value.ui.action(action,'target',value.element);
  assert.deepEqual(value.calls,[{path:`/academics/${resource}/target/release`,options:{method:'POST',body:{}}}]);
  assert.equal(value.renders,1);assert.match(value.messages[0],/2 notas devueltas/);assert.equal(value.element.disabled,false);
 });
}

test('the global lock prevents a repeated click while the external activity release is in flight',async()=>{
 let complete;const waiting=new Promise(resolve=>complete=resolve),value=fixture({apiResult:waiting});
 value.element.disabled=false;value.element.dataset={action:'academic-release-activity:activity'};const click=dispatch(value.ui,value.element),first=click();
 await Promise.resolve();await click();assert.equal(value.calls.length,1);assert.equal(value.element.disabled,true);
 complete({releasedCount:1,skippedCount:0});await first;assert.equal(value.element.disabled,false);assert.equal(value.renders,1);assert.deepEqual(value.messages,['1 nota devuelta.']);
});

test('a server rejection is reported to the caller and leaves the button usable for a retry',async()=>{
 const error=Object.assign(Error('Solo puedes calificar actividades de tu grupo.'),{status:403}),value=fixture({apiError:error});
 await assert.rejects(()=>value.ui.action('academic-release-activity','activity',value.element),failure=>failure===error);
 assert.equal(value.element.disabled,false);assert.equal(value.renders,0);assert.deepEqual(value.messages,[]);
});

test('a refresh failure after commit confirms the successful return instead of suggesting another release',async()=>{
 const value=fixture({renderError:Error('Sin conexión para recargar')});await value.ui.action('academic-release','group',value.element);
 assert.equal(value.calls.length,1);assert.equal(value.renders,1);assert.equal(value.element.disabled,false);assert.match(value.messages[0],/2 notas devueltas/);assert.match(value.messages[0],/La devolución se guardó/);assert.match(value.messages[0],/Recarga la página/);
});

test('an activity with no eligible new notes has an explicit outcome without claiming a publication',async()=>{
 const value=fixture({apiResult:{releasedCount:0,skippedCount:2}});await value.ui.action('academic-release-activity','activity',value.element);
 assert.match(value.messages[0],/^No hay notas nuevas listas para devolver/);assert.match(value.messages[0],/Las demás entregas conservaron su estado\./);assert.doesNotMatch(value.messages[0],/0 notas devueltas|siguen pendientes|soportes por revisar/);
 const refresh=fixture({apiResult:{releasedCount:0},renderError:Error('Sin conexión')});await refresh.ui.action('academic-release-activity','activity',refresh.element);assert.match(refresh.messages[0],/No pudimos actualizar la lista/);assert.doesNotMatch(refresh.messages[0],/devolución se guardó/);
});

test('the fallback response and a detached source button do not break the course release',async()=>{
 const value=fixture({apiResult:{published:1}});value.element.isConnected=false;
 await value.ui.action('academic-release','group',value.element);assert.deepEqual(value.messages,['1 nota devuelta.']);assert.equal(value.renders,1);
});
