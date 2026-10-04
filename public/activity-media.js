import {escapeHtml as e} from './lib.js';

export function previewUrl(value){
 try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';return u.href;}catch{return '';}
}
export function embedUrl(value){
 const href=previewUrl(value);if(!href)return '';const u=new URL(href);
 if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname)){
  const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
  if(/^[\w-]{11}$/.test(id||''))return 'https://www.youtube-nocookie.com/embed/'+id;
 }
 if(u.hostname==='drive.google.com'){const id=u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1];if(id)return 'https://drive.google.com/file/d/'+id+'/preview';}
 return u.protocol==='https:'?href:'';
}
export function linkPreview(value,label='Material de apoyo'){
 const href=previewUrl(value);if(!href)return '';const embed=embedUrl(href),host=new URL(href).hostname;
 return `<details class="activity-link-preview" data-preview-kind="${embed.includes('youtube-nocookie.com/embed/')?'video':'page'}"><summary><span>${e(label)}</span><small>${e(host)}</small><span>Vista previa</span></summary><div class="activity-link-body">${embed?`<iframe src="${e(embed)}" title="${e(label)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="fullscreen; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`:''}<div class="activity-link-footer"><p>Si la página no permite mostrarse aquí, puedes abrirla en otra pestaña.</p><a class="btn secondary small" href="${e(href)}" target="_blank" rel="noopener noreferrer">Abrir en otra pestaña ↗</a></div></div></details>`;
}
export function linkedText(value){
 const text=String(value||''),parts=[],pattern=/https?:\/\/[^\s<>"']+/g;let cursor=0;
 for(const match of text.matchAll(pattern)){parts.push(e(text.slice(cursor,match.index)));let href=match[0].replace(/[.,;!?)\]]+$/,'');parts.push(previewUrl(href)?`<a href="${e(href)}" target="_blank" rel="noopener noreferrer">${e(href)}</a>`:e(href));parts.push(e(match[0].slice(href.length)));cursor=match.index+match[0].length;}
 parts.push(e(text.slice(cursor)));return parts.join('');
}
export function textPreviews(value,extra=''){
 const links=[extra,...(String(value||'').match(/https?:\/\/[^\s<>"']+/g)||[]).map(v=>v.replace(/[.,;!?)\]]+$/,''))].filter(previewUrl);
 return [...new Set(links)].slice(0,6).map((url,i)=>linkPreview(url,`Recurso de apoyo ${i+1}`)).join('');
}
export function questionVisual(q,attachments=[]){
 const files=(q.media||[]).map(name=>attachments.find(f=>f.name===name)).filter(Boolean),images=files.filter(f=>f.mime?.startsWith('image/'));
 if(q.imageUrl&&previewUrl(q.imageUrl))images.unshift({url:q.imageUrl,name:q.imageAlt||'Imagen del enunciado'});
 return images.length?`<aside class="question-illustrations" aria-label="Imágenes del enunciado">${images.map(f=>`<figure><a href="${e(f.url)}" target="_blank" rel="noopener noreferrer" title="Ampliar imagen"><img src="${e(f.url)}" alt="${e(q.imageAlt||f.name||'Imagen del enunciado')}" loading="lazy"></a>${q.imageAlt?`<figcaption>${e(q.imageAlt)}</figcaption>`:''}<small>Selecciona la imagen para ampliarla</small></figure>`).join('')}</aside>`:'';
}
export function questionHeading(q,attachments=[],title=''){
 const visual=questionVisual(q,attachments);
 return `<div class="question-statement ${visual?'with-images':''}"><div class="question-statement-text">${title?`<span class="overline">${e(title)}</span>`:''}<p class="academic-text question-prompt">${linkedText(q.prompt)}</p>${textPreviews(q.prompt,q.linkUrl)}</div>${visual}</div>`;
}

