import {escapeHtml as e} from './lib.js';
import {questionVisual,linkedText,textPreviews} from './activity-media.js';

const fmt=n=>Number(n).toLocaleString('es-CO',{maximumFractionDigits:2});
export const choiceQuestion=q=>['single','multiple'].includes(q.type);
export function quizSharedAttachments(a){const assigned=new Set((a.questions||[]).flatMap(q=>q.media||[]));return (a.attachments||[]).filter(f=>!assigned.has(f.name));}
export function quizQuestion(q,index,attachments,answers={},media=''){
 const visual=questionVisual(q,attachments),answer=answers[q.id],name='answer-'+q.id;
 let control='';
 if(q.type==='instruction')control='<p class="activity-exercise-hint">Resuelve este ejercicio en tus archivos. Adjunta el resultado en «Tu entrega».</p>';
 else if(q.type==='short')control=`<label class="quiz-written-answer">Tu respuesta<input name="${e(name)}" maxlength="500" value="${e(typeof answer==='string'?answer:'')}" placeholder="Escribe una respuesta breve" data-answer-required></label>`;
 else if(q.type==='number')control=`<label class="quiz-written-answer">Resultado numérico<input name="${e(name)}" inputmode="decimal" maxlength="120" value="${e(typeof answer==='string'?answer:'')}" placeholder="Ej. 12,5" data-answer-required><span class="field-hint">Puedes usar coma o punto decimal.</span></label>`;
 else if(q.type==='text')control=`<label class="quiz-written-answer">Tu respuesta<textarea name="${e(name)}" rows="4" maxlength="10000" placeholder="Explica tu respuesta…" data-answer-required>${e(typeof answer==='string'?answer:'')}</textarea></label>`;
 else control=`<div class="quiz-options">${(q.options||[]).map((option,n)=>`<label class="academic-option"><input type="${q.type==='single'?'radio':'checkbox'}" name="${e(name)}" value="${n}" ${Array.isArray(answer)&&answer.includes(n)?'checked':''}><span class="quiz-option-letter" aria-hidden="true">${String.fromCharCode(65+n)}</span><span>${e(option)}</span></label>`).join('')}</div>${q.type==='multiple'?'<p class="field-hint">Puedes seleccionar más de una opción.</p>':''}`;
 return `<fieldset class="academic-question quiz-question activity-question" id="activity-question-${index+1}" data-quiz-question="${index}" data-question-type="${e(q.type)}"><legend><span>${q.type==='instruction'?'Ejercicio':'Punto'} ${index+1}</span><small>${fmt(q.points)} puntos</small></legend><div class="quiz-question-layout ${visual?'with-image':''}"><div class="quiz-question-content"><p class="academic-text question-prompt">${linkedText(q.prompt)}</p>${textPreviews(q.prompt,q.linkUrl)}${media}${control}</div>${visual}</div></fieldset>`;
}
export function quizReview(_activity,support){return `<section class="activity-attachments" data-quiz-review>${support}</section>`;}

export function bindQuizNavigation(form,data){
 const questions=[...form.querySelectorAll('[data-quiz-question]')];if(!questions.length)return;
 const required=questions.filter(q=>q.dataset.questionType!=='instruction');
 const answered=q=>[...q.querySelectorAll('textarea,input')].some(input=>['radio','checkbox'].includes(input.type)?input.checked:Boolean(input.value.trim()));
 function progress(){
  const count=required.filter(answered).length,label=form.querySelector('[data-question-progress]'),meter=form.querySelector('[data-question-meter]');
  if(label)label.textContent=required.length?`${count} de ${required.length} puntos respondidos`:`${questions.length} ejercicio${questions.length===1?'':'s'} para resolver en tus archivos`;
  if(meter){meter.max=Math.max(1,required.length);meter.value=count;meter.hidden=!required.length;}
  questions.forEach((question,index)=>{for(const jump of form.querySelectorAll(`[data-quiz-jump="${index}"]`)){const complete=question.dataset.questionType==='instruction'?false:answered(question);jump.classList.toggle('answered',complete);jump.setAttribute('aria-label',`${question.dataset.questionType==='instruction'?'Ir al ejercicio':'Ir al punto'} ${index+1}${complete?', respondido':''}`);}});
 }
 form.addEventListener('click',event=>{const jump=event.target.closest('[data-quiz-jump]');if(!jump)return;const question=questions[Number(jump.dataset.quizJump)];if(question){question.scrollIntoView({block:'start',behavior:'smooth'});question.querySelector('input,textarea,legend')?.focus({preventScroll:true});}});
 form.addEventListener('input',progress);form.addEventListener('change',progress);
 form.academicShowSupport=()=>{form.querySelector('[data-procedure-stage]')?.scrollIntoView({block:'nearest'});};
 questions.forEach(question=>question.hidden=false);progress();
}
