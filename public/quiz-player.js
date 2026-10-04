import {escapeHtml as e} from './lib.js';
import {questionVisual,linkedText,textPreviews} from './activity-media.js';
import {icon} from './ui.js';

const fmt=n=>Number(n).toLocaleString('es-CO',{maximumFractionDigits:2});
export function quizSharedAttachments(a){
 const assigned=new Set((a.questions||[]).flatMap(q=>q.media||[]));
 return (a.attachments||[]).filter(f=>!assigned.has(f.name));
}
export function quizQuestion(q,index,attachments,answers={},media=''){
 const visual=questionVisual(q,attachments),answer=answers[q.id];
 return `<fieldset class="academic-question quiz-question" data-quiz-question="${index}" ${index?'hidden':''}><legend>Pregunta ${index+1} <small>${fmt(q.points)} puntos</small></legend><div class="quiz-question-layout ${visual?'with-image':''}"><div class="quiz-question-content"><p class="academic-text question-prompt">${linkedText(q.prompt)}</p>${textPreviews(q.prompt,q.linkUrl)}${media}${q.type==='text'?`<label class="quiz-written-answer">Tu respuesta<textarea name="answer-${e(q.id)}" rows="4" maxlength="10000">${e(typeof answer==='string'?answer:'')}</textarea></label>`:`<div class="quiz-options">${q.options.map((o,n)=>`<label class="academic-option"><input type="${q.type==='single'?'radio':'checkbox'}" name="answer-${e(q.id)}" value="${n}" ${Array.isArray(answer)&&answer.includes(n)?'checked':''}><span class="quiz-option-letter" aria-hidden="true">${String.fromCharCode(65+n)}</span><span>${e(o)}</span></label>`).join('')}</div>`}${q.type==='multiple'?'<span class="field-hint">Selecciona todas las opciones correctas.</span>':''}</div>${visual}</div></fieldset>`;
}
export function quizReview(a,support){
 return `<section class="quiz-review" data-quiz-review hidden aria-labelledby="quiz-review-title"><h2 id="quiz-review-title" tabindex="-1">Revisa tu cuestionario</h2><p class="field-hint" data-quiz-review-status></p><div class="quiz-review-questions">${a.questions.map((q,i)=>`<button type="button" class="quiz-review-question" data-quiz-jump="${i}" aria-label="Revisar pregunta ${i+1}"><strong>Pregunta ${i+1}</strong><span data-quiz-answer-status="${i}">Sin responder</span>${icon('arrow')}</button>`).join('')}</div>${support}<p class="field-hint">Puedes volver a cualquier pregunta y cambiar tus respuestas antes de enviar. El resultado aparecerá cuando tu docente publique la calificación.</p></section>`;
}
export function bindQuizNavigation(form,data){
 const questions=[...form.querySelectorAll('[data-quiz-question]')],review=form.querySelector('[data-quiz-review]');
 if(!questions.length||!review)return;
 const stages=[...questions,review],controls=document.createElement('div');let index=0;
 controls.className='quiz-progress';controls.innerHTML=`<div class="quiz-progress-label"><strong data-quiz-position role="status" aria-live="polite"></strong><span data-quiz-completed></span></div><progress max="${questions.length}" value="0" aria-label="Preguntas respondidas"></progress><details class="quiz-question-menu"><summary>${icon('grid')}Ir a pregunta</summary><div>${questions.map((q,i)=>`<button class="quiz-jump" type="button" data-quiz-jump="${i}" aria-label="Ir a pregunta ${i+1}">${i+1}</button>`).join('')}<button class="quiz-jump quiz-jump-review" type="button" data-quiz-jump="${questions.length}">Revisar</button></div></details>`;form.prepend(controls);
 const actions=form.querySelector('[data-quiz-actions]'),send=actions.querySelector('[value=submit]');
 actions.insertAdjacentHTML('afterbegin',`<button type="button" class="btn secondary" data-quiz-previous>${icon('back')}Anterior</button>`);
 actions.insertAdjacentHTML('beforeend',`<button type="button" class="btn" data-quiz-next>Siguiente${icon('arrow')}</button>`);
 const previous=actions.querySelector('[data-quiz-previous]'),next=actions.querySelector('[data-quiz-next]');
 const answered=q=>[...q.querySelectorAll('textarea,input')].some(input=>input.type==='radio'||input.type==='checkbox'?input.checked:input.value.trim());
 function progress(){const count=questions.filter(answered).length;controls.querySelector('[data-quiz-completed]').textContent=`${count} de ${questions.length} respondidas`;controls.querySelector('progress').value=count;review.querySelector('[data-quiz-review-status]').textContent=count===questions.length?'Todas las preguntas tienen respuesta. Revisa tus respuestas y envía cuando estés listo.':`Tienes ${questions.length-count} pregunta(s) sin responder. Puedes volver a ellas antes de enviar.`;questions.forEach((q,i)=>{const done=answered(q);review.querySelector(`[data-quiz-answer-status="${i}"]`).textContent=done?'Respondida':'Sin responder';review.querySelector(`[data-quiz-jump="${i}"]`).classList.toggle('answered',done);const jump=controls.querySelector(`[data-quiz-jump="${i}"]`);jump.classList.toggle('answered',done);jump.setAttribute('aria-label',`Ir a pregunta ${i+1}, ${done?'respondida':'sin responder'}`);});}
 function paint(focus=false){stages.forEach((stage,n)=>stage.hidden=n!==index);controls.querySelector('[data-quiz-position]').textContent=index===questions.length?'Revisión y entrega':`Pregunta ${index+1} de ${questions.length}`;previous.hidden=index===0;next.hidden=index===questions.length;send.hidden=index!==questions.length;next.innerHTML=(index===questions.length-1?'Revisar y enviar':'Siguiente')+icon('arrow');controls.querySelectorAll('[data-quiz-jump]').forEach(jump=>{if(Number(jump.dataset.quizJump)===index)jump.setAttribute('aria-current','step');else jump.removeAttribute('aria-current');});progress();if(focus){const title=stages[index].querySelector('legend,h2');title.tabIndex=-1;title.focus({preventScroll:true});form.scrollIntoView({block:'start',behavior:'instant'});}}
 function go(value){if(form.getAttribute('aria-busy')==='true')return;index=Math.max(0,Math.min(questions.length,value));controls.querySelector('details').open=false;paint(true);}
 previous.addEventListener('click',()=>go(index-1));next.addEventListener('click',()=>go(index+1));
 form.addEventListener('click',event=>{const jump=event.target.closest('[data-quiz-jump]');if(jump)go(Number(jump.dataset.quizJump));});
 form.addEventListener('input',progress);form.addEventListener('change',progress);
 form.academicShowSupport=()=>go(questions.length);paint();
}
