import {escapeHtml as e,safeUrl} from './lib.js';
import {icon} from './ui.js';
import {parseCourseDeepLink} from './notifications.js';

export function courseHelpDescriptor(state,current=''){
 const user=state?.user,learning=user?.role==='student'||state?.viewMode==='learning';
 if(!user?.roles||!learning||state.assurance!=='password'||state.preview||user.mustChangePassword)return null;
 const course=state.currentCourse;if(!course?.id||course.entityKind==='template')return null;
 const activity=/^actividad\/([^?]+)/.exec(current),deep=parseCourseDeepLink(current);
 if(!activity&&!deep)return null;
 const descriptor={courseId:course.id};
 if(activity){descriptor.activityId=activity[1];return descriptor;}
 const resourceId=state.activeResourceId,modules=course.modules||[];
 if(resourceId&&modules.some(module=>(module.resources||[]).some(resource=>resource.id===resourceId)))descriptor.resourceId=resourceId;
 else if(resourceId&&(course.quickResources||[]).some(item=>item.id===resourceId))descriptor.quickResourceId=resourceId;
 else if(deep.moduleId&&modules.some(module=>module.id===deep.moduleId))descriptor.moduleId=deep.moduleId;
 return descriptor;
}
export function courseHelpContextLabel(context){return [context?.courseTitle,context?.moduleTitle,context?.title!==context?.moduleTitle&&context?.type!=='course'?context?.title:null].filter(Boolean).join(' › ');}
const initials=name=>String(name||'Docente').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toLocaleUpperCase('es');
const teacherPhoto=value=>/^\/api\/community\/avatar\/[\w-]+(?:\?[^\r\n<>"']*)?$/.test(value||'')?value:safeUrl(value);
const avatar=teacher=>`<span class="course-help-avatar">${teacherPhoto(teacher.avatarUrl)?`<img src="${e(teacherPhoto(teacher.avatarUrl))}" alt="">`:e(initials(teacher.name))}</span>`;

export function createCourseHelpUI({api,getState,onAsk,toast}){
 let host=null,key='',epoch=0,data=null,open=false,busy=false,controller=null,failed=false;
 const current=()=>location.hash.slice(1);
 function mount(){if(!host){host=document.createElement('div');host.id='course-help-root';host.className='course-help';}const viewer=document.querySelector('dialog.resource-viewer[open]');const parent=viewer||document.body;if(host.parentElement!==parent)parent.append(host);return host;}
 function detachFromViewer(){if(host?.closest('dialog'))document.body.append(host);}
 function hide(){controller?.abort();epoch++;key='';data=null;open=false;failed=false;host?.replaceChildren();host?.removeAttribute('data-open');}
 function paint(){if(!key||!data){host?.replaceChildren();return;}const root=mount(),teachers=data.teachers||[],available=teachers.filter(teacher=>teacher.canMessage),label=courseHelpContextLabel(data.context);root.toggleAttribute('data-open',open);root.innerHTML=`${open?`<section class="course-help-panel" aria-label="Preguntar al docente"><header><div><h2>Pregunta a tu docente</h2><p>La conversación conserva el contexto de tu pregunta.</p></div><button type="button" class="icon-btn" data-course-help="close" aria-label="Cerrar ayuda">${icon('close')}</button></header><div class="course-help-context">${icon('book')}<span>${e(label)}</span></div><div class="course-help-teachers">${teachers.length?teachers.map(teacher=>`<button type="button" class="course-help-teacher" data-course-help="ask" data-teacher-id="${e(teacher.id)}" ${teacher.canMessage?'':'disabled'}>${avatar(teacher)}<span><strong>${e(teacher.name)}</strong><small>${teacher.canMessage?'Abrir chat · Puedes escribir aunque esté sin conexión':e(teacher.reason||'No disponible para mensajes')}</small></span>${icon('chevron')}</button>`).join(''):'<p class="course-help-empty">El curso todavía no tiene un docente disponible para mensajes.</p>'}</div><p class="course-help-note">Tu pregunta se envía por chat personal. El docente verá el curso y el material que estás consultando.</p><p class="course-help-error" role="alert"></p></section>`:''}<button type="button" class="course-help-trigger" data-course-help="toggle" aria-expanded="${open}" aria-label="Preguntar al docente sobre ${data.context?.type==='activity'?'esta actividad':'este material'}" title="Preguntar al docente">${available[0]?avatar(available[0]):`<span class="course-help-avatar">${icon('help')}</span>`}<span>Preguntar al docente</span>${icon(open?'close':'mail')}</button>`;}
 async function enhance({force=false}={}){const descriptor=courseHelpDescriptor(getState(),current()),dialog=document.querySelector('dialog[open]');if(!descriptor||dialog&&!dialog.classList.contains('resource-viewer')){hide();return;}const next=JSON.stringify([getState().user.id,descriptor]);if(next===key&&!force){if(data)paint();return;}controller?.abort();controller=new AbortController();key=next;data=null;failed=false;open=false;host?.replaceChildren();const version=++epoch;try{const result=await api('/chat/context?'+new URLSearchParams(descriptor),{signal:controller.signal});if(version!==epoch||next!==key)return;data=result;paint();}catch(error){if(version!==epoch||error.name==='AbortError')return;failed=true;host?.replaceChildren();}}
 document.addEventListener('click',event=>{const action=event.target.closest('[data-course-help]');if(!action){if(open&&!event.target.closest('#course-help-root')){open=false;paint();}return;}event.preventDefault();const kind=action.dataset.courseHelp;if(kind==='toggle'){open=!open;paint();if(open)host.querySelector('[data-course-help=ask]:not(:disabled)')?.focus();}else if(kind==='close'){open=false;paint();host.querySelector('[data-course-help=toggle]')?.focus();}else if(kind==='ask'&&!busy){const teacher=data?.teachers?.find(item=>String(item.id)===action.dataset.teacherId&&item.canMessage);if(!teacher)return;busy=true;action.disabled=true;const context=data.context;void Promise.resolve(onAsk(teacher.id,context,teacher.sendGroupId||context.courseId)).then(()=>{open=false;paint();}).catch(error=>{const message=host?.querySelector('.course-help-error');if(message)message.textContent=error.message||'No pudimos abrir la conversación. Intenta nuevamente.';else toast(error.message);}).finally(()=>{busy=false;if(action.isConnected)action.disabled=false;});}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();open=false;paint();host.querySelector('[data-course-help=toggle]')?.focus();}},true);
 window.addEventListener('focus',()=>{if(failed)void enhance({force:true});});
 return {enhance,detachFromViewer,hide};
}
