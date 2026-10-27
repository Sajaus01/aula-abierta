import test from 'node:test';
import assert from 'node:assert/strict';
import {teacherCourseModel,renderTeacherCoursePanel,bindTeacherCoursePanel} from '../public/teacher-course-panel.js';

function fixture(){return {id:'group',title:'Circuitos',description:'Materiales y actividades del grupo.',entityKind:'group',groupCode:'A',cohort:'2035-1',lifecycle:'active',published:true,chapterOrder:'desc',accessMode:'password',coverUrl:'https://example.com/cover.png',permissions:{edit:true,grade:true,manage:true},modules:[{id:'advanced',title:'Simulación',position:20,published:false,resources:[{id:'resource-two',title:'Modelo avanzado',kind:'lab',published:true,position:2},{id:'resource-one',title:'Guía inicial',kind:'pdf',published:false,position:0}]},{id:'basics',title:'Fundamentos',position:3,published:true,resources:[{id:'reading',title:'Magnitudes y unidades',kind:'html',published:true,position:0}]}],activities:[{id:'draft',moduleId:'advanced',title:'Diseña el experimento',kind:'task',weight:30,status:'draft'},{id:'quiz',moduleId:'basics',title:'Comprueba tus conocimientos',kind:'quiz',weight:70,status:'published'},{id:'general',moduleId:null,title:'Reto general',kind:'task',weight:0,status:'archived'}]};}
const chapter=(html,id)=>{const start=html.indexOf('data-module-id="'+id+'"');assert.notEqual(start,-1);return html.slice(html.lastIndexOf('<details',start),html.indexOf('<div class="teacher-chapter-body">',start));};

test('teacher header uses the course cover and factual content counts without learner progress',()=>{
 const html=renderTeacherCoursePanel(fixture(),{enrollmentCount:0});
 assert.match(html,/data-teacher-course-panel/);assert.match(html,/teacher-course-header/);assert.match(html,/src="https:\/\/example.com\/cover.png"/);
 assert.match(html,/2 capítulos/);assert.match(html,/3 materiales/);assert.match(html,/3 actividades/);assert.match(html,/0 matrículas activas/);
 assert.doesNotMatch(html,/aria-valuenow|Avance total|Tu avance|Completado|materiales completados/);
 assert.doesNotMatch(renderTeacherCoursePanel(fixture()),/matrículas activas/,'an absent enrollment total must not become an invented zero');
});

