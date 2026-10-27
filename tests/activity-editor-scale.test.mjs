import test from 'node:test';
import assert from 'node:assert/strict';
import {activityForm,activityImpactHTML,bindActivityEditor,redistributeQuestionPoints,renderQuestion} from '../public/activity-editor.js';
import {createAcademicTools,revisionPolicyHelp} from '../public/academic-tools.js';
import {questionPointsTotal} from '../public/grading-scale.js';

test('changing a quiz from 100 to 5 points assigns 0.25 to each of its twenty questions',()=>{
 const original=Array(20).fill(5),points=redistributeQuestionPoints(original,5);
 assert.deepEqual(points,Array(20).fill(0.25));assert.deepEqual(original,Array(20).fill(5));assert.equal(questionPointsTotal(points),5);
 for(const [values,target] of [[[1,2,3],5],[Array(50).fill(2),7],[Array.from({length:21},(_,i)=>i+1),27.35]]){
  const result=redistributeQuestionPoints(values,target);assert.equal(questionPointsTotal(result),target);result.forEach((value,i)=>assert.ok(Math.abs(value/result[0]-values[i]/values[0])<1e-10));
 }
});

test('a proportional scale outside question limits reports the problem without changing its source',()=>{
 const points=Array(20).fill(5);
 assert.throws(()=>redistributeQuestionPoints(points,1),/menos de 0,1/);assert.deepEqual(points,Array(20).fill(5));
 assert.throws(()=>redistributeQuestionPoints([500,500],2500),/más de 1000/);
 for(const target of [0,NaN,Infinity])assert.throws(()=>redistributeQuestionPoints(points,target),/número positivo/);
 assert.throws(()=>redistributeQuestionPoints([],5),/al menos una/);
});

test('quiz and question inputs accept fractional values without a 0.1 step',()=>{
 const html=activityForm({kind:'quiz',maxPoints:5,questions:[]},{title:'Curso',modules:[]},{modern:true,fileCards:()=>'',savedFiles:()=>'',acceptedFiles:'',questionEditor:renderQuestion});
 assert.match(html,/name="maxPoints"[^>]+step="any"/);assert.doesNotMatch(html,/name="maxPoints"[^>]+disabled/);
 assert.match(renderQuestion({points:0.25}),/name="qPoints"[^>]+min="0.1"[^>]+step="any"[^>]+value="0.25"/);
});

function editorHarness(values=Array(20).fill(5)){
 const classList={add(){},toggle(){}},handlers=new Map(),nodes=new Map();
 function node(value=''){
  const n={value:String(value),disabled:false,hidden:false,checked:false,files:[],classList,childNodes:[{textContent:'Puntos máximos'}],selectedOptions:[{textContent:'Curso'}],textContent:'',innerHTML:'',parentElement:null,tagName:'INPUT',name:'',type:'number',focus(){},scrollIntoView(){},setAttribute(){},removeAttribute(){},addEventListener(){},getAttribute(){return '';},setCustomValidity(message){this.validationMessage=message;},checkValidity(){return !this.validationMessage;},querySelector(){return null;},querySelectorAll(){return [];},closest(selector){return selector==='label'?this:selector==='[data-editor-section]'?{dataset:{editorSection:'grading'}}:null;}};return n;
 }
 const fields={};for(const name of ['kind','maxPoints','title','description','instructionUrl','moduleId','weight','status','opensAt','dueAt','closesAt','instructionFiles','procedureEnabled','procedureMaxFiles','procedureInstructions','procedureReview','responseText','responseLink','responseFiles','responseRequireText','responseRequireLink','responseRequireFiles','allowLate']){fields[name]=node();fields[name].name=name;}
 Object.assign(fields.kind,{value:'quiz',type:'select-one'});fields.maxPoints.value=String(questionPointsTotal(values));fields.title.value='Cuestionario';fields.moduleId.value='';fields.weight.value='0';fields.status.value='draft';fields.procedureMaxFiles.value='5';fields.responseText.checked=true;fields.responseLink.checked=true;fields.responseFiles.checked=true;
 fields.maxPoints.checkValidity=function(){return !this.validationMessage&&Number(this.value)>=Number(this.min)&&Number(this.value)<=Number(this.max);};
 const questions=values.map((points,index)=>{
  const map=new Map(),q=node();q.dataset={question:'q'+index};
  for(const [selector,value]of [['[name=qType]','text'],['[name=qPoints]',points],['[name=qPrompt]','Pregunta '+index],['[name=qOptions]',''],['[name=qCorrect]',''],['[data-manual-hint]',''],['[data-options]',''],['[data-add-option]',''],['[data-option-hint]',''],['[data-question-number]',''],['[data-action="academic-question-up"]',''],['[data-action="academic-question-down"]',''],['[data-action="academic-question-copy"]','']])map.set(selector,node(value));
  const score=map.get('[name=qPoints]');score.name='qPoints';score.checkValidity=()=>Number(score.value)>=0.1&&Number(score.value)<=1000;
  q.querySelector=selector=>map.get(selector)||null;q.querySelectorAll=()=>[];return q;
 });
 const save=node(),footer=node(),previewButton=node(),modal=node();modal.dataset={};modal.open=true;modal.classList=classList;
 footer.insertAdjacentHTML=()=>{};footer.querySelector=selector=>selector==='[type=submit]'?save:previewButton;
 const form=node();form.elements={...fields,namedItem:name=>fields[name]};form.closest=()=>modal;form.querySelector=selector=>{if(selector===':scope > .form-actions')return footer;if(selector==='[name=procedureFormats]:checked')return null;if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
 form.querySelectorAll=selector=>selector==='[data-question]'?questions:selector==='input,textarea,select'?[fields.title,fields.maxPoints,...questions.map(q=>q.querySelector('[name=qPoints]'))]:[];
 form.addEventListener=(type,fn)=>{const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);};form.dispatchEvent=event=>{for(const fn of handlers.get(event.type)||[])fn(event);return true;};
 bindActivityEditor(form,{kind:'quiz',maxPoints:questionPointsTotal(values),questions:[],status:'draft',attachments:[]},{modules:[]},{activities:[]});
 return {form,fields,questions,nodes,edit(name,value,index=0,type='input'){const field=name==='qPoints'?questions[index].querySelector('[name=qPoints]'):fields[name];field.value=String(value);for(const fn of handlers.get(type)||[])fn({target:field});}};
}

