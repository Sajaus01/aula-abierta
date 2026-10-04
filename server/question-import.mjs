import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';

export async function readQuestionsWorkbook(bytes){
 if(bytes.length>10*1024*1024)throw Error('El Excel supera 10 MB.');
 // Validate actual expansion before passing this untrusted ZIP to the workbook parser.
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw Error('Excel no válido.');
 const count=bytes.readUInt16LE(end+10);if(count>600)throw Error('Demasiadas partes en el Excel.');
 let offset=bytes.readUInt32LE(end+16),total=0;
 for(let n=0;n<count;n++){
  if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('Excel dañado.');
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),size=bytes.readUInt32LE(offset+20),expected=bytes.readUInt32LE(offset+24),local=bytes.readUInt32LE(offset+42);
  if(flags&1||![0,8].includes(method)||expected>20*1024*1024||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw Error('Formato Excel no admitido.');
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);if(start+size>offset)throw Error('Excel dañado.');
  const source=bytes.subarray(start,start+size),expanded=method===8?inflateRawSync(source,{maxOutputLength:20*1024*1024}):source;
  total+=expanded.length;if(expanded.length!==expected||total>40*1024*1024)throw Error('Excel demasiado grande al descomprimir.');
  offset+=46+bytes.readUInt16LE(offset+28)+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32);
 }
 // Some valid producers use prefixed SpreadsheetML elements; ExcelJS expects
 // the default namespace. Normalize just that namespace, preserving relationships.
 const zip=await JSZip.loadAsync(bytes);let normalized=false;
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.xml'))){let xml=await zip.file(name).async('string');const ns=/xmlns:([A-Za-z_][\w.-]*)="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/.exec(xml);if(ns){const prefix=ns[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');xml=xml.replace(new RegExp('(<\\/?)(?:'+prefix+'):','g'),'$1').replace(ns[0],'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');zip.file(name,xml);normalized=true;}}
 const book=new ExcelJS.Workbook();await book.xlsx.load(normalized?await zip.generateAsync({type:'nodebuffer'}):bytes);
 const sheet=book.getWorksheet('Preguntas')||book.worksheets[0];if(!sheet||sheet.rowCount>501||sheet.columnCount>30)throw Error('Usa hasta 500 filas y 30 columnas.');
 const value=cell=>{const v=cell.value;if(v===null||v===undefined)return '';if(typeof v==='string'||typeof v==='number')return String(v);if(v.richText)return v.richText.map(x=>x.text).join('');if(v.hyperlink)return String(v.hyperlink);throw Error('No se admiten fórmulas, fechas ni objetos en las preguntas.');};
 const headers=Array.from({length:sheet.columnCount},(_,i)=>value(sheet.getRow(1).getCell(i+1))||`Columna ${i+1}`),rows=[];
 for(let n=2;n<=sheet.rowCount;n++){const cells=headers.map((_,i)=>value(sheet.getRow(n).getCell(i+1)));if(cells.some(v=>v.trim()))rows.push({row:n,cells,images:[]});}
 let imageBytes=0,imageCount=0;for(const drawing of sheet.getImages()){
  const n=Math.floor(drawing.range.tl.nativeRow)+1,row=rows.find(r=>r.row===n);
  if(!row)throw Error(`La imagen de la fila ${n} no tiene una pregunta. Colócala en la fila del enunciado.`);
  const source=book.getImage(drawing.imageId),extension=String(source.extension).toLowerCase();
  const buffer=source.buffer?Buffer.from(source.buffer):Buffer.from(String(source.base64||'').replace(/^data:[^,]+,/,''),'base64');
  const image=validateWorkbookImage({name:`excel-fila-${n}-${row.images.length+1}.${extension}`,base64:buffer.toString('base64')});
  imageBytes+=buffer.length;if(++imageCount>50||row.images.length>=5||imageBytes>20*1024*1024)throw Error('Hasta 5 imágenes por pregunta, 50 en total y 20 MB de imágenes.');
  row.images.push(image);
 }
 return {headers,rows};
}
function validateWorkbookImage(image){
 if(!image||typeof image.name!=='string'||!/^[^\\/\x00-\x1f]{1,170}\.(png|jpe?g|gif)$/i.test(image.name)||typeof image.base64!=='string'||image.base64.length>7*1024*1024)throw Error('Las imágenes de Excel deben ser PNG, JPG o GIF, hasta 5 MB por imagen.');
 const b=Buffer.from(image.base64,'base64'),ext=image.name.split('.').pop().toLowerCase();
 const valid=b.length&&b.length<=5*1024*1024&&b.toString('base64')===image.base64&&(ext==='png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['jpg','jpeg'].includes(ext)?b[0]===255&&b[1]===216&&b[2]===255:['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()));
 if(!valid)throw Error('Una imagen del Excel está dañada o no coincide con su formato.');return {name:image.name,base64:image.base64};
}
export function mapQuestions(rows,mapping){
 if(!Array.isArray(rows)||rows.length>50)throw Error('Importa de 1 a 50 preguntas.');
 return rows.map(row=>{const get=k=>String(row.cells?.[mapping[k]]??'').trim(),errors=[],type=get('type').toLowerCase(),prompt=[get('prompt'),get('instructions')].filter(Boolean).join('\n'),options=['option1','option2','option3','option4'].map(get).filter(Boolean),correct=get('correct').split(/[,;]/).filter(Boolean).map(v=>Number(v.trim())-1),points=Number(get('points')),imageUrl=get('image'),feedback=get('feedback');
  if(!prompt||prompt.length>3000)errors.push('Enunciado obligatorio, máximo 3000 caracteres.');
  if(!['single','multiple','text'].includes(type))errors.push('Tipo: single, multiple o text.');
  if(!Number.isFinite(points)||points<0.1||points>1000)errors.push('Puntos entre 0,1 y 1000.');
  if(type!=='text'&&(options.length<2||options.some(v=>v.length>1000)||!correct.length||correct.some(v=>!Number.isInteger(v)||v<0||v>=options.length)||new Set(correct).size!==correct.length||type==='single'&&correct.length!==1))errors.push('Revisa las opciones y los números de respuestas correctas.');
  if(imageUrl&&!/^https:\/\/[^\s]+$/.test(imageUrl))errors.push('La imagen debe usar HTTPS.');if(feedback.length>3000)errors.push('Retroalimentación demasiado larga.');
  const imageAlt=get('imageAlt'),linkUrl=get('link');if(imageAlt.length>500)errors.push('Descripción de imagen: máximo 500 caracteres.');if(linkUrl){try{const u=new URL(linkUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();}catch{errors.push('El enlace de apoyo debe ser HTTP o HTTPS sin credenciales.');}}
  const embeddedImages=(row.images||[]).map(validateWorkbookImage);if(embeddedImages.length>5)throw Error('Hasta 5 imágenes por pregunta.');
  return {row:row.row,errors,question:{id:randomUUID(),type,prompt,options:type==='text'?[]:options,correct:type==='text'?[]:correct,points,imageUrl,imageAlt,linkUrl,feedback,embeddedImages}};
 });
}
export function createQuestionImport({accessModel:a,fail,json,readJson,readSession}){return {handler:async(req,res,path,method,auth)=>{
 if(!path.startsWith('/api/question-import/'))return false;if(!a.staff(auth)||auth.preview)fail(403,'Se requiere acceso docente.');
 if(path==='/api/question-import/template'&&method==='GET'){const bytes=Buffer.from(readFileSync(new URL('../templates/questions.base64',import.meta.url),'utf8'),'base64');res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="plantilla-cuestionarios.xlsx"'});res.end(bytes);return true;}
 if(method==='POST'){const b=await readJson(req,29*1024*1024);auth=readSession(req);if(!a.staff(auth)||auth.preview)fail(403,'Se requiere acceso docente.');let result;try{if(path.endsWith('/read'))result=await readQuestionsWorkbook(Buffer.from(b.base64||'','base64'));else if(path.endsWith('/preview'))result=mapQuestions(b.rows,b.mapping||{});else fail(404,'Importación no encontrada.');}catch(error){fail(400,error.message);}json(res,result);return true;}
 fail(404,'Importación no encontrada.');
 }};}
