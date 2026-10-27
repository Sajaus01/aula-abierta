export function materialStatus(resourceId, progress = []) {
  const entry = progress.find(row => row.resourceId === resourceId);
  return entry?.completed ? 'completed' : entry?.openedAt || entry?.lastOpenedAt ? 'opened' : 'unopened';
}

const completionPercent=(completed,total)=>!total?0:completed===total?100:Math.min(99,Math.round(completed/total*100));

export function summarizeLearning(resources = [], progress = []) {
  const unique = [...new Map(resources.map(resource => [resource.id, resource])).values()];
  const completed = unique.filter(resource => materialStatus(resource.id, progress) === 'completed').length;
  const opened = unique.filter(resource => materialStatus(resource.id, progress) !== 'unopened').length;
  const pending = unique.filter(resource => materialStatus(resource.id, progress) !== 'completed');
  const exercises = unique.filter(resource => resource.kind === 'exercise');
  return {
    total: unique.length, completed, opened, pending: pending.length,
    unopened: unique.length - opened, inProgress: opened - completed,
    percent: completionPercent(completed,unique.length),
    next: pending[0] || null,
    exercisesTotal: exercises.length,
    exercisesCompleted: exercises.filter(resource => materialStatus(resource.id, progress) === 'completed').length
  };
}

export function activityCompleted(activity) {
  const response=activity?.responseState??activity?.submission?.state??(['pending','draft','returned','submitted','graded','missing'].includes(activity?.state)?activity.state:null);
  if(response!==undefined&&response!==null&&response!=='')return response==='submitted'||response==='graded';
  return activity?.submitted===true||activity?.state==='Entregada'||activity?.state==='submitted'||activity?.state==='graded';
}

const activityExempt=activity=>activity?.outcome?.state==='exempt'||activity?.exempt===true||activity?.state==='exempt';
// Finalization only chooses what to continue next. It is neither a delivery nor
// a satisfactory learning result, and an old "missing" label is not evidence of
// a durable automatic closure.
export function activityFinalized(activity) {
  return activityCompleted(activity)||activityExempt(activity)||activity?.closure?.closed===true;
}

// The input must come from the authorized course DTO. Scheduled publications
// already visible in that DTO remain requirements, even before they can be sent.
export function summarizeCourseLearning(resources=[],activities=[],progress=[],{now=Date.now()}={}) {
  const visibleResources=[...new Map(resources.filter(item=>item&&item.id&&item.published!==false&&!item.hidden).map(item=>[item.id,item])).values()];
  const visibleActivities=[...new Map(activities.filter(item=>item&&item.id&&(!item.status||item.status==='published')&&!item.hidden&&item.modulePublished!==false).map(item=>[item.id,item])).values()];
  const materials=summarizeLearning(visibleResources,progress),at=typeof now==='number'?now:Date.parse(now);
  const scheduled=item=>Boolean(item.opensAt&&Number.isFinite(Date.parse(item.opensAt))&&Date.parse(item.opensAt)>at);
  const pending=visibleActivities.filter(item=>!activityCompleted(item));
  const openPending=visibleActivities.filter(item=>!activityFinalized(item));
  const actionable=pending.filter(item=>!scheduled(item));
  const future=pending.filter(scheduled);
  const continueActivity=openPending.find(item=>!scheduled(item))||openPending[0]||null;
  const tasks=visibleActivities.filter(item=>item.kind!=='quiz'),quizzes=visibleActivities.filter(item=>item.kind==='quiz');
  const activitySummary={
    total:visibleActivities.length,completed:visibleActivities.length-pending.length,pending:pending.length,
    tasksTotal:tasks.length,tasksCompleted:tasks.filter(activityCompleted).length,
    quizzesTotal:quizzes.length,quizzesCompleted:quizzes.filter(activityCompleted).length,
    returned:pending.filter(item=>item.responseState==='returned').length,
    inProgress:pending.filter(item=>item.responseState==='draft').length,
    scheduled:future.length,next:actionable[0]||future[0]||null,
    finalized:visibleActivities.length-openPending.length,openPending:openPending.length,
    closedMissing:visibleActivities.filter(item=>item.closure?.closed===true&&!activityCompleted(item)&&!activityExempt(item)).length,
    exempt:visibleActivities.filter(activityExempt).length,continueNext:continueActivity
  };
  activitySummary.missing=activitySummary.closedMissing;
  const total=materials.total+activitySummary.total,completed=materials.completed+activitySummary.completed;
  const next=materials.next?{type:'resource',item:materials.next}:activitySummary.next?{type:'activity',item:activitySummary.next,scheduled:scheduled(activitySummary.next)}:null;
  const continueNext=materials.next?{type:'resource',item:materials.next}:continueActivity?{type:'activity',item:continueActivity,scheduled:scheduled(continueActivity)}:null;
  return {total,completed,pending:total-completed,percent:completionPercent(completed,total),materials,activities:activitySummary,next,
    finalized:materials.completed+activitySummary.finalized,openPending:materials.pending+activitySummary.openPending,continueNext,
    materialsTotal:materials.total,materialsCompleted:materials.completed,
    activitiesTotal:activitySummary.total,activitiesCompleted:activitySummary.completed,
    tasksTotal:activitySummary.tasksTotal,tasksCompleted:activitySummary.tasksCompleted,
    quizzesTotal:activitySummary.quizzesTotal,quizzesCompleted:activitySummary.quizzesCompleted,
    returned:activitySummary.returned,scheduled:activitySummary.scheduled};
}

export function quickGuide(role) {
  return role === 'admin' ? [
    ['Crea el curso', 'Elige su modalidad: libre, solo cédula o cédula y contraseña. Puedes empezar con un borrador.'],
    ['Organiza y evalúa', 'Dentro del curso, crea capítulos y materiales. En Gestionar actividades prepara tareas, cuestionarios, fechas y porcentajes; revisa las entregas desde el Libro de notas.'],
    ['Registra y matricula', 'Desde tu curso, usa Matricular estudiantes para subir una lista CSV: se crean las cuentas y matrículas juntas. También puedes elegir una cuenta individual.'],
    ['Comparte el acceso', 'Los estudiantes nuevos ingresan con su cédula como usuario y contraseña inicial. El aula les pedirá crear una contraseña personal. Publica el curso cuando esté listo.']
  ] : [
    ['Encuentra tus cursos', 'En Mi aprendizaje están tus cursos y tus pendientes. En Explorar cursos puedes consultar el catálogo.'],
    ['Retoma tu aprendizaje', 'Usa Continuar curso o vuelve a los materiales que abriste recientemente.'],
    ['Organiza tus pendientes', 'En Mis actividades consulta las fechas, entrega tareas y responde cuestionarios. En Mis notas verás los resultados y comentarios que publique tu docente.'],
    ['Guarda tu avance', 'Marca un material como completado cuando termines. Abrirlo no significa haberlo completado; puedes dejarlo pendiente nuevamente.'],
    ['Pide ayuda cuando la necesites', 'Si falta un curso o necesitas recuperar tu contraseña, comunícate con tu docente.']
  ];
}
