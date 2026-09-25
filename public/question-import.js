import {escapeHtml as e} from './lib.js';
import {icon} from './ui.js';

export function bindQuestionImport(form,{api,questionEditor,questionFields,toast}){
 const input=form.querySelector('#question-excel'),box=form.querySelector('#excel-mapping');if(!input)return;
 let generation=0;
 const fields=[['prompt','Enunciado'],['type','Tipo'],['option1','Opción 1'],['option2','Opción 2'],['option3','Opción 3'],['option4','Opción 4'],['correct','Correctas'],['points','Puntos'],['feedback','Retroalimentación'],['image','Imagen HTTPS'],['instructions','Instrucciones']];
 input.onchange=async()=>{
  const version=++generation;
  try{
   const file=input.files[0];if(!file)return;if(file.size>2*1048576)throw Error('El archivo supera 2 MB.');
   input.disabled=true;box.textContent='Leyendo Excel…';
   const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(Error('No se pudo leer el archivo.'));r.readAsDataURL(file);});
   const data=await api('/question-import/read',{method:'POST',body:{base64}});
   if(version!==generation||!form.isConnected)return;
   if(!data.rows.length)throw Error('El archivo no contiene preguntas. Completa la plantilla y vuelve a seleccionarla.');
   box.innerHTML=`<h4>Asignar columnas</h4><p class="field-hint">${data.rows.length} filas encontradas. Se añadirán al cuestionario actual cuando confirmes la importación.</p><div class="form-grid">${fields.map(([k,label],i)=>`<label>${label}<select data-map="${k}"><option value="-1">No usar</option>${data.headers.map((h,j)=>`<option value="${j}" ${i===j?'selected':''}>${e(h)}</option>`).join('')}</select></label>`).join('')}</div><button type="button" class="btn secondary" data-validate>${icon('check')}Validar y previsualizar</button><div data-import-preview aria-live="polite"></div>`;
   const validate=box.querySelector('[data-validate]'),target=box.querySelector('[data-import-preview]');
   box.onchange=()=>{target.replaceChildren();};
   validate.onclick=async()=>{
    if(validate.disabled)return;
    validate.disabled=true;
    const mapping=Object.fromEntries([...box.querySelectorAll('[data-map]')].map(s=>[s.dataset.map,Number(s.value)]));
    try{
     const rows=await api('/question-import/preview',{method:'POST',body:{rows:data.rows,mapping}});
     const currentMapping=Object.fromEntries([...box.querySelectorAll('[data-map]')].map(s=>[s.dataset.map,Number(s.value)]));
     if(version!==generation||!form.isConnected||JSON.stringify(mapping)!==JSON.stringify(currentMapping))return;
     const valid=rows.length&&rows.every(r=>!r.errors.length);
     target.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Fila</th><th>Pregunta</th><th>Validación</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.row}</td><td>${e(r.question.prompt)}<br>${{single:'Una respuesta',multiple:'Selección múltiple',text:'Respuesta abierta'}[r.question.type]||e(r.question.type)} · ${r.question.points} puntos</td><td>${r.errors.map(e).join('<br>')||'Lista para importar'}</td></tr>`).join('')}</tbody></table></div>${valid?`<button type="button" class="btn" data-confirm-import>${icon('plus')}Añadir preguntas al editor</button>`:'<p class="field-hint">Corrige el archivo o la asignación de columnas y vuelve a validar.</p>'}`;
     target.querySelector('[data-confirm-import]')?.addEventListener('click',event=>{
      const list=form.querySelector('#question-list'),start=list.children.length;
      if(start+rows.length>50){toast('El cuestionario admite hasta 50 preguntas.');return;}
      event.currentTarget.disabled=true;
      for(const row of rows){list.insertAdjacentHTML('beforeend',questionEditor(row.question,list.children.length+1));questionFields(list.lastElementChild,row.question);}
      box.textContent=`${rows.length} preguntas añadidas. Revisa y guarda la actividad.`;input.value='';
      form.dispatchEvent(new Event('activity-editor-change'));list.children[start]?.querySelector('[name=qPrompt]').focus();
     });
    }catch(error){if(version===generation)target.textContent=error.message;}finally{validate.disabled=false;}
   };
  }catch(error){if(version===generation)box.textContent=error.message;}finally{input.disabled=false;}
 };
}
