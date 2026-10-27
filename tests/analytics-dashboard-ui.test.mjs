import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsHref,analyticsDuration,renderGroupSummary,renderStudentOverview,renderActiveBars,renderDailyLine,renderSubmissionDonut,renderGradeDistribution,renderStudentDetail,renderGroupOverview,analyticsCSV,gradeHistoryChart,createAnalyticsUI} from '../public/analytics-dashboard.js';
import {createPanoramaUI} from '../public/panorama.js';

function fixture(){
 const students=[{id:'s1',name:'Ana <script>bad()</script>',document:'test-1',activeEnrollment:true,current:{submitted:2,pending:1,overdue:1,awaitingGrade:1,materialsCompleted:2,materialsTotal:4,progress:50,gradeAccumulated:1.6,gradeFinal:null,scaleMax:5,lastActivityAt:'2026-10-27T18:00:00Z'},period:{visits:3,sessions:2,activeSeconds:600,averageSessionSeconds:300},grade:{periods:[]}},{id:'s2',name:'Luis',document:'test-2',activeEnrollment:true,current:{submitted:0,pending:1,overdue:0,awaitingGrade:0,materialsCompleted:0,materialsTotal:4,progress:0,gradeAccumulated:0,gradeFinal:null,scaleMax:5,lastActivityAt:null},period:{visits:0,sessions:0,activeSeconds:0,averageSessionSeconds:0},grade:{periods:[]}}];
 const group={students:2,visits:3,sessions:2,activeSeconds:600,averageSessionSeconds:300,averageActiveSeconds:300,progress:25,gradeAccumulated:.8,scaleMax:5,submitted:2,pending:2,overdue:1,awaitingGrade:1,activityPendingTotal:3,materialsCompleted:2,materialsTotal:8};
 return {group:{id:'group-one',title:'Circuitos',cohort:'2026-2',code:'A'},settings:{scaleMax:5,passMark:3,periods:[]},filters:{from:'2026-10-27',to:'2026-10-31',studentId:'',activityId:'activity-one'},students,studentOptions:students.map(({id,name})=>({id,name})),groupOptions:[{id:'group-one',title:'Circuitos',cohort:'2026-2',code:'A'}],activityOptions:[{id:'activity-one',title:'Informe'}],summary:{group,selection:{...group}},measurement:{startedAt:'2026-10-27T05:00:00Z',available:true,partialCoverage:false,definitions:{active:'Solo tiempo con interacción.'}},daily:[{date:'2026-10-27',activeSeconds:300,visits:1,sessions:1},{date:'2026-10-28',activeSeconds:180,visits:1,sessions:0},{date:'2026-10-31',activeSeconds:120,visits:1,sessions:1}],detail:null,comparison:[],changes:[],labs:[],activities:[],definitions:{},updatedAt:'2026-10-31T20:00:00Z'};
}
const heading=(title,subtitle,actions='')=>`<header><h1>${title}</h1><p>${subtitle}</p>${actions}</header>`;

test('summary separates the measured period from current academic results and keeps the full-group baseline',()=>{
 const report=fixture();report.filters.studentId='s1';report.summary.selection={...report.summary.group,students:1,activeSeconds:600};
 const html=renderGroupSummary(report);
 assert.match(html,/600|10 min/);assert.match(html,/2 en el grupo/);assert.match(html,/5 min activos por estudiante/);
 assert.match(html,/período seleccionado/);assert.match(html,/calificaciones: estado actual/);assert.match(html,/Acumulada media sobre el 100 %/);
});

test('missing historical measurement is not rendered as zero visits, sessions or active time',()=>{
 const report=fixture();report.measurement.available=false;report.measurement.startedAt=null;
 const summary=renderGroupSummary(report),roster=renderStudentOverview(report),line=renderDailyLine(report);
 assert.match(summary,/Sin medición/);assert.match(summary,/— ingresos · — sesiones/);
 assert.match(roster,/data-active="-1"/);assert.doesNotMatch(roster,/<strong>0<\/strong><small>0 sesiones/);
 assert.doesNotMatch(line,/<polyline|<circle/);assert.match(line,/no se estiman/);
 assert.equal(analyticsDuration(0),'0 s');assert.equal(analyticsDuration(null),'Sin medición');
});