test('input/change events redistribute visible questions and editing one question updates the total',()=>{
 const h=editorHarness();h.edit('maxPoints',5);assert.equal(h.fields.maxPoints.value,'5');assert.equal(h.fields.maxPoints.disabled,false);assert.ok(h.questions.every(q=>q.querySelector('[name=qPoints]').value==='0.25'));
 h.edit('qPoints',0.5);assert.equal(h.fields.maxPoints.value,'5.25');assert.equal(h.questions[1].querySelector('[name=qPoints]').value,'0.25');
 h.edit('maxPoints',10.5,0,'change');assert.equal(h.fields.maxPoints.value,'10.5');assert.equal(h.questions[0].querySelector('[name=qPoints]').value,'1');assert.equal(h.questions[1].querySelector('[name=qPoints]').value,'0.5');assert.doesNotThrow(()=>h.form.activityEditor.validate());
});

test('an invalid total stays visible across other edits and blocks saving until corrected',()=>{
 const h=editorHarness();h.edit('maxPoints',1);assert.equal(h.fields.maxPoints.value,'1');assert.ok(h.questions.every(q=>q.querySelector('[name=qPoints]').value==='5'));
 assert.match(h.nodes.get('[data-points-error]').textContent,/menos de 0,1/);assert.equal(h.nodes.get('[data-points-error]').hidden,false);
 h.edit('title','Otro título');assert.equal(h.fields.maxPoints.value,'1');assert.throws(()=>h.form.activityEditor.validate(),/menos de 0,1/);
 h.edit('maxPoints',5);assert.equal(h.nodes.get('[data-points-error]').hidden,true);assert.doesNotThrow(()=>h.form.activityEditor.validate());
});

test('quiz total limits match the number of questions, including 0.1, 0.3 and 20000 points',()=>{
 const single=editorHarness([1]);single.edit('maxPoints',0.1);assert.equal(single.fields.maxPoints.min,'0.1');assert.equal(single.fields.maxPoints.max,'1000');assert.equal(single.fields.maxPoints.value,'0.1');assert.equal(single.questions[0].querySelector('[name=qPoints]').value,'0.1');assert.doesNotThrow(()=>single.form.activityEditor.validate());
 const three=editorHarness([1,1,1]);three.edit('maxPoints',0.3);assert.equal(three.fields.maxPoints.min,'0.3');assert.equal(three.fields.maxPoints.value,'0.3');assert.equal(questionPointsTotal(three.questions.map(q=>Number(q.querySelector('[name=qPoints]').value))),0.3);assert.doesNotThrow(()=>three.form.activityEditor.validate());
 const twenty=editorHarness(Array(20).fill(5));twenty.edit('maxPoints',20000);assert.equal(twenty.fields.maxPoints.max,'20000');assert.ok(twenty.questions.every(q=>q.querySelector('[name=qPoints]').value==='1000'));assert.doesNotThrow(()=>twenty.form.activityEditor.validate());
 assert.deepEqual(redistributeQuestionPoints(Array(20).fill(1000),20000),Array(20).fill(1000));assert.throws(()=>redistributeQuestionPoints([1,2],2000),/más de 1000/);
 twenty.fields.kind.value='task';twenty.form.activityEditor.refresh();assert.equal(twenty.fields.maxPoints.min,'1');assert.equal(twenty.fields.maxPoints.max,'10000');
});

test('an empty quiz keeps zero visible and asks for questions rather than a contradictory total',()=>{
 const empty=editorHarness([]);assert.equal(empty.fields.maxPoints.value,'0');assert.equal(empty.fields.maxPoints.min,'0');assert.equal(empty.fields.maxPoints.max,'0');assert.throws(()=>empty.form.activityEditor.validate(),/Añade al menos una pregunta/);
 const html=activityForm({kind:'quiz',maxPoints:0.3,questions:[{},{},{}]},{title:'Curso',modules:[]},{fileCards:()=>'',savedFiles:()=>'',acceptedFiles:'',questionEditor:()=>''});assert.match(html,/name="maxPoints"[^>]+min="0.3" max="3000"/);
});

