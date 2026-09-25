export function setupAcademicPolicy(db){db.exec(`
CREATE TABLE IF NOT EXISTS activity_versions(activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,revision INTEGER NOT NULL,config TEXT NOT NULL,files TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(activity_id,revision));
CREATE TABLE IF NOT EXISTS grade_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,submission_id TEXT NOT NULL,actor_id TEXT NOT NULL,before_value TEXT NOT NULL,after_value TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grade_overrides(activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,student_id TEXT NOT NULL REFERENCES users(id),exempt INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(activity_id,student_id));
CREATE TABLE IF NOT EXISTS attempt_starts(activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,student_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,started_at TEXT NOT NULL,PRIMARY KEY(activity_id,student_id,revision));
CREATE TABLE IF NOT EXISTS learning_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,course_id TEXT,object_id TEXT,action TEXT NOT NULL,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_group_date ON learning_events(course_id,created_at);`);}
export function evaluatedSignature(a){return JSON.stringify({kind:a.kind,maxPoints:a.maxPoints,questions:a.questions.map(q=>({id:q.id,type:q.type,options:q.options,correct:q.correct,points:q.points}))});}
export function revisionDecision(before,after,body,count,attachmentsChanged,fail){
 const structural=evaluatedSignature(before)!==evaluatedSignature(after);
 const textChanged=['title','description','questions','instructionUrl'].some(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]))||attachmentsChanged;
 const changed=structural||textChanged;
 if(count&&changed){
  if(!['editorial','evaluated'].includes(body.changeKind))fail(409,'Indica si el cambio es de redacción o modifica lo evaluado.','REVISION_DECISION_REQUIRED');
  if(structural&&body.changeKind==='editorial')fail(400,'Cambiar opciones, respuestas, puntos o preguntas modifica la evaluación.');
  if(body.changeKind==='evaluated'&&!['keep','optional','repeat'].includes(body.revisionPolicy))fail(409,'Decide cómo afecta el cambio a los intentos existentes.','REVISION_DECISION_REQUIRED');
 }
 const policy=count&&changed&&body.changeKind==='evaluated'?body.revisionPolicy:(before.repeatPolicy||'keep');
 return {changed,policy,reset:count>0&&changed&&body.changeKind==='evaluated'&&policy==='repeat'};
}
export function validatePeriods(input,fail){
 if(!Array.isArray(input)||input.length>12)fail(400,'Configura hasta 12 cortes.');const ids=new Set();
 const periods=input.map(p=>{if(!p||typeof p.id!=='string'||!/^[\w-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.title!=='string'||!p.title.trim()||p.title.length>100||typeof p.weight!=='number'||!Number.isFinite(p.weight)||p.weight<0||p.weight>100)fail(400,'Revisa nombres, identificadores y pesos de los cortes.');ids.add(p.id);return {id:p.id,title:p.title.trim(),weight:p.weight};});
 if(periods.length&&Math.abs(periods.reduce((n,p)=>n+p.weight,0)-100)>.0001)fail(400,'Los cortes deben sumar 100 %.');return periods;
}
export function gradeCalculation(activities,userId,cfg,forAdmin,{rows,closed,override}){
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const cells=activities.map(a=>{const s=rows(a.id,userId).find(r=>r.state!=='draft'),old=s?JSON.parse(s.payload).previousActivity:null;const maxPoints=old?.maxPoints||a.maxPoints;const visible=s&&s.points!==null&&(forAdmin||s.published);const exempt=override(a.id,userId);const zero=!s&&cfg.missingAsZero&&closed(a);return {activityId:a.id,title:a.title,periodId:a.periodId||'',weight:a.weight,maxPoints,submissionId:s?.id||null,points:visible?s.points:null,published:Boolean(s?.published),state:exempt?'exempt':zero?'missing':!s?'pending':visible?'graded':'submitted',late:Boolean(s?.late),ready:!!exempt||!!zero||!!(s?.published&&s.points!==null)};});
 function calculate(list){const nonExempt=list.filter(c=>c.state!=='exempt'),total=nonExempt.reduce((n,c)=>n+c.weight,0),graded=nonExempt.filter(c=>c.state==='graded'||c.state==='missing'),gradedWeight=graded.reduce((n,c)=>n+c.weight,0),earned=graded.reduce((n,c)=>n+(c.points||0)/c.maxPoints*c.weight,0);return {weightTotal:round(list.reduce((n,c)=>n+c.weight,0)),gradedWeight:round(gradedWeight),provisional:gradedWeight?round(earned/gradedWeight*cfg.scaleMax):null,accumulated:total?round(earned/total*cfg.scaleMax):null,ready:Math.abs(list.reduce((n,c)=>n+c.weight,0)-100)<.001&&list.every(c=>!c.weight||c.ready),allExempt:!!list.length&&!nonExempt.length};}
 const periods=(cfg.periods||[]).map(p=>({...p,...calculate(cells.filter(c=>c.periodId===p.id))}));
 if(!periods.length){const v=calculate(cells);return {...v,cells,periods:[],final:cfg.finalPublished&&v.ready?v.accumulated:null};}
 const counted=periods.filter(p=>!p.allExempt),weight=counted.reduce((n,p)=>n+p.weight,0),graded=counted.filter(p=>p.provisional!==null),evaluated=graded.reduce((n,p)=>n+p.weight,0),ready=periods.every(p=>p.ready)&&cells.every(c=>periods.some(p=>p.id===c.periodId));
 const accumulated=weight?round(counted.reduce((n,p)=>n+(p.accumulated||0)*p.weight,0)/weight):null;
 return {cells,periods,weightTotal:round(periods.reduce((n,p)=>n+p.weight,0)),gradedWeight:round(evaluated),provisional:evaluated?round(graded.reduce((n,p)=>n+p.provisional*p.weight,0)/evaluated):null,accumulated,ready,final:cfg.finalPublished&&ready?accumulated:null};
}