test('student and grade links preserve backend filter aliases and never cross into another group',()=>{
 const report=fixture();report.filters.studentId='s1';
 const href=analyticsHref(report,{},'calificaciones');
 assert.ok(href.startsWith('#calificaciones/group-one?'));assert.ok(href.includes('from=2026-10-27'));assert.ok(href.includes('to=2026-10-31'));assert.ok(href.includes('student=s1'));assert.ok(href.includes('activity=activity-one'));
 const roster=renderStudentOverview(report,{gradebook:true});assert.match(roster,/view=matrix/);assert.match(roster,/tab=student/);assert.doesNotMatch(roster,/group-two/);
 assert.equal(analyticsHref(report,{student:null}).includes('student='),false);
});

test('student overview escapes all person data and distinguishes pending, overdue and work awaiting a grade',()=>{
 const html=renderStudentOverview(fixture());
 assert.match(html,/Ana &lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/1 pendientes/);assert.match(html,/1 vencidas/);assert.match(html,/1 por calificar/);assert.match(html,/0 \/ 5/);
 assert.match(html,/no equivale a una nota definitiva/);assert.match(html,/Por debajo del umbral · en curso/);
});

test('submission proportions use a disjoint partition and expose accessible labels and a data table',()=>{
 const report=fixture(),html=renderSubmissionDonut(report);
 assert.match(html,/<strong>5<\/strong><small>actividades/);assert.match(html,/Entregadas: 2; Pendientes abiertas: 2; Vencidas sin entrega: 1/);
 assert.match(html,/Ver datos del gráfico/);assert.match(html,/40 %/);assert.match(html,/20 %/);
 const zero=fixture();zero.summary.selection.submitted=0;zero.summary.selection.pending=0;zero.summary.selection.overdue=0;
 assert.match(renderSubmissionDonut(zero),/No hay actividades requeridas/);assert.doesNotMatch(renderSubmissionDonut(zero),/NaN|Infinity/);
});

test('daily chart uses the real spacing of recorded dates and does not invent missing days',()=>{
 const html=renderDailyLine(fixture()),circles=[...html.matchAll(/<circle cx="([\d.]+)"/g)].map(match=>Number(match[1]));
 assert.deepEqual(circles,[42,170.5,556]);assert.equal(html.includes('2026-10-29'),false);
 assert.match(html,/Fecha \(Colombia\)/);assert.match(html,/2026-10-31/);assert.match(html,/Ingresos/);
});

test('grade history uses actual timestamps and breaks the line when a grade was withdrawn',()=>{
 const report=fixture(),changes=[['2026-10-27T05:00:00Z',4],['2026-10-28T05:00:00Z',null],['2026-10-31T05:00:00Z',3]].map(([created_at,points])=>({student_id:'s1',activity_id:'activity-one',created_at,after_value:JSON.stringify({points}),reason:'Revisión'}));
 const html=gradeHistoryChart(changes,report);assert.doesNotMatch(html,/<polyline/);assert.match(html,/no es una nota acumulada histórica/);assert.match(html,/Revisión/);
 const measured=changes.map((change,index)=>({...change,after_value:JSON.stringify({points:index+1})})),circles=[...gradeHistoryChart(measured,report).matchAll(/<circle cx="([\d.]+)"/g)].map(match=>Number(match[1]));assert.deepEqual(circles,[35,167.5,565]);
});

test('active bars retain the baseline and grade distribution preserves a real zero',()=>{
 const report=fixture(),bars=renderActiveBars(report),grades=renderGradeDistribution(report);
 assert.match(bars,/Promedio del grupo: 5 min/);assert.match(bars,/10 min/);assert.match(bars,/0 s/);assert.match(bars,/Ver datos del gráfico/);
 assert.match(grades,/0–&lt;1/);assert.match(grades,/1–&lt;2/);assert.match(grades,/0 sin acumulada disponible/);
});