test('all existing creation, edition, publication and management actions remain available with full permission',()=>{
 const html=renderTeacherCoursePanel(fixture());
 for(const action of ['new-module:group','academic-new:group','edit-course:group','publish-course:group','platform-clone:group','platform-staff:group','platform-state:group','platform-appearance:group','platform-preview:group','platform-delete-course:group','enroll-course:group','new-resource:advanced','academic-new-module:advanced','edit-module:advanced','publish-module:advanced','delete-module:advanced','resource:resource-one','edit-resource:resource-one','publish-resource:resource-one','delete-resource:resource-one','academic-edit:draft','academic-publication:draft','academic-delete:draft'])assert.ok(html.includes('data-action="'+action+'"'),action);
 assert.match(html,/data-course-chapter-order="group"/);assert.match(html,/value="desc" selected/);assert.match(html,/#estadisticas\/group/);assert.match(html,/#calificaciones\/group/);
});

test('destructive actions live in Options rather than in content rows or primary controls',()=>{
 const html=renderTeacherCoursePanel(fixture()),outside=html.replace(/<details class="action-menu teacher-options">[\s\S]*?<\/details>/g,'');
 assert.match(html,/data-action="delete-module:/);assert.match(html,/data-action="delete-resource:/);assert.match(html,/data-action="academic-delete:/);
 assert.doesNotMatch(outside,/data-action="(?:delete-|academic-delete|platform-delete)/);
 assert.doesNotMatch(html,/publication-module|module-head[^>]*>\s*<div class="flex/,'legacy control folding must not change the teacher layout');
});

test('scope permissions independently control content editing, grades and group management',()=>{
 const data=fixture();
 const readonly=renderTeacherCoursePanel(data,{permissions:{}});assert.doesNotMatch(readonly,/data-action="(?:new-|edit-|publish-|delete-|academic-new|academic-edit|academic-delete|academic-publication|enroll-|platform-(clone|staff|state|appearance|delete))/);assert.doesNotMatch(readonly,/#calificaciones|#estadisticas|data-course-chapter-order/);assert.match(readonly,/resource:resource-one/);assert.match(readonly,/#actividad\/draft/);
 const grader=renderTeacherCoursePanel(data,{permissions:{grade:true}});assert.match(grader,/#calificaciones\/group/);assert.match(grader,/#estadisticas\/group/);assert.doesNotMatch(grader,/data-action="new-module|data-action="edit-module|data-action="enroll-course/);
 const manager=renderTeacherCoursePanel(data,{permissions:{manage:true}});assert.match(manager,/enroll-course:group/);assert.match(manager,/platform-staff:group/);assert.doesNotMatch(manager,/academic-new:|#calificaciones|data-course-chapter-order/);
});

test('templates show authorized linked groups and keep enrollment actions out of the template',()=>{
 const data={...fixture(),id:'template',entityKind:'template'};
 const html=renderTeacherCoursePanel(data,{linkedGroups:[{id:'authorized',title:'Grupo autorizado',cohort:'2035-2',groupCode:'B',lifecycle:'draft'}]});
 assert.match(html,/Crear grupo/);assert.match(html,/#curso\/authorized/);assert.match(html,/Grupos vinculados/);assert.doesNotMatch(html,/enroll-course:template|platform-preview:template|#estadisticas\/template/);
 assert.doesNotMatch(renderTeacherCoursePanel(data),/authorized/,'linked groups must come only from the authorized caller data');
});

test('manual positions supply canonical numbering while server order remains intact',()=>{
 const data=fixture(),before=JSON.stringify(data),model=teacherCourseModel(data),html=renderTeacherCoursePanel(data);
 assert.deepEqual(model.chapters.map(module=>[module.id,module.number]),[['advanced',2],['basics',1]]);
 assert.deepEqual(model.chapters[0].resources.map(item=>item.id),['resource-two','resource-one']);
 assert.ok(html.indexOf('data-module-id="advanced"')<html.indexOf('data-module-id="basics"'));assert.ok(html.indexOf('data-action="resource:resource-two"')<html.indexOf('data-action="resource:resource-one"'));assert.equal(JSON.stringify(data),before);
 assert.match(chapter(html,'advanced'),/>02<\/span>/);assert.match(chapter(html,'basics'),/>01<\/span>/);
});

test('draft content stays visible, and its parent visibility is described without marking it published to students',()=>{
 const html=renderTeacherCoursePanel(fixture());assert.match(html,/Capítulo en borrador/);assert.match(html,/Publicado · capítulo oculto/);assert.match(html,/Diseña el experimento/);assert.match(html,/Archivada/);
 const model=teacherCourseModel(fixture(),{filter:'drafts'});assert.equal(model.chapters[0].visible,true);assert.equal(model.chapters[0].resources[0].visible,true);assert.equal(model.chapters[1].visible,false);assert.equal(model.general[0].visible,true);
});

test('search matches accents, chapters, activity type and unassigned activities without changing the source',()=>{
 const data=fixture(),before=JSON.stringify(data);
 let model=teacherCourseModel(data,{query:'simulacion'});assert.equal(model.chapters[0].visible,true);assert.ok(model.chapters[0].resources.every(row=>row.visible));assert.equal(model.chapters[1].visible,false);
 model=teacherCourseModel(data,{filter:'activities',query:'cuestionario'});assert.equal(model.chapters[1].activities[0].visible,true);assert.ok(model.chapters.every(module=>module.resources.every(row=>!row.visible)));
 model=teacherCourseModel(data,{query:'Reto general'});assert.equal(model.general[0].visible,true);assert.ok(model.chapters.every(module=>!module.visible));assert.equal(JSON.stringify(data),before);
});

test('library slots avoid duplicate buttons while preserving copy destinations',()=>{
 const html=renderTeacherCoursePanel(fixture());
 assert.match(html,/data-teacher-library-slot="module" data-course="group"/);assert.match(html,/data-teacher-library-slot="activity" data-course="group"/);
 assert.match(html,/data-teacher-library-slot="resource" data-module="advanced"/);assert.match(html,/data-teacher-library-slot="activity" data-module="advanced"/);
 assert.doesNotMatch(html,/data-action="library-(?:pick|save)/,'the existing library integration owns inserted actions');
});

test('course, chapter and material strings are escaped and unsafe covers are rejected',()=>{
 const data=fixture();data.title='<img src=x onerror=bad()>';data.description='<script>bad()</script>';data.modules[0].title='</h3><script>bad()</script>';data.modules[0].resources[0].title='" onmouseover="bad()';data.coverUrl='javascript:bad()';
 const html=renderTeacherCoursePanel(data);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&quot; onmouseover=&quot;bad\(\)/);assert.doesNotMatch(html,/<script>|<img src=x|src="javascript:/);
});

test('explicit chapter expansion and callback HTML do not introduce learner-specific claims',()=>{
 const data=fixture(),html=renderTeacherCoursePanel(data,{openChapters:new Set(['basics']),quickResourcesHTML:'<section class="panel quick-resources">Recursos de apoyo</section>',courseLinksHTML:'<a href="#actividades/group">Gestionar actividades</a>'});
 assert.doesNotMatch(chapter(html,'advanced').split('>')[0],/\bopen\b/);assert.match(chapter(html,'basics').split('>')[0],/\bopen\b/);assert.match(html,/Recursos de apoyo/);assert.match(html,/Gestionar actividades/);assert.doesNotMatch(html,/avance|porcentaje completado/i);
});

test('legacy management keeps its course actions without unsupported platform administration',()=>{
 const html=renderTeacherCoursePanel({...fixture(),entityKind:undefined},{legacy:true,permissions:{edit:true,grade:true,manage:true}});
 assert.match(html,/data-action="edit-course:group"/);assert.match(html,/data-action="publish-course:group"/);assert.match(html,/data-action="delete-course:group"/);assert.doesNotMatch(html,/data-action="platform-|data-course-chapter-order/);
});

test('modern group announcements and presence have compact integration targets without duplicate header injection',()=>{
 const html=renderTeacherCoursePanel(fixture());assert.equal((html.match(/id="course-presence"/g)||[]).length,1);assert.match(html,/class="course-notification-entry" href="#notificaciones\?course=group"/);assert.match(html,/data-course-notification-count="group" hidden/);
 const header=html.slice(html.indexOf('<header class="course-header'),html.indexOf('</header>'));assert.match(header,/course-notification-entry/);assert.doesNotMatch(header,/id="course-presence"/,'presence belongs to the compact overview rather than a separate header block');
 for(const options of [{legacy:true},{}]){const data=options.legacy?fixture():{...fixture(),entityKind:'template'};const absent=renderTeacherCoursePanel(data,options);assert.doesNotMatch(absent,/id="course-presence"|course-notification-entry|data-course-notification-count/);}
});

function node(dataset={}){return {dataset,hidden:false,open:false,value:'',textContent:'',listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},querySelector(){return null;},querySelectorAll(){return [];}};}

test('evaluation signals and filters are confined to authorized teacher activity rows',()=>{
 const data=fixture();data.activities[1].evaluation={state:'pending',submitted:3,evaluated:2,pending:1,unreleased:1,returned:0};
 const html=renderTeacherCoursePanel(data);
 assert.match(html,/data-activity-evaluation-state="pending"/);assert.match(html,/>Por calificar</);assert.match(html,/value="evaluated"/);
 assert.match(chapter(html,'basics'),/por calificar/i,'the collapsed chapter exposes its activity evaluation summary');
 const readonly=renderTeacherCoursePanel(data,{permissions:{view:true},filter:'pending'});
 assert.doesNotMatch(readonly,/data-activity-evaluation-state|activity-evaluation|value="pending"|value="evaluated"|value="correction"/);
 assert.match(readonly,/data-teacher-course-filter><option value="all" selected/,'a saved grading filter cannot hide content after permission loss');
 assert.doesNotMatch(renderTeacherCoursePanel(fixture()),/data-activity-evaluation-state/,'a publication badge or absent summary cannot imply evaluation');
});

test('evaluation filtering preserves chapter order and excludes materials and other evaluation states',()=>{
 const data=fixture(),pending={state:'pending',submitted:1,evaluated:0,pending:1,unreleased:0,returned:0};
 data.activities[1].evaluation=pending;data.activities[2]={...data.activities[2],status:'published',evaluation:{...pending,state:'evaluated',evaluated:1,pending:0}};
 const before=JSON.stringify(data),model=teacherCourseModel(data,{filter:'pending'});
 assert.deepEqual(model.chapters.map(item=>item.id),['advanced','basics']);assert.equal(model.chapters[1].activities[0].visible,true);
 assert.ok(model.chapters.every(item=>item.resources.every(resource=>!resource.visible)));assert.equal(model.general[0].visible,false);
 assert.equal(teacherCourseModel(data,{filter:'evaluated'}).general[0].visible,true);assert.equal(JSON.stringify(data),before);
});
test('local filtering retains draft rows and restores expansion without API calls or navigation',()=>{
 const search=node(),filter=node(),expand=node(),count=node(),empty=node(),row=node({teacherSearch:'simulacion guia',teacherKind:'material',teacherDraft:'true'}),activity=node({teacherSearch:'simulacion ejercicio',teacherKind:'activity',teacherDraft:'true'}),chapterNode=node({moduleId:'m',teacherTitle:'simulacion',teacherDraft:'true'}),chapterEmpty=node();filter.value='all';
 chapterNode.querySelectorAll=()=>[row,activity];chapterNode.querySelector=selector=>selector==='[data-teacher-chapter-empty]'?chapterEmpty:row;
 const nodes={'[data-teacher-course-search]':search,'[data-teacher-course-filter]':filter,'[data-teacher-course-expand]':expand,'[data-teacher-visible-count]':count,'[data-teacher-filter-empty]':empty};
 const panel=node({teacherOpenIds:'["m"]'});panel.querySelector=selector=>nodes[selector]||null;panel.querySelectorAll=selector=>selector==='[data-teacher-chapter]'?[chapterNode]:selector==='[data-teacher-item]'?[row,activity]:[];
 const root={querySelectorAll:()=>[panel]},events=[];bindTeacherCoursePanel(root,{onQuery:value=>events.push(['query',value]),onFilter:value=>events.push(['filter',value]),onOpenChapters:value=>events.push(['open',[...value]])});
 assert.equal(chapterNode.open,true);search.value='SIMULACIÓN';search.listeners.get('input')();assert.equal(chapterNode.hidden,false);assert.equal(activity.hidden,false);
 filter.value='activities';filter.listeners.get('change')();assert.equal(row.hidden,true);assert.equal(activity.hidden,false);
 filter.value='drafts';filter.listeners.get('change')();assert.equal(row.hidden,false);assert.equal(activity.hidden,false);
 search.value='no existe';search.listeners.get('input')();assert.equal(chapterNode.hidden,true);assert.equal(empty.hidden,false);
 search.value='';filter.value='all';search.listeners.get('input')();assert.equal(chapterNode.open,true);assert.equal(count.hidden,true);
 expand.listeners.get('click')();assert.equal(chapterNode.open,false);assert.deepEqual(events.at(-1),['open',[]]);
 assert.deepEqual(events[0],['query','SIMULACIÓN']);
});
