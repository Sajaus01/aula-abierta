import {escapeHtml as e,safeUrl} from './lib.js';
import {icon} from './ui.js';

const labels={draft:'Borrador',published:'Publicada',archived:'Archivada'};
const fmt=n=>Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:2});
const dateInput=v=>{if(!v)return '';const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const button=(label,attr,glyph,style='secondary small')=>`<button type="button" class="btn ${style}" ${attr}>${icon(glyph)}${label}</button>`;
const section=(id,title,description,body)=>`<section class="editor-section form-stack" id="editor-${id}" data-editor-section="${id}" ${id==='details'?'':'hidden'} aria-labelledby="editor-heading-${id}"><header class="editor-section-heading"><h3 id="editor-heading-${id}" tabindex="-1">${title}</h3><p>${description}</p></header>${body}</section>`;

export function weightSummary(activities,id,periodId,weight,status){
 const used=activities.filter(a=>a.id!==id&&a.status==='published'&&(a.periodId||'')===(periodId||'')).reduce((n,a)=>n+Number(a.weight),0);
 const total=used+(status==='published'?Number(weight)||0:0);
 return {used,total,remaining:Math.max(0,100-used),exceeded:total>100.00001};
}
export function dateProblem({opensAt,dueAt,closesAt,allowLate}){
 if(opensAt&&dueAt&&opensAt>=dueAt)return {field:'dueAt',message:'La fecha de entrega debe ser posterior a la apertura.'};
 if(opensAt&&closesAt&&opensAt>=closesAt)return {field:'closesAt',message:'El cierre definitivo debe ser posterior a la apertura.'};
 if(dueAt&&closesAt&&dueAt>closesAt)return {field:'closesAt',message:'El cierre definitivo no puede ser anterior a la fecha de entrega.'};
 if(allowLate&&!dueAt)return {field:'dueAt',message:'Define una fecha de entrega para aceptar envíos tardíos.'};
 return null;
}
export function evaluationStructure(a){return JSON.stringify({kind:a.kind,maxPoints:Number(a.maxPoints),questions:(a.kind==='quiz'?a.questions:[]).map(q=>({id:q.id,type:q.type,options:q.type==='text'?[]:q.options,correct:q.type==='text'?[]:[...q.correct].sort((a,b)=>a-b),points:Number(q.points)}))});}
export function optionRow(value,correct,type,id,i){return `<div class="editor-option"><label class="editor-correct"><input type="${type==='multiple'?'checkbox':'radio'}" name="correct-${e(id)}" data-correct ${correct?'checked':''} aria-label="Opción ${i+1} correcta"><span data-option-letter>${String.fromCharCode(65+i)}</span></label><input data-option-text aria-label="Texto de opción ${i+1}" value="${e(value)}" maxlength="1000" placeholder="Escribe una respuesta">${button('',`data-remove-option aria-label="Quitar opción ${i+1}"`,'close','ghost small')}</div>`;}
export function renderQuestion(q={},n=1){
 q={id:crypto.randomUUID(),type:'single',prompt:'',options:['',''],correct:[],points:1,...q};
 const options=q.options.length?q.options:['',''];
 return `<fieldset class="academic-question-editor" data-question="${e(q.id)}"><legend data-question-number>Pregunta ${n}</legend><div class="editor-question-toolbar">${button('Subir','data-action="academic-question-up"','up','ghost small')}${button('Bajar','data-action="academic-question-down"','down','ghost small')}${button('Duplicar','data-action="academic-question-copy"','copy','ghost small')}${button('Quitar','data-action="academic-remove-question"','trash','danger small')}</div><label>Enunciado<textarea name="qPrompt" rows="3" maxlength="3000" required placeholder="¿Qué debe resolver el estudiante?">${e(q.prompt)}</textarea></label><div class="form-grid"><label>Tipo de respuesta<select name="qType"><option value="single" ${q.type==='single'?'selected':''}>Una respuesta correcta</option><option value="multiple" ${q.type==='multiple'?'selected':''}>Varias respuestas correctas</option><option value="text" ${q.type==='text'?'selected':''}>Respuesta abierta · revisión manual</option></select></label><label>Puntos de esta pregunta<input name="qPoints" type="number" min="0.1" max="1000" step="0.1" required value="${q.points}"></label></div><div data-options ${q.type==='text'?'hidden':''}><p class="field-hint" data-option-hint>Marca la respuesta correcta a la izquierda de cada opción.</p><div data-option-list>${options.map((v,i)=>optionRow(v,q.correct.includes(i),q.type,q.id,i)).join('')}</div>${button('Añadir opción','data-add-option','plus')}<textarea name="qOptions" hidden>${e(options.join('\n'))}</textarea><input type="hidden" name="qCorrect" value="${q.correct.map(i=>i+1).join(',')}"></div><p class="field-hint" data-manual-hint ${q.type!=='text'?'hidden':''}>El estudiante escribirá su respuesta. La calificarás manualmente.</p><div data-question-extras></div></fieldset>`;
}

export function activityForm(a,c,{modern=false,fileCards,savedFiles,acceptedFiles,questionEditor}){
 const steps=[['details','Detalles','edit'],['content','Contenido','file'],['delivery','Entrega','upload'],['grading','Calificación','chart'],['publication','Publicación','calendar'],...(a.id?[['changes','Cambios','settings']]:[])];
 return `<div class="activity-editor-layout"><aside class="editor-sidebar"><p class="editor-course">${icon('book')}<span>${e(c.title)}</span></p><nav aria-label="Configuración de la actividad">${steps.map(([id,label,glyph],i)=>`<button type="button" data-editor-go="${id}" aria-controls="editor-${id}" ${i===0?'aria-current="step"':''}>${icon(glyph)}<span>${i+1}. ${label}</span></button>`).join('')}</nav><div class="editor-summary" aria-label="Resumen de la actividad"></div></aside><div class="editor-workspace">
 ${section('details','Identifica la actividad','Empieza por el título, la forma de responder y el lugar donde aparecerá.',`<label>Título de la actividad <span class="field-hint">Obligatorio</span><input name="title" value="${e(a.title)}" required maxlength="180" placeholder="Ej. Taller de la unidad 1"></label><label>Tipo de actividad<select name="kind"><option value="task" ${a.kind==='task'?'selected':''}>Tarea · texto, enlace o archivos</option><option value="quiz" ${a.kind==='quiz'?'selected':''}>Cuestionario interactivo</option></select></label><p class="editor-callout" data-kind-description></p><label>Capítulo<select name="moduleId"><option value="">Actividad general del curso</option>${c.modules.map(m=>`<option value="${e(m.id)}" ${a.moduleId===m.id?'selected':''}>${e(m.title)}${m.published===false?' · Borrador':''}</option>`).join('')}</select><span class="field-hint">Aparecerá junto a los materiales de este capítulo.</span></label>`)}
 ${section('content','Prepara el contenido','Explica qué deben hacer y cómo evaluarás sus respuestas.',`<label>Instrucciones y criterios de evaluación<textarea name="description" rows="6" maxlength="20000" placeholder="Objetivo, pasos, formato esperado y criterios para obtener la nota…">${e(a.description)}</textarea></label><details class="editor-disclosure" ${(a.instructionUrl||(a.attachments||[]).length)?'open':''}><summary>${icon('folder')}Enunciado y material de apoyo <span>Enlaces y archivos</span></summary><div class="form-stack"><label>Enlace del enunciado (opcional)<input type="url" name="instructionUrl" maxlength="2048" placeholder="https://…" value="${e(a.instructionUrl||'')}"><span class="field-hint">Drive, video, página o presentación. Revisa sus permisos de acceso.</span></label>${fileCards(a.attachments,{external:true})}${savedFiles(a.attachments)}<label>Adjuntar archivos del docente<input type="file" name="instructionFiles" multiple accept="${acceptedFiles}"><span class="field-hint">Hasta 5 archivos nuevos y 20 MB por actividad. PDF e imágenes se visualizan; Office se descarga. Para mostrar diapositivas, expórtalas a PDF.</span><span class="field-hint" data-file-selection aria-live="polite">Ningún archivo seleccionado.</span></label><p class="field-hint">Estos son tus materiales; los estudiantes adjuntarán sus respuestas por separado.</p></div></details><div id="question-builder" ${a.kind!=='quiz'?'hidden':''}><div class="editor-question-heading"><h4>Preguntas del cuestionario</h4><span class="badge" data-question-total></span></div><p class="field-hint">La selección se corrige automáticamente. Las respuestas abiertas requieren tu revisión. Tú decides cuándo publicar las notas.</p><div data-import-slot></div><div data-question-undo hidden></div><p class="editor-callout" data-question-empty>Añade tu primera pregunta o importa un archivo Excel.</p><div id="question-list">${a.questions.map((q,i)=>questionEditor(q,i+1)).join('')}</div>${button('Añadir pregunta','data-action="academic-add-question"','plus')}</div>`)}
 ${section('delivery','Define cómo se entrega','Controla las oportunidades disponibles para cada estudiante.',`<div class="editor-callout" data-delivery-description></div><label>Máximo de entregas o intentos<input name="maxAttempts" type="number" min="1" max="20" step="1" required value="${a.maxAttempts}"><span class="field-hint">Entre 1 y 20. La última entrega enviada se usa para calcular la nota.</span></label><div data-timer-slot></div><p class="field-hint">Guardar un borrador no consume un intento. El estudiante debe enviar su respuesta para registrar una entrega.</p>`)}
 ${section('grading','Configura la calificación','Los puntos califican esta actividad; el porcentaje define cuánto aporta a la nota.',`<div data-period-slot></div><div class="form-grid"><label>Porcentaje de la nota<input name="weight" type="number" min="0" max="100" step="0.01" value="${a.weight}" required><span class="field-hint">0 % permite practicar sin afectar la nota final.</span></label><label>Puntos máximos<input name="maxPoints" type="number" min="1" max="10000" step="0.1" value="${a.maxPoints}" required ${a.kind==='quiz'?'disabled':''}><span class="field-hint" data-points-description></span></label></div><div class="editor-callout" data-weight-summary role="status"></div><p class="field-hint">Las notas se publican desde el libro de notas. Publicar la actividad no publica automáticamente sus resultados.</p>`)}
 ${section('publication','Elige cuándo estará disponible','Publicación, plazo de entrega y cierre tienen funciones diferentes.',`<label>Visibilidad<select name="status">${[['draft','Borrador · solo docentes'],['published','Publicada · visible en el curso'],['archived','Archivada · oculta para estudiantes']].map(([v,t])=>`<option value="${v}" ${a.status===v?'selected':''}>${t}</option>`).join('')}</select></label><p class="editor-callout" data-status-description></p><p class="field-hint">Fechas en ${e(Intl.DateTimeFormat().resolvedOptions().timeZone)}. Deja los campos vacíos si no necesitas límites.</p><label>Apertura<input name="opensAt" type="datetime-local" value="${dateInput(a.opensAt)}"><span class="field-hint">Desde cuándo pueden consultar el enunciado y responder.</span></label><label>Fecha de entrega<input name="dueAt" type="datetime-local" value="${dateInput(a.dueAt)}"><span class="field-hint">Plazo para entregar a tiempo.</span></label><label class="check-label"><input name="allowLate" type="checkbox" ${a.allowLate?'checked':''}>Aceptar entregas tardías</label><label>Cierre definitivo<input name="closesAt" type="datetime-local" value="${dateInput(a.closesAt)}"><span class="field-hint">Después de esta fecha se bloquea cualquier nuevo envío.</span></label><p class="editor-callout" data-date-summary></p>`)}
 ${a.id?section('changes','Revisa los cambios','Decide qué pasará con las respuestas que ya recibiste.',modern?'<div data-revision-slot></div>':`<p class="editor-callout">Cambiar el enunciado, archivos, tipo, preguntas o puntos solicita una nueva entrega. Las respuestas anteriores se conservan en el historial y dejan de contar. Ajustar solo fechas, porcentaje o publicación conserva las entregas.</p><label class="check-label"><input name="requestResubmission" type="checkbox">Solicitar nuevas entregas aunque solo cambien fechas, porcentaje o publicación</label>`):''}
 <section class="editor-section form-stack" data-editor-section="preview" hidden></section><section class="editor-section form-stack" data-editor-section="impact" hidden></section>
 <div class="editor-step-actions">${button('Anterior','data-editor-previous','back')}${button('Siguiente','data-editor-next','arrow')}</div>
 </div></div>`;
}

export function bindActivityEditor(form,a,c,evaluation){
 const modal=form.closest('dialog'),workspace=form.querySelector('.editor-workspace'),nav=[...form.querySelectorAll('[data-editor-go]')];
 let current='details',lastEdit='details',removed=null,reviewing=false,taskPoints=a.kind==='task'?a.maxPoints:100,lastKind=a.kind;
 form.noValidate=true;modal.classList.add('activity-editor-modal');
 const footer=form.querySelector(':scope > .form-actions'),save=footer.querySelector('[type=submit]');
 footer.insertAdjacentHTML('afterbegin',button('Vista previa','data-editor-preview','eye'));
 const previewButton=footer.querySelector('[data-editor-preview]');
 function go(id,focus=true){
  if(reviewing&&id!=='impact')return;
  current=id;if(nav.some(n=>n.dataset.editorGo===id))lastEdit=id;
  for(const s of form.querySelectorAll('[data-editor-section]'))s.hidden=s.dataset.editorSection!==id;
  nav.forEach(n=>{if(n.dataset.editorGo===id)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});
  const index=nav.findIndex(n=>n.dataset.editorGo===id);
  form.querySelector('.editor-step-actions').hidden=index<0;
  form.querySelector('[data-editor-previous]').disabled=index===0;
  form.querySelector('[data-editor-next]').hidden=index===nav.length-1;
  workspace.scrollTop=0;
  if(focus)form.querySelector(`[data-editor-section="${id}"] h3`)?.focus();
 }
 const field=(name)=>form.elements.namedItem(name);
 function syncQuestion(q){
  const type=q.querySelector('[name=qType]').value,rows=[...q.querySelectorAll('.editor-option')];
  q.querySelector('[data-options]').hidden=type==='text';q.querySelector('[data-manual-hint]').hidden=type!=='text';
  let found=false;
  rows.forEach((row,i)=>{const check=row.querySelector('[data-correct]');check.type=type==='multiple'?'checkbox':'radio';if(type==='single'&&check.checked){if(found)check.checked=false;found=true;}
   check.setAttribute('aria-label',`Opción ${i+1} correcta`);row.querySelector('[data-option-letter]').textContent=String.fromCharCode(65+i);
   row.querySelector('[data-option-text]').setAttribute('aria-label',`Texto de opción ${i+1}`);
   const remove=row.querySelector('[data-remove-option]');remove.disabled=rows.length<=2;remove.setAttribute('aria-label',`Quitar opción ${i+1}`);
  });
  q.querySelector('[name=qOptions]').value=rows.map(r=>r.querySelector('[data-option-text]').value).join('\n');
  q.querySelector('[name=qCorrect]').value=rows.flatMap((r,i)=>r.querySelector('[data-correct]').checked?[i+1]:[]).join(',');
  q.querySelector('[data-add-option]').disabled=rows.length>=10;
  q.querySelector('[data-option-hint]').textContent=type==='multiple'?'Marca todas las opciones correctas. La respuesta debe coincidir con la selección completa.':'Marca una respuesta correcta a la izquierda.';
 }
 function weights(){return weightSummary(evaluation?.activities||[],a.id,field('periodId')?.value,field('weight').value,field('status').value);}
 function refresh(){
  const quiz=field('kind').value==='quiz',questions=[...form.querySelectorAll('[data-question]')];
  form.querySelector('#question-builder').hidden=!quiz;
  if(lastKind==='task'&&quiz)taskPoints=field('maxPoints').value;
  if(lastKind==='quiz'&&!quiz)field('maxPoints').value=taskPoints;
  lastKind=field('kind').value;field('maxPoints').disabled=quiz;
  form.querySelector('[data-kind-description]').textContent=quiz?'Cuestionario: construye preguntas de selección o respuesta abierta dentro del aula.':'Tarea: el estudiante puede responder con texto, un enlace, archivos o una combinación de ellos.';
  form.querySelector('[data-delivery-description]').textContent=quiz?'Los estudiantes responden las preguntas en el aula. Las respuestas abiertas se califican manualmente.':'Se admiten texto, enlaces y hasta 5 archivos de respuesta: PDF, imágenes, documentos y hojas de cálculo; máximo 10 MB por archivo y 20 MB en total.';
  questions.forEach((q,i)=>{syncQuestion(q);q.querySelector('[data-question-number]').textContent=`Pregunta ${i+1}`;q.querySelector('[data-action="academic-question-up"]').disabled=i===0;q.querySelector('[data-action="academic-question-down"]').disabled=i===questions.length-1;q.querySelector('[data-action="academic-question-copy"]').disabled=questions.length>=50;});
  const points=questions.reduce((n,q)=>n+Number(q.querySelector('[name=qPoints]').value||0),0);
  if(quiz)field('maxPoints').value=Number(points.toFixed(2));
  if(a.id&&field('changeKind')&&a.activeResponseCount){
   const structure={kind:field('kind').value,maxPoints:quiz?Number(points.toFixed(2)):Number(field('maxPoints').value),questions:questions.map(q=>({id:q.dataset.question,type:q.querySelector('[name=qType]').value,points:Number(q.querySelector('[name=qPoints]').value),options:q.querySelector('[name=qOptions]').value.split('\n').map(s=>s.trim()),correct:q.querySelector('[name=qCorrect]').value.split(',').filter(Boolean).map(v=>Number(v)-1)}))};
   if(evaluationStructure(a)!==evaluationStructure(structure)&&field('changeKind').value==='editorial'){field('changeKind').value='evaluated';field('changeKind').dispatchEvent(new Event('change'));}
  }
  form.querySelector('[data-question-total]').textContent=`${questions.length} / 50 · ${fmt(points)} puntos`;
  form.querySelector('[data-question-empty]').hidden=questions.length>0;
  form.querySelector('[data-action="academic-add-question"]').disabled=questions.length>=50;
  form.querySelector('[data-points-description]').textContent=quiz?`Se suman automáticamente: ${fmt(points)} puntos en ${questions.length} preguntas.`:'Ejemplo: 80 puntos de 100 equivalen al 80 % de la nota de esta actividad.';
  const summary=weights(),period=field('periodId')?.selectedOptions[0]?.textContent||'Nota del curso';
  form.querySelector('[data-weight-summary]').textContent=`${period}. Otras actividades publicadas: ${fmt(summary.used)} %. Disponible: ${fmt(summary.remaining)} %. ${field('status').value==='published'?`Con esta actividad: ${fmt(summary.total)} % de 100 %.`:'El borrador o archivo no consume porcentaje publicado.'}${summary.exceeded?' Reduce el porcentaje antes de publicar.':''}`;
  form.querySelector('[data-weight-summary]').classList.toggle('warning',summary.exceeded);
  form.querySelector('[data-status-description]').textContent=field('status').value==='published'?'Aparecerá en el curso si el grupo y el capítulo también están publicados. Si programas una apertura futura, el enunciado y las respuestas estarán disponibles desde esa fecha.':field('status').value==='draft'?'Puedes seguir preparando esta actividad. Los estudiantes no la verán hasta que la publiques.':'Se oculta a los estudiantes. Las entregas y las notas anteriores se conservan.';
  const problem=dateProblem({opensAt:field('opensAt').value,dueAt:field('dueAt').value,closesAt:field('closesAt').value,allowLate:field('allowLate').checked});
  const dateText=problem?.message||(field('allowLate').checked?(field('closesAt').value?'Se aceptan envíos tardíos solo hasta el cierre definitivo.':'Se aceptan envíos tardíos sin fecha de cierre.'):(field('dueAt').value?'Los envíos se bloquean al vencer la fecha de entrega.':field('closesAt').value?'Los envíos se bloquean en el cierre definitivo.':'Sin límite de fechas para responder una vez publicada.'));
  form.querySelector('[data-date-summary]').textContent=dateText;form.querySelector('[data-date-summary]').classList.toggle('warning',!!problem);
  form.querySelector('.editor-summary').innerHTML=`<span class="overline">Tu actividad</span><strong>${e(field('title').value||'Sin título todavía')}</strong><span>${quiz?'Cuestionario':'Tarea'} · ${labels[field('status').value]}</span><span>${fmt(field('weight').value)} % · ${fmt(quiz?points:field('maxPoints').value)} puntos</span><span>${e(field('moduleId').selectedOptions[0].textContent)}</span><small>Los cambios se aplican al guardar.</small>`;
  if(!save.disabled)save.innerHTML=icon(field('status').value==='published'?'globe':'save')+(field('status').value==='published'?(a.status==='published'?'Guardar cambios':'Publicar actividad'):field('status').value==='draft'?'Guardar borrador':'Guardar archivada');
 }
 function fail(input,message){go(input.closest('[data-editor-section]')?.dataset.editorSection||'content');for(let el=input.parentElement;el&&el!==form;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;input.focus();throw Error(message);}
 function validate(){
  refresh();const quiz=field('kind').value==='quiz';
  if(!field('title').value.trim())fail(field('title'),'Escribe un título para la actividad.');
  for(const input of form.querySelectorAll('input,textarea,select')){
   if(input.disabled||input.closest('[data-editor-section="preview"]')||(!quiz&&input.closest('#question-builder'))||input.type==='hidden')continue;
   if(!input.checkValidity())fail(input,`Revisa ${input.closest('label')?.childNodes[0]?.textContent?.trim()||input.getAttribute('aria-label')||'el campo señalado'}: ${input.validationMessage}`);
  }
  const dates=dateProblem({opensAt:field('opensAt').value,dueAt:field('dueAt').value,closesAt:field('closesAt').value,allowLate:field('allowLate').checked});if(dates)fail(field(dates.field),dates.message);
  if(weights().exceeded)fail(field('weight'),'Las actividades publicadas de este corte o curso superarían el 100 %.');
  const questions=[...form.querySelectorAll('[data-question]')];
  if(quiz&&!questions.length)fail(form.querySelector('[data-action="academic-add-question"]'),'Añade al menos una pregunta al cuestionario.');
  if(quiz)for(const [i,q] of questions.entries()){
   const prompt=q.querySelector('[name=qPrompt]');if(!prompt.value.trim())fail(prompt,`Escribe el enunciado de la pregunta ${i+1}.`);
   if(q.querySelector('[name=qType]').value!=='text'){
    for(const input of q.querySelectorAll('[data-option-text]'))if(!input.value.trim())fail(input,`Completa todas las opciones de la pregunta ${i+1}.`);
    if(!q.querySelector('[data-correct]:checked'))fail(q.querySelector('[data-correct]'),`Marca la respuesta correcta de la pregunta ${i+1}.`);
   }
  }
  const instructionFiles=[...field('instructionFiles').files];if(instructionFiles.length>5)fail(field('instructionFiles'),'Selecciona hasta 5 archivos nuevos para el enunciado.');
  const pending=[...instructionFiles];let mediaCount=(a.attachments||[]).filter(f=>!form.querySelector(`[name=removeAttachment][value="${CSS.escape(f.id)}"]`)?.checked).length;
  if(quiz)for(const q of questions){const files=q.querySelector('[name=qFiles]');if(!files)continue;const retained=q.querySelectorAll('[name=qMediaKeep]:checked').length;if(retained+files.files.length>5)fail(files,'Cada pregunta admite hasta 5 archivos.');pending.push(...files.files);}
  const retainedBytes=(a.attachments||[]).filter(f=>!form.querySelector(`[name=removeAttachment][value="${CSS.escape(f.id)}"]`)?.checked).reduce((n,f)=>n+f.size,0);
  if(pending.reduce((n,f)=>n+f.size,retainedBytes)>20*1048576)fail(field('instructionFiles'),'El material conservado y los archivos nuevos superan 20 MB.');
  if(mediaCount+pending.length>50)fail(field('instructionFiles'),'La actividad admite hasta 50 archivos en total.');
 }
 function preview(){
  const target=form.querySelector('[data-editor-section="preview"]'),quiz=field('kind').value==='quiz';
  const files=(a.attachments||[]).filter(f=>!form.querySelector(`[name=removeAttachment][value="${CSS.escape(f.id)}"]`)?.checked);
  target.innerHTML=`<header class="editor-section-heading"><h3 tabindex="-1">Vista previa del contenido</h3><p>Incluye lo que estás editando. No guarda cambios ni registra respuestas.</p></header>${button('Volver a editar','data-editor-return','back')}<article class="editor-preview-paper"><span class="badge">${quiz?'Cuestionario':'Tarea'}</span><h2>${e(field('title').value||'Actividad sin título')}</h2><p class="academic-text">${e(field('description').value||'Aún no has escrito instrucciones.')}</p>${field('instructionUrl').value?`<a class="btn secondary small" href="${e(safeUrl(field('instructionUrl').value))}" target="_blank" rel="noopener noreferrer">${icon('link')}Abrir enlace del enunciado</a>`:''}${files.length?`<h4>Materiales guardados</h4><ul>${files.map(f=>`<li><a href="${e(f.url)}" target="_blank" rel="noopener noreferrer">${e(f.name)}</a></li>`).join('')}</ul>`:''}${field('instructionFiles').files.length?`<h4>Archivos por guardar</h4><ul>${[...field('instructionFiles').files].map(f=>`<li>${e(f.name)}</li>`).join('')}</ul>`:''}${quiz?[...form.querySelectorAll('[data-question]')].map((q,i)=>`<section class="editor-preview-question"><h4>${i+1}. ${e(q.querySelector('[name=qPrompt]').value||'Pregunta sin enunciado')}</h4><p class="field-hint">${fmt(q.querySelector('[name=qPoints]').value)} puntos · ${q.querySelector('[name=qType]').selectedOptions[0].textContent}</p>${q.querySelector('[name=qImage]')?.value?`<p class="field-hint">Imagen: ${e(q.querySelector('[name=qImageAlt]')?.value||q.querySelector('[name=qImage]').value)}</p>`:''}${q.querySelector('[name=qType]').value==='text'?'<div class="editor-preview-answer">Espacio para la respuesta escrita</div>':`<ol type="A">${[...q.querySelectorAll('[data-option-text]')].map(el=>`<li>${e(el.value||'Opción pendiente')}</li>`).join('')}</ol>`}${[...q.querySelectorAll('[name=qMediaKeep]:checked')].length||q.querySelector('[name=qFiles]')?.files.length?`<p class="field-hint">Adjuntos: ${e([...q.querySelectorAll('[name=qMediaKeep]:checked')].map(el=>el.value).concat([...q.querySelector('[name=qFiles]').files].map(f=>f.name)).join(' · '))}</p>`:''}</section>`).join(''):'<div class="editor-preview-answer">El estudiante podrá escribir una respuesta, compartir un enlace y adjuntar archivos.</div>'}</article>`;
  go('preview');
 }
 const onEdit=()=>{form.querySelector(':scope > .form-error').textContent='';refresh();};
 form.addEventListener('input',onEdit);form.addEventListener('change',onEdit);
 form.addEventListener('activity-editor-change',()=>{modal.dataset.dirty='true';refresh();});
 form.addEventListener('click',ev=>{
  const control=ev.target.closest('button');if(!control)return;
  if(control.hasAttribute('data-editor-go'))go(control.dataset.editorGo);
  if(control.hasAttribute('data-editor-previous')||control.hasAttribute('data-editor-next')){const i=nav.findIndex(n=>n.dataset.editorGo===current);go(nav[i+(control.hasAttribute('data-editor-next')?1:-1)]?.dataset.editorGo||current);}
  if(control.hasAttribute('data-editor-preview'))preview();if(control.hasAttribute('data-editor-return'))go(lastEdit);
  if(control.hasAttribute('data-add-option')){const q=control.closest('[data-question]'),list=q.querySelector('[data-option-list]');if(list.children.length<10)list.insertAdjacentHTML('beforeend',optionRow('',false,q.querySelector('[name=qType]').value,q.dataset.question,list.children.length));form.dispatchEvent(new Event('activity-editor-change'));}
  if(control.hasAttribute('data-remove-option')){const row=control.closest('.editor-option');if(row.parentElement.children.length>2)row.remove();form.dispatchEvent(new Event('activity-editor-change'));}
  if(control.hasAttribute('data-undo-question')&&removed){const list=form.querySelector('#question-list');if(list.children.length>=50)return;list.insertBefore(removed.node,list.children[removed.index]||null);removed=null;form.querySelector('[data-question-undo]').hidden=true;form.dispatchEvent(new Event('activity-editor-change'));}
 });
 function removeQuestion(el){const node=el.closest('[data-question]');removed={node,index:[...node.parentElement.children].indexOf(node)};node.remove();const bar=form.querySelector('[data-question-undo]');bar.hidden=false;bar.innerHTML=`<span>Pregunta retirada. Puedes recuperarla antes de guardar.</span>${button('Deshacer','data-undo-question','back')}`;form.dispatchEvent(new Event('activity-editor-change'));}
 async function confirmImpact(r){
  reviewing=true;nav.forEach(n=>n.disabled=true);previewButton.disabled=true;
  save.innerHTML=icon('eye')+'Revisión pendiente';save.removeAttribute('aria-busy');
  const changed=(r.impact||[]).filter(x=>x.before!==x.after),target=form.querySelector('[data-editor-section="impact"]');
  const period=id=>evaluation?.settings?.periods?.find(p=>p.id===id)?.title||'Sin corte';
  target.innerHTML=`<header class="editor-section-heading"><h3 tabindex="-1">Revisa antes de guardar</h3><p>Estos cambios todavía no se han aplicado.</p></header><div class="editor-callout"><strong>${r.affectedResponses} respuestas o borradores vigentes</strong><p>${{keep:'Se conservan los intentos y sus notas anteriores.',optional:'Se ofrecerán nuevos intentos; la nota actual se conserva hasta un nuevo envío.',repeat:'Las respuestas anteriores pasarán al historial. Sus notas dejarán de contar hasta una nueva entrega.'}[r.policy]}</p>${r.changed&&field('changeKind')?.value==='evaluated'?'<p>Los borradores en curso pasarán al historial al cambiar lo evaluado.</p>':''}</div><dl class="editor-impact-summary"><dt>Porcentaje</dt><dd>${fmt(r.oldWeight)} % → ${fmt(r.newWeight)} %</dd><dt>Corte</dt><dd>${e(period(r.oldPeriod))} → ${e(period(r.newPeriod))}</dd><dt>Promedios que cambian</dt><dd>${changed.length}</dd></dl>${changed.length?`<div class="table-wrap"><table><thead><tr><th>Estudiante</th><th>Antes</th><th>Después</th></tr></thead><tbody>${changed.slice(0,20).map(x=>`<tr><td>${e(x.name)}</td><td>${x.before===null?'Sin nota':fmt(x.before)}</td><td>${x.after===null?'Sin nota':fmt(x.after)}</td></tr>`).join('')}</tbody></table></div>${changed.length>20?`<p>Se muestran 20 de ${changed.length} cambios.</p>`:''}`:''}${r.policy==='repeat'?'<p class="field-hint">Si los plazos anteriores vencieron, el sistema retirará esos límites para permitir repetir.</p>':''}<div class="flex wrap">${button('Volver a revisar','data-impact-cancel','back')}${button('Confirmar y guardar','data-impact-confirm','check','')}</div>`;
  go('impact');
  return new Promise(resolve=>{let settled=false;const done=value=>{if(settled)return;settled=true;modal.removeEventListener('close',closed);reviewing=false;nav.forEach(n=>n.disabled=false);previewButton.disabled=false;if(value){save.innerHTML=icon('clock')+'Guardando…';save.setAttribute('aria-busy','true');}if(modal.open)go(lastEdit);resolve(value);};const closed=()=>done(false);modal.addEventListener('close',closed,{once:true});target.querySelector('[data-impact-cancel]').onclick=()=>done(false);target.querySelector('[data-impact-confirm]').onclick=()=>done(true);});
 }
 form.activityEditor={validate,refresh,go,removeQuestion,confirmImpact};refresh();go('details',false);
}
