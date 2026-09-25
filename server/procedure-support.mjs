import {procedurePolicy,SUPPORT_FORMATS,supportFileAllowed} from '../public/procedure-support.js';

export function validateProcedurePolicy(input,fail){
 if(input===undefined)return procedurePolicy();
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Configuración de soportes no válida.');
 const p={...procedurePolicy(),...input};
 if(typeof p.enabled!=='boolean'||typeof p.reviewRequired!=='boolean')fail(400,'Revisa las opciones de soportes y revisión docente.');
 if(typeof p.instructions!=='string'||p.instructions.length>4000)fail(400,'Las indicaciones de los soportes admiten hasta 4000 caracteres.');
 if(!Array.isArray(p.formats)||p.formats.some(id=>!SUPPORT_FORMATS.some(f=>f.id===id))||new Set(p.formats).size!==p.formats.length||(p.enabled&&!p.formats.length))fail(400,'Selecciona al menos un formato válido para los soportes.');
 if(!Number.isInteger(p.maxFiles)||p.maxFiles<1||p.maxFiles>5)fail(400,'Configura entre 1 y 5 archivos de soporte.');
 return {enabled:p.enabled,instructions:p.instructions.trim(),formats:[...p.formats],maxFiles:p.maxFiles,reviewRequired:p.reviewRequired};
}
export function validateProcedureFiles(policy,files,final,fail){
 if(!policy.enabled)return;
 if(final&&!files.length)fail(400,'Adjunta al menos un archivo con los soportes de tus procedimientos antes de entregar.','PROCEDURE_SUPPORT_REQUIRED');
 if(files.length>policy.maxFiles)fail(400,`Tu docente admite hasta ${policy.maxFiles} archivos de soporte.`);
 if(files.some(f=>!supportFileAllowed(policy,f.name)))fail(400,'Uno de los archivos de soporte no tiene un formato admitido por tu docente.');
}
