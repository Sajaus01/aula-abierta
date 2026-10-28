import {escapeHtml as e} from './lib.js';

export const closedWithoutSubmission=item=>item?.closure?.closed===true;
export const automaticZeroLabel='0 automático';
export const closedActivityLabel='Vencida sin entrega';
export const closedActivityContinuity='Finalizada por vencimiento · Puedes continuar con el curso';
export const closedDraftMessage='Borrador conservado. La actividad está cerrada y no se ha enviado.';

const date=value=>{const time=new Date(value);return value&&Number.isFinite(time.getTime())?time.toLocaleString('es-CO',{timeZone:'America/Bogota',dateStyle:'medium',timeStyle:'short'}):'';};
const points=value=>Number.isFinite(value)?value.toLocaleString('es-CO',{maximumFractionDigits:2}):String(value??'—');
export function publishedManualGrade(item){
 const grade=item?.manualGrade===true?item:item?.manualGrade;
 if(!grade?.published)return null;
 const official=grade.gradeDraft?{...grade,points:grade.publishedPoints,feedback:grade.publishedFeedback||''}:grade;
 return Number.isFinite(official.points)?official:null;
}
export function automaticZeroHTML(item){const grade=publishedManualGrade(item);return closedWithoutSubmission(item)?grade?`<small class="academic-automatic-zero">Nota docente: ${e(points(grade.points))} / ${e(points(grade.gradingMaxPoints??grade.maxPoints??item.maxPoints))}</small>`:'<small class="academic-automatic-zero">0 automático</small>':'';}

export function manualGradeResultHTML(activity){
 const grade=publishedManualGrade(activity);if(!grade)return '';
 return `<section class="activity-automatic-result activity-manual-result" role="status"><span class="badge">Calificación docente · sin entrega</span><strong>${e(points(grade.points))} <small>/ ${e(points(grade.gradingMaxPoints??grade.maxPoints??activity.maxPoints))}</small></strong>${grade.feedback?`<p class="academic-text">${e(grade.feedback)}</p>`:''}<small>Tu docente asignó esta nota sin registrar una entrega.${closedWithoutSubmission(activity)?' El plazo permanece cerrado.':''}</small></section>`;
}

export function closureHistoryHTML(closure){
 if(!closure)return '';
 const events=closure.history?.length?closure.history:closure.closedAt?[{state:'closed',at:closure.closedAt,reason:'deadline'}]:[];
 if(!events.length)return '';
 const reasons={deadline:'Venció el plazo sin entrega.',extension:'Se habilitó un nuevo plazo.',submission:'Se recibió una entrega real.',exempt:'La actividad quedó exenta.',revision:'La actividad se actualizó.'};
 return `<details class="activity-closure-history"><summary>Historial de cierre automático <span>${events.length}</span></summary><ol>${[...events].reverse().map(event=>`<li><div><strong>${event.state==='closed'?'Cierre automático · 0':event.state==='reopened'?'Cierre retirado':'Actualización del cierre'}</strong><time>${e(date(event.at))}</time></div><p>${e(reasons[event.reason]||'Registro conservado.')}${event.deadlineAt?' Plazo: '+e(date(event.deadlineAt)):''}</p></li>`).join('')}</ol></details>`;
}

export function closedActivityResultHTML(activity){
 if(!closedWithoutSubmission(activity))return '';
 if(publishedManualGrade(activity))return manualGradeResultHTML(activity);
 return `<section class="activity-automatic-result" role="status"><span class="badge">${closedActivityLabel}</span><strong>0 <small>/ ${e(activity.maxPoints??'—')}</small><span>automático</span></strong><p>${closedActivityContinuity}.</p><small>No se recibió una entrega. El cierre no consume intentos ni significa que la actividad esté aprobada.</small></section>`;
}
