// A chapter outcome describes the learner's official result in one activity.
// Submission completion and semester accumulation remain separate measures.
export function activityOutcome(latest,cell,settings) {
 if(cell?.state==='exempt')return {state:'exempt',satisfactory:true};
 if(!latest||!['submitted','graded'].includes(latest.state)||latest.returned_at)return {state:'pending',satisfactory:false};
 const graded=cell?.state==='graded'&&cell.published&&cell.submissionId===latest.id;
 const points=cell?.points,maximum=cell?.maxPoints,scale=settings?.scaleMax,passMark=settings?.passMark;
 if(!graded||!Number.isFinite(points)||!Number.isFinite(maximum)||maximum<=0||!Number.isFinite(scale)||scale<=0||!Number.isFinite(passMark)||passMark<0||passMark>scale)return {state:'submitted-awaiting-grade',satisfactory:false};
 const satisfactory=points/maximum>=passMark/scale;
 return {state:satisfactory?'gradedPass':'gradedBelow',satisfactory};
}
