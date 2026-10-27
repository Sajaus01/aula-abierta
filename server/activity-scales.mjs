import {submissionMaxPoints} from '../public/grading-scale.js';

export function prepareScaleConversions(records,activity,nextMaximum,fail,{at=new Date().toISOString(),skipDrafts=false}={}) {
 if(!Number.isFinite(nextMaximum)||nextMaximum<=0)fail(400,'La nueva escala de puntos no es válida.');
 const converted=[];
 for(const record of records){
  if(record.superseded||skipDrafts&&record.state==='draft')continue;
  const original=JSON.parse(record.payload),from=submissionMaxPoints(original,activity);
  if(from===nextMaximum)continue;
  const adjust=value=>{if(value===null||value===undefined)return value;if(!Number.isFinite(value)||!from||value<0||value>from)fail(409,'Una calificación tiene una escala inválida. Revísala antes de cambiar los puntos máximos.');return value/from*nextMaximum;};
  const next={...original,gradingMaxPoints:nextMaximum};
  const points=adjust(record.points);
  if(original.teacherGradeDraft){if(typeof original.teacherGradeDraft!=='object'||Array.isArray(original.teacherGradeDraft)||!Object.hasOwn(original.teacherGradeDraft,'points'))fail(409,'Una nota guardada no es válida. Revísala antes de cambiar la escala.');next.teacherGradeDraft={...original.teacherGradeDraft,points:adjust(original.teacherGradeDraft.points)};}
  if(Object.hasOwn(original,'automaticPoints'))next.automaticPoints=adjust(original.automaticPoints);
  if(from&&from!==nextMaximum)next.scaleAdjustment={from,to:nextMaximum,at};
  const before={points:record.points,gradingMaxPoints:from,automaticPoints:original.automaticPoints??null,draftPoints:original.teacherGradeDraft?.points??null,published:Boolean(record.published)};
  const after={points,gradingMaxPoints:nextMaximum,automaticPoints:next.automaticPoints??null,draftPoints:next.teacherGradeDraft?.points??null,published:Boolean(record.published)};
  converted.push({id:record.id,studentId:record.student_id,version:record.version,from,to:nextMaximum,points,payload:next,before,after});
 }
 return converted;
}
