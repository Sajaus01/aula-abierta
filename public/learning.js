export function materialStatus(resourceId, progress = []) {
  const entry = progress.find(row => row.resourceId === resourceId);
  return entry?.completed ? 'completed' : entry?.openedAt || entry?.lastOpenedAt ? 'opened' : 'unopened';
}

export function summarizeLearning(resources = [], progress = []) {
  const unique = [...new Map(resources.map(resource => [resource.id, resource])).values()];
  const completed = unique.filter(resource => materialStatus(resource.id, progress) === 'completed').length;
  const opened = unique.filter(resource => materialStatus(resource.id, progress) !== 'unopened').length;
  const pending = unique.filter(resource => materialStatus(resource.id, progress) !== 'completed');
  const exercises = unique.filter(resource => resource.kind === 'exercise');
  return {
    total: unique.length, completed, opened, pending: pending.length,
    unopened: unique.length - opened, inProgress: opened - completed,
    percent: unique.length ? Math.round(completed / unique.length * 100) : 0,
    next: pending[0] || null,
    exercisesTotal: exercises.length,
    exercisesCompleted: exercises.filter(resource => materialStatus(resource.id, progress) === 'completed').length
  };
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
