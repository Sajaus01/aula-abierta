import test from 'node:test';import assert from 'node:assert/strict';
import {revisionDecision,validatePeriods,gradeCalculation} from '../server/academic-policy.mjs';
import {createAcademicTools} from '../public/academic-tools.js';
const fail=(code,message)=>{throw Error(message);};
test('weight impact is confirmed even when the edited activity has no responses',async()=>{
 let confirmations=0;const previous=globalThis.window;
 globalThis.window={confirm:()=>{confirmations++;return false;}};
 try{const tools=createAcademicTools({getState:()=>({user:{roles:['teacher']}}),api:async()=>({affectedResponses:0,impact:[{name:'Student',before:5,after:2.5}],policy:'keep',oldWeight:0,newWeight:50})});
 assert.equal(await tools.confirmActivity('activity',{}),false);assert.equal(confirmations,1);
 }finally{globalThis.window=previous;}
});
test('evaluated edits require an explicit choice; editorial corrections keep completed work',()=>{
 const before={kind:'quiz',title:'T',description:'D',maxPoints:1,questions:[{id:'q',type:'single',prompt:'Typo',options:['A','B'],correct:[0],points:1}]};
 const editorial={...before,title:'Fixed title'};
 assert.throws(()=>revisionDecision(before,editorial,{},3,false,fail),/Indica/);
 assert.equal(revisionDecision(before,editorial,{changeKind:'editorial'},3,false,fail).reset,false);
 const changed={...before,questions:[{...before.questions[0],correct:[1]}]};
 assert.throws(()=>revisionDecision(before,changed,{changeKind:'editorial'},3,false,fail),/modifica/);
 assert.equal(revisionDecision(before,changed,{changeKind:'evaluated',revisionPolicy:'keep'},3,false,fail).reset,false);
 assert.equal(revisionDecision(before,changed,{changeKind:'evaluated',revisionPolicy:'repeat'},3,false,fail).reset,true);
});
test('period weights, real zero, ungraded, exempt and retained historical scale are distinct',()=>{
 const periods=validatePeriods([{id:'one',title:'One',weight:30},{id:'two',title:'Two',weight:70}],fail);assert.throws(()=>validatePeriods([{id:'one',title:'One',weight:30}],fail),/100/);
 const activities=[{id:'a',title:'A',periodId:'one',weight:100,maxPoints:20},{id:'b',title:'B',periodId:'two',weight:100,maxPoints:10}];
 const rows=id=>[{id:'s'+id,state:'graded',points:id==='a'?10:0,published:1,payload:JSON.stringify(id==='a'?{previousActivity:{maxPoints:10}}:{})}];
 const g=gradeCalculation(activities,'student',{periods,scaleMax:5,finalPublished:true},false,{rows,closed:()=>true,override:()=>false});
 assert.equal(g.final,1.5);assert.equal(g.cells[1].state,'graded');assert.equal(g.cells[1].points,0);
 const pending=gradeCalculation(activities,'student',{periods,scaleMax:5,missingAsZero:true},false,{rows:()=>[{id:'x',state:'submitted',points:null,published:0,payload:'{}'}],closed:()=>true,override:()=>false});assert.equal(pending.cells[0].state,'submitted');assert.equal(pending.final,null);
 const exempt=gradeCalculation(activities,'student',{periods,scaleMax:5,finalPublished:true},false,{rows,closed:()=>true,override:id=>id==='b'});assert.equal(exempt.cells[1].state,'exempt');assert.equal(exempt.final,5);
});
