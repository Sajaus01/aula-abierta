// Teacher-assigned marks are independent of student deliveries. In particular,
// they do not consume attempts, create a submitted_at date or reopen a deadline.
export function setupManualGrades(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS activity_manual_grades(
 id TEXT PRIMARY KEY,activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,revision INTEGER NOT NULL,
 points REAL,feedback TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,
 draft_payload TEXT,max_points REAL NOT NULL,scale_adjustment TEXT,
 superseded INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS activity_manual_grade_current ON activity_manual_grades(activity_id,student_id) WHERE superseded=0;
 CREATE INDEX IF NOT EXISTS activity_manual_grade_student ON activity_manual_grades(student_id,activity_id,superseded);`);
}

export function manualGradeRecord(row,{forAdmin=false}={}) {
 if(!row||!forAdmin&&!row.published)return null;
 const draft=forAdmin&&row.draft_payload?JSON.parse(row.draft_payload):null;
 const payload={gradingMaxPoints:row.max_points,...(row.scale_adjustment?{scaleAdjustment:JSON.parse(row.scale_adjustment)}:{}),...(draft?{teacherGradeDraft:draft}:{})};
 return {...row,manualGrade:true,state:'graded',payload:JSON.stringify(payload),points:draft?draft.points:row.points,feedback:draft?draft.feedback:row.feedback,published:draft?0:row.published,submitted_at:null,returned_at:null,return_due_at:null,attempt:0,late:0};
}

export function manualGradeDTO(row,{forAdmin=false}={}) {
 const record=manualGradeRecord(row,{forAdmin});if(!record)return null;
 const draft=forAdmin&&row.draft_payload?JSON.parse(row.draft_payload):null;
 return {id:row.id,manualGrade:true,activityId:row.activity_id,studentId:row.student_id,name:row.name,document:row.document,revision:row.revision,superseded:Boolean(row.superseded),gradingMaxPoints:row.max_points,scaleAdjustment:row.scale_adjustment?JSON.parse(row.scale_adjustment):null,points:record.points,feedback:record.feedback,published:Boolean(row.published),version:row.version,updatedAt:row.updated_at,state:record.points===null?'submitted':'graded',attempt:0,submittedAt:null,returnedAt:null,returnDueAt:null,late:false,answers:{},files:[],text:'',url:'',instructionFiles:[],questionFeedback:[],...(forAdmin?{gradeDraft:!!draft,publishedPoints:row.published?row.points:null,publishedFeedback:row.published?row.feedback:''}:{})};
}
