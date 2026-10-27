import {escapeHtml as e} from './lib.js';
import {icon} from './ui.js';

const labels={pending:'Sin entregar',draft:'Borrador guardado',returned:'Corrección pendiente',submitted:'Entregada · por calificar',graded:'Calificada'};
const normal=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
const selectedStudent=(report,id)=>report?.students?.find(student=>student.id===id);
const endpoint=id=>'/academics/activities/'+encodeURIComponent(id)+'/extensions';

export function canManageActivityExtensions(state,courseId){
 const course=state.courses?.find(item=>item.id===courseId);
 return state.assurance==='password'&&state.user?.role==='admin'&&state.viewMode!=='learning'&&!state.preview&&course?.entityKind==='group'&&course.permissions?.grade===true;
}

export function activityExtensionButton({activityId,studentId='',label='Habilitar entrega',compact=false,title=label}={}){
 return `<button type="button" class="${compact?'icon-btn extension-entry-icon':'btn ghost small extension-entry'}" data-action="academic-extension:${e(encodeURIComponent(activityId))}" data-student="${e(studentId)}" aria-label="${e(title)}" title="${e(title)}">${icon('calendar')}${compact?'':e(label)}</button>`;
}

export function extensionDateInput(value){
 const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return '';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function extensionDeadline(value,{unlimited=false,now=Date.now(),opensAt=null}={}){
 if(unlimited)return null;
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value||'')))throw Error('Elige una fecha y una hora, o selecciona «Sin límite».');
 const date=new Date(value+':00-05:00');
 if(!Number.isFinite(date.getTime())||extensionDateInput(date)!==value)throw Error('La fecha y la hora no son válidas.');
 if(date.getTime()<=Number(now))throw Error('El nuevo plazo debe estar en el futuro.');
 if(opensAt&&date.getTime()<=Date.parse(opensAt))throw Error('El nuevo plazo debe ser posterior a la apertura de la actividad.');
 return date.toISOString();
}

export function extensionDateLabel(value){
 if(!value)return 'Sin límite de fecha';
 const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',dateStyle:'medium',timeStyle:'short'}).format(date):'Fecha no disponible';
}

export function filterExtensionStudents(students,query,selectedId=''){
 const term=normal(query).trim();return students.filter(student=>student.id===selectedId||normal(student.name+' '+student.document).includes(term));
}

export function createActivityExtensionManager({api}){
 const load=activityId=>api(endpoint(activityId));
 async function write(report,studentId,dueAt,remove=false){
  const student=selectedStudent(report,studentId);if(!student)throw Error('Selecciona un estudiante con matrícula vigente en este grupo.');
  const result=await api(endpoint(report.activity.id)+'/'+encodeURIComponent(studentId),{method:remove?'DELETE':'PUT',body:{version:student.extensionVersion??student.extension?.version??0,...(remove?{}:{dueAt})}});
  return {...report,serverNow:result.serverNow||report.serverNow,students:report.students.map(item=>item.id===studentId?{...item,...result,id:item.id,submissionState:item.submissionState}:item)};
 }
 return {load,save:(report,id,dueAt)=>write(report,id,dueAt),revoke:(report,id)=>write(report,id,null,true)};
}

