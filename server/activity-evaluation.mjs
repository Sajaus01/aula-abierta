const emptyCounts=()=>({submitted:0,evaluated:0,pending:0,unreleased:0,returned:0});
const payload=value=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{return null;}};
const stateFor=counts=>counts.pending?'pending':counts.returned?'correction':counts.submitted?'evaluated':'empty';

// A new unsent attempt does not erase teaching work on the preceding delivery.
// A returned response (including its saved draft) is the current correction.
export function summarizeActivityEvaluation(activity,records) {
 const counts=emptyCounts(),chosen=new Set();
 const ordered=records.filter(record=>!record.superseded&&record.eligible!==false&&record.eligible!==0).sort((a,b)=>(b.attempt||0)-(a.attempt||0)||String(b.updated_at||'').localeCompare(String(a.updated_at||''))||String(b.id||'').localeCompare(String(a.id||'')));
 for(const record of ordered){
  if(chosen.has(record.student_id))continue;
  if(record.state==='draft'&&!record.returned_at)continue;
  if(!['submitted','graded','returned','draft'].includes(record.state))continue;
  chosen.add(record.student_id);
  if(record.state==='returned'||record.state==='draft'&&record.returned_at){counts.returned++;continue;}
  counts.submitted++;
  const data=payload(record.payload),draft=data?.teacherGradeDraft||null,points=draft?draft.points:record.points,maximum=data?.previousActivity?.maxPoints||activity.maxPoints;
  const valid=Boolean(data&&Number.isFinite(points)&&points>=0&&Number.isFinite(maximum)&&maximum>0&&points<=maximum&&!data.procedureReviewPending);
  if(!valid){counts.pending++;continue;}
  counts.evaluated++;if(draft||!record.published)counts.unreleased++;
 }
 return {state:activity.status==='draft'?'draft':activity.status==='archived'?'archived':stateFor(counts),...counts};
}

export function summarizeCourseEvaluation(activities) {
 const counts=emptyCounts(),activityCounts={evaluated:0,pending:0,empty:0,correction:0,draft:0,archived:0};
 for(const activity of activities){const summary=activity.evaluation;if(!summary)continue;if(Object.hasOwn(activityCounts,summary.state))activityCounts[summary.state]++;if(activity.status==='published')for(const key of Object.keys(counts))counts[key]+=summary[key];}
 return {state:stateFor(counts),...counts,activityCounts};
}

export function createActivityEvaluation({db,accessModel}) {
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 function canRead(auth,courseId){return Boolean(auth?.assurance==='password'&&!auth.preview&&auth.view!=='learning'&&(accessModel?accessModel.staff(auth)&&accessModel.p.can(auth.user.id,courseId,'grade'):auth.user?.role==='admin'));}
 function pendingByCourse(courseIds){
  if(!courseIds.length)return new Map();const marks=courseIds.map(()=>'?').join(',');
  return new Map(all(`SELECT a.course_id,count(*) pending FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id IN(${marks}) AND s.superseded=0 AND (s.state='submitted' OR (s.state='graded' AND s.published=0) OR (CASE WHEN json_valid(s.payload) THEN json_type(s.payload,'$.teacherGradeDraft')='object' ELSE 0 END)) GROUP BY a.course_id`,...courseIds).map(row=>[row.course_id,row.pending]));
 }
 function counts(courseIds){
  if(!courseIds.length)return new Map();const marks=courseIds.map(()=>'?').join(',');
  return new Map(all(`SELECT s.activity_id,
   sum(s.state NOT IN('draft','returned')) submissionCount,
   sum(s.state='draft' AND s.returned_at IS NULL) draftCount,
   sum(s.state='returned' OR s.state='draft' AND s.returned_at IS NOT NULL) returnedCount,
   count(*) activeResponseCount FROM submissions s JOIN activities a ON a.id=s.activity_id WHERE a.course_id IN(${marks}) AND s.superseded=0 GROUP BY s.activity_id`,...courseIds).map(row=>[row.activity_id,{submissionCount:row.submissionCount,draftCount:row.draftCount,returnedCount:row.returnedCount,activeResponseCount:row.activeResponseCount}]));
 }
 function summaries(courseIds,auth,{at=new Date().toISOString()}={}) {
  const ids=[...new Set(courseIds)].filter(id=>canRead(auth,id));if(!ids.length)return new Map();const marks=ids.map(()=>'?').join(',');
  const activities=all(`SELECT id,course_id,config FROM activities WHERE course_id IN(${marks}) ORDER BY created_at,id`,...ids),legacyCounts=counts(ids);
  // Only grading fields are read from the payload; answers, text and files never
  // enter the aggregate and no personal identifiers appear in its public DTO.
  const records=all(`SELECT s.id,s.activity_id,s.student_id,s.attempt,s.state,s.points,s.published,s.returned_at,s.updated_at,
   CASE WHEN json_valid(s.payload) THEN json_object('teacherGradeDraft',json_extract(s.payload,'$.teacherGradeDraft'),'previousActivity',json_object('maxPoints',json_extract(s.payload,'$.previousActivity.maxPoints')),'procedureReviewPending',json_extract(s.payload,'$.procedureReviewPending')) ELSE NULL END payload
   FROM submissions s JOIN activities a ON a.id=s.activity_id JOIN users u ON u.id=s.student_id
   WHERE a.course_id IN(${marks}) AND s.superseded=0 AND u.active=1
   AND EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id=a.course_id AND e.student_id=s.student_id AND e.status='active' AND (e.starts_at IS NULL OR e.starts_at<=?) AND (e.expires_at IS NULL OR e.expires_at>?))
   ${accessModel?"AND u.account_status='active' AND EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='student') AND NOT EXISTS(SELECT 1 FROM grade_overrides g WHERE g.activity_id=s.activity_id AND g.student_id=s.student_id AND g.exempt=1)":"AND u.role='student'"}
   ORDER BY s.activity_id,s.student_id,s.attempt DESC,s.updated_at DESC,s.id DESC`,...ids,at,at);
  const byActivity=new Map();for(const record of records){const list=byActivity.get(record.activity_id)||[];list.push(record);byActivity.set(record.activity_id,list);}
  const result=new Map(ids.map(courseId=>[courseId,{activities:[],byActivity:new Map(),legacyCounts}]));
  for(const row of activities){const config=payload(row.config)||{},entry={id:row.id,title:config.title||'',status:config.status,evaluation:summarizeActivityEvaluation(config,byActivity.get(row.id)||[])},course=result.get(row.course_id);course.activities.push(entry);course.byActivity.set(row.id,entry);}
  for(const course of result.values())course.evaluation=summarizeCourseEvaluation(course.activities);
  return result;
 }
 return {canRead,summaries,counts,pendingByCourse};
}