test('scale-only impact explains proportional conversion and retained drafts without a private score list',()=>{
 const report={affectedResponses:3,changed:true,policy:'keep',scaleOnly:true,oldMaxPoints:100,newMaxPoints:5,scaleConversionCount:3,scaleConversions:[{name:'PRIVATE SCALE RECORD',points:80}],impact:[],oldWeight:25,newWeight:25};
 const html=activityImpactHTML(report,{changeKind:'evaluated'});assert.match(html,/100 → 5/);assert.match(html,/80\/100 → 4\/5/);assert.match(html,/Respuestas con escala ajustada<\/dt><dd>3/);assert.match(html,/conservan las respuestas y los borradores/);assert.doesNotMatch(html,/borradores en curso pasarán al historial|PRIVATE SCALE RECORD/);
 const noAccess=activityImpactHTML({...report,impact:[]});assert.doesNotMatch(noAccess,/PRIVATE SCALE RECORD/);
});

test('content and repeat policies keep their history warnings, and impact names and periods are escaped',()=>{
 const report={affectedResponses:1,changed:true,policy:'optional',scaleOnly:false,oldMaxPoints:100,newMaxPoints:5,scaleConversionCount:0,impact:[{name:'<img src=x onerror=alert(1)>',before:0,after:4}],oldWeight:25,newWeight:50};
 const html=activityImpactHTML(report,{changeKind:'evaluated',periodTitle:()=>'<script>period</script>'});assert.match(html,/borradores en curso pasarán al historial/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;period/);assert.doesNotMatch(html,/<script>|<img src=x/);
 const repeat=activityImpactHTML({...report,policy:'repeat',scaleOnly:true},{changeKind:'evaluated'});assert.match(repeat,/dejarán de contar/);assert.doesNotMatch(repeat,/se conservan las respuestas y los borradores|notas se convierten proporcionalmente/);
 assert.match(revisionPolicyHelp('evaluated','keep'),/solo cambia la escala/);assert.match(revisionPolicyHelp('evaluated','repeat'),/dejarán de contar/);
});

test('tools send effective maximum to one preview and preserve its scale metadata and policy',async()=>{
 const calls=[],seen=[],tools=createAcademicTools({getState:()=>({user:{roles:['teacher']}}),api:async(path,options)=>{calls.push({path,options});return {affectedResponses:0,impact:[],changed:true,policy:'optional',scaleOnly:true,scaleConversionCount:2,oldMaxPoints:100,newMaxPoints:5};}}),form={activityEditor:{confirmImpact:async report=>{seen.push(report);return true;}}};
 assert.equal(await tools.confirmActivity('activity',{maxPoints:5,changeKind:'evaluated',revisionPolicy:'optional'},form),true);assert.equal(calls.length,1);assert.deepEqual(calls[0].options.body,{maxPoints:5,changeKind:'evaluated',revisionPolicy:'optional',preview:true});assert.equal(seen[0].policy,'optional');assert.equal(seen[0].scaleOnly,true);assert.equal(seen[0].scaleConversionCount,2);
});

test('a proportional scale-only edit with keep saves without a second confirmation',async()=>{
 let previews=0,confirmations=0;const tools=createAcademicTools({getState:()=>({user:{roles:['teacher']}}),api:async()=>{previews++;return {affectedResponses:12,changed:true,policy:'keep',scaleOnly:true,scaleConversionCount:12,oldMaxPoints:100,newMaxPoints:5,oldWeight:25,newWeight:25,oldPeriod:'one',newPeriod:'one',impact:[{before:3.8,after:3.8}]};}}),form={activityEditor:{confirmImpact:async()=>{confirmations++;return false;}}};
 assert.equal(await tools.confirmActivity('activity',{maxPoints:5,changeKind:'evaluated',revisionPolicy:'keep'},form),true);assert.equal(previews,1);assert.equal(confirmations,0);assert.match(revisionPolicyHelp('evaluated','keep'),/notas se convierten proporcionalmente/);
});

test('content, repeat, optional, weight, period or grade impact keeps the existing review',async()=>{
 const base={affectedResponses:1,changed:true,policy:'keep',scaleOnly:true,scaleConversionCount:1,oldWeight:25,newWeight:25,oldPeriod:'one',newPeriod:'one',impact:[]};
 for(const overrides of [{scaleOnly:false},{policy:'repeat'},{policy:'optional'},{newWeight:50},{newPeriod:'two'},{impact:[{before:0,after:1}]}]){
  let confirmations=0;const tools=createAcademicTools({getState:()=>({user:{roles:['teacher']}}),api:async()=>({...base,...overrides})}),form={activityEditor:{confirmImpact:async()=>{confirmations++;return false;}}};
  assert.equal(await tools.confirmActivity('activity',{changeKind:'evaluated',revisionPolicy:overrides.policy||'keep'},form),false);assert.equal(confirmations,1,JSON.stringify(overrides));
 }
});
