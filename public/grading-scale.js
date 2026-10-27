const validMaximum=value=>Number.isFinite(value)&&value>0;

export function submissionMaxPoints(submission,activity) {
 const maximum=submission?.gradingMaxPoints??submission?.previousActivity?.maxPoints??activity?.maxPoints;
 return validMaximum(maximum)?maximum:null;
}

export function submissionScaleAdjustment(submission,activity) {
 const maximum=submissionMaxPoints(submission,activity),adjustment=submission?.scaleAdjustment;
 if(adjustment&&validMaximum(adjustment.from)&&validMaximum(adjustment.to)&&adjustment.from!==adjustment.to&&adjustment.to===maximum)return {from:adjustment.from,to:adjustment.to,...(typeof adjustment.at==='string'?{at:adjustment.at}:{})};
 const original=submission?.previousActivity?.maxPoints,current=submission?.gradingMaxPoints;
 return validMaximum(original)&&validMaximum(current)&&original!==current?{from:original,to:current}:null;
}

export function questionPointsTotal(questions) {
 const total=questions.reduce((sum,question)=>sum+Number(typeof question==='number'?question:question.points),0);
 return Number.isFinite(total)?Number(total.toPrecision(15)):total;
}