function currentState(report,student,now){
 if(!student)return '<p class="extension-placeholder">Selecciona a quién quieres habilitar la entrega.</p>';
 const extension=student.extension,active=extension?.active===true;
 const deadline=student.deadline||{source:active?'extension':'activity',dueAt:active?extension.dueAt:report.activity.dueAt||report.activity.closesAt},source={extension:'Autorización individual',correction:'Plazo de corrección',activity:'Plazo de la actividad'}[deadline.source]||'Plazo vigente';
 return `<section class="extension-current" aria-label="Estado actual"><div><strong>${e(student.name)}</strong><span class="badge ${active?'green':'gray'}">${e(labels[student.submissionState]||'Sin entregar')}</span></div><dl><div><dt>Plazo vigente</dt><dd>${e(extensionDateLabel(deadline.dueAt||deadline.closesAt))}<small class="extension-deadline-source">${e(source)}${deadline.allowLate?' · admite tardías':''}</small></dd></div><div><dt>Autorización individual</dt><dd>${active?e(extensionDateLabel(extension.dueAt))+(extension.dueAt&&Date.parse(extension.dueAt)<=now?' · vencida':''):'Sin habilitación vigente'}</dd></div></dl>${active?`<button type="button" class="text-button extension-revoke" data-extension-action="revoke">${icon('back')}Retirar autorización</button><p class="field-hint">Puedes habilitarla de nuevo. Al retirarla se aplica el plazo vigente de la actividad o corrección.</p>`:''}</section>`;
}

export function renderActivityExtensionWindow({activities=[],activityId='',report=null,studentId='',search='',draft=null,loading=false,error='',message='',now=Date.now(),otherDrafts=0}={}){
 const student=selectedStudent(report,studentId),rows=filterExtensionStudents(report?.students||[],search,studentId),active=student?.extension?.active===true;
 const currentDue=student?.deadline?student.deadline.dueAt||student.deadline.closesAt||null:active?student.extension.dueAt:report?.activity?.dueAt||report?.activity?.closesAt||null;
 const values=draft||{unlimited:Boolean(student&&currentDue===null),date:extensionDateInput(currentDue&&Date.parse(currentDue)>now?currentDue:now+86400000)};
 const picker=activities.length>1?`<label>Actividad<select name="activity">${activities.map(item=>`<option value="${e(item.id)}" ${item.id===activityId?'selected':''}>${e(item.title)}${item.status==='draft'?' · borrador':''}</option>`).join('')}</select></label>`:`<p class="extension-activity-title">${e(report?.activity?.title||activities[0]?.title||'Actividad')}</p>`;
 return `<form id="activity-extension-form" class="extension-workspace" novalidate><p class="extension-intro">Habilita la entrega para un estudiante con un plazo propio.</p>${picker}${loading?'<p class="extension-loading" role="status">Consultando estudiantes y plazos…</p>':report?`<div class="extension-student-picker"><label>Buscar estudiante<input type="search" name="search" placeholder="Nombre o documento" value="${e(search)}" autocomplete="off"></label><label>Estudiante<select name="student"><option value="">Elige un estudiante</option>${rows.map(item=>`<option value="${e(item.id)}" ${item.id===studentId?'selected':''}>${e(item.name)}${item.document?' · '+e(item.document):''}</option>`).join('')}</select></label></div><p class="extension-search-count" data-extension-count>${rows.length} estudiante(s) disponibles</p><div data-extension-current>${currentState(report,student,now)}</div>${report.students.length?'':'<p class="field-hint">Este grupo no tiene estudiantes con matrícula vigente.</p>'}${student?`<fieldset class="extension-deadline"><legend>Nuevo plazo individual</legend><div class="extension-deadline-options"><label><input type="radio" name="deadlineMode" value="date" ${values.unlimited?'':'checked'}>Con fecha y hora</label><label><input type="radio" name="deadlineMode" value="unlimited" ${values.unlimited?'checked':''}>Sin límite</label></div><label>Fecha y hora de Colombia<input name="dueAt" type="datetime-local" value="${e(values.date)}" ${values.unlimited?'disabled':''} required><span class="field-hint">Zona horaria: Colombia (UTC−5).</span></label></fieldset><p class="extension-scope">Conserva los intentos y las respuestas guardadas.${report.activity.kind==='quiz'&&report.activity.timeLimitMinutes?' Si el tiempo del cuestionario ya terminó, al abrirlo comenzará de nuevo el tiempo configurado.':''}</p>${['submitted','graded'].includes(student.submissionState)?'<p class="field-hint">Este estudiante ya tiene una entrega enviada. La habilitación no añade intentos ni cambia su nota.</p>':''}${report.activity.status==='draft'?'<p class="field-hint">La actividad seguirá oculta hasta que la publiques.</p>':''}${report.activity.opensAt?'<p class="field-hint">Apertura de la actividad: '+e(extensionDateLabel(report.activity.opensAt))+'.</p>':''}`:''}`:'<p class="extension-placeholder">No pudimos consultar esta actividad.</p>'}<p class="extension-error form-error" data-extension-error role="alert" ${error?'':'hidden'}>${e(error)}</p><p class="extension-result" data-extension-result role="status" aria-live="polite" ${message?'':'hidden'}>${e(message)}</p>${otherDrafts?`<p class="field-hint">${otherDrafts} selección(es) con cambios sin guardar.</p>`:''}<footer class="extension-actions">${!report&&!loading?'<button type="button" class="btn secondary small" data-extension-action="retry">'+icon('refresh')+'Reintentar</button>':''}<button type="button" class="btn secondary small" data-action="close-modal">Cerrar</button><button type="submit" class="btn small" ${!student||loading?'disabled':''}>${icon('check')}${active?'Actualizar plazo':'Habilitar entrega'}</button></footer></form>`;
}

