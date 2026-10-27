import {renderCoursePanel} from './course-panel.js';
import {renderTeacherCoursePanel,bindTeacherCoursePanel} from './teacher-course-panel.js';
import {activityDueAt,individualDeadlineLabel} from './activity-deadline.js';
import {createStorageUI} from './storage.js';
import {createChatUI} from './chat.js';
import {createNotificationsUI,parseCourseDeepLink} from './notifications.js';
import {createCourseHelpUI} from './course-help.js';
import {createCommunityUI} from './community.js';
import {createPanoramaUI} from './panorama.js';
import {createAnalyticsUI} from './analytics.js';
import {createEngagementTracker} from './engagement.js';
import {createNavigation,navigationScope} from './navigation.js';
import {createLibraryUI} from './library.js';
import {createPlatformUI} from './platform.js';
import { createQuickResourcesUI } from './quick-resources.js';
import { createAcademicUI } from './academics.js';
import { escapeHtml as e, safeUrl, videoEmbed, parseStudentsCsv } from './lib.js';
import { materialStatus, summarizeLearning, activityFinalized, quickGuide } from './learning.js';
import { enrollmentPreview, enrollmentResultLabel } from './enrollment-import.js';

import {icon,button as btn,navigationItems,courseEntryActions,manageableGroups,enhanceUI,observeUI,toggleNavigation} from './ui.js';
const modes = {public:'Acceso libre',document:'Solo cédula',password:'Cédula y contraseña'};
const kinds = {pdf:'Documento PDF',slides:'Diapositivas',video:'Video',book:'Libro',image:'Imagen',exercise:'Ejercicio',html:'Capítulo HTML',lab:'Laboratorio interactivo',link:'Enlace'};
const kindIcon = kind => ({pdf:'file',slides:'file',video:'video',book:'book',image:'image',exercise:'edit',html:'code',lab:'code',link:'link'}[kind] || 'file');
const badge = mode => `<span class="badge ${mode === 'public' ? 'green' : mode === 'document' ? 'amber' : 'gray'}">${icon(mode === 'public' ? 'globe' : mode === 'document' ? 'users' : 'lock')}${modes[mode]}</span>`;
let state = {user:null,assurance:null,viewMode:'teaching',settings:{name:'Aula Abierta',subtitle:'Tu espacio de aprendizaje'},courses:[],students:[],enrollments:[],progress:[],filter:'all',query:'',loginMode:'password',setupRequired:false};
const hasDualRole=()=>state.user?.roles?.includes('student')&&state.user.roles.some(role=>role!=='student');
const syncViewCookie=()=>{document.cookie=`aula_view=${state.viewMode}; Path=/; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;};
const setInitialView=()=>{state.viewMode=state.user?.roles?.includes('student')&&!hasDualRole()?'learning':hasDualRole()&&sessionStorage.getItem('aula-view-'+state.user.id)==='learning'?'learning':'teaching';syncViewCookie();};
const admin = () => state.user?.role === 'admin'&&state.viewMode!=='learning'&&!state.preview;
const student = () => Boolean(state.user&&(state.user.role==='student'||state.viewMode==='learning'||state.preview));
state.academicOverview=[];state.learning={courses:[],recent:[],activities:[]};state.resourceFilter='all';
const materialName = kind => !admin()&&kind==='html'?'Lección interactiva':kinds[kind];
const route = () => state.user?.mustChangePassword ? 'crear-contrasena' : location.hash.slice(1) || (admin() ? 'inicio' : student() ? 'mis-cursos' : 'catalogo');
const modal = document.getElementById('modal');
const app = document.getElementById('app');
let pendingModalDismiss=null;
let modalHandler, renderVersion = 0, toastTimer, renderedRoute=null,renderedScope=null;
async function api(path, options={}) {
  const requestedView=state.viewMode;
  const res = await fetch(`/api${path}`, {credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(state.preview?{'X-Aula-Preview':state.preview,...(state.previewActivity?{'X-Aula-Activity-Preview':state.previewActivity}:{})}:state.user?.roles?{'X-Aula-View':requestedView}:{}),...options.headers},body:options.body === undefined ? undefined : JSON.stringify(options.body)});
  let result; try { result = await res.json(); } catch { throw new Error('No pudimos conectar con el aula. Intenta nuevamente en unos momentos.'); }
  if (!res.ok) throw Object.assign(new Error(result.error || 'No se pudo completar la operación.'),{status:res.status,code:result.code});
  if(state.user?.roles&&!state.preview){const contextualize=value=>{if(Array.isArray(value))value.forEach(contextualize);else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(/url$/i.test(key)&&typeof item==='string'&&item.startsWith('/api/')){const address=new URL(item,location.origin);address.searchParams.set('aula_view',requestedView);value[key]=address.pathname+address.search;}else if(item&&typeof item==='object')contextualize(item);}};contextualize(result.data);}
  return result.data;
}
const post = (path, body={}) => api(path,{method:'POST',body});
const patch = (path, body) => api(path,{method:'PATCH',body});
function toast(text) { const feedback=modal.open&&modal.querySelector('.viewer-message');if(feedback){feedback.textContent=text;feedback.hidden=false;return;}const t=document.getElementById('toast'); t.textContent=text;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4000); }
function date(value) { return value ? new Date(value).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}) : 'Sin vencimiento'; }
function art() { return '<div class="book-art" aria-hidden="true"><div class="art-circle"></div><div class="art-book back"></div><div class="art-book"></div><span class="spark">✦</span><span class="spark">✧</span></div>'; }
function brand() { return `<a href="#${admin()?'inicio':student()?'mis-cursos':'catalogo'}" class="brand"><span class="brand-mark">${icon('book')}</span>${e(state.settings.name || 'Aula Abierta')}</a>`; }
function heading(title,subtitle,action='') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action?`<div class="heading-actions">${action}</div>`:''}</div>`; }
function empty(title,copy,action='',glyph='book') { return `<div class="empty"><div class="empty-icon">${icon(glyph)}</div><h3>${title}</h3><p>${copy}</p>${action}</div>`; }
function footer() {return '<footer class="footer"><span>Aula Abierta · Un espacio para compartir conocimiento</span><span>Aprender nos conecta.</span></footer>';}
function viewSwitch(){return hasDualRole()&&!state.preview?`<div class="role-switch" role="group" aria-label="Cambiar espacio"><button type="button" class="role-switch-option ${admin()?'active':''}" data-action="view-mode:teaching" aria-pressed="${admin()}">${icon('book')} Docencia</button><button type="button" class="role-switch-option ${student()?'active':''}" data-action="view-mode:learning" aria-pressed="${student()}">${icon('cap')} Aprendizaje</button></div>`:'';}
const roleLabel=()=>state.user?.primaryRole==='master'?'Máster':state.user?.primaryRole==='admin'?'Administrativo':state.user?.primaryRole==='teacher'?'Docente':'Estudiante';
function shell(content,current) {
  const nav=navigationItems({...state.user,role:admin()?'admin':'student'},!!state.preview),parent=current.split('/')[0].split('?')[0],activeRoute=parent==='curso'?(state.currentCourse?.entityKind==='template'?'cursos':admin()?'grupos':'mis-cursos'):['actividad','actividades','calificaciones'].includes(parent)?'tareas':parent==='perfil'?'usuarios':parent;
  const pageTitle={notificaciones:'Notificaciones',almacenamiento:'Almacenamiento',mensajes:'Mensajes',comunidad:'Comunidad',panorama:'Panorama','mi-perfil':'Mi perfil',curso:state.currentCourse?.title||'Curso',actividad:'Actividad',actividades:'Actividades del curso',calificaciones:'Calificaciones',estadisticas:'Seguimiento del grupo',perfil:'Perfil',ajustes:'Configuración',cuenta:'Mi cuenta'}[parent]||nav.find(x=>x[0]===current)?.[2]||'Mi aula';
  return `<div class="shell"><aside class="sidebar" id="sidebar"><button type="button" class="icon-btn sidebar-close" data-action="close-menu" aria-label="Cerrar navegación">${icon("close")}</button>${brand()}${viewSwitch()}<span class="brand-sub">${admin()?'Espacio docente':'Campus virtual'}</span><div class="nav-label">${admin()?'GESTIONAR':'APRENDER'}</div><nav class="nav-list" aria-label="Navegación principal">${[...nav,...(state.user?.roles&&!state.preview?[['almacenamiento','folder','Almacenamiento']]:[]),...(state.user?.roles&&!state.preview?[['mensajes','mail','Mensajes'],['notificaciones','bell','Notificaciones'],['comunidad','users','Comunidad'],['mi-perfil','image','Mi perfil']]:[])].map(([id,glyph,text])=>`<a class="nav-link ${activeRoute.split('?')[0]===id?'active':''}" href="#${id}" ${id==='mensajes'?'hidden':''} ${activeRoute.split('?')[0]===id?'aria-current="page"':''}><span class="nav-icon">${icon(glyph)}</span><span class="nav-text">${text}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="support-card sidebar-help"><button type="button" class="text-button" data-action="help">${icon('help')}<span>Guía rápida</span></button></div><a class="nav-link ${current===(admin()?'ajustes':'cuenta')?'active':''}" href="#${admin()?'ajustes':'cuenta'}">${icon('settings')}${admin()?'Configuración':'Mi cuenta'}</a><div class="profile"><div class="avatar">${e(state.user?.name?.split(' ').map(x=>x[0]).slice(0,2).join('')||'AA')}</div><div class="spacer"><strong>${e(state.user?.name)}</strong><small>${e(roleLabel())}${hasDualRole()?' · Estudiante':''}</small></div><button class="icon-btn" data-action="logout" aria-label="Cerrar sesión">${icon('logout')}</button></div></div></aside><button type="button" class="nav-scrim" data-action="close-menu" tabindex="-1" aria-label="Cerrar menú"></button><div class="workspace"><header class="topbar"><div class="crumb"><button class="icon-btn mobile-menu" data-action="menu" aria-controls="sidebar" aria-expanded="false" aria-label="Abrir navegación">${icon('menu')}</button><span>${admin()?'Mi espacio docente':'Mi campus'}</span><span>/</span><strong>${e(pageTitle)}</strong></div><div class="flex topbar-tools"><span class="status flex topbar-context"><span class="status-dot"></span>Campus virtual</span>${admin()?'<a href="#catalogo" class="btn secondary small">'+icon('globe')+'Explorar cursos</a>':''}</div></header><main class="main" id="main" tabindex="-1">${content}${footer()}</main></div></div>`;
}
function publicShell(content) { return `<header class="public-top flex between">${brand()}<div class="flex"><a href="#catalogo" class="btn ghost small">Cursos</a><a href="#login" class="btn">${icon('logout')}Ingresar al aula</a></div></header><main class="public-main" id="main">${content}${footer()}</main>`; }
function courseCard(c) {if(student())return studentCourseCard(c);const resources=c.modules?.flatMap(m=>m.resources || []) || [];return `<article class="course-card"><div class="course-cover">${safeUrl(c.coverUrl)?`<img src="${e(safeUrl(c.coverUrl))}" alt="" loading="lazy">`:icon('book')}</div><div class="course-body"><div class="flex between">${admin()?badge(c.accessMode):`<span class="badge gray">${c.accessMode==='public'?'Acceso libre':'Curso con matrícula'}</span>`}${admin()?`<span class="badge ${c.published?'green':'gray'}">${c.lifecycle==='archived'?'Archivado':c.published?'Publicado':'Borrador'}</span>`:''}</div><h3><a href="#curso/${e(c.id)}">${e(c.title)}</a></h3>${c.entityKind?`<p class="field-hint">${c.entityKind==='template'?'Curso plantilla':`Grupo ${e(c.groupCode)} · ${e(c.cohort)}`}</p>`:''}<p>${e(c.description || 'Un nuevo espacio para aprender.')}</p><div class="course-meta"><span>${icon('folder')}${c.modules?.length ?? c.moduleCount ?? 0} capítulos</span><span>${icon('file')}${c.resourceCount ?? resources.length} recursos</span></div><div class="course-actions"><a class="btn ${admin()?'secondary':''} small" href="#curso/${e(c.id)}">${c.locked?'Ver acceso':'Abrir curso'}${icon('arrow')}</a>${admin()&&(!c.permissions||c.permissions.edit)?btn('Editar',`edit-course:${c.id}`,'ghost small','edit'):''}</div></div></article>`; }
function dashboard() {
 const modern=!!state.user.roles,templates=state.courses.filter(c=>!modern||c.entityKind==='template'),groups=state.courses.filter(c=>c.entityKind==='group'),active=groups.filter(c=>c.lifecycle==='active'),pending=(state.academicOverview||[]).filter(c=>c.pending>0&&state.courses.find(v=>v.id===c.id)?.permissions?.grade!==false),pendingCount=pending.reduce((sum,c)=>sum+c.pending,0);
 const manage=state.courses.some(c=>(!modern||c.entityKind==='group')&&c.permissions?.manage!==false);
 return heading(`Hola, ${e(state.user.name.split(' ')[0])}`,'Tus grupos, contenidos y evaluaciones en un solo lugar.',btn('Crear curso plantilla','new-course','','plus'))+
 `<div class="stats compact-stats">${[[templates.length,modern?'Cursos plantilla':'Cursos','book'],[active.length,'Grupos activos','users'],[state.enrollments.filter(x=>x.active).length,'Matrículas activas','cap'],[pendingCount,'Entregas por revisar','edit']].map(([n,label,glyph])=>`<article class="stat"><span class="stat-icon">${icon(glyph)}</span><div><strong>${n}</strong><span class="stat-top">${label}</span></div></article>`).join('')}</div>`+
 `<section class="panel dashboard-shortcuts"><div class="section-head"><h2>Accesos rápidos</h2></div><div class="flex wrap">${manage?btn('Subir lista y matricular','bulk-enrollment:','secondary','upload'):''}<a class="btn secondary" href="#biblioteca">${icon('folder')}Biblioteca de contenidos</a><a class="btn secondary" href="#estudiantes">${icon('cap')}Consultar estudiantes</a>${btn('Guía de uso','help','ghost','help')}</div></section>`+
 `<div class="dashboard-grid"><section class="panel"><div class="section-head"><h2>${icon('users')} ${modern?'Mis grupos':'Mis cursos'}</h2><a class="text-button" href="#${modern?'grupos':'cursos'}">Ver todos ${icon('arrow')}</a></div>${(modern?groups:templates).length?(modern?groups:templates).slice(0,5).map(c=>`<div class="resource-row"><span class="resource-icon">${icon('book')}</span><div class="spacer"><strong>${e(c.title)}</strong><small>${c.entityKind==='group'?`${e(c.cohort)} / ${e(c.groupCode)} · `:''}${{draft:'Borrador',active:'Activo',archived:'Archivado'}[c.lifecycle]||(c.published?'Publicado':'Borrador')}</small></div><a class="btn secondary small" href="#curso/${e(c.id)}">Abrir curso ${icon('arrow')}</a></div>`).join(''):empty('Prepara tu primer grupo','Crea un curso plantilla, organiza su contenido y crea un grupo para matricular estudiantes.',`<a class="btn secondary" href="#cursos">Ver cursos plantilla</a>`,'users')}</section><section class="panel"><div class="section-head"><h2>${icon('edit')} Por revisar</h2></div>${pending.length?pending.slice(0,5).map(c=>`<a class="agenda-row" href="#actividades/${e(c.id)}"><div class="spacer"><strong>${e(c.title)}</strong><small>${c.pending} entregas por calificar o publicar</small></div>${icon('arrow')}</a>`).join(''):'<div class="quiet-empty">'+icon('check')+'<p>No tienes entregas pendientes de revisión.</p></div>'}<div class="form-actions"><a class="btn secondary" href="#tareas">Ver actividades y notas</a></div></section></div>`;
}
function searchBox(placeholder) {return `<div class="search">${icon('search')}<input aria-label="${placeholder}" placeholder="${placeholder}" id="search" value="${e(state.query)}"></div>`;}
function coursesPage(student=false) {
 let list=state.courses.filter(c=>(student||!state.user?.roles||c.entityKind==='template') && (!student||c.enrolled||c.accessMode==='public') && (state.filter==='all'||state.filter==='published'&&c.published||state.filter==='draft'&&!c.published&&c.lifecycle!=='archived'||state.filter==='archived'&&c.lifecycle==='archived') && `${c.title} ${c.description}`.toLowerCase().includes(state.query.toLowerCase()));
 return heading(student?'Mi aprendizaje':state.user?.roles?'Cursos plantilla':'Mis cursos',student?'Continúa donde lo dejaste.':state.user?.roles?'Prepara contenidos y crea grupos independientes para cada semestre.':'Crea, organiza y comparte tus cursos.',admin()?btn(state.user?.roles?'Crear curso plantilla':'Crear curso','new-course','','plus'):'')+
 `<div class="toolbar">${searchBox('Buscar un curso…')}${admin()?`<div class="tabs" aria-label="Estado del curso">${[['all','Todos'],['published','Publicados'],['draft','Borradores'],['archived','Archivados']].map(([v,t])=>btn(t,`filter:${v}`,`tab ${state.filter===v?'active':''}`)).join('')}</div>`:''}</div>`+
 (list.length?`<div class="course-grid">${list.map(courseCard).join('')}</div>`:empty(state.query?'Sin coincidencias':student?'Tu aprendizaje empieza pronto':'Un aula llena de posibilidades',state.query?'Prueba con otro nombre.':student?'Cuando tu docente te matricule, encontrarás aquí tus cursos.':'Crea tu primer curso. Puedes guardar un borrador y publicarlo cuando esté listo.',admin()?btn('Crear mi primer curso','new-course','','plus'):'','book'));
}
function catalog() {
 const list=state.courses.filter(c=>c.published && `${c.title} ${c.description}`.toLowerCase().includes(state.query.toLowerCase()));
 return (admin()?`<div class="notice">${icon('globe')}Esta es la vista del catálogo. Como administrador puedes abrir también los contenidos restringidos.<a class="text-button" href="#inicio">Volver al panel</a></div>`:'')+
 `<section class="public-banner"><div><span class="overline">BIENVENIDO A TU CAMPUS</span><h1>El siguiente paso<br>en tu aprendizaje.</h1><p>${e(state.settings.subtitle || 'Explora tus cursos, encuentra tus materiales y aprende a tu ritmo.')}</p></div>${art()}</section><div class="section-head"><div><h2>Explora los cursos</h2><small>Un espacio para aprender y seguir creciendo</small></div></div><div class="toolbar">${searchBox('Buscar en el catálogo…')}<span class="muted">${list.length} cursos disponibles</span></div>`+
 (list.length?`<div class="course-grid">${list.map(courseCard).join('')}</div>`:empty('Estamos preparando tu próxima clase','Los cursos publicados aparecerán aquí. Si ya estás matriculado, ingresa con tu cédula.',state.user?'':'<a class="btn secondary" href="#login">Ingresar al aula →</a>'));
}
function studentsPage() {
 const list=state.students.filter(s=>`${s.document} ${s.name} ${s.email}`.toLowerCase().includes(state.query.toLowerCase()));
 return heading('Estudiantes','Las personas que forman parte de tu aula.',`<div class="flex wrap">${btn('Importar lista','import-students','secondary','upload')}${btn('Añadir estudiante','new-student','','plus')}</div>`)+
 `<div class="toolbar">${searchBox('Buscar por nombre o cédula…')}<small class="muted">${state.students.length} estudiantes registrados</small></div>`+
 (list.length?`<div class="panel table-panel table-wrap"><table><thead><tr><th>ESTUDIANTE</th><th>CÉDULA</th><th>ESTADO</th><th>GESTIONAR</th></tr></thead><tbody>${list.map(s=>`<tr><td><strong>${e(s.name)}</strong>${s.roles?.some(r=>r!=='student')?`<span class="badge gray">También ${s.roles.includes('teacher')?'docente':s.roles.includes('admin')?'administrativo':'máster'}</span>`:''}<span class="muted">${e(s.email||'Sin correo registrado')}</span></td><td>${e(s.document)}</td><td><span class="badge ${s.active?'green':'gray'}">${s.active?'Activo':'Suspendido'}</span><span class="muted">${s.mustChangePassword?'Primer ingreso pendiente':'Contraseña personal'}</span></td><td class="actions"><a class="btn ghost small" href="#perfil/${e(s.id)}">${icon('users')}Perfil</a>${s.roles?.some(r=>r!=='student')?'':btn('Editar',`edit-student:${s.id}`,'ghost small','edit')+btn('Restablecer',`reset-student:${s.id}`,'ghost small','lock')}</td></tr>`).join('')}</tbody></table></div>`:empty('Conoce a tu comunidad','Añade estudiantes uno a uno o importa una lista CSV. Su cédula será su nombre de usuario.',btn('Añadir estudiante','new-student','','plus'),'users'));
}
function enrollmentsPage() {
 const manage=manageableGroups(state.courses).length>0,list=state.enrollments.filter(x=>{const person=state.students.find(v=>v.id===x.studentId),course=state.courses.find(v=>v.id===x.courseId);return [person?.name,person?.document,course?.title,course?.cohort,course?.groupCode].join(' ').toLowerCase().includes(state.query.toLowerCase());});
 return heading('Matrículas','Consulta el acceso de estudiantes y gestiona las matrículas de tus grupos.',manage?`<div class="flex wrap">${btn('Subir lista y matricular','bulk-enrollment','secondary','upload')}${btn('Nueva matrícula','new-enrollment','','plus')}</div>`:'')+`<div class="toolbar">${searchBox('Buscar estudiante, cédula o grupo…')}<span class="muted">${list.length} matrículas</span></div>`+
 (list.length?`<div class="panel table-panel table-wrap"><table><thead><tr><th>ESTUDIANTE</th><th>CURSO</th><th>VIGENCIA</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>${list.map(x=>{const s=state.students.find(y=>y.id===x.studentId),c=state.courses.find(y=>y.id===x.courseId);const expired=x.expiresAt&&new Date(x.expiresAt)<new Date();return `<tr><td><strong>${e(s?.name||x.studentName||'Estudiante')}</strong><span class="muted">${e(s?.document||'')}</span></td><td><a class="text-button" href="#curso/${e(x.courseId)}">${e(c?.title||x.courseTitle||'Curso')}</a>${c?.entityKind==='group'?`<small>${e(c.cohort)} / ${e(c.groupCode)}</small>`:''}</td><td>${date(x.expiresAt)}<span class="muted">${x.startsAt?'Desde '+date(x.startsAt):'Acceso inmediato'}</span></td><td><span class="badge ${x.status==='active'&&!expired?'green':'gray'}">${x.status==='revoked'?'Revocada':expired?'Vencida':x.startsAt&&new Date(x.startsAt)>new Date()?'Programada':'Activa'}</span></td><td class="actions">${c?.permissions?.manage!==false?btn('Editar',`edit-enrollment:${x.id}`,'ghost small','edit')+btn(x.status==='active'?'Revocar':'Reactivar',`toggle-enrollment:${x.id}`,'ghost small'):'<span class="muted">Solo consulta</span>'}</td></tr>`;}).join('')}</tbody></table></div>`:empty(state.query?'Sin coincidencias':'Aún no hay matrículas',state.query?'Prueba con otro estudiante o grupo.':'Las matrículas aparecerán aquí cuando registres estudiantes en un grupo.',manage&&!state.query?btn('Subir lista y matricular','bulk-enrollment','','upload'):'','cap'));
}
function libraryPage() {
 const resources=state.courses.flatMap(c=>(c.modules||[]).flatMap(m=>(m.resources||[]).map(r=>({...r,courseTitle:c.title,courseId:c.id,moduleTitle:m.title})))).filter(r=>`${r.title} ${r.courseTitle}`.toLowerCase().includes(state.query.toLowerCase()));
 return heading('Biblioteca','Todos tus materiales, organizados por curso.',btn('Añadir material','library-add','','plus'))+`<div class="toolbar">${searchBox('Buscar un material…')}<small class="muted">${resources.length} recursos</small></div>`+
 (resources.length?`<div class="library-list">${resources.map(r=>`<div class="resource-row"><span class="resource-icon">${icon(kindIcon(r.kind))}</span><div class="spacer"><strong>${e(r.title)}</strong><small>${e(r.courseTitle)} · ${e(r.moduleTitle)}</small></div><span class="badge gray">${kinds[r.kind]}</span>${btn('Abrir',`resource:${r.id}`,'secondary small','arrow')}</div>`).join('')}</div>`:empty('Tu biblioteca está lista para crecer','Añade diapositivas, libros, imágenes y ejercicios dentro de cada capítulo. También puedes enlazar videos.',btn('Ir a mis cursos','go:cursos','secondary','book'),'folder'));
}
function settingsPage() {return heading('Configuración','Haz que este espacio se sienta como tu aula.')+`<div class="settings-grid"><section class="panel"><h2>Identidad del campus</h2><form id="settings-form" class="form-stack"><label>Nombre de la plataforma<input name="name" required maxlength="80" value="${e(state.settings.name)}"></label><label>Descripción de bienvenida<textarea name="subtitle" maxlength="240">${e(state.settings.subtitle)}</textarea></label><label>Correo de contacto<input type="email" name="contactEmail" value="${e(state.settings.contactEmail||'')}"></label><div class="form-error" role="alert"></div><button class="btn" type="submit">Guardar cambios</button></form></section><section class="panel"><h2>Acceso a los cursos</h2>${Object.entries(modes).map(([k,t])=>`<div class="mode-card">${badge(k)}<p>${{public:'Cualquier persona puede ver el curso publicado, sin iniciar sesión.',document:'Solo estudiantes matriculados. La cédula identifica al estudiante, pero no comprueba su identidad.',password:'Estudiantes matriculados que hayan iniciado sesión con su cédula y contraseña.'}[k]}</p></div>`).join('')}<div class="form-actions">${btn('Cambiar mi contraseña','change-password','secondary','lock')}</div></section></div>`;}
function loginPage() {
 return `<div class="login-layout"><div class="login-side"><div><span class="overline">TU ESPACIO DE APRENDIZAJE</span><h1 style="margin-top:20px">Cada gran idea<br>empieza en un aula.</h1><p>Tus cursos, tus materiales y todo lo que necesitas para seguir aprendiendo.</p></div>${art()}<small>Aula Abierta · Campus virtual</small></div><section class="login-form"><h2>Qué bueno verte</h2><p>Ingresa para continuar con tus cursos.</p>${state.setupRequired?'<div class="notice">El aula se está preparando. Tu docente te avisará cuando puedas ingresar.</div>':''}<div class="login-tabs">${[['password','Con contraseña'],['document','Solo cédula']].map(([m,t])=>`<button class="tab ${state.loginMode===m?'active':''}" data-action="login-mode:${m}">${t}</button>`).join('')}</div>${state.loginMode==='password'?'<div class="first-login-hint"><strong>¿Es tu primer ingreso?</strong><p>Si tu docente ya te registró, escribe tu cédula como usuario y contraseña. Después crearás tu contraseña personal.</p></div>':''}<form id="login-form" class="form-stack"><label>Cédula<input name="document" inputmode="numeric" autocomplete="username" pattern="[0-9]{4,20}" required placeholder="Tu número de cédula"><span class="field-hint">Escríbela sin puntos ni espacios.</span></label>${state.loginMode!=='document'?'<label>Contraseña<input name="password" type="password" autocomplete="current-password" maxlength="256" required placeholder="Tu contraseña"></label>':'<p class="field-hint">Disponible después de crear tu contraseña, si tu docente habilitó esta modalidad para el curso.</p>'}<div class="form-error" role="alert"></div><button type="submit" class="btn">Ingresar a mi aula ${icon('arrow')}</button></form><div class="login-recovery"><button class="text-button" data-action="recovery-help">Olvidé mi contraseña</button></div><p class="field-hint" style="margin-top:14px">${contactTeacher()}</p></section></div>`;
}
function firstPasswordPage() {
 const minimum=state.user?.roles?.some(r=>r!=='student')?12:4;
 return `<section class="first-password-card panel"><span class="overline">PREPARA TU ACCESO</span><h1>Crea tu contraseña personal</h1><p class="small-paragraph">Hola, ${e(state.user.name.split(' ')[0])}. Antes de entrar al aula, reemplaza tu contraseña inicial por una que elijas tú.</p><p class="first-password-user">Usuario: <strong>${e(state.user.document)}</strong></p><form id="first-password-form" class="form-stack"><input type="hidden" name="username" autocomplete="username" value="${e(state.user.document)}"><label>Nueva contraseña<input type="password" name="newPassword" autocomplete="new-password" minlength="${minimum}" maxlength="256" required aria-describedby="first-password-hint"></label><p class="field-hint" id="first-password-hint">Mínimo ${minimum} caracteres. Puedes usar números, letras o combinarlos. Debe ser diferente de tu cédula.</p><label>Repite la nueva contraseña<input type="password" name="confirmPassword" autocomplete="new-password" minlength="${minimum}" maxlength="256" required></label><div class="form-error" role="alert"></div><button type="submit" class="btn">Guardar y entrar al aula ${icon('arrow')}</button></form><p class="field-hint" style="margin-top:18px">En tus próximos ingresos usarás tu cédula y esta nueva contraseña.</p>${btn('Salir y continuar después','logout','ghost small')}</section>`;
}
function firstPasswordShell(content) {
 return `<header class="first-password-top"><span class="brand"><span class="brand-mark">${icon('book')}</span>${e(state.settings.name||'Aula Abierta')}</span>${btn('Cerrar sesión','logout','secondary small','logout')}</header><main id="main" class="first-password-main">${content}${footer()}</main>`;
}

function studyButton(courseId,resourceId,label='Continuar curso',style='') {
 return btn(label,`study:${courseId}/${resourceId}`,style,'arrow');
}
function learningActivityRow(activity){
 const due=activityDueAt(activity),overdue=due&&Date.parse(due)<=Date.now(),individual=individualDeadlineLabel(activity),label=individual||(due?(overdue?'Plazo vencido · ':'')+new Date(due).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}):'Sin fecha límite');
 return `<a class="agenda-row" href="#actividad/${e(activity.id)}"><span class="resource-icon">${icon(activity.kind==='quiz'?'edit':'file')}</span><div class="spacer"><strong>${e(activity.title)}</strong><small>${e(activity.courseTitle)}</small><span class="due-label ${overdue?'overdue':''}">${e(label)}</span></div>${icon('chevron')}</a>`;
}
function progressBar(percent,label) {return `<div class="progress-track" role="progressbar" aria-label="${e(label)}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>`;}
function contactTeacher() {return state.settings.contactEmail?`<a class="text-button" href="mailto:${e(state.settings.contactEmail)}">${icon('mail')} Contactar a mi docente</a>`:'Si necesitas ayuda con un curso, comunícate con tu docente.';}
function studentCourseCard(c) {
 const learning=state.learning.courses.find(x=>x.courseId===c.id),overall=learning?.overall,total=overall?.total??learning?.total??c.resourceCount??0,done=overall?.completed??learning?.completed??0,percent=overall?.percent??(total?done===total?100:Math.min(99,Math.round(done/total*100)):0),materials=overall?.materialsTotal??learning?.total??c.resourceCount??0,activities=overall?.activitiesTotal??0;
 return `<article class="course-card learning-course-card"><div class="course-cover">${safeUrl(c.coverUrl)?`<img src="${e(safeUrl(c.coverUrl))}" alt="" loading="lazy">`:icon('book')}</div><div class="course-body"><span class="badge ${c.locked?'gray':'green'}">${c.locked?'Acceso requerido':c.enrolled?'Matriculado':'Curso abierto'}</span><h3><a href="#curso/${e(c.id)}">${e(c.title)}</a></h3>${c.entityKind?`<p class="field-hint">${c.entityKind==='template'?'Curso plantilla':`Grupo ${e(c.groupCode)} · ${e(c.cohort)}`}</p>`:''}<p>${e(c.description||'Tus materiales y actividades en un solo lugar.')}</p><div class="course-meta"><span>${icon('folder')}${c.moduleCount??c.modules?.length??0} capítulos</span><span>${icon('file')}${materials} materiales${activities?' · '+activities+' actividades':''}</span></div>${!c.locked&&total?`<div class="learning-card-progress"><div class="flex between"><strong>${percent}% de avance</strong><small>${done} de ${total} elementos</small></div>${progressBar(percent,`Avance en ${c.title}`)}<small>${overall?.openPending??Math.max(0,total-done)} por realizar${overall?.activities.closedMissing?' · '+overall.activities.closedMissing+(overall.activities.closedMissing===1?' cerrada por vencimiento':' cerradas por vencimiento'):overall?' · Materiales y actividades':''}</small></div>`:!c.locked?'<p class="field-hint">Tu docente está preparando el contenido.</p>':''}<div class="course-actions">${courseEntryActions(c,learning)}</div></div></article>`;
}

function learningPage() {
 const courses=state.courses.filter(c=>c.enrolled||c.accessMode==='public'),list=courses.filter(c=>`${c.title} ${c.description}`.toLowerCase().includes(state.query.toLowerCase()));
 const summaries=state.learning.courses,totals=summaries.reduce((a,c)=>({completed:a.completed+c.completed,unopened:a.unopened+Math.max(0,c.total-c.opened)}),{completed:0,unopened:0});
 const recent=state.learning.recent||[],agenda=(state.academicOverview||[]).flatMap(c=>(c.activities||[]).filter(a=>a.state==='Pendiente'&&!activityFinalized(a)).map(a=>({...a,courseTitle:c.title}))).sort((a,b)=>(activityDueAt(a)||'z').localeCompare(activityDueAt(b)||'z'));
 return heading(`Hola, ${e(state.user.name.split(' ')[0])}`,'Entra a tus cursos y continúa aprendiendo.',`<a class="btn secondary" href="#tareas">${icon('calendar')}Mis actividades</a>`)+
 `<div class="stats learning-stats compact-stats">${[[courses.length,'Mis cursos','book'],[totals.completed,'Materiales completados','check'],[totals.unopened,'Materiales sin abrir','file'],[state.assurance==='password'?agenda.length:'—','Actividades pendientes','edit']].map(([n,label,glyph])=>`<article class="stat"><span class="stat-icon">${icon(glyph)}</span><div><strong>${n}</strong><span class="stat-top">${label}</span></div></article>`).join('')}</div>`+
 `<div class="learning-dashboard-layout"><section class="learning-courses"><div class="section-head learning-course-heading"><h2>Mis cursos <span class="badge gray">${list.length}</span></h2>${searchBox('Buscar entre mis cursos…')}</div>`+
 (list.length?`<div class="course-grid">${list.map(studentCourseCard).join('')}</div>`:empty(state.query?'Sin coincidencias':'Tu aprendizaje empieza pronto',state.query?'Prueba con otro nombre.':'Cuando tu docente te matricule, encontrarás aquí tus cursos.','<a class="btn secondary" href="#catalogo">Explorar cursos</a>'))+'</section>'+
 `<div class="learning-overview"><section class="panel"><div class="section-head"><h2>${icon('calendar')} Próximas entregas</h2><a class="text-button" href="#tareas">Ver todas ${icon('arrow')}</a></div>${state.assurance!=='password'?`<p class="small-paragraph">Ingresa con tu contraseña para consultar tus entregas.</p>${btn('Ingresar con contraseña','password-login','secondary small','lock')}`:agenda.length?`<div class="learning-list">${agenda.slice(0,4).map(learningActivityRow).join('')}</div>`:'<div class="quiet-empty">'+icon('check')+'<p>No tienes entregas pendientes.</p></div>'}</section><section class="panel"><div class="section-head"><h2>${icon('clock')} Materiales recientes</h2></div>${recent.length?`<div class="learning-list">${recent.slice(0,4).map(x=>`<div class="resource-row"><span class="resource-icon">${icon(kindIcon(x.kind))}</span><div class="spacer"><strong>${e(x.title)}</strong><small>${e(x.courseTitle)}</small></div>${studyButton(x.courseId,x.resourceId,'Retomar','secondary small')}</div>`).join('')}</div>`:'<div class="quiet-empty">'+icon('book')+'<p>Aquí encontrarás los materiales que vayas abriendo.</p></div>'}</section></div></div>`;
}
function learnerCoursePage(c) {
 return renderCoursePanel(c,{progress:state.preview?[]:state.progress,filter:state.resourceFilter,query:state.courseContentQuery||'',openChapters:state.courseOpenChapters||null,learner:student(),showChapterStatus:student()&&state.assurance==='password'&&!state.preview,canNotify:!!state.user?.roles&&state.assurance==='password'&&!state.preview,quickResourcesHTML:quickResourcesUI.panel(c),contactHTML:contactTeacher()});
}
const teacherCourseViews=new Map();
function teacherCourseViewState(id){
 const key=navigationScope(state)+'|'+id;
 if(!teacherCourseViews.has(key))teacherCourseViews.set(key,{query:'',filter:'all',openChapters:null});
 return teacherCourseViews.get(key);
}
function teacherCoursePage(c){
 const enrollmentCount=Array.isArray(state.enrollments)?state.enrollments.filter(item=>item.courseId===c.id&&item.active).length:null;
 return renderTeacherCoursePanel(c,{...teacherCourseViewState(c.id),permissions:state.user?.roles?c.permissions:{edit:true,grade:true,manage:true},legacy:!state.user?.roles,quickResourcesHTML:quickResourcesUI.panel(c),linkedGroups:state.courses.filter(group=>group.templateId===c.id),enrollmentCount});
}
function refreshCoursePanel({searchFocus=false}={}) {
 const current=document.querySelector('.course-study-content>section');if(!current||!state.currentCourse)return false;
 const search=current.querySelector('[data-course-search]'),selection=searchFocus&&search?[search.selectionStart,search.selectionEnd]:null;
 const shell=document.createElement('div');shell.innerHTML=learnerCoursePage(state.currentCourse);const next=shell.querySelector('.course-study-content>section');current.replaceWith(next);enhanceUI(next);
 if(searchFocus){const input=next.querySelector('[data-course-search]');input?.focus();if(input&&selection)input.setSelectionRange(...selection);}
 return true;
}

async function coursePage(id,version) {
 state.currentCourse=null;
 let c;try {c=await api(`/courses/${id}`);}catch(error){
  const known=state.courses.find(course=>course.id===id),needsLogin=!state.user||error.status===401,passwordNeeded=state.user&&state.assurance!=='password'&&known?.accessMode==='password';
  if(error.status===404)return heading('Curso no disponible','Este curso no está disponible en este momento.')+'<a class="btn secondary" href="#mis-cursos">Volver a mi aprendizaje</a>';
  if(![401,403].includes(error.status))return heading('No pudimos cargar el curso','Intenta nuevamente en unos momentos.')+btn('Volver a intentar','reload','secondary','arrow');
  const message=needsLogin?'Ingresa para consultar los materiales de este curso.':passwordNeeded?'Este curso requiere que ingreses con tu contraseña.':'No tienes una matrícula vigente en este curso. Consulta con tu docente.';
  return heading('Acceso al curso',message)+(needsLogin||passwordNeeded?btn('Ingresar al aula','course-login:'+id,'','lock'):`<section class="panel"><p class="small-paragraph">${contactTeacher()}</p><div class="form-actions"><a class="btn secondary" href="#mis-cursos">Volver a mi aprendizaje</a></div></section>`);
 }
 if(version!==renderVersion)return '';
 state.currentCourse=c;
 if(!admin())return learnerCoursePage(c);
 return teacherCoursePage(c);
}
async function refresh() {
 const isAdmin=admin();
 if(state.user?.mustChangePassword){state.courses=[];state.students=[];state.enrollments=[];state.progress=[];state.learning={courses:[],recent:[],activities:[]};return;}
 const results=await Promise.all([api(isAdmin?'/admin/courses':'/courses'),isAdmin?api('/admin/students'):Promise.resolve([]),isAdmin?api('/admin/enrollments'):Promise.resolve([]),state.user?api('/progress'):Promise.resolve([]),student()?api('/learning'):Promise.resolve({courses:[],recent:[],activities:[]}),state.user&&state.assurance==='password'?api('/academics/courses'):Promise.resolve([])]);
 [state.courses,state.students,state.enrollments,state.progress,state.learning,state.academicOverview]=results;
}
async function render() {
 const version=++renderVersion,current=route(),scope=navigationScope(state);
 if(renderedScope&&renderedScope!==scope)academicsUI.dispose();
 else if(!await academicsUI.beforeLeave())return;
 if(version!==renderVersion||scope!==navigationScope(state)||current!==route())return;
 academicsUI.cancelPending();const navToken=navigation.beginRender(current);let content;
 if(!/^(curso|actividad|actividades|calificaciones|estadisticas)\//.test(current))state.currentCourse=null;
 try {
  if(state.user?.mustChangePassword) content=firstPasswordPage();
  else if(current==='crear-contrasena'){location.hash=state.user?'mis-cursos':'login';return;}
  else if(current==='login') content=loginPage();
  else if(current.startsWith('curso/')) content=await coursePage(parseCourseDeepLink(current).courseId,version);
  else if(admin()&&state.user?.roles&&(current==='panorama'||current.startsWith('panorama?')||current.startsWith('estadisticas/')))content=current.startsWith('panorama')?await panoramaUI.page():await analyticsUI.page(current);
  else if(admin()&&state.user?.roles&&current==='biblioteca')content=await libraryUI.page();
  else if(admin()&&state.user?.roles&&(current==='usuarios'||current==='grupos'||current.startsWith('perfil/'))) content=await platformUI.page(current);
  else if(state.user?.roles&&(current==='notificaciones'||current.startsWith('notificaciones?')))content=await notificationsUI.page();
  else if(state.user?.roles&&(current==='mensajes'||current.startsWith('mensajes?')))content=await chatUI.page();
  else if(state.user?.roles&&(current==='mi-perfil'||current==='comunidad'||current.startsWith('comunidad?')))content=await communityUI.page(current);
  else if(state.user&&!state.preview&&current==='almacenamiento')content=await storageUI.page();
  else if(current==='catalogo') content=catalog();
  else if(!state.user){location.hash='login';return;}
  else if(current==='tareas'||/^(actividades|actividad|calificaciones)\//.test(current)) content=await academicsUI.pageHTML(current);
  else if(current==='mis-cursos'){
   if(student()&&!state.preview){
    const [learning,overview]=await Promise.all([api('/learning'),state.assurance==='password'?api('/academics/courses'):Promise.resolve([])]);
    if(version!==renderVersion||scope!==navigationScope(state)||current!==route())return;
    state.learning=learning;state.academicOverview=overview;
   }
   content=admin()?coursesPage(true):learningPage();
  }
  else if(current==='cuenta') content=heading('Mi cuenta','Tu información de acceso.')+`<section class="panel" style="max-width:650px"><h2>${e(state.user.name)}</h2><p class="small-paragraph" style="margin:15px 0">Usuario: ${e(state.user.document)}<br>Acceso actual: ${state.assurance==='password'?'Con contraseña':'Solo cédula'}</p>${state.user.roles?`<p class="small-paragraph">Funciones: ${state.user.roles.map(r=>({master:'Máster',admin:'Administrativo',teacher:'Docente',student:'Estudiante'}[r]||r)).join(' · ')}</p>`:''}${hasDualRole()?`<p class="small-paragraph">Puedes cambiar entre Docencia y Aprendizaje desde la barra lateral. Tus matrículas y grupos asignados se conservan por separado.</p>`:''}${state.assurance==='password'?btn('Cambiar contraseña','change-password','secondary','lock'):btn('Ingresar con contraseña','password-login','secondary','lock')}</section>`;
  else if(!admin()){location.hash='mis-cursos';return;}
  else content=({inicio:dashboard,cursos:()=>coursesPage(),estudiantes:studentsPage,matriculas:enrollmentsPage,biblioteca:libraryPage,ajustes:settingsPage}[current]||dashboard)();
  if(version!==renderVersion||navToken.scope!==navigationScope(state)||current!==route())return;
  app.innerHTML=state.user?.mustChangePassword?firstPasswordShell(content):state.user&&current!=='login'?shell(content,current):publicShell(content);
  renderedRoute=current;renderedScope=scope;
  if(admin()&&current==='ajustes')document.querySelector('.settings-grid')?.insertAdjacentHTML('beforeend',`<section class="panel"><h2>Trasladar un aula existente</h2><p class="small-paragraph">Importa una copia de migración en una plataforma sin cursos ni estudiantes. Conserva la cuenta de administrador de destino. El archivo contiene datos privados: no lo subas a GitHub.</p><div class="form-actions">${btn('Importar traslado','import-migration','secondary','upload')}</div></section>`);
  storageUI.bind();
  platformUI.enhance(current);
  analyticsUI.bind();panoramaUI.bind();communityUI.enhance();chatUI.enhance();notificationsUI.enhance();courseHelpUI.enhance();engagementTracker.enhance();
  if(state.user?.roles&&!state.preview)libraryUI.enhance(current);
  if(state.preview)document.querySelector('main')?.insertAdjacentHTML('afterbegin',`<div class="notice warning">Vista previa del estudiante · No se guardan entregas, notas ni avances. ${btn('Salir de vista previa','platform-exit-preview','secondary small')}</div>`);
  academicsUI.bind();
  if(admin()&&state.currentCourse&&current.startsWith('curso/')){
   const view=teacherCourseViewState(state.currentCourse.id);
   bindTeacherCoursePanel(app,{onQuery:value=>{view.query=value;},onFilter:value=>{view.filter=value;},onOpenChapters:value=>{view.openChapters=value;}});
  }
  enhanceUI(app);
  bindForms();
  document.title=`${document.querySelector('main h1')?.textContent||'Mi aula'} · ${state.settings.name||'Aula Abierta'}`;
  navigation.completeRender(navToken);
  if(current.startsWith('curso/')){
   const deep=parseCourseDeepLink(current),resourceId=deep.resourceId||state.pendingResourceId;state.pendingResourceId=null;
   if(deep.resourceId||deep.quickResourceId){navigation.replaceRoute('curso/'+deep.courseId);renderedRoute=route();}
   state.viewerReturnToOrigin=resourceId||deep.quickResourceId?{route:route(),scope}:null;
   try{
    if(resourceId&&state.currentCourse?.modules.some(m=>m.resources.some(r=>r.id===resourceId)))await viewResource(resourceId);
    else if(deep.quickResourceId&&state.currentCourse?.quickResources?.some(item=>item.id===deep.quickResourceId))await quickResourcesUI.action('quick-view',deep.quickResourceId);
    else if(deep.moduleId){const chapter=Array.from(document.querySelectorAll('[data-module-id]')).find(node=>node.dataset.moduleId===deep.moduleId);if(chapter?.tagName==='DETAILS')chapter.open=true;chapter?.scrollIntoView({block:'start',behavior:'instant'});}
   }finally{state.viewerReturnToOrigin=null;}
  }

 }catch(error){if(version!==renderVersion||navToken.scope!==navigationScope(state)||current!==route())return;const message=empty('No pudimos abrir esta página',e(error.message),btn('Volver a intentar','reload','secondary','arrow')+`<a class="btn ghost" href="#${admin()?'inicio':'mis-cursos'}">Volver al inicio</a>`,'help');app.innerHTML=state.user?shell(message,current):publicShell(message);enhanceUI(app);renderedRoute=current;navigation.completeRender(navToken);}
}
function detachFloatingTools(){courseHelpUI.detachFromViewer();const chats=document.getElementById('chat-root');if(chats?.closest('dialog'))document.body.append(chats);}
function openModal(title,body,onSubmit,{wide=false,submit='Guardar'}={}) {
 detachFloatingTools();courseHelpUI.hide();
 if(modal.open)modal.close();
 document.documentElement.classList.remove('resource-viewer-open');
 modal.className=wide?'wide':'';
 modal.innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar">${icon('close')}</button></div>${onSubmit?'<form id="modal-form">':''}${body}${onSubmit?`<div class="form-error" role="alert"></div><div class="form-actions"><button type="button" class="btn secondary" data-action="close-modal">Cancelar</button><button type="submit" class="btn">${submit}</button></div></form>`:''}`;
 modal.dataset.dirty='false';modalHandler=onSubmit;enhanceUI(modal);navigation.openOverlay();modal.showModal();
}
function openResourceViewer(resource,view,actions) {
 detachFloatingTools();
 const returnToOrigin=state.viewerReturnToOrigin?.route===route()&&state.viewerReturnToOrigin?.scope===navigationScope(state);
 const backLabel=returnToOrigin&&navigation.originLabel()||navigation.overlayOriginLabel()|| (resource.id.startsWith('academic-file-')?'Volver a la actividad':'Volver al curso');
 if(modal.open)modal.close();
 modal.className='resource-viewer';
 modal.dataset.dirty='false';
 modal.innerHTML=`<header class="viewer-header"><button type="button" class="btn secondary viewer-back" data-action="close-modal" aria-label="${backLabel}" autofocus>${icon('arrow')}<span class="viewer-action-label">${backLabel}</span></button><div class="viewer-heading"><h2 id="modal-title" title="${e(resource.title)}">${e(resource.title)}</h2><span>${materialName(resource.kind)}</span></div><div class="viewer-actions">${actions}<button type="button" class="icon-btn" data-action="close-modal" aria-label="Cerrar material" title="Cerrar material">${icon('close')}</button></div></header><p class="viewer-message" role="status" hidden></p><div class="content-view">${view}</div>`;
 modalHandler=null;state.activeResourceId=resource.id;state.activeResourceRoute=route();state.activeResourceScope=navigationScope(state);state.activeResourceScroll=window.scrollY;
 document.documentElement.classList.add('resource-viewer-open');
 navigation.openOverlay(resource.id.startsWith('academic-file-')?null:()=>viewResource(resource.id),{replacePage:returnToOrigin});modal.showModal();courseHelpUI.enhance();chatUI.enhance();
}
async function submitForm(form,fn) {
 const submit=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');if(submit.disabled)return;error.textContent='';const label=submit.innerHTML;submit.disabled=true;submit.setAttribute('aria-busy','true');submit.innerHTML=icon('clock')+'Guardando…';
 try {await fn(new FormData(form));}catch(err){error.textContent=err.message;error.setAttribute('tabindex','-1');error.focus();}finally{submit.disabled=false;submit.removeAttribute('aria-busy');submit.innerHTML=label;}
}
function values(fd){return Object.fromEntries(fd.entries());}
function findCourse(id){return state.courses.find(c=>c.id===id)||state.currentCourse;}
function allModules(){return state.courses.flatMap(c=>c.modules||[]).concat(state.currentCourse?.modules||[]);}
function findResource(id){return allModules().flatMap(m=>m.resources||[]).find(r=>r.id===id);}
async function saved(message='Cambios guardados') {modal.close();await refresh();await render();toast(message);}
function courseForm(id) {
 const c=id?findCourse(id):{title:'',description:'',accessMode:'password',published:false};
 const kind=c.entityKind==='group'?'grupo':'curso',canDelete=!!(id&&state.user?.roles&&c.permissions?.manage);
 const deleteZone=canDelete?`<section class="course-delete-zone" aria-label="Eliminar ${kind}"><div><strong>Eliminar ${kind}</strong><p>Esta acción elimina matrículas, materiales, entregas y notas de este ${kind}. Requiere dos confirmaciones.</p></div>${btn('Eliminar '+kind,'platform-delete-course:'+id,'danger small','trash')}</section>`:'';
 openModal(id?'Editar '+kind:'Un nuevo espacio para aprender',`<div class="form-stack"><label>${c.entityKind==='group'?'Nombre del grupo':'Nombre del curso'}<input name="title" required maxlength="180" placeholder="¿Qué vas a enseñar?" value="${e(c.title)}"></label><label>Descripción<textarea name="description" maxlength="4000" placeholder="Cuenta a tus estudiantes qué encontrarán aquí.">${e(c.description)}</textarea></label><label>¿Cómo se ingresa a este ${kind}?<select name="accessMode">${Object.entries(modes).map(([k,t])=>`<option value="${k}" ${c.accessMode===k?'selected':''}>${t}</option>`).join('')}</select><span class="field-hint">Los cursos restringidos requieren una matrícula. Solo cédula ofrece una verificación básica, sin comprobar la identidad.</span></label><label>Imagen de portada (opcional)<input type="url" name="coverUrl" placeholder="https://…" value="${e(c.coverUrl||'')}"></label><label class="check-label"><input type="checkbox" name="published" ${c.published?'checked':''}>${c.entityKind==='group'?'Publicar grupo para estudiantes':'Publicar en el catálogo'}</label><span class="field-hint">Sin publicar, solo tú puedes ver el contenido.</span>${deleteZone}</div>`,async fd=>{const data={...values(fd),published:fd.has('published')};await (id?patch(`/admin/courses/${id}`,data):post('/admin/courses',data));await saved(id?'Curso actualizado':'Tu curso está creado');});
}
function studentForm(id) {
 const s=id?state.students.find(x=>x.id===id):{};
 openModal(id?'Editar estudiante':'Añadir estudiante',`<div class="form-stack"><label>Nombre completo<input name="name" required maxlength="160" value="${e(s.name||'')}"></label><label>Cédula<input name="document" inputmode="numeric" pattern="[0-9]{4,20}" required ${id?'readonly':''} value="${e(s.document||'')}"><span class="field-hint">Será el usuario para ingresar. Sin puntos ni espacios.</span></label><label>Correo (opcional)<input name="email" type="email" value="${e(s.email||'')}"></label>${id?`<label class="check-label"><input type="checkbox" name="active" ${s.active?'checked':''}>Cuenta activa</label>`:'<div class="notice">Su usuario y contraseña inicial serán su cédula. Tendrá que crear una contraseña personal en el primer ingreso, de al menos 4 caracteres.</div>'}</div>`,async fd=>{const data=values(fd);if(id)data.active=fd.has('active');await(id?patch(`/admin/students/${id}`,data):post('/admin/students',data));await saved(id?'Estudiante actualizado':'Estudiante registrado. Su acceso inicial es con la cédula.');});
}
function resetStudentPassword(id) {
 const s=state.students.find(x=>x.id===id);if(!s)return;
 openModal('Restablecer acceso',`<p class="small-paragraph">Se restablecerá la contraseña de <strong>${e(s.name)}</strong> a su cédula y se cerrarán sus sesiones abiertas. En el siguiente ingreso deberá elegir una contraseña personal nueva.</p><p class="field-hint" style="margin-top:16px">Verifica que la solicitud sea del estudiante antes de restablecer su acceso.</p>`,async()=>{await post(`/admin/students/${id}/reset-password`);await saved('Acceso restablecido. El estudiante debe ingresar con su cédula como usuario y contraseña.');},{submit:'Restablecer a la cédula'});
}

function enrollmentForm(id,courseId) {
 const eligible=state.courses.filter(c=>(!c.entityKind||c.entityKind==='group')&&(!c.permissions||c.permissions.manage)&&c.lifecycle!=='archived');
 if(!eligible.length){openModal('No hay grupos disponibles','<p>Crea un grupo desde un curso plantilla o solicita permiso para gestionar sus matrículas.</p>');return;}
 if(!state.courses.length){openModal('Crea primero un curso','<p class="small-paragraph">Necesitas un curso para matricular estudiantes.</p><div class="form-actions">'+btn('Entendido','close-modal')+'</div>');return;}
 if(!state.students.length){openModal('Matricula tu primer grupo','<p class="small-paragraph">Puedes subir una lista para crear las cuentas y matricularlas en un solo paso. Para una matrícula individual, registra primero al estudiante.</p><div class="form-actions">'+btn('Subir lista y matricular',`bulk-enrollment:${courseId||''}`,'','upload')+btn('Cerrar','close-modal','secondary')+'</div>');return;}
 const x=id?state.enrollments.find(y=>y.id===id):{courseId};
 openModal(id?'Editar matrícula':'Nueva matrícula',`<div class="form-stack"><label>Estudiante<select name="studentId" ${id?'disabled':''}>${state.students.map(s=>`<option value="${s.id}" ${s.id===x.studentId?'selected':''}>${e(s.name)} · ${e(s.document)}</option>`).join('')}</select></label><label>Curso<select name="courseId" ${id?'disabled':''}>${eligible.map(c=>`<option value="${c.id}" ${c.id===x.courseId?'selected':''}>${e(c.title)}${c.entityKind==='group'?` · ${e(c.cohort)} / ${e(c.groupCode)}`:''}</option>`).join('')}</select></label><div class="form-grid"><label>Inicio (opcional)<input type="date" name="startsAt" value="${x.startsAt?.slice(0,10)||''}"></label><label>Último día de acceso<input type="date" name="expiresAt" value="${x.expiresAt?.slice(0,10)||''}"></label></div><span class="field-hint">Sin fechas, el acceso comienza ahora y no vence. Las fechas usan el horario del servidor (UTC).</span></div>`,async fd=>{const data=values(fd);data.startsAt=data.startsAt?`${data.startsAt}T00:00:00.000Z`:null;data.expiresAt=data.expiresAt?`${data.expiresAt}T23:59:59.999Z`:null;await(id?patch(`/admin/enrollments/${id}`,data):post('/admin/enrollments',data));await saved('Matrícula guardada');});
}
function enrollmentOptions(courseId) {
 const course=state.courses.find(c=>c.id===courseId);if(!course)return;
 openModal('Matricular estudiantes',`<p class="small-paragraph">Curso: <strong>${e(course.title)}</strong></p><div class="enrollment-options"><section><span class="resource-icon">${icon('users')}</span><h3>Matrícula individual</h3><p>Selecciona una cuenta ya registrada y asígnale acceso a este curso.</p>${btn('Elegir estudiante',`single-enrollment:${courseId}`,'secondary')}</section><section><span class="resource-icon">${icon('upload')}</span><h3>Un grupo completo</h3><p>Sube una lista CSV. Crearemos las cuentas que falten y las matricularemos en este curso.</p>${btn('Subir lista y matricular',`bulk-enrollment:${courseId}`,'','upload')}</section></div>`,null,{wide:true});
}
function enrollmentSummary(summary,preview=false) {
 const items=[[summary.createdStudents,preview?'Cuentas nuevas previstas':'Cuentas creadas'],[summary.enrolled,preview?'Matrículas nuevas previstas':'Matrículas creadas'],[summary.alreadyEnrolled,'Ya matriculados'],[summary.reactivated,preview?'Por reactivar':'Reactivadas'],[summary.skipped,'Omitidos'],[summary.errors,'Por revisar']];
 return `<div class="enrollment-summary">${items.map(([n,label])=>`<div><strong>${Number(n)||0}</strong><span>${label}</span></div>`).join('')}</div>`;
}
function enrollmentRows(rows,preview=false) {
 return `<div class="table-wrap enrollment-results"><table><thead><tr><th>REGISTRO</th><th>ESTUDIANTE</th><th>CÉDULA</th><th>${preview?'ACCIÓN PREVISTA':'RESULTADO'}</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${Number(row.row)}</td><td>${e(row.name)}</td><td>${e(row.document)}</td><td><span class="badge ${row.status==='error'?'amber':row.status==='skipped'?'gray':'green'}">${e(enrollmentResultLabel(row))}</span>${row.error||row.reason?`<span class="muted">${e(row.error||row.reason)}</span>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
async function readEnrollmentList(file) {
 if(!file?.size)throw new Error('Selecciona un archivo CSV con estudiantes.');
 if(file.size>1024*1024)throw new Error('La lista debe pesar menos de 1 MB.');
 const students=parseStudentsCsv(await file.text(),{allowDuplicates:true});
 if(!students.length)throw new Error('La lista no contiene estudiantes.');
 if(students.length>500)throw new Error('Importa hasta 500 registros por lista.');
 return students;
}
function bulkEnrollmentForm(courseId) {
 const eligible=manageableGroups(state.courses);
 if(!eligible.length){openModal('No hay grupos disponibles','<p>Crea un grupo desde un curso plantilla o solicita permiso para gestionar sus matrículas.</p>');return;}
 if(!state.courses.length){openModal('Crea primero un curso','<p class="small-paragraph">Crea un curso y luego podrás subir la lista de sus estudiantes.</p><div class="form-actions">'+btn('Entendido','close-modal')+'</div>');return;}
 const course=state.courses.find(c=>c.id===courseId);let previewVersion=0;
 openModal('Subir lista y matricular',`<div class="form-stack">${course?`<div class="enrollment-target"><small>CURSO SELECCIONADO</small><strong>${e(course.title)}</strong></div><input type="hidden" name="courseId" value="${e(course.id)}">`:`<label>Curso<select name="courseId" required><option value="">Selecciona el curso</option>${eligible.map(c=>`<option value="${e(c.id)}">${e(c.title)}${c.entityKind==='group'?` · ${e(c.cohort)} / ${e(c.groupCode)}`:''}${c.published?'':' · Borrador'}</option>`).join('')}</select></label>`}<p class="small-paragraph">Sube un CSV con las columnas <strong>cedula,nombre,correo</strong>. El correo es opcional. Se crearán las cuentas que falten y se matricularán en el curso elegido.</p><label>Lista de estudiantes (CSV)<input type="file" name="csv" accept=".csv,text/csv" required><span class="field-hint">Hasta 500 registros y 1 MB. Desde Excel, guarda la lista como CSV UTF-8 y conserva las cédulas como texto.</span></label>${btn('Descargar plantilla vacía','csv-template','secondary small','download')}<div class="form-grid"><label>Inicio (opcional)<input type="date" name="startsAt"></label><label>Último día de acceso (opcional)<input type="date" name="expiresAt"></label></div><span class="field-hint">Estas fechas se aplican a matrículas nuevas y reactivadas. Sin fechas, el acceso comienza ahora y no vence. Horario UTC.</span><label class="check-label"><input type="checkbox" name="reactivate">Reactivar matrículas vencidas o revocadas de esta lista</label><span class="field-hint">Las matrículas vigentes o programadas conservan sus fechas. Las cuentas suspendidas aparecerán para revisión.</span><div id="enrollment-preview" aria-live="polite"><p class="field-hint">Al elegir el archivo verás una vista previa de la lista.</p></div><div class="notice">Los estudiantes nuevos ingresan con su cédula como usuario y contraseña inicial, y deberán crear una contraseña personal. Las cuentas existentes conservan su contraseña.</div><p class="enrollment-progress" role="status" hidden>Registrando y matriculando el grupo. Espera a que aparezca el resultado.</p></div>`,async fd=>{
  const selected=course?.id||fd.get('courseId');if(!selected)throw new Error('Selecciona el curso.');
  const students=await readEnrollmentList(fd.get('csv'));
  const startsAt=fd.get('startsAt')?`${fd.get('startsAt')}T00:00:00.000Z`:null,expiresAt=fd.get('expiresAt')?`${fd.get('expiresAt')}T23:59:59.999Z`:null;
  if(startsAt&&expiresAt&&startsAt>=expiresAt)throw new Error('La fecha final debe ser posterior a la inicial.');
  if(!form.isConnected||!modal.open)return;
  state.bulkEnrollmentBusy=true;form.setAttribute('aria-busy','true');form.querySelector('.enrollment-progress').hidden=false;
  const controls=Array.from(modal.querySelectorAll('input,select,button')).map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
  let result;
  try {result=await post(`/admin/courses/${encodeURIComponent(selected)}/enrollments/bulk`,{students,startsAt,expiresAt,reactivate:fd.has('reactivate')});}
  catch(error){throw new Error(`${error.message} Si la carga se interrumpió, revisa las matrículas y vuelve a enviar la misma lista; los registros confirmados no se duplican.`);}
  finally{state.bulkEnrollmentBusy=false;form.removeAttribute('aria-busy');if(form.isConnected)form.querySelector('.enrollment-progress').hidden=true;controls.forEach(([el,disabled])=>el.disabled=disabled);}
  let refreshFailed=false;try{await refresh();await render();}catch{refreshFailed=true;}
  showEnrollmentImportResult(result,refreshFailed);
 },{wide:true,submit:'Crear y matricular estudiantes'});
 const form=modal.querySelector('#modal-form');
 form.addEventListener('change',async()=>{
  const version=++previewVersion,preview=form.querySelector('#enrollment-preview');form.querySelector('.form-error').textContent='';
  const file=form.elements.csv.files[0],selected=course?.id||form.elements.courseId.value;
  if(!file){preview.innerHTML='<p class="field-hint">Al elegir el archivo verás una vista previa de la lista.</p>';return;}
  if(!selected){preview.innerHTML='<p class="field-hint">Selecciona el curso para revisar la lista.</p>';return;}
  try{const rows=await readEnrollmentList(file);if(version!==previewVersion||!form.isConnected)return;const result=enrollmentPreview(rows,state.students,state.enrollments,selected,{reactivate:form.elements.reactivate.checked});preview.innerHTML=`<h3>Vista previa · ${rows.length} registros</h3><p class="field-hint">Estimación con los datos actuales. El resultado de la carga confirmará cada registro.</p>${enrollmentSummary(result.summary,true)}${enrollmentRows(result.results.slice(0,20),true)}${rows.length>20?`<p class="field-hint">Se muestran los primeros 20 de ${rows.length} registros.</p>`:''}`;}
  catch(error){if(version===previewVersion&&form.isConnected)preview.innerHTML=`<p class="form-error" role="alert">${e(error.message)}</p>`;}
 });
}
function showEnrollmentImportResult(result,refreshFailed=false) {
 if(state.enrollmentReportUrl)URL.revokeObjectURL(state.enrollmentReportUrl);
 const csv='\uFEFFregistro,cedula,nombre,resultado,detalle\r\n'+result.results.map(row=>[row.row,row.document,row.name,enrollmentResultLabel(row),row.error||row.reason||''].map(csvCell).join(',')).join('\r\n');
 state.enrollmentReportUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 openModal('Resultado de la matrícula por lista',`<p class="small-paragraph">Curso: <strong>${e(result.course.title)}</strong><br>Se procesaron ${Number(result.summary.received)} registros.</p>${enrollmentSummary(result.summary)}${refreshFailed?'<p class="notice warning">El resultado se guardó, pero no pudimos actualizar el panel. Recarga la página después de revisar el reporte.</p>':''}${result.summary.errors||result.summary.skipped?'<p class="small-paragraph">Revisa los registros omitidos o con errores en la tabla. Puedes corregirlos y subir la lista otra vez.</p>':'<p class="small-paragraph">La lista quedó procesada. Los estudiantes nuevos deben cambiar su contraseña en el primer ingreso.</p>'}${enrollmentRows(result.results)}<div class="form-actions"><a class="btn secondary" href="${e(state.enrollmentReportUrl)}" download="resultado-matriculas.csv">${icon('download')}Descargar resultado</a>${btn('Listo','close-modal')}</div>`,null,{wide:true});
}

function moduleForm(id,courseId) {
 const m=id?allModules().find(x=>x.id===id):{title:'',position:Math.min(1000000,Math.max(-1,...(state.currentCourse?.modules||[]).map(module=>Number(module.position)||0))+1)};
 openModal(id?'Editar capítulo':'Añadir capítulo',`<div class="form-stack"><label>Título del capítulo<input name="title" required maxlength="180" placeholder="Nombre del capítulo" value="${e(m.title)}"></label><label>Orden<input name="position" type="number" min="0" max="1000000" value="${m.position||0}"></label><label class="check-label"><input type="checkbox" name="published" ${m.published?'checked':''}>Publicar capítulo</label><span class="field-hint">En borrador, solo tú puedes verlo. Al publicarlo, se muestran únicamente los materiales y actividades que también estén publicados. El curso debe estar publicado.</span></div>`,async fd=>{const data={...values(fd),position:Number(fd.get('position')),published:fd.has('published')};await(id?patch(`/admin/modules/${id}`,data):post(`/admin/courses/${courseId}/modules`,data));await saved('Capítulo guardado');});
}
function resourceForm(id,moduleId) {
 const r=id?findResource(id):{title:'',kind:'pdf',position:Math.min(1000000,Math.max(-1,...(allModules().find(module=>module.id===moduleId)?.resources||[]).map(resource=>Number(resource.position)||0))+1)};
 openModal(id?'Editar material':'Añadir material',`<div class="form-stack"><div class="form-grid"><label class="full">Título<input name="title" required maxlength="180" value="${e(r.title)}" placeholder="Nombre del material"></label><label>Tipo de recurso<select name="kind">${Object.entries(kinds).map(([k,t])=>`<option value="${k}" ${r.kind===k?'selected':''}>${t}</option>`).join('')}</select></label><label>Orden<input type="number" name="position" min="0" max="1000000" value="${r.position||0}"></label></div><label>Registro de resultados (solo laboratorios)<select name="labResults">${[['disabled','Sin registro'],['optional','Opcional'],['required','Requerido para completar']].map(([v,t])=>`<option value="${v}" ${(r.labResults||'optional')===v?'selected':''}>${t}</option>`).join('')}</select></label><label>Subir archivo (opcional)<input type="file" name="file" accept=".pdf,.pptx,.docx,.png,.jpg,.jpeg,.webp,.gif,.html,.txt"><span class="field-hint">Máximo 20 MB. PDF e imágenes tienen vista previa; PowerPoint y Word se descargan.${r.fileName?' Archivo actual: '+e(r.fileName):''}</span></label>${r.fileName?'<label class="check-label"><input name="removeFile" type="checkbox">Quitar archivo actual</label>':''}<label>Enlace a video o material (opcional)<input type="url" name="url" placeholder="https://…" value="${e(r.url||'')}"><span class="field-hint">Videos de YouTube y Vimeo se pueden reproducir aquí. Un enlace externo conserva los permisos de su servicio.</span></label><label>Texto del ejercicio o código HTML (opcional)<textarea name="content" rows="5" maxlength="500000" placeholder="Escribe las instrucciones o pega un capítulo HTML autónomo.">${e(r.content||'')}</textarea></label><p class="field-hint">Usa una fuente por material: archivo, enlace o texto. Los capítulos HTML se muestran aislados del resto de la plataforma.</p><label class="check-label"><input type="checkbox" name="published" ${r.published?'checked':''}>Publicar material</label><span class="field-hint">Para que los estudiantes lo vean, el capítulo y el curso también deben estar publicados.</span></div>`,async fd=>{const data=values(fd),file=fd.get('file');data.published=fd.has('published');delete data.file;if(fd.has('removeFile'))data.file=null;delete data.removeFile;data.position=Number(data.position);if(file?.size){if(file.size>20*1024*1024)throw new Error('El archivo supera el límite de 20 MB.');data.file={name:file.name,mime:file.type||'application/octet-stream',base64:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(file);})};}await(id?patch(`/admin/resources/${id}`,data):post(`/admin/modules/${moduleId}/resources`,data));await saved('Material guardado');},{wide:true});
}
function confirmAction(title,copy,fn) {openModal(title,`<p class="small-paragraph">${copy}</p>`,async()=>{await fn();await saved();},{submit:'Confirmar'});}
async function viewResource(id) {
 const r=findResource(id);if(!r)throw new Error('Abre primero el curso que contiene este recurso.');
 const initialScope=navigationScope(state),initialRoute=route();
 if(student()&&!state.preview){const opened=await post(`/progress/${id}/open`);if(navigationScope(state)!==initialScope||route()!==initialRoute)return;state.progress=state.progress.filter(p=>p.resourceId!==id).concat(opened);}
 const url=safeUrl(r.url),embed=videoEmbed(url),file=r.fileUrl;let view='';
 if(['html','lab'].includes(r.kind)&&(r.content||file)){
  view=`<iframe title="${e(r.title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/api/resources/${encodeURIComponent(r.id)}/preview?aula_view=${!state.preview&&student()?'learning':'teaching'}"></iframe>`;
 }else if(embed)view=`<iframe class="video" title="${e(r.title)}" src="${e(embed)}" allow="fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
 else if(file&&(r.fileMime==='application/pdf'||r.fileName?.toLowerCase().endsWith('.pdf')))view=`<iframe title="${e(r.title)}" src="${e(file)}"></iframe>`;
 else if(r.kind==='image'&&(file||url))view=`<img src="${e(file||url)}" alt="${e(r.title)}">`;
 else if(r.content)view=`<pre>${e(r.content)}</pre>`;
 else view=`<div class="empty"><div class="empty-icon">${icon(kindIcon(r.kind))}</div><h3>${e(r.title)}</h3><p>${file?'Descarga el archivo para abrirlo en tu dispositivo.':url?'Abre este material en su página original.':'Este material aún no tiene contenido.'}</p></div>`;
 const completed=state.progress.some(p=>p.resourceId===id&&p.completed);
 const completionLabel=completed?'Marcar pendiente':'Marcar completado';
 const actions=`${file?`<a class="btn secondary" href="${e(file)}" download aria-label="Descargar archivo" title="Descargar archivo">${icon('download')}<span class="viewer-action-label">Descargar</span></a>`:''}${url?`<a class="btn secondary" href="${e(url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir enlace original" title="Abrir enlace original">${icon('link')}<span class="viewer-action-label">Abrir enlace</span></a>`:''}${state.user&&!admin()&&!state.preview?`<button type="button" class="btn ${completed?'secondary':''}" data-action="complete:${id}" aria-label="${completionLabel}" title="${completionLabel}">${icon('check')}<span class="viewer-action-label">${completionLabel}</span></button>`:''}`;
 openResourceViewer(r,view,actions+(r.kind==='lab'&&r.labResults!=='disabled'&&!state.preview?btn(admin()?'Ver resultados':'Registrar resultados','lab-results:'+r.id,'secondary') :''));
}
function importStudents() {
 openModal('Importar estudiantes',`<div class="form-stack"><p class="small-paragraph">Carga una lista CSV con las columnas <strong>cedula,nombre,correo</strong>. El correo es opcional. Conserva las cédulas como texto para no perder ceros.</p><label>Archivo CSV<input type="file" name="csv" accept=".csv,text/csv" required></label><p class="field-hint">Cada estudiante nuevo tendrá su cédula como usuario y contraseña inicial, con cambio obligatorio al ingresar. Las cuentas existentes se conservan. Las matrículas se asignan después, desde Matrículas.</p>${btn('Descargar plantilla vacía','csv-template','secondary small','download')}</div>`,async fd=>{const f=fd.get('csv');if(f.size>1024*1024)throw new Error('La lista debe pesar menos de 1 MB.');const students=parseStudentsCsv(await f.text());if(!students.length)throw new Error('La lista no contiene estudiantes.');if(students.length>500)throw new Error('Importa hasta 500 estudiantes por lista.');const result=await post('/admin/students/bulk',{students});await saved('Lista procesada');state.importResult=result;openModal('Resultado de la importación',`<p class="small-paragraph">Se registraron ${result.created?.length||0} estudiantes. Pueden ingresar con su cédula como usuario y contraseña inicial; el aula les pedirá crear una contraseña personal.</p>${result.errors?.length?`<div class="notice warning" style="margin-top:15px">${result.errors.map(x=>e(x.error||x.message||JSON.stringify(x))).join('<br>')}</div>`:''}<div class="table-wrap"><table><thead><tr><th>ESTUDIANTE</th><th>CÉDULA</th><th>ACCESO INICIAL</th></tr></thead><tbody>${(result.created||[]).map(s=>`<tr><td>${e(s.name)}</td><td>${e(s.document)}</td><td>Con su cédula</td></tr>`).join('')}</tbody></table></div><div class="form-actions">${btn('Guardar registro','export-students','secondary','download')}${btn('Listo','close-modal')}</div>`,null,{wide:true});},{submit:'Importar estudiantes'});
}
function downloadText(name,text,type='text/csv') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;(modal.open?modal:document.body).append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(url);},1000);}
function importMigration() {
 openModal('Importar el aula local',`<div class="form-stack"><p class="small-paragraph">El traslado incluye los cursos, estudiantes, matrículas, avances y materiales del archivo. Solo se permite cuando esta plataforma aún no tiene cursos ni estudiantes.</p><label>Archivo de migración<input type="file" name="bundle" accept=".json,application/json" required></label><p class="field-hint">La cuenta de administrador y su contraseña actuales se conservan. Las sesiones y los códigos de activación anteriores no se trasladan.</p></div>`,async fd=>{
  const file=fd.get('bundle');if(!file?.size)throw new Error('Selecciona el archivo de migración.');if(file.size>64*1024*1024)throw new Error('La copia supera el límite de 64 MB.');
  let bundle;try{bundle=JSON.parse(await file.text());}catch{throw new Error('El archivo no contiene una copia JSON válida.');}
  if(!bundle||bundle.format!=='aula-abierta-migration'||bundle.version!==1)throw new Error('El archivo no es una copia compatible de Aula Abierta.');
  const result=await post('/admin/migration',bundle);await saved('Traslado completado');
  const counts=result.imported;openModal('Tu aula ya está trasladada',`<p class="small-paragraph">Se importaron ${Number(counts.courses)} cursos, ${Number(counts.students)} estudiantes, ${Number(counts.resources)} recursos y ${Number(counts.enrollments)} matrículas.</p><p class="field-hint" style="margin-top:16px">Los estudiantes sin contraseña personal ingresan inicialmente con su cédula como usuario y contraseña. El aula les pedirá cambiarla.</p><div class="form-actions">${btn('Continuar','close-modal')}</div>`);
 },{submit:'Importar en esta plataforma'});
}
function csvCell(text){let t=String(text??'');if(/^[=+@\-\t\r]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';}
function bindForms() {
 document.getElementById('login-form')?.addEventListener('submit',ev=>{ev.preventDefault();submitForm(ev.currentTarget,async fd=>{const result=await post('/auth/login',values(fd));state.user=result.user;state.assurance=result.assurance;setInitialView();state.currentCourse=null;await refresh();location.hash=state.user.mustChangePassword?'crear-contrasena':state.afterLoginCourse?'curso/'+state.afterLoginCourse:admin()?'inicio':'mis-cursos';if(!state.user.mustChangePassword)state.afterLoginCourse=null;await render();if(!state.user.mustChangePassword)toast('Bienvenido a tu aula');});});
 document.getElementById('first-password-form')?.addEventListener('submit',ev=>{ev.preventDefault();submitForm(ev.currentTarget,async fd=>{const data=values(fd);if(data.newPassword!==data.confirmPassword)throw new Error('Las contraseñas no coinciden. Escríbelas de nuevo.');const result=await post('/auth/first-password',{newPassword:data.newPassword,confirmPassword:data.confirmPassword});state.user=result.user;state.assurance=result.assurance;setInitialView();await refresh();location.hash=state.afterLoginCourse?'curso/'+state.afterLoginCourse:admin()?'inicio':'mis-cursos';state.afterLoginCourse=null;await render();toast('Tu contraseña está lista. Bienvenido a tu aula.');});});
 document.getElementById('settings-form')?.addEventListener('submit',ev=>{ev.preventDefault();submitForm(ev.currentTarget,async fd=>{state.settings=await patch('/admin/settings',values(fd));await render();toast('Configuración guardada');});});
}
modal.addEventListener('submit',ev=>{if(ev.target.id==='modal-form'){ev.preventDefault();submitForm(ev.target,fd=>modalHandler(fd));}});
modal.addEventListener('input',ev=>{if(ev.target.closest('form')&&!ev.target.closest('#chat-root'))modal.dataset.dirty='true';});
modal.addEventListener('change',ev=>{if(ev.target.closest('form')&&!ev.target.closest('#chat-root'))modal.dataset.dirty='true';});
function canDismissModal(after=()=>modal.close()){
 if(modal.getAttribute('aria-busy')==='true')return false;
 if(state.bulkEnrollmentBusy)return false;
 if(modal.dataset.dirty!=='true')return true;
 pendingModalDismiss=after;
 if(!modal.querySelector('.discard-changes'))modal.querySelector('.modal-head').insertAdjacentHTML('afterend',`<div class="discard-changes notice warning" role="alert"><p>Tienes cambios sin guardar.</p><div class="flex wrap">${btn('Seguir editando','keep-editing','secondary small','edit')}${btn('Descartar cambios','discard-modal','danger small','close')}</div></div>`);
 modal.querySelector('[data-action="keep-editing"]')?.focus();return false;
}
modal.addEventListener('cancel',ev=>{if(!canDismissModal())ev.preventDefault();});
modal.addEventListener('close',async()=>{
 if(modal.open)return;
 navigation.closeOverlay();
 const resourceId=state.activeResourceId,originRoute=state.activeResourceRoute,scroll=state.activeResourceScroll??window.scrollY,initialScope=state.activeResourceScope;
 state.activeResourceId=null;state.activeResourceRoute=null;
 detachFloatingTools();modal.replaceChildren();modalHandler=null;courseHelpUI.enhance();
 document.documentElement.classList.remove('resource-viewer-open');
 if(state.importResult)state.importResult=null;
 if(state.enrollmentReportUrl){URL.revokeObjectURL(state.enrollmentReportUrl);state.enrollmentReportUrl=null;}
 if(resourceId&&student()&&!resourceId.startsWith('academic-file-')){
  try{const learning=await api('/learning');if(navigationScope(state)!==initialScope)return;state.learning=learning;}catch{/* The material's saved progress remains available. */}
  if(route()===originRoute&&!modal.open){await render();window.scrollTo(0,scroll);document.querySelector(`[data-action="resource:${resourceId}"]`)?.focus({preventScroll:true});}
  else if(route()==='mis-cursos'&&!modal.open&&student())await render();
 }
});



document.addEventListener('input',ev=>{if(ev.target.id==='search'){const position=ev.target.selectionStart;state.query=ev.target.value;render().then(()=>{const s=document.getElementById('search');s?.focus();s?.setSelectionRange(position,position);});}});
document.addEventListener('click',async ev=>{
 if(ev.target.closest('.skip-link')){ev.preventDefault();const main=document.querySelector('main');main?.setAttribute('tabindex','-1');main?.focus();main?.scrollIntoView();return;}
 const el=ev.target.closest('[data-action]');if(!el)return;const [action,id]=el.dataset.action.split(':');if(el.disabled)return;
 const menu=el.closest('.action-menu');if(menu)menu.open=false;el.setAttribute('aria-busy','true');if(el.tagName==='BUTTON')el.disabled=true;
 try {
  if(['logout','view-mode','platform-preview','platform-activity-preview','platform-exit-preview'].includes(action)&&(!await academicsUI.beforeLeave()||modal.open&&!canDismissModal(()=>el.click())))return;
  if(action==='lab-results'){if(admin()){const rows=await api('/labs/'+id+'/results');openModal('Resultados del laboratorio',rows.map(r=>'<p>'+e(r.name||r.user_id)+' · '+e(new Date(r.created_at).toLocaleString())+'</p><pre>'+e(r.result)+'</pre>').join('')||'<p>Sin resultados registrados.</p>');}else openModal('Registrar resultados','<label>Resultados y observaciones<textarea name="result" required maxlength="10000" rows="8"></textarea></label>',async fd=>{await post('/labs/'+id+'/results',{result:fd.get('result')});modal.close();toast('Resultados guardados');});return;}
  if(action.startsWith('library-')){await libraryUI.action(action,id,el);return;}
  if(action==='platform-activity-preview'&&modal.open&&!canDismissModal(()=>platformUI.action(action,id)))return;
  if(action.startsWith('storage-')){await storageUI.action(action,id);return;}
  if(action.startsWith('platform-')){await platformUI.action(action,id);return;}
  if(action.startsWith('quick-')){await quickResourcesUI.action(action,id);return;}
  if(action.startsWith('academic-')){await academicsUI.action(action,id,el);return;}
  switch(action){
   case 'menu':toggleNavigation(!document.getElementById('sidebar').classList.contains('open'));break;
   case 'close-menu':toggleNavigation(false);break;
   case 'go':location.hash=id;break;
   case 'view-mode':if(!hasDualRole()||!['teaching','learning'].includes(id))break;state.viewMode=id;syncViewCookie();sessionStorage.setItem('aula-view-'+state.user.id,id);state.currentCourse=null;await refresh();location.hash=id==='learning'?'mis-cursos':'inicio';await render();break;
   case 'filter':state.filter=id;await render();break;
   case 'close-modal':if(canDismissModal())modal.close();break;
   case 'keep-editing':modal.querySelector('.discard-changes')?.remove();pendingModalDismiss=null;modal.querySelector('form input,form textarea,form select')?.focus();break;
   case 'discard-modal':{const done=pendingModalDismiss;pendingModalDismiss=null;modal.dataset.dirty='false';if(done)await done();else modal.close();break;}
   case 'resource-filter':state.resourceFilter=id;state.courseOpenChapters=null;if(!refreshCoursePanel())await render();break;
   case 'course-content-reset':state.resourceFilter='all';state.courseContentQuery='';state.courseOpenChapters=null;refreshCoursePanel();break;
   case 'course-login':state.afterLoginCourse=id;state.loginMode='password';location.hash='login';break;
   case 'study':{const [courseId,resourceId]=id.split('/');if(route()==='curso/'+courseId)await viewResource(resourceId);else{state.pendingResourceId=resourceId;location.hash='curso/'+courseId;}break;}
   case 'login-mode':state.loginMode=id;await render();break;
   case 'password-login':state.loginMode='password';state.afterLoginCourse=null;location.hash='login';break;
   case 'logout':await notificationsUI.beforeLogout();await post('/auth/logout');state.user=null;state.assurance=null;state.currentCourse=null;state.afterLoginCourse=null;state.pendingResourceId=null;state.loginMode='password';await refresh();location.hash='catalogo';await render();break;
   case 'new-course':courseForm();break;
   case 'edit-course':courseForm(id);break;
   case 'publish-course':{const c=findCourse(id);await patch(`/admin/courses/${id}`,{published:!c.published});await saved(c.published?'Curso guardado como borrador':'Curso publicado');break;}
   case 'delete-course':confirmAction(state.user?.roles?'Archivar':'Eliminar curso',state.user?.roles?'Se cerrará el acceso de estudiantes y se conservarán materiales, matrículas, entregas y notas. Puedes reactivarlo desde Estado.':'Se eliminarán sus capítulos, materiales y matrículas. Esta acción no se puede deshacer.',async()=>{await api(`/admin/courses/${id}`,{method:'DELETE'});location.hash='cursos';});break;
   case 'new-student':studentForm();break;
   case 'edit-student':studentForm(id);break;
   case 'reset-student':resetStudentPassword(id);break;
   case 'import-students':importStudents();break;
   case 'import-migration':importMigration();break;
   case 'csv-template':downloadText('plantilla-estudiantes.csv','\uFEFFcedula,nombre,correo\r\n');break;
   case 'export-students':if(state.importResult)downloadText('estudiantes-registrados.csv','\uFEFFcedula,nombre,acceso_inicial\r\n'+state.importResult.created.map(s=>[s.document,s.name,'Su cédula; cambio obligatorio al ingresar'].map(csvCell).join(',')).join('\r\n'));break;
   case 'new-enrollment':enrollmentForm();break;
   case 'enroll-course':enrollmentOptions(id);break;
   case 'single-enrollment':enrollmentForm(null,id);break;
   case 'bulk-enrollment':bulkEnrollmentForm(id);break;
   case 'edit-enrollment':enrollmentForm(id);break;
   case 'toggle-enrollment':{const x=state.enrollments.find(y=>y.id===id);confirmAction(x.status==='active'?'Revocar matrícula':'Reactivar matrícula',x.status==='active'?'El estudiante perderá el acceso a este curso restringido.':'Se restaurará la matrícula con sus fechas actuales.',()=>patch(`/admin/enrollments/${id}`,{status:x.status==='active'?'revoked':'active'}));break;}
   case 'new-module':moduleForm(null,id);break;
   case 'publish-module':{const m=allModules().find(x=>x.id===id);await patch(`/admin/modules/${id}`,{published:!m.published});await saved(m.published?'Capítulo oculto para estudiantes':'Capítulo publicado. Solo se mostrarán sus contenidos publicados.');break;}
   case 'publish-resource':{const r=findResource(id);await patch(`/admin/resources/${id}`,{published:!r.published});await saved(r.published?'Material guardado como borrador':'Material publicado. Será visible si su capítulo y curso están publicados.');break;}
   case 'edit-module':moduleForm(id);break;
   case 'delete-module':confirmAction('Eliminar capítulo','También se eliminarán los recursos de este capítulo.',()=>api(`/admin/modules/${id}`,{method:'DELETE'}));break;
   case 'new-resource':resourceForm(null,id);break;
   case 'edit-resource':resourceForm(id);break;
   case 'delete-resource':confirmAction('Eliminar material','Este material dejará de estar disponible para los estudiantes.',()=>api(`/admin/resources/${id}`,{method:'DELETE'}));break;
   case 'resource':await viewResource(id);break;
   case 'library-add':location.hash='cursos';toast('Abre un curso y añade materiales en sus capítulos');break;
   case 'complete':{const completed=!state.progress.some(x=>x.resourceId===id&&x.completed);const updated=await api(`/progress/${id}`,{method:'PUT',body:{completed}});state.progress=state.progress.filter(p=>p.resourceId!==id).concat(updated);modal.close();toast(completed?'Material completado':'Material marcado como pendiente');break;}
   case 'change-password':openModal('Cambiar contraseña',`<div class="form-stack"><label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="256"></label><label>Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" minlength="${state.user?.roles?.some(r=>r!=='student')?12:4}" maxlength="256" required><span class="field-hint">Usa al menos ${state.user?.roles?.some(r=>r!=='student')?12:4} caracteres.${admin()?'':' Debe ser diferente de tu cédula.'}</span></label><label>Repite la nueva contraseña<input name="confirmPassword" type="password" autocomplete="new-password" minlength="${state.user?.roles?.some(r=>r!=='student')?12:4}" maxlength="256" required></label></div>`,async fd=>{const data=values(fd);if(data.newPassword!==data.confirmPassword)throw new Error('Las contraseñas no coinciden.');await post('/auth/password',data);await notificationsUI.beforeLogout();await post('/auth/logout');state.user=null;state.assurance=null;modal.close();state.loginMode='password';location.hash='login';await render();toast('Contraseña actualizada. Ingresa nuevamente.');});break;
   case 'recovery-help':openModal('Recuperar mi acceso',`<p class="small-paragraph">Solicita a tu docente que restablezca tu acceso. Cuando lo haga, ingresa en <strong>Con contraseña</strong> usando tu cédula como usuario y contraseña. El aula te pedirá elegir una nueva.</p><div class="learning-contact">${contactTeacher()}</div><div class="form-actions">${btn('Entendido','close-modal')}</div>`);break;
   case 'help':openModal(admin()?'Tu aula, paso a paso':'Tu aprendizaje, paso a paso',`<div class="steps">${quickGuide(state.user?.role).map(([t,c],i)=>`<div class="step"><span class="step-number">${i+1}</span><div><strong>${e(t)}</strong><p>${e(c)}</p></div></div>`).join('')}</div><div class="form-actions">${btn('Entendido','close-modal')}</div>`);break;
   case 'reload':await boot();break;
  }
 }catch(err){toast(err.message);}finally{el.removeAttribute('aria-busy');if(el.tagName==='BUTTON')el.disabled=false;}
});
async function boot() {
 try { const [status,session,settings]=await Promise.all([api('/status'),api('/auth/me'),api('/settings')]);Object.assign(state,session,{settings,setupRequired:status.setupRequired});setInitialView();await refresh();await render(); }
 catch(error){app.innerHTML=publicShell(heading('No pudimos conectar con el aula','Intenta nuevamente en unos momentos. Si el problema continúa, comunícate con tu docente.')+btn('Volver a intentar','reload','secondary','arrow'));}
}
const quickResourcesUI=createQuickResourcesUI({api,getState:()=>state,openModal,openResourceViewer,modal,render,toast,btn,icon});
observeUI();
const libraryUI=createLibraryUI({api,getState:()=>state,openModal,modal,render,refresh,toast,btn,heading});
const chatUI=createChatUI({api,getState:()=>state,heading,toast,openModal,render,onPolicyChanged:()=>communityUI.tick(true)});
const notificationsUI=createNotificationsUI({api,getState:()=>state,heading,toast,render});
const courseHelpUI=createCourseHelpUI({api,getState:()=>state,onAsk:(teacherId,context,groupId)=>chatUI.openTeacherQuestion(teacherId,context,groupId),toast});
const communityUI=createCommunityUI({api,getState:()=>state,heading,toast});
const panoramaUI=createPanoramaUI({api,heading,getState:()=>state});
const analyticsUI=createAnalyticsUI({api,heading,getState:()=>state});
const engagementTracker=createEngagementTracker({api,getState:()=>state});
const platformUI=createPlatformUI({api,getState:()=>state,openModal,modal,render,refresh,toast,btn,heading,courseCard});
const storageUI=createStorageUI({api,getState:()=>state,heading,btn,icon,openModal,render,toast,modal});
const academicsUI=createAcademicUI({openResourceViewer,api,getState:()=>state,openModal,canDismissModal,isNavigationRestore:()=>navigation.hasSnapshot(),toast,render,modal,btn,icon,heading,empty});
const navigation=createNavigation({getState:()=>state,getRoute:route,render,isModalOpen:()=>modal.open,closeModal:()=>modal.close(),beforeLeave:async({retry})=>{
 if(!await academicsUI.beforeLeave())return false;
 return !modal.open||canDismissModal(()=>{modal.dataset.dirty='false';modal.close();retry();});
}});
navigation.start();
boot();





document.addEventListener('input',event=>{if(!event.target.matches('[data-course-search]')||event.isComposing)return;state.courseContentQuery=event.target.value;state.courseOpenChapters=null;refreshCoursePanel({searchFocus:true});});
document.addEventListener('click',event=>{const button=event.target.closest('[data-course-expand]');if(!button)return;const chapters=[...document.querySelectorAll('.course-chapter')],expand=chapters.some(chapter=>!chapter.open);chapters.forEach(chapter=>chapter.open=expand);button.textContent=expand?'Contraer todo':'Expandir todo';});
document.addEventListener('toggle',event=>{if(!event.target.matches?.('.course-chapter')||!document.contains(event.target))return;const chapters=[...document.querySelectorAll('.course-chapter')],button=document.querySelector('[data-course-expand]');state.courseOpenChapters=new Set(chapters.filter(chapter=>chapter.open).map(chapter=>chapter.dataset.moduleId));if(button)button.textContent=chapters.length&&chapters.every(chapter=>chapter.open)?'Contraer todo':'Expandir todo';},true);