test('individual evidence distinguishes active time from elapsed time and reports bounded details',()=>{
 const report=fixture();report.filters.studentId='s1';report.detail={studentId:'s1',truncated:true,sessions:[{startedAt:'2026-10-27T16:00:00Z',lastActiveAt:'2026-10-27T17:00:00Z',activeSeconds:300,elapsedSeconds:3600}],intervals:[{startedAt:'2026-10-27T16:00:00Z',endedAt:'2026-10-27T16:00:30Z',seconds:30}],events:[{createdAt:'2026-10-27T16:00:00Z',action:'resource.open',objectTitle:'<img src=x onerror=bad()>',source:'learning'}]};
 const html=renderStudentDetail(report);assert.match(html,/Lapso observado/);assert.match(html,/5 min/);assert.match(html,/1 h/);assert.match(html,/30 s/);assert.match(html,/totales incluyen todo el período/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/view=matrix/);
});

test('overview does not average incomparable grading scales and group links retain the selected dates',()=>{
 const report=fixture();report.summary={...report.summary.group,scaleMax:null,gradeAccumulated:null};assert.match(renderGroupSummary(report),/Escalas distintas/);
 const overview={filters:report.filters,groups:[{id:'group-one',title:'Circuitos',cohort:'2026-2',code:'A',summary:fixture().summary.group,measurement:report.measurement}]};
 const html=renderGroupOverview(overview);assert.match(html,/#estadisticas\/group-one\?from=2026-10-27/);assert.match(html,/Hasta|Acumulada media/);
});

test('multi-group overview labels enrollment counts separately from distinct people',()=>{
 const overview={groups:[{id:'one'},{id:'two'}],summary:{students:8,distinctStudents:6,scopeDescription:'Un estudiante puede participar en varios grupos.',scaleMax:5},measurement:{available:true}};
 const html=renderGroupSummary(overview);assert.match(html,/Matrículas/);assert.match(html,/6 personas distintas/);assert.doesNotMatch(html,/>Estudiantes<\/span>/);
 assert.match(renderGroupSummary(fixture()),/>Estudiantes<\/span>/);
});

test('CSV names the current accumulation and measured units rather than the old provisional average',()=>{
 const csv=analyticsCSV(fixture()),lines=csv.split('\r\n');assert.match(lines[0],/Tiempo activo \(segundos\)/);assert.match(lines[0],/Nota acumulada sobre el 100 %/);assert.doesNotMatch(lines[0],/Provisional/);assert.match(lines[2],/"0","0","0","0"/);
});

test('CSV leaves unavailable historical visits, sessions and time empty instead of exporting fabricated zeros',()=>{
 const report=fixture();report.measurement.available=false;
 const csv=analyticsCSV(report),row=csv.split('\r\n')[2].split(',');
 assert.deepEqual(row.slice(4,8),['""','""','""','""']);
 assert.ok(csv.includes('"0","5",""'),'the real zero accumulation remains available independently of time measurement');
});

test('the tracking route defaults to student evidence when the backend returns studentId',async()=>{
 const report=fixture();report.filters.studentId='s1';report.students=report.students.slice(0,1);report.detail={studentId:'s1',sessions:[],intervals:[],events:[]};
 const ui=createAnalyticsUI({api:async path=>{assert.equal(path,'/analytics/group-one?student=s1&from=2026-10-27');return report;},heading,getState:()=>({})});
 const html=await ui.page('estadisticas/group-one?student=s1&from=2026-10-27');assert.match(html,/Detalle del estudiante/);assert.match(html,/Sesiones registradas/);assert.match(html,/student=s1/);
});

test('staff without grade access stay in the permitted audit view without calling academic analytics',async()=>{
 const previous=globalThis.location;globalThis.location={hash:'#panorama'};
 try{
  const calls=[],ui=createPanoramaUI({api:async path=>{calls.push(path);return {scope:'assigned',total:0,stats:[],courses:[],people:[],byGroup:[],events:[],updatedAt:'2026-10-27T18:00:00Z',page:1,pages:1};},heading,getState:()=>({courses:[{entityKind:'group',permissions:{grade:false}}]})});
  const html=await ui.page();assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/platform/overview?'));assert.match(html,/Registro detallado/);assert.doesNotMatch(html,/Resumen de grupos/);
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});
