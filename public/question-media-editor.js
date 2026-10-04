import {questionVisual} from './activity-media.js';
export function bindQuestionMediaEditor(field,q={}){
 const urls=[];const repaint=()=>{urls.splice(0).forEach(URL.revokeObjectURL);const files=[...field.querySelector('[name=qFiles]').files].filter(f=>f.type.startsWith('image/'));const attachments=files.map(f=>{const url=URL.createObjectURL(f);urls.push(url);return {name:f.name,mime:f.type,url};});field.mediaPreviewItems=attachments;const kept=[...field.querySelectorAll('[name=qMediaKeep]:checked')].map(el=>el.value);field.querySelector('[data-question-image-preview]').innerHTML=questionVisual({imageUrl:field.querySelector('[name=qImage]').value,imageAlt:field.querySelector('[name=qImageAlt]').value,media:[...kept,...attachments.map(f=>f.name)]},[...(field.closest('form').activityMediaAttachments||[]),...attachments]);};
 field.querySelector('[name=qFiles]').addEventListener('change',repaint);field.querySelector('[name=qImageAlt]').addEventListener('input',repaint);
 field.querySelector('[name=qImage]').addEventListener('change',repaint);for(const input of field.querySelectorAll('[name=qMediaKeep]'))input.addEventListener('change',repaint);
 const dialog=field.closest('dialog');dialog?.addEventListener('close',()=>urls.splice(0).forEach(URL.revokeObjectURL),{once:true});repaint();
}
