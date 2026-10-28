import {escapeHtml as e} from './lib.js';

const labels={evaluated:'Evaluada',pending:'Por calificar',empty:'Sin entregas',correction:'En corrección',draft:'Borrador',archived:'Archivada'};
const count=value=>Number.isFinite(Number(value))&&Number(value)>=0?Math.floor(Number(value)):0;
const amount=(value,singular,plural)=>value+' '+(value===1?singular:plural);

export function activityEvaluationState(activity){
 const state=activity?.evaluation?.state;
 return Object.hasOwn(labels,state)?state:'';
}

export function activityEvaluationAttributes(activity){
 const state=activityEvaluationState(activity);return state?` data-activity-evaluation-state="${state}"`:'';
}

export function activityEvaluationPresentation(activity){
 const state=activityEvaluationState(activity);if(!state)return null;
 const evaluation=activity.evaluation,counts=Object.fromEntries(['submitted','evaluated','pending','unreleased','returned'].map(key=>[key,count(evaluation[key])]));
 let description,detail='';
 if(state==='draft')description='La actividad está en borrador.';
 else if(state==='archived')description='La actividad está archivada.';
 else if(state==='empty')description='No hay entregas reales vigentes para evaluar.';
 else{
  const manualEvaluated=count(evaluation.manualEvaluated),manualPending=count(evaluation.manualPending);
  const parts=counts.submitted?[Math.max(0,counts.evaluated-manualEvaluated)+' de '+amount(counts.submitted,'entrega evaluada','entregas evaluadas')]:[];
  if(manualEvaluated)parts.push(amount(manualEvaluated,'nota docente sin entrega','notas docentes sin entrega'));
  if(counts.pending>manualPending)parts.push(amount(counts.pending-manualPending,'entrega por calificar','entregas por calificar'));
  if(manualPending)parts.push(amount(manualPending,'nota sin entrega por completar','notas sin entrega por completar'));
  if(counts.returned)parts.push(amount(counts.returned,'entrega en corrección','entregas en corrección'));
  if(counts.unreleased)parts.push(amount(counts.unreleased,'nota guardada por devolver','notas guardadas por devolver'));
  description=parts.join('. ')+'.';
  const hints=[];
  if(state==='pending'&&counts.pending)hints.push(amount(counts.pending,manualPending?'nota por completar':'entrega',manualPending?'notas por completar':'entregas'));
  if(state==='correction'&&counts.returned)hints.push(amount(counts.returned,'entrega','entregas'));
  if(counts.unreleased)hints.push(counts.unreleased+' por devolver');
  detail=hints.join(' · ');
 }
 return {state,label:labels[state],counts,detail,description};
}

export function activityEvaluationHTML(activity,{compact=false}={}){
 const value=activityEvaluationPresentation(activity);if(!value)return '';
 const detail=compact?(value.counts.unreleased?value.counts.unreleased+' por devolver':''):value.detail;
 return `<span class="activity-evaluation${compact?' compact':''}" data-activity-evaluation="${value.state}" role="img" aria-label="${e(value.label+'. '+value.description)}" title="${e(value.description)}"><span class="activity-evaluation-main"><i class="activity-evaluation-dot" aria-hidden="true"></i><span>${value.label}</span></span>${detail?`<small class="activity-evaluation-detail">${e(detail)}</small>`:''}</span>`;
}

export function activityEvaluationSummaryHTML(activities=[],{includeUnpublished=false,compact=false}={}){
 const known=activities.map(activity=>activityEvaluationPresentation(activity)).filter(Boolean);
 if(!known.length)return '';
 const rows=known.filter(item=>includeUnpublished||!['draft','archived'].includes(item.state));
 if(!rows.length)return '<span class="activity-evaluation-summary activity-evaluation-empty">Sin actividades publicadas</span>';
 const counts=Object.fromEntries(Object.keys(labels).map(state=>[state,rows.filter(item=>item.state===state).length]));
 const unread=rows.reduce((sum,item)=>sum+item.counts.unreleased,0),phrases={evaluated:['evaluada','evaluadas'],pending:['por calificar','por calificar'],correction:['en corrección','en corrección'],empty:['sin entregas','sin entregas'],draft:['en borrador','en borrador'],archived:['archivada','archivadas']};
 const visible=['pending','correction','evaluated','empty',...(includeUnpublished?['draft','archived']:[])].filter(state=>counts[state]);
 return `<span class="activity-evaluation-summary${compact?' compact':''}" role="group" aria-label="Evaluación de actividades${includeUnpublished?'':' publicadas'}">${visible.map(state=>`<span class="activity-evaluation-summary-item" data-activity-evaluation="${state}"><i class="activity-evaluation-dot" aria-hidden="true"></i>${amount(counts[state],...phrases[state])}</span>`).join('')}${unread?`<small class="activity-evaluation-unreleased" title="Notas guardadas que aún no se han devuelto al estudiante">${amount(unread,'nota por devolver','notas por devolver')}</small>`:''}</span>`;
}
