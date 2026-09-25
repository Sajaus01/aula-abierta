import {escapeHtml as e} from './lib.js';
const icons = {
 book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3V4h1zm9 3a3 3 0 0 1 3-3h6v15h-5a4 4 0 0 0-4 2',
 grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9',
 check:'m5 12 4 4L19 6', plus:'M12 5v14M5 12h14', arrow:'M5 12h14m-5-5 5 5-5 5', chevron:'m9 6 6 6-6 6',
 file:'M14 2H5v20h14V7zm0 0v5h5M8 12h8M8 16h6', video:'m10 8 6 4-6 4zM3 4h18v16H3z',
 image:'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M8 7h.01', folder:'M3 5h7l2 2h9v13H3z',
 lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3', globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 3-2 3 1 3-3 3-3 1-1 3H9l-1-3-3-1-2-3 1-3-1-3 3-3 3-1z',
 logout:'M9 3H3v18h6M9 12h12m-4-4 4 4-4 4', search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 6 6',
 upload:'M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6', download:'M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4',
 edit:'m15 4 5 5M4 16 17 3l4 4L8 20l-5 1z', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
 close:'m6 6 12 12M6 18 18 6', help:'M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 cap:'m2 9 10-5 10 5-10 5zM6 11v7c4 3 8 3 12 0v-7M22 9v8', mail:'M3 5h18v14H3zm0 0 9 8 9-8',
 calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 11h16', menu:'M4 6h16M4 12h16M4 18h16', code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
 clock:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', link:'m10 13 4-4M7 14l-2 2a3 3 0 0 0 4 4l4-4M11 8l4-4a3 3 0 0 1 4 4l-2 2',
 more:'M5 12h.01M12 12h.01M19 12h.01', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6', copy:'M9 9h12v12H9zM5 15H3V3h12v2', chart:'M3 3v18h18M7 16v-5m5 5V7m5 9V4', archive:'M3 3h18v5H3zM5 8v13h14V8M9 12h6', back:'M19 12H5m5-5-5 5 5 5', save:'M3 3h15l3 3v15H3zM7 3v6h10V3M7 21v-8h10v8', play:'m8 4 12 8-12 8z', up:'M12 20V4m-6 6 6-6 6 6', down:'M12 4v16m-6-6 6 6 6-6', palette:'M12 3a9 9 0 0 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5a3 3 0 0 0 3-3 9 9 0 0 0-9-7M7 8h.01M12 6h.01M17 8h.01M5 13h.01', shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6'
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.file}"/></svg>`;

export function actionIcon(action='',label='') {
 const value=(action+' '+label).toLowerCase();
 const choices=[[/close|cancelar|cerrar|salir de vista/,'close'],[/preview|vista previa|vista estudiante/,'eye'],[/delete|eliminar|retirar|revocar/,'trash'],[/archive|archivar/,'archive'],[/clone|copy|copiar|duplicar/,'copy'],[/appearance|apariencia/,'palette'],[/staff|docentes|colaboradores|usuarios|perfil|estudiantes/,'users'],[/enroll|matricul/,'cap'],[/library-save|guardar en biblioteca/,'folder'],[/library|biblioteca|existente/,'folder'],[/settings|estado|configur|cortes|evaluaci/,'settings'],[/\bup\b|subir pregunta/,'up'],[/\bdown\b|bajar/,'down'],[/download|descarg|export/,'download'],[/import|upload|subir/,'upload'],[/password|contraseña|recover|recuperar/,'lock'],[/roles|permisos/,'shield'],[/publish|publicar|ocultar|compartir/,'globe'],[/new|add|crear|añadir|agregar/,'plus'],[/edit|editar|modificar|cambiar/,'edit'],[/save|guardar|confirmar|aplicar|complet|entendido/,'check'],[/back|volver|anterior/,'back'],[/nota|calific|estadíst|seguimiento|panorama/,'chart'],[/actividades|cuestionario|pregunta/,'edit'],[/continuar|retomar|comenzar/,'play'],[/curso|material/,'book'],[/search|buscar|filtr/,'search'],[/help|ayuda|guía/,'help']];
 return choices.find(([pattern])=>pattern.test(value))?.[1]||'arrow';
}
export const button=(text,action,style='',glyph='')=>`<button type="button" class="btn ${style}" data-action="${e(action)}">${icon(glyph||actionIcon(action,text))}${text}</button>`;

export function navigationItems(user,preview=false){
 if(user?.role!=='admin'||preview)return [['mis-cursos','cap','Mi aprendizaje'],['tareas','edit','Mis actividades'],['catalogo','book','Explorar cursos']];
 const modern=!!user.roles,global=user.roles?.some(r=>r==='master'||r==='admin');
 return [['inicio','grid','Resumen'],['cursos','book',modern?'Cursos plantilla':'Mis cursos'],...(modern?[['grupos','users','Grupos']]:[]),['estudiantes','cap','Estudiantes'],['matriculas','check','Matrículas'],['tareas','edit','Actividades y notas'],['biblioteca','folder','Biblioteca'],...(global?[['usuarios','shield','Usuarios y roles']]:[]),...(modern?[['panorama','chart','Panorama']]:[])];
}

export function courseEntryActions(course,learning){
 return `<a class="btn small" href="#curso/${e(course.id)}">${icon('book')}Abrir curso</a>`+(!course.locked&&learning?.nextResource&&learning.opened?button('Continuar',`study:${course.id}/${learning.nextResource.id}`,'secondary small','play'):'');
}