export function createActivityExtensionsUI({api,modal,openModal,toast,render,getState}){
 const manager=createActivityExtensionManager({api});let cleanup=()=>{},generation=0;
 function dispose(){generation++;cleanup();cleanup=()=>{};}
 async function open({courseId,activities=[],activityId='',studentId=''}={}){
  if(!canManageActivityExtensions(getState(),courseId))throw Error('Necesitas permiso para calificar en este grupo.');
  dispose();const token=generation,controller=new AbortController(),options={signal:controller.signal},drafts=new Map();
  let list=activities,report=null,selected=studentId,search='',loading=true,busy=false,changed=false,error='',message='',clockOffset=0,request=0;
  const now=()=>Date.now()+clockOffset,key=()=>activityId+'/'+selected,currentDraft=()=>drafts.get(key()),isCurrent=()=>token===generation&&modal.open;
  const syncDirty=()=>{modal.dataset.dirty=[...drafts.values()].some(draft=>draft.dirty)?'true':'false';};
  function paint(){if(!isCurrent())return;const root=modal.querySelector('[data-extensions-root]');if(!root)return;root.innerHTML=renderActivityExtensionWindow({activities:list,activityId,report,studentId:selected,search,draft:currentDraft(),loading,error,message,now:now(),otherDrafts:[...drafts.entries()].filter(([id,draft])=>id!==key()&&draft.dirty).length});syncDirty();}
  const updateClock=()=>{if(report?.serverNow)clockOffset=Date.parse(report.serverNow)-Date.now();};
  async function load(){
   const version=++request;loading=true;error='';message='';paint();
   try{
    if(!list.length){const course=await api('/academics/courses/'+encodeURIComponent(courseId));if(!isCurrent()||version!==request)return;list=course.activities||[];}
    if(!activityId||!list.some(item=>item.id===activityId))activityId=list[0]?.id||'';
    if(!activityId)throw Error('Crea una actividad en este grupo para poder habilitar una entrega.');
    const data=await manager.load(activityId);if(!isCurrent()||version!==request)return;report=data;updateClock();
    if(!selectedStudent(report,selected))selected='';
   }catch(cause){if(!isCurrent()||version!==request)return;report=null;error=cause.message;}
   finally{if(isCurrent()&&version===request){loading=false;paint();}}
  }
  function remember(){
   if(!selected)return;const form=modal.querySelector('#activity-extension-form');if(!form)return;
   drafts.set(key(),{date:form.elements.dueAt.value,unlimited:form.elements.deadlineMode.value==='unlimited',dirty:true});syncDirty();
  }
  function showError(cause){error=cause.message;const target=modal.querySelector('[data-extension-error]');if(target){target.textContent=error;target.hidden=false;target.tabIndex=-1;target.focus();}}
  async function save(remove=false){
   if(busy||loading||!selected)return;
   const student=selectedStudent(report,selected);if(!student){showError(new Error('Selecciona un estudiante con matrícula vigente en este grupo.'));return;}if(remove&&!student.extension?.active)return;
   remember();busy=true;modal.setAttribute('aria-busy','true');const root=modal.querySelector('[data-extensions-root]');root.inert=true;error='';message='';
   try{
    const draft=currentDraft(),dueAt=remove?null:extensionDeadline(draft.date,{unlimited:draft.unlimited,now:now(),opensAt:report.activity.opensAt});
    const updated=await (remove?manager.revoke(report,selected):manager.save(report,selected,dueAt));if(!isCurrent())return;
    report=updated;updateClock();drafts.delete(key());changed=true;const source=selectedStudent(report,selected)?.deadline?.source;message=remove?'Se retiró la autorización individual de '+student.name+'. Se aplica el plazo vigente de '+(source==='correction'?'la corrección':source==='activity'?'la actividad':'la actividad o corrección')+'.':'Entrega habilitada para '+student.name+(dueAt?' hasta el '+extensionDateLabel(dueAt)+' (hora de Colombia).':' sin límite de fecha.');
    if(!remove&&selectedStudent(report,selected)?.timerReset)message+=' El tiempo del cuestionario se reiniciará al abrirlo.';
    toast(remove?'Autorización individual retirada.':'Entrega habilitada.');paint();
   }catch(cause){
    if(!isCurrent())return;
    if(cause.status===409){try{report=await manager.load(activityId);updateClock();if(!selectedStudent(report,selected))selected='';cause=new Error('El plazo cambió en otra sesión. Se actualizó el estado vigente; revisa tus datos y vuelve a guardar.');}catch{/* Keep the entered deadline and the original conflict message. */}}
    if(!isCurrent())return;paint();showError(cause);
   }finally{busy=false;if(isCurrent()){modal.removeAttribute('aria-busy');modal.querySelector('[data-extensions-root]').inert=false;syncDirty();}}
  }
  openModal('Habilitar entrega','<div data-extensions-root></div>',null);modal.classList.add('activity-extensions-modal');
  cleanup=()=>controller.abort();
  modal.addEventListener('close',()=>{if(modal.open)return;cleanup();if(changed)void render();},options);
  modal.addEventListener('submit',event=>{if(event.target.id!=='activity-extension-form')return;event.preventDefault();void save();},options);
  modal.addEventListener('click',event=>{const button=event.target.closest('[data-extension-action]');if(!button||busy)return;if(button.dataset.extensionAction==='retry')void load();if(button.dataset.extensionAction==='revoke')void save(true);},options);
  modal.addEventListener('input',event=>{
   if(!event.target.closest('#activity-extension-form'))return;
   if(event.target.name==='search'){
    search=event.target.value;const select=modal.querySelector('[name=student]'),students=filterExtensionStudents(report.students,search,selected);
    select.innerHTML='<option value="">Elige un estudiante</option>'+students.map(student=>`<option value="${e(student.id)}" ${student.id===selected?'selected':''}>${e(student.name)}${student.document?' · '+e(student.document):''}</option>`).join('');modal.querySelector('[data-extension-count]').textContent=students.length+' estudiante(s) disponibles';
   }else if(event.target.name==='dueAt')remember();syncDirty();
  },options);
  modal.addEventListener('change',event=>{
   if(!event.target.closest('#activity-extension-form')||busy)return;
   if(event.target.name==='activity'){activityId=event.target.value;report=null;search='';void load();}
   else if(event.target.name==='student'){selected=event.target.value;error='';message='';paint();}
   else if(event.target.name==='deadlineMode'){remember();const input=modal.querySelector('[name=dueAt]');input.disabled=event.target.value==='unlimited';}
   else if(event.target.name==='dueAt')remember();syncDirty();
  },options);
  paint();await load();
 }
 return {open,dispose};
}
