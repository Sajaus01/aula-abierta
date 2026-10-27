import {summarizeCourseLearning,materialStatus,activityFinalized} from '../public/learning.js';
import {submissionMaxPoints} from '../public/grading-scale.js';

const DAY=86400000,TIMEZONE='America/Bogota';
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
const mean=values=>values.length?round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
const parsed=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const latestDate=values=>values.filter(Boolean).sort().at(-1)||null;
const localDate=value=>new Date(Number(value)-5*3600000).toISOString().slice(0,10);
const inRange=(value,filters)=>Boolean(value&&value>=filters.startAt&&value<=filters.endAt);

export function insightsFilters(query,fail,at=Date.now()){
 const today=localDate(at),defaultFrom=new Date(Date.parse(today+'T12:00:00Z')-29*DAY).toISOString().slice(0,10);
 const from=query.get('from')||defaultFrom,to=query.get('to')||today;
 for(const value of [from,to]){
  const date=new Date(value+'T00:00:00Z');
  if(!/^\d{4}-\d\d-\d\d$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)fail(400,'La fecha del filtro no es válida.');
 }
 if(from>to)fail(400,'La fecha inicial debe ser anterior a la final.');
 return {from,to,startAt:new Date(from+'T00:00:00.000-05:00').toISOString(),endAt:new Date(to+'T23:59:59.999-05:00').toISOString(),timezone:TIMEZONE,defaultPeriod:!query.get('from')&&!query.get('to'),studentId:query.get('student')||'',activityId:query.get('activity')||''};
}

export const INSIGHT_DEFINITIONS={
 current:'Entregas, pendientes, materiales, avance y notas muestran el estado actual del grupo, no una reconstrucción del pasado.',
 period:'El intervalo seleccionado se aplica a ingresos, sesiones, tiempo activo y acciones registradas. Sus días corresponden a Colombia.',
 visits:'Ingreso medido: sesión de participación en el grupo iniciada después de 30 minutos sin actividad. Recargar o cambiar de capítulo no añade otro ingreso.',
 sessions:'Una sesión reúne la participación del estudiante en un mismo grupo hasta que transcurren 30 minutos sin actividad.',
 active:'Tiempo activo medido con el aula visible, en primer plano y con interacción reciente. No equivale al tiempo que una pestaña queda abierta ni demuestra aprendizaje.',
 averageSession:'Duración promedio: tiempo activo medido dividido entre las sesiones con ingreso o actividad en el intervalo. No es duración de una pestaña abierta.',
 daily:'Una sesión con actividad en varios días aparece en cada día. Las sesiones diarias no se suman para obtener las sesiones distintas del periodo.',
 historical:'No se reconstruye tiempo activo anterior al inicio de esta medición. Las aperturas antiguas del grupo no se convierten en ingresos medidos.',
 submitted:'Cada actividad se cuenta una vez según su última respuesta vigente. Enviada o calificada significa entregada; un borrador o una devolución sigue pendiente.',
 pending:'Pendientes y vencidas sin entrega son categorías separadas. El total sin entregar conserva ambas; por finalizar excluye entregas reales, exenciones y cierres automáticos vigentes.',
 overdue:'Usa el plazo efectivo de la actividad, corrección o autorización individual. Un cierre automático vigente conserva la actividad como vencida sin entrega; una autorización sin límite no recupera la fecha original.',
 progress:'Avance del contenido publicado visible: materiales completados, tareas entregadas y cuestionarios enviados. Un cierre automático o una exención no se cuentan como acciones realizadas ni como aprobación.',
 continuity:'Finalizadas para continuar reúne entregas reales, exenciones y cierres automáticos vigentes. No equivale a entregadas ni a resultados satisfactorios.',
 autoClosure:'Cerradas sin entrega son actividades con cierre automático vigente y cero registrado. Siguen vencidas sin entrega; una reapertura individual retira ese cierre mientras permite responder.',
 grades:'Nota acumulada sobre el 100 % del semestre según el libro docente. Incluye todas las actividades publicadas que conserva el esquema de evaluación, aunque su capítulo esté oculto; el avance y los pendientes usan solo contenidos visibles. Incluye notas privadas autorizadas, conserva exenciones y los ceros vigentes del libro, sin convertir cierres automáticos en envíos.',
 opened:'Abrió el visor del material; no demuestra aprendizaje.',
 completed:'El estudiante marcó el material como completado.',
 login:'Último inicio de sesión en la plataforma; no equivale a ingreso al grupo.',
 group:'Las aperturas históricas de la API se conservan como registros heredados, separados de los ingresos medidos.',
 dates:'Las notas y el avance son actuales. Los eventos y la participación se recortan al intervalo seleccionado, en America/Bogota.',
 started:'Actividades distintas abiertas, guardadas o enviadas en el intervalo; iniciar una actividad no demuestra resolución.',
 questions:'Solo se comparan las respuestas vigentes de la versión actual de cada cuestionario.',
 labs:'Resultados escritos registrados por el estudiante; pueden ser opcionales, requeridos o estar deshabilitados.',
 comparisonScope:'La comparación utiliza el estado actual completo de cada grupo autorizado y muestra su propia escala.',
 comparison:'Los grupos pueden tener contenidos, evaluaciones y estudiantes diferentes.'
};

