import {materialStatus} from './learning.js';
import {studentDeadline} from './activity-deadline.js';

const unique=items=>[...new Map(items.filter(item=>item?.id).map(item=>[item.id,item])).values()];
const phrase=(count,singular,plural)=>count+' '+(count===1?singular:plural);
const percent=(done,total)=>!total?0:done===total?100:Math.min(99,Math.round(done/total*100));
function responseState(activity){
 const value=activity.responseState||activity.submission?.state||(['pending','draft','returned','submitted','graded','missing'].includes(activity.state)?activity.state:null);
 return value||((activity.submitted===true||activity.state==='Entregada')?'submitted':'pending');
}

export function chapterStatus(resources=[],activities=[],progress=[],{now=Date.now()}={}){
 const at=typeof now==='number'?now:Date.parse(now);
 const materials=unique(resources.filter(item=>item?.published!==false&&!item?.hidden));
 const work=unique(activities.filter(item=>(!item?.status||item.status==='published')&&!item?.hidden&&item?.modulePublished!==false));
 const counts={total:materials.length+work.length,satisfied:0,overdue:0,awaitingGrade:0,needsReview:0,exempt:0,materialsCompleted:0,materialsTotal:materials.length,activitiesTotal:work.length,notStarted:0,started:0,corrections:0,scheduled:0};
 for(const material of materials){
  const state=materialStatus(material.id,progress);
  if(state==='completed'){counts.materialsCompleted++;counts.satisfied++;}
  if(state==='unopened')counts.notStarted++;else counts.started++;
 }
 for(const activity of work){
  const response=responseState(activity),outcome=activity.outcome?.state,policy=studentDeadline(activity,[],at);
  const exempt=outcome==='exempt',unfinished=['draft','returned','missing','pending'].includes(response);
  const hasResponse=['submitted','graded'].includes(response)||(!unfinished&&['gradedPass','gradedBelow','submitted-awaiting-grade'].includes(outcome));
  // An explicit exemption resolves the requirement without creating a delivery.
  if(exempt){counts.exempt++;counts.satisfied++;counts.started++;continue;}
  const passed=hasResponse&&outcome==='gradedPass';
  if(passed)counts.satisfied++;
  const hasWork=['draft','returned','submitted','graded','missing'].includes(response)||['gradedPass','gradedBelow','submitted-awaiting-grade'].includes(outcome);
  if(hasWork)counts.started++;else counts.notStarted++;
  if(response==='returned')counts.corrections++;
  if(policy.future&&!hasResponse)counts.scheduled++;
  if(outcome==='gradedBelow'&&hasResponse)counts.needsReview++;
  else if(hasResponse&&!passed)counts.awaitingGrade++;
  const deadline=policy.dueAt??policy.closesAt,expired=deadline&&Number.isFinite(Date.parse(deadline))&&Date.parse(deadline)<=at;
  const renewed=['extension','correction'].includes(policy.source)&&!policy.closed&&!policy.future;
  // A missing response can be finished for continuity without being satisfactory.
  // Keep that history visible even if a later progress policy counts it as done.
  if(!hasResponse&&((response==='missing'&&!renewed)||(!policy.future&&expired)))counts.overdue++;
 }
 const state=counts.overdue?'overdue':counts.total>0&&counts.satisfied===counts.total?'completed':counts.started>0?'in-progress':'not-started';
 const label={'not-started':'Sin iniciar','in-progress':'En curso',completed:'Completado',overdue:'Vencidas sin entrega'}[state];
 const icon={'not-started':'book','in-progress':'clock',completed:'check',overdue:'alert'}[state];
 let summary;
 if(!counts.total)summary='Este capítulo aún no tiene contenido publicado.';
 else if(state==='completed')summary='Todos los requisitos están cumplidos.'+(counts.exempt?' '+phrase(counts.exempt,'actividad exenta.','actividades exentas.'):'');
 else{
  const parts=[];
  if(counts.overdue)parts.push(phrase(counts.overdue,'actividad vencida sin entrega','actividades vencidas sin entrega'));
  if(counts.awaitingGrade)parts.push(phrase(counts.awaitingGrade,'actividad por calificar','actividades por calificar'));
  if(counts.needsReview)parts.push(phrase(counts.needsReview,'resultado por debajo del umbral de aprobación','resultados por debajo del umbral de aprobación'));
  if(counts.corrections)parts.push(phrase(counts.corrections,'corrección pendiente','correcciones pendientes'));
  if(counts.scheduled)parts.push(phrase(counts.scheduled,'actividad programada','actividades programadas'));
  if(counts.exempt)parts.push(phrase(counts.exempt,'actividad exenta','actividades exentas'));
  summary=parts.length?parts.join('; ')+'.':state==='not-started'?'Todavía no has iniciado los elementos de este capítulo.':counts.satisfied+' de '+counts.total+' requisitos cumplidos.';
 }
 return {state,label,icon,summary,percent:percent(counts.satisfied,counts.total),counts};
}
