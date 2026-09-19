import {getDocument,GlobalWorkerOptions} from '/pdfjs/legacy/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='/pdfjs/legacy/build/pdf.worker.mjs';
const canvas=document.getElementById('canvas'),status=document.getElementById('status'),input=document.getElementById('page'),zoom=document.getElementById('zoom'),previous=document.getElementById('previous'),next=document.getElementById('next'),text=document.getElementById('text');
let pdf,current=1,renderTask,generation=0;
async function render(){if(!pdf)return;const version=++generation,previousTask=renderTask;previousTask?.cancel();status.textContent='Cargando página…';
 try{if(previousTask)await previousTask.promise.catch(()=>{});if(version!==generation)return;const page=await pdf.getPage(current);if(version!==generation)return;const natural=page.getViewport({scale:1}),desired=zoom.value==='fit'?Math.max(180,document.documentElement.clientWidth-32)/natural.width:Number(zoom.value);const scale=Math.min(desired,Math.sqrt(8000000/(natural.width*natural.height)));const viewport=page.getViewport({scale}),density=Math.min(window.devicePixelRatio||1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
  canvas.width=Math.floor(viewport.width*density);canvas.height=Math.floor(viewport.height*density);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('aria-label',`Página ${current} de ${pdf.numPages}`);
  renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[density,0,0,density,0,0]});await renderTask.promise;if(version!==generation)return;
  input.value=current;previous.disabled=current===1;next.disabled=current===pdf.numPages;status.textContent=`Página ${current} de ${pdf.numPages}`;
  const content=await page.getTextContent();if(version===generation)text.textContent=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')||'Esta página contiene una imagen o no tiene texto seleccionable.';
 }catch(error){if(error.name!=='RenderingCancelledException'&&version===generation)status.textContent='No pudimos mostrar esta página. Puedes descargar el PDF.';}
}
try{const url=new URL(new URLSearchParams(location.search).get('file')||'',location.origin);if(url.origin!==location.origin||!/^\/api\/academics\/(?:activities\/[^/]+\/attachments\/[^/]+|submissions\/[^/]+\/files\/[^/]+)$/.test(url.pathname))throw Error('Ruta no válida');
 const download=document.getElementById('download');download.href=url.pathname+'?download=1';download.hidden=false;
 pdf=await getDocument({url:url.pathname,isEvalSupported:false,enableXfa:false,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'}).promise;
 document.getElementById('count').textContent='de '+pdf.numPages;input.max=pdf.numPages;input.disabled=false;await render();
}catch(error){status.textContent='No se pudo abrir el PDF. Verifica tu acceso o usa Descargar PDF. Puede requerir contraseña.';}
previous.addEventListener('click',()=>{if(current>1){current--;render();}});next.addEventListener('click',()=>{if(pdf&&current<pdf.numPages){current++;render();}});input.addEventListener('change',()=>{const n=Number(input.value);if(pdf&&Number.isInteger(n)&&n>=1&&n<=pdf.numPages){current=n;render();}else input.value=current;});zoom.addEventListener('change',render);
let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(()=>{if(zoom.value==='fit')render();},150);});window.addEventListener('pagehide',()=>{renderTask?.cancel();pdf?.destroy();});
