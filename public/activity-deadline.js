const timestamp=value=>value?Date.parse(value):NaN;
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);

// The server sends the resolved policy. Fallbacks keep older course summaries
// and restored pages readable; the API always checks the current authorization.
export function studentDeadline(activity={},mine=[],at=Date.now()){
 const now=typeof at==='number'?at:Date.parse(at),correction=mine.find(item=>item.returnedAt&&['draft','returned'].includes(item.state));
 let policy=activity.deadline&&typeof activity.deadline==='object'?activity.deadline:null;
 if(!policy){
  const extension=activity.extension,returnedAt=correction?.returnedAt||activity.returnedAt;
  const returned=Boolean(correction||activity.responseState==='returned');
  const useExtension=Boolean(extension?.active&&(!returned||!returnedAt||timestamp(extension.updatedAt)>=timestamp(returnedAt)));
  const source=useExtension?'extension':returned?'correction':'activity';
  const dueAt=useExtension?extension.dueAt??null:returned?(correction?correction.returnDueAt:activity.returnDueAt)??null:has(activity,'effectiveDueAt')?activity.effectiveDueAt:activity.dueAt??null;
  policy={source,opensAt:activity.opensAt??null,dueAt,closesAt:source==='activity'?(has(activity,'effectiveClosesAt')?activity.effectiveClosesAt:activity.closesAt??null):dueAt,allowLate:source==='activity'&&Boolean(activity.allowLate),extension};
 }
 const future=timestamp(policy.opensAt)>now,closed=timestamp(policy.closesAt)<=now||!policy.allowLate&&timestamp(policy.dueAt)<=now;
 return {...policy,future,closed:Boolean(closed),extension:policy.extension??activity.extension??null};
}

export function activityDueAt(activity,mine=[]){const policy=studentDeadline(activity,mine);return policy.dueAt??policy.closesAt??null;}
export function hasIndividualDeadline(activity,mine=[],at=Date.now()){return studentDeadline(activity,mine,at).source==='extension';}
export function deadlineDate(value){return value?new Date(value).toLocaleString('es-CO',{timeZone:'America/Bogota',dateStyle:'medium',timeStyle:'short'}):'Sin fecha límite';}
export function individualDeadlineLabel(activity,mine=[],at=Date.now()){
 const policy=studentDeadline(activity,mine,at);
 if(policy.source!=='extension')return '';
 return policy.closed?'Plazo individual vencido':policy.dueAt?'Tu plazo: '+deadlineDate(policy.dueAt):'Entrega habilitada sin fecha límite';
}
