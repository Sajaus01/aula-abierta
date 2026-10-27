import {escapeHtml as e} from './lib.js';
import {activityExtensionButton} from './activity-extensions.js';
import {closedWithoutSubmission,automaticZeroHTML} from './activity-state.js';

export function gradebookRoute(route){
 const [path,search='']=route.split('?'),[type,id]=path.split('/');
 return {type,id,query:new URLSearchParams(search)};
}

export function gradebookReportQuery(query){
 const filters=new URLSearchParams();
 for(const key of ['from','to','student'])if(query.get(key))filters.set(key,query.get(key));
 return filters.toString();
}

export function renderGradebookFilters(data,courses=[]){
 const report=data.insights,query=data.query||new URLSearchParams(),filters=report?.filters||{};
 const groups=courses.filter(course=>course.entityKind==='group'&&course.permissions?.grade!==false);
 const selected=data.course.id,students=report?.studentOptions||data.allStudents||data.students||[];
 const from=query.get('from')||filters.fromDate||filters.from?.slice(0,10)||'',to=query.get('to')||filters.toDate||filters.to?.slice(0,10)||'';
 return `<form class="insight-filters gradebook-overview-filters" id="gradebook-overview-filters"><label>Grupo<select name="group">${(groups.length?groups:[data.course]).map(group=>`<option value="${e(group.id)}" ${group.id===selected?'selected':''}>${e([group.title,group.cohort,group.groupCode||group.code].filter(Boolean).join(' · '))}</option>`).join('')}</select></label><label>Estudiante<select name="student"><option value="">Todo el grupo</option>${students.map(student=>`<option value="${e(student.id)}" ${student.id===query.get('student')?'selected':''}>${e(student.name)}</option>`).join('')}</select></label><label>Desde<input type="date" name="from" value="${e(from)}"></label><label>Hasta<input type="date" name="to" value="${e(to)}"></label><button class="btn secondary small" type="submit">Aplicar</button><a class="text-button" href="#calificaciones/${e(selected)}">Limpiar</a><p class="field-hint">Fechas de Colombia para ingresos y tiempo activo. Las entregas, el avance y las notas muestran el estado actual.</p></form>`;
}

export function renderIndividualGrades(data,button,{allowExtensions=false}={}){
 const student=data.students?.[0];if(!student)return '';
 const format=value=>value===null||value===undefined?'—':Number(value).toLocaleString('es-CO',{maximumFractionDigits:2});
 const periods=data.settings.periods||[],activities=new Map(data.activities.map(activity=>[activity.id,activity]));
 const labels={pending:'Sin entregar',draft:'Borrador sin enviar',submitted:'Por calificar',returned:'Devuelta para corregir',exempt:'Exenta',missing:'Vencida sin entrega'};
 return `<section class="gradebook-individual"><header><h3>${e(student.name)}</h3><span>Nota acumulada sobre el 100 %: <strong>${format(student.accumulated)} / ${format(data.settings.scaleMax)}</strong></span></header><p class="field-hint">Las notas privadas siguen visibles solo en el espacio docente. Una entrega pendiente conserva su estado y su calificación vacía.</p><div class="analytics-table-wrap"><table><thead><tr><th>Actividad</th><th>${periods.length?'Peso en el corte':'Peso'}</th><th>Nota</th><th>Estado</th><th>Revisión</th></tr></thead><tbody>${student.cells.map(cell=>{const activity=activities.get(cell.activityId),state=cell.state==='exempt'?labels.exempt:closedWithoutSubmission(cell)||cell.state==='missing'?labels.missing:cell.points!==null&&cell.points!==undefined?(cell.published?'Nota devuelta':'Nota privada'):labels[cell.state]||'Pendiente',points=cell.state==='missing'?0:cell.points;return `<tr><td><a href="#actividad/${e(cell.activityId)}">${e(cell.title||activity?.title||'Actividad')}</a></td><td>${format(cell.weight)} %${periods.length?`<small>${e(periods.find(period=>period.id===(cell.periodId||activity?.periodId))?.title||'Sin corte')}</small>`:''}</td><td>${format(points)} / ${format(cell.maxPoints)}${automaticZeroHTML(cell)}</td><td>${e(state)}</td><td>${cell.submissionId?button('Revisar respuesta','academic-gradebook:'+cell.submissionId,'secondary small','eye'):`<a class="text-button" href="#actividad/${e(cell.activityId)}">Abrir actividad</a>`}${allowExtensions&&student.active!==false&&student.status!=='revoked'?activityExtensionButton({activityId:cell.activityId,studentId:student.id}):''}</td></tr>`;}).join('')}</tbody></table></div></section>`;
}

export function bindGradebookOverview(root=document){
 const form=root.querySelector('#gradebook-overview-filters');if(!form)return;
 form.addEventListener('submit',event=>{
  event.preventDefault();
  if(form.elements.from.value&&form.elements.to.value&&form.elements.from.value>form.elements.to.value){form.elements.to.setCustomValidity('La fecha final debe ser posterior a la inicial.');form.elements.to.reportValidity();return;}
  form.elements.to.setCustomValidity('');
  const query=new URLSearchParams();for(const key of ['student','from','to'])if(form.elements[key].value)query.set(key,form.elements[key].value);
  location.hash=gradebookFilterRoute(form.elements.group.value,query,location.hash);
 });
 form.elements.to.addEventListener('input',()=>form.elements.to.setCustomValidity(''));
 form.elements.from.addEventListener('input',()=>form.elements.to.setCustomValidity(''));
 form.elements.group.addEventListener('change',()=>{form.elements.student.value='';form.requestSubmit();});
}

export function gradebookFilterRoute(group,filters,currentHash=''){
 const current=gradebookRoute(currentHash.replace(/^#/,'')),query=new URLSearchParams(filters);
 if(current.id===group&&current.query.get('view')==='matrix')query.set('view','matrix');
 else query.delete('view');
 if(current.id!==group)query.delete('student');
 return '#calificaciones/'+encodeURIComponent(group)+(query.size?'?'+query:'');
}