export function createCourseInsights({db,accessModel:a,academics,engagement=null,fail,clock=()=>Date.now()}){
 const all=(sql,...params)=>db.prepare(sql).all(...params),one=(sql,...params)=>db.prepare(sql).get(...params);
 const groupView=course=>({id:course.id,title:course.title,cohort:course.cohort,code:course.group_code,templateId:course.template_id,lifecycle:course.lifecycle});
 const groupOptions=auth=>all("SELECT id,title,cohort,group_code,template_id,lifecycle FROM courses WHERE entity_kind='group' ORDER BY title,cohort,group_code,id").filter(course=>a.p.can(auth.user.id,course.id,'grade')).map(groupView);
 function aggregate(students,scaleMax){
  const sum=pick=>students.reduce((total,student)=>total+(Number(pick(student))||0),0),activeSeconds=round(sum(student=>student.period.activeSeconds)),sessions=sum(student=>student.period.sessions);
  return {students:students.length,visits:sum(student=>student.period.visits),sessions,activeSeconds,averageSessionSeconds:sessions?round(activeSeconds/sessions):null,averageActiveSeconds:students.length?round(activeSeconds/students.length):0,progress:mean(students.map(student=>student.current.progress)),gradeAccumulated:mean(students.map(student=>student.current.gradeAccumulated).filter(value=>value!==null)),scaleMax,submitted:sum(student=>student.current.submitted),pending:sum(student=>student.current.pending),overdue:sum(student=>student.current.overdue),pendingTotal:sum(student=>student.current.pendingTotal),activityPendingTotal:sum(student=>student.current.pendingTotal),closedMissing:sum(student=>student.current.closedMissing),finalized:sum(student=>student.current.finalized),openPending:sum(student=>student.current.openPending),exempt:sum(student=>student.current.exempt),awaitingGrade:sum(student=>student.current.awaitingGrade),awaitingReturn:sum(student=>student.current.awaitingReturn),materialsCompleted:sum(student=>student.current.materialsCompleted),materialsTotal:sum(student=>student.current.materialsTotal),activitiesTotal:sum(student=>student.current.activitiesTotal),lastActivityAt:latestDate(students.map(student=>student.current.lastActivityAt))};
 }
 function dailyFor(students){
  const dates=new Map();for(const student of students)for(const day of student.period.daily||[]){const value=dates.get(day.date)||{date:day.date,activeSeconds:0,visits:0,sessions:0};value.activeSeconds=round(value.activeSeconds+(day.activeSeconds||0));value.visits+=day.visits||0;value.sessions+=day.sessions||0;dates.set(day.date,value);}return [...dates.values()].sort((left,right)=>left.date.localeCompare(right.date));
 }
 function core(course,filters){
  academics.reconcileClosures?.({courseId:course.id});
  const at=Number(clock()),now=new Date(at).toISOString(),cfg=academics.settings(course.id),activities=academics.list(course.id);
  const modules=all('SELECT id,title,published FROM modules WHERE course_id=?',course.id),moduleMap=new Map(modules.map(module=>[module.id,module]));
  const visibleActivities=activities.filter(activity=>activity.status==='published'&&(!activity.moduleId||moduleMap.get(activity.moduleId)?.published));
  const resources=all('SELECT r.id,r.title,r.kind,r.module_id FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=? AND m.published=1 AND r.published=1 ORDER BY m.position,m.id,r.position,r.id',course.id);
  const roster=all('SELECT u.id,u.name,u.document,u.active,u.account_status,e.status,e.starts_at,e.expires_at FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.course_id=? ORDER BY u.name,u.id',course.id);
  const progressRows=all('SELECT p.* FROM progress p JOIN resources r ON r.id=p.resource_id JOIN modules m ON m.id=r.module_id WHERE m.course_id=? AND m.published=1 AND r.published=1',course.id);
  const histories=all('SELECT s.* FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id=? AND s.superseded=0 ORDER BY s.student_id,s.activity_id,s.attempt DESC,s.updated_at DESC,s.id DESC',course.id);
  const learning=all('SELECT user_id,action,object_id,created_at FROM learning_events WHERE course_id=? AND created_at>=? AND created_at<=?',course.id,filters.startAt,filters.endAt);
  const oldReads=new Map(all("SELECT user_id,max(created_at) last_group,count(*) legacy_reads FROM learning_events WHERE course_id=? AND action='group.enter' GROUP BY user_id",course.id).map(row=>[row.user_id,row]));
  const lastLearning=new Map(all('SELECT user_id,max(created_at) last_at FROM learning_events WHERE course_id=? GROUP BY user_id',course.id).map(row=>[row.user_id,row.last_at]));
  const lastAudit=new Map(all("SELECT actor_id,max(created_at) last_at FROM audit WHERE json_extract(context,'$.group.id')=? GROUP BY actor_id",course.id).map(row=>[row.actor_id,row.last_at]));
  const auditPeriod=all("SELECT actor_id,action,target_id,created_at FROM audit WHERE json_extract(context,'$.group.id')=? AND created_at>=? AND created_at<=? AND action IN ('resource.open','resource.complete')",course.id,filters.startAt,filters.endAt);
  const overrides=new Set(all('SELECT g.activity_id,g.student_id FROM grade_overrides g JOIN activities a ON a.id=g.activity_id WHERE a.course_id=? AND g.exempt=1',course.id).map(row=>row.student_id+'|'+row.activity_id));
  const meter=engagement?.summary(course.id,{from:filters.startAt,to:filters.endAt,userIds:roster.map(student=>student.id)})||{measurementStartedAt:null,students:[],daily:[],definitions:{}};
  const meterRows=new Map((meter.students||[]).map(row=>[row.userId,row])),startedAt=meter.measurementStartedAt||meter.metadata?.measurementStartedAt||null;
  const measurement={startedAt,measurementStartedAt:startedAt,available:Boolean(startedAt&&filters.endAt>=startedAt&&filters.startAt<=now),partialCoverage:Boolean(startedAt&&filters.startAt<startedAt),measuredUntil:now,timezone:TIMEZONE,definitions:{...INSIGHT_DEFINITIONS,...meter.definitions}};
  const students=roster.map(student=>{
   const progress=progressRows.filter(row=>row.user_id===student.id).map(row=>({resourceId:row.resource_id,completed:Boolean(row.completed),openedAt:row.opened_at,lastOpenedAt:row.last_opened_at,updatedAt:row.updated_at}));
   const records=histories.filter(row=>row.student_id===student.id),latest=new Map();for(const submission of records)if(!latest.has(submission.activity_id))latest.set(submission.activity_id,submission);
   const grade=academics.gradeRow(activities.filter(activity=>activity.status==='published'),student.id,cfg,true),gradeCells=new Map(grade.cells.map(cell=>[cell.activityId,cell]));
   let submitted=0,pending=0,overdue=0,awaitingGrade=0,awaitingReturn=0,exempt=0;
   const activityRows=visibleActivities.map(activity=>{
    const submission=latest.get(activity.id),response=submission?.state==='draft'&&submission.returned_at?'returned':submission?.state||'pending',excused=overrides.has(student.id+'|'+activity.id),delivered=['submitted','graded'].includes(response),cell=gradeCells.get(activity.id),closure=academics.studentClosure?.(activity,student.id,{reconcile:false})||null,state=!delivered&&!excused&&closure?.closed?'missing':response;
    const policy=academics.studentDeadline(activity,student.id,submission,now),deadline=policy.dueAt??policy.closesAt??null,latePending=Boolean(!delivered&&!excused&&(closure?.closed||(!policy.opensAt||policy.opensAt<=now)&&deadline&&deadline<=now));
    if(excused)exempt++;else if(delivered){submitted++;if(cell?.points===null||cell?.points===undefined)awaitingGrade++;else if(!cell.published)awaitingReturn++;}else if(latePending)overdue++;else pending++;
    const row={id:activity.id,activityId:activity.id,title:activity.title,kind:activity.kind,moduleId:activity.moduleId,status:activity.status,responseState:state,submitted:delivered,closure,dueAt:activity.dueAt,opensAt:activity.opensAt,closesAt:activity.closesAt,returnDueAt:state==='returned'?(submission.return_due_at||null):null,deadline:policy,extension:policy.extension,effectiveDueAt:deadline,effectiveClosesAt:policy.closesAt,exempt:excused,overdue:latePending,submissionId:submission?.id||null,points:cell?.points??null,gradePublished:Boolean(cell?.published),updatedAt:submission?.updated_at||null,submittedAt:submission?.submitted_at||null};
    return {...row,finalized:activityFinalized(row)};
   });
   const learningSummary=summarizeCourseLearning(resources,activityRows,progress,{now:at}),periodMeter=meterRows.get(student.id)||{visits:0,sessions:0,activeSeconds:0,averageSessionSeconds:null,lastActiveAt:null,daily:[]};
   const studentLearning=learning.filter(event=>event.user_id===student.id),periodSent=new Set(records.filter(row=>inRange(row.submitted_at,filters)).map(row=>row.activity_id)),started=new Set([...studentLearning.filter(event=>event.action==='activity.start').map(event=>event.object_id),...records.filter(row=>inRange(row.state==='draft'?row.updated_at:row.submitted_at,filters)).map(row=>row.activity_id)].filter(id=>visibleActivities.some(activity=>activity.id===id)));
   const lastLogin=one("SELECT max(created_at) at FROM audit WHERE actor_id=? AND action LIKE 'auth.login.%'",student.id)?.at||null;
   const lastActivityAt=latestDate([lastLearning.get(student.id),lastAudit.get(student.id),periodMeter.lastActiveAtAllTime||periodMeter.lastActiveAt,...progress.map(row=>row.lastOpenedAt||row.openedAt||row.updatedAt),...records.map(row=>row.state==='draft'?row.updated_at:row.submitted_at)]);
   const current={submitted,pending,overdue,pendingTotal:pending+overdue,activityPendingTotal:pending+overdue,closedMissing:learningSummary.activities.closedMissing,finalized:learningSummary.activities.finalized,openPending:learningSummary.activities.openPending,awaitingGrade,awaitingReturn,exempt,activitiesTotal:visibleActivities.length,materialsCompleted:learningSummary.materials.completed,materialsOpened:learningSummary.materials.opened,materialsTotal:learningSummary.materials.total,totalElements:learningSummary.total,completedElements:learningSummary.completed,progress:learningSummary.percent,gradeAccumulated:grade.accumulated,gradeFinal:grade.final,scaleMax:cfg.scaleMax,gradedWeight:grade.gradedWeight,lastActivityAt};
   const period={visits:periodMeter.visits||0,sessions:periodMeter.sessions||0,activeSeconds:periodMeter.activeSeconds||0,averageSessionSeconds:periodMeter.sessions?(periodMeter.averageSessionSeconds??round((periodMeter.activeSeconds||0)/periodMeter.sessions)):null,lastActiveAt:periodMeter.lastActiveAt||null,daily:(periodMeter.daily||[]).map(day=>({...day,sessions:day.sessions||0})),submittedActivities:[...periodSent].filter(id=>visibleActivities.some(activity=>activity.id===id)).length,startedActivities:started.size,openedMaterials:new Set(auditPeriod.filter(event=>event.actor_id===student.id&&event.action==='resource.open').map(event=>event.target_id)).size,completedMaterials:new Set(auditPeriod.filter(event=>event.actor_id===student.id&&event.action==='resource.complete').map(event=>event.target_id)).size,legacyGroupReads:studentLearning.filter(event=>event.action==='group.enter').length};
   const attention=[overdue?'Actividades vencidas sin entrega':'',awaitingGrade?'Entregas pendientes de calificar':'',grade.accumulated!==null&&grade.accumulated<cfg.passMark?'Nota acumulada baja':'',measurement.available&&!period.visits?'Sin ingresos medidos en el periodo':''].filter(Boolean);
   return {...student,activeEnrollment:Boolean(student.active&&student.account_status==='active'&&student.status==='active'&&(!student.starts_at||student.starts_at<=now)&&(!student.expires_at||student.expires_at>now)),current,period,grade,learning:learningSummary,activityStates:activityRows,materialStates:resources.map(resource=>({id:resource.id,title:resource.title,kind:resource.kind,state:materialStatus(resource.id,progress),...progress.find(row=>row.resourceId===resource.id)})),lastLogin,lastGroup:oldReads.get(student.id)?.last_group||null,lastActivityAt,opened:current.materialsOpened,completed:current.materialsCompleted,total:current.materialsTotal,progress:current.progress,started:started.size,submitted:current.submitted,pending:current.pendingTotal,overdue:current.overdue,attention};
  });
  return {course,cfg,activities,visibleActivities,modules,resources,roster,histories,students,measurement,now,filters};
 }
 function advanced(context,filters,selected){
  const {course,cfg,activities,histories}=context,selectedIds=new Set(selected.map(student=>student.id));
  const chosen=activities.filter(activity=>!filters.activityId||activity.id===filters.activityId);
  const results=chosen.map(activity=>{
   const records=histories.filter(submission=>submission.activity_id===activity.id&&selectedIds.has(submission.student_id));
   const byStudent=new Map();for(const submission of records)if(!byStudent.has(submission.student_id))byStudent.set(submission.student_id,submission);
   const latest=[...byStudent.values()].filter(submission=>['submitted','graded'].includes(submission.state)&&inRange(submission.submitted_at,filters)).map(submission=>{const draft=parsed(submission.payload).teacherGradeDraft;return draft?{...submission,points:draft.points,published:0}:submission;}),graded=latest.filter(submission=>submission.points!==null);
    return {id:activity.id,title:activity.title,kind:activity.kind,status:activity.status,submitted:latest.length,average:graded.length?round(graded.reduce((sum,submission)=>sum+submission.points/submissionMaxPoints(parsed(submission.payload),activity)*cfg.scaleMax,0)/graded.length):null,questions:activity.questions.map(question=>{const comparable=latest.filter(submission=>submission.revision===activity.revision),answered=comparable.filter(submission=>Object.hasOwn(parsed(submission.payload).answers||{},question.id));return {id:question.id,prompt:question.prompt,answered:answered.length,correct:['single','multiple'].includes(question.type)?answered.filter(submission=>JSON.stringify(parsed(submission.payload).answers[question.id])===JSON.stringify(question.correct)).length:null};})};
  });
  const changeParams=[course.id,filters.startAt,filters.endAt],changeScope=[];
  if(filters.studentId){changeScope.push('s.student_id=?');changeParams.push(filters.studentId);}
  if(filters.activityId){changeScope.push('a.id=?');changeParams.push(filters.activityId);}
  const changes=all('SELECT g.created_at,g.before_value,g.after_value,g.reason,s.student_id,a.id activity_id FROM grade_audit g JOIN submissions s ON s.id=g.submission_id JOIN activities a ON a.id=s.activity_id WHERE a.course_id=? AND g.created_at>=? AND g.created_at<=? AND EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=a.course_id AND e.student_id=s.student_id)'+(changeScope.length?' AND '+changeScope.join(' AND '):'')+' ORDER BY g.id DESC LIMIT 200',...changeParams);
  const labParams=[course.id,filters.startAt,filters.endAt];if(filters.studentId)labParams.push(filters.studentId);
  const labs=all("SELECT e.created_at,e.object_id,e.user_id,u.name,r.title,e.details FROM learning_events e JOIN users u ON u.id=e.user_id JOIN resources r ON r.id=e.object_id WHERE e.course_id=? AND e.action='lab.result' AND e.created_at>=? AND e.created_at<=? AND EXISTS(SELECT 1 FROM enrollments n WHERE n.course_id=e.course_id AND n.student_id=e.user_id)"+(filters.studentId?' AND e.user_id=?':'')+' ORDER BY e.id DESC LIMIT 200',...labParams).map(record=>({...record,result:parsed(record.details).result,details:undefined}));
  return {activities:results,changes,labs};
 }
 function events(courseId,filters,studentId=null){
  const person=studentId||filters.studentId,params=[courseId,filters.startAt,filters.endAt],personClause=person?' AND user_id=?':'';if(person)params.push(person);
  const learning=all('SELECT id,user_id,action,object_id,created_at FROM learning_events WHERE course_id=? AND created_at>=? AND created_at<=?'+personClause+' ORDER BY id DESC LIMIT 200',...params).map(event=>({id:'learning-'+event.id,source:'learning',userId:event.user_id,action:event.action,objectId:event.object_id,createdAt:event.created_at}));
  const auditParams=[courseId,filters.startAt,filters.endAt];if(person)auditParams.push(person,person);
  const auditEvents=all("SELECT id,actor_id,action,target_id,created_at,context FROM audit WHERE json_extract(context,'$.group.id')=? AND created_at>=? AND created_at<=?"+(person?" AND (actor_id=? OR action LIKE 'activity.auto-%' AND json_extract(context,'$.student.id')=?)":'')+' ORDER BY id DESC LIMIT 200',...auditParams).map(event=>{const context=parsed(event.context);return {id:'audit-'+event.id,source:'audit',userId:event.action.startsWith('activity.auto-')?context.student?.id||null:event.actor_id,actorId:event.actor_id,action:event.action,objectId:context.object?.id||event.target_id,targetId:event.target_id,objectTitle:context.object?.title||'',createdAt:event.created_at};});
  const names=new Map([...all('SELECT r.id,r.title FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=?',courseId),...academics.list(courseId).map(activity=>({id:activity.id,title:activity.title}))].map(object=>[object.id,object.title]));
  return [...learning,...auditEvents].filter(event=>!filters.activityId||event.objectId===filters.activityId).map(event=>({...event,objectTitle:event.objectTitle||names.get(event.objectId)||'',created_at:event.createdAt,user_id:event.userId,object_id:event.objectId})).sort((left,right)=>right.createdAt.localeCompare(left.createdAt)||right.id.localeCompare(left.id)).slice(0,200);
 }
 function selectedContext(auth,id,filters){
  a.requireScope(auth,id,'grade');const course=a.group(id),context=core(course,filters);
  if(filters.studentId&&!context.students.some(student=>student.id===filters.studentId))fail(400,'El estudiante no pertenece a este grupo.');
  if(filters.activityId&&!context.activities.some(activity=>activity.id===filters.activityId))fail(400,'La actividad no pertenece a este grupo.');
  return context;
 }
 function report(auth,id,query=new URLSearchParams()){
  const filters=insightsFilters(query,fail,clock()),context=selectedContext(auth,id,filters),students=context.students.filter(student=>!filters.studentId||student.id===filters.studentId);
  const distribution={progress:[0,0,0,0,0],grades:[0,0,0,0,0],ungraded:0,activityStates:{submitted:0,pending:0,overdue:0}};
  for(const student of students){distribution.progress[Math.min(4,Math.floor(student.current.progress/20))]++;if(student.grade.accumulated===null)distribution.ungraded++;else distribution.grades[Math.min(4,Math.max(0,Math.floor(student.grade.accumulated/context.cfg.scaleMax*5)))]++;for(const name of ['submitted','pending','overdue'])distribution.activityStates[name]+=student.current[name];}
  const comparison=all("SELECT * FROM courses WHERE template_id=? AND entity_kind='group' ORDER BY cohort,group_code,id",context.course.template_id).filter(course=>a.p.can(auth.user.id,course.id,'grade')).map(course=>{const other=course.id===id?context:core(course,{...filters,studentId:'',activityId:''}),summary=aggregate(other.students,other.cfg.scaleMax);return {...groupView(course),group_code:course.group_code,average:summary.gradeAccumulated,scaleMax:other.cfg.scaleMax,progress:summary.progress,enrollments:other.students.length,activities:other.activities.length,submissions:summary.submitted,summary};});
  let detail=null;if(filters.studentId){const student=students[0],tracked=engagement?.details(id,student.id,{from:filters.startAt,to:filters.endAt})||{sessions:[],intervals:[]},sessions=tracked.sessions||[],intervals=tracked.intervals||[];detail={studentId:student.id,current:student.current,period:student.period,activities:student.activityStates,materials:student.materialStates,sessions:sessions.slice(-100).reverse().map(session=>({...session,endedAt:session.endedAt||session.lastActiveAt||null})),intervals:intervals.slice(-300).reverse(),totalSessions:sessions.length,totalIntervals:intervals.length,truncated:sessions.length>100||intervals.length>300,limits:{sessions:100,intervals:300,events:200},events:events(id,filters,student.id),measurement:context.measurement};}
  return {group:groupView(context.course),settings:context.cfg,filters,measurement:context.measurement,currentScope:'Estado actual del grupo',periodScope:'Participación y acciones registradas en el intervalo',students,studentOptions:context.roster.map(student=>({id:student.id,name:student.name})),groupOptions:groupOptions(auth),activityOptions:context.activities.map(activity=>({id:activity.id,title:activity.title})),summary:{group:aggregate(context.students,context.cfg.scaleMax),selection:aggregate(students,context.cfg.scaleMax)},daily:dailyFor(students),ranking:[...students].sort((left,right)=>right.period.activeSeconds-left.period.activeSeconds||right.period.visits-left.period.visits||left.name.localeCompare(right.name)).map(student=>({studentId:student.id,name:student.name,activeSeconds:student.period.activeSeconds,visits:student.period.visits,sessions:student.period.sessions,progress:student.current.progress,submitted:student.current.submitted,pending:student.current.pending,overdue:student.current.overdue})),detail,distribution,comparison,...advanced(context,filters,students),events:events(id,filters),definitions:context.measurement.definitions,updatedAt:context.now,timezone:TIMEZONE};
 }
 function overview(auth,query=new URLSearchParams()){
  if(!a.staff(auth))fail(403,'El panorama académico requiere acceso docente o administrativo.');
  const filters=insightsFilters(query,fail,clock()),options=groupOptions(auth),selectedGroup=query.get('group')||'';
  if(selectedGroup&&!options.some(group=>group.id===selectedGroup))fail(403,'No tienes permiso para consultar las estadísticas de este grupo.');
  const contexts=options.filter(group=>!selectedGroup||group.id===selectedGroup).map(group=>core(a.group(group.id),filters));
  if(filters.studentId&&!contexts.some(context=>context.roster.some(student=>student.id===filters.studentId)))fail(400,'El estudiante no pertenece a los grupos seleccionados.');
  const selected=contexts.flatMap(context=>context.students.filter(student=>!filters.studentId||student.id===filters.studentId));
  const groups=contexts.filter(context=>!filters.studentId||context.students.some(student=>student.id===filters.studentId)).map(context=>{const students=context.students.filter(student=>!filters.studentId||student.id===filters.studentId);return {...groupView(context.course),summary:aggregate(students,context.cfg.scaleMax),groupSummary:aggregate(context.students,context.cfg.scaleMax),measurement:context.measurement,scaleMax:context.cfg.scaleMax,daily:dailyFor(students)};});
  const scales=[...new Set(groups.map(group=>group.scaleMax))],summary=aggregate(selected,scales.length===1?scales[0]:null);if(scales.length!==1)summary.gradeAccumulated=null;
  summary.groups=groups.length;summary.distinctStudents=new Set(selected.map(student=>student.id)).size;summary.scopeDescription='Los totales por grupo cuentan matrículas; un estudiante puede participar en varios grupos.';
  const studentOptions=[...new Map(contexts.flatMap(context=>context.roster.map(student=>[student.id,{id:student.id,name:student.name}]))).values()].sort((left,right)=>left.name.localeCompare(right.name));
  return {filters:{...filters,groupId:selectedGroup},groups,groupOptions:options,studentOptions,summary,daily:dailyFor(selected),measurement:{startedAt:groups.map(group=>group.measurement.startedAt).filter(Boolean).sort()[0]||null,available:groups.some(group=>group.measurement.available),partialCoverage:groups.some(group=>group.measurement.partialCoverage),timezone:TIMEZONE,definitions:INSIGHT_DEFINITIONS},definitions:INSIGHT_DEFINITIONS,timezone:TIMEZONE,updatedAt:new Date(clock()).toISOString()};
 }
 return {report,overview,groupOptions};
}