export function manageableGroups(courses,currentId){
 return courses.filter(c=>(!c.entityKind||c.entityKind==='group')&&c.id!==currentId&&c.lifecycle!=='archived'&&(!c.permissions||c.permissions.manage));
}

export function validatePeriods(periods){
 if(periods.length>12)throw Error('Puedes configurar hasta 12 cortes.');
 const ids=new Set();
 for(const p of periods){if(!p.title.trim())throw Error('Escribe un nombre para cada corte.');if(!Number.isFinite(p.weight)||p.weight<0||p.weight>100)throw Error('El porcentaje de cada corte debe estar entre 0 y 100.');if(ids.has(p.id))throw Error('Hay un corte repetido.');ids.add(p.id);}
 if(periods.length&&Math.abs(periods.reduce((sum,p)=>sum+p.weight,0)-100)>0.001)throw Error('Los porcentajes de los cortes deben sumar 100 %.');
 return periods;
}

function decorate(root){
 for(const el of root.querySelectorAll('.btn,.text-button,.nav-link')){
  if(el.querySelector('svg')||!el.textContent.trim()||el.classList.contains('tab')||el.closest('.viewer-heading'))continue;
  el.insertAdjacentHTML('afterbegin',icon(actionIcon(el.dataset.action,el.textContent)));
 }
 for(const el of root.querySelectorAll('.icon-btn[aria-label]'))if(!el.title)el.title=el.getAttribute('aria-label');
}
function actionMenu(container,nodes,label){
 if(!nodes.length||container.querySelector(':scope > .action-menu'))return;
 const details=document.createElement('details');details.className='action-menu';
 details.innerHTML=`<summary aria-label="${e(label)}" title="${e(label)}">${icon('more')}<span>Opciones</span></summary><div class="action-menu-popover"></div>`;
 const list=details.lastElementChild;
 for(const node of nodes){
  if(node.classList.contains('icon-btn')){const name=node.getAttribute('aria-label')||node.title;node.insertAdjacentHTML('beforeend',`<span>${e(name.replace(/ (recurso|actividad|capítulo).*$/,''))}</span>`);node.classList.replace('icon-btn','btn');node.classList.add('ghost','small');}
  if(/delete|revok/.test(node.dataset.action||''))node.classList.add('danger');list.append(node);
 }
 container.append(details);
}
export function enhanceUI(root){
 decorate(root);
 if(root.id==='app')document.documentElement.classList.remove('navigation-open');
 for(const head of root.querySelectorAll('.section-head')){
  const actions=[...head.children].filter(el=>el.matches('button.btn,a.btn'));
  if(actions.length>1){const group=document.createElement('div');group.className='heading-actions';for(const action of actions)group.append(action);head.append(group);}
 }
 // Move existing controls (with their original actions) into compact, accessible menus.
 for(const module of root.querySelectorAll('.publication-module')){
  const head=module.querySelector('.module-head'),controls=head?.querySelector(':scope > .flex');
  if(controls&&!module.querySelector('.module-add')){
   const creation=[...controls.querySelectorAll(':scope > [data-action]')].filter(b=>/^(new-resource|academic-new-module|library-pick):/.test(b.dataset.action));
   if(creation.length){const footer=document.createElement('div');footer.className='module-add';for(const b of creation)footer.append(b);module.append(footer);}
   actionMenu(controls,[...controls.children].filter(n=>n.hasAttribute('data-action')),'Opciones del capítulo '+(head.querySelector('h3')?.textContent||''));
  }
 }
 for(const row of root.querySelectorAll('.resource-row')){
  const nodes=[...row.children].filter(n=>/^(publish-resource|edit-resource|delete-resource|academic-edit|academic-delete|library-save|library-share):/.test(n.dataset?.action||''));
  actionMenu(row,nodes,'Opciones de '+(row.querySelector('strong')?.textContent||'contenido'));
 }
}
export function observeUI(){
 const observer=new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node.nodeType===1){if(node.matches('.btn,.nav-link,.text-button'))decorate(node.parentElement);else decorate(node);}});
 observer.observe(document.body,{childList:true,subtree:true});
 document.addEventListener('click',event=>{for(const menu of document.querySelectorAll('.action-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
 document.addEventListener('toggle',event=>{const current=event.target;if(current.matches?.('.action-menu[open]'))for(const menu of document.querySelectorAll('.action-menu[open]'))if(menu!==current)menu.open=false;},true);
 document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const menu=event.target.closest?.('.action-menu[open]');if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();}});
 document.addEventListener('keydown',event=>{
  const sidebar=document.querySelector('.sidebar.open');if(!sidebar)return;
  if(event.key==='Escape'){event.preventDefault();toggleNavigation(false);return;}
  if(event.key!=='Tab')return;const items=[...sidebar.querySelectorAll('a[href],button:not(:disabled)')].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 });
 window.addEventListener('resize',()=>{if(innerWidth>800&&document.querySelector('.sidebar.open'))toggleNavigation(false);});
}

export function toggleNavigation(open){
 const sidebar=document.getElementById('sidebar');if(!sidebar)return;
 sidebar.classList.toggle('open',open);document.documentElement.classList.toggle('navigation-open',open);
 for(const el of document.querySelectorAll('.workspace>main,.workspace>.topbar'))el.inert=open;
 const button=document.querySelector('[data-action=menu]');button?.setAttribute('aria-expanded',String(open));
 if(open)sidebar.querySelector('[data-action=close-menu]')?.focus();else button?.focus();
}
