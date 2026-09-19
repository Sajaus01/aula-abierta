export function enrollmentPreview(rows, students, enrollments, courseId, { reactivate = false, at = Date.now() } = {}) {
  const users = new Map(students.map(student => [student.document, student]));
  const existing = new Map(enrollments.filter(item => item.courseId === courseId).map(item => [item.studentId, item]));
  const seen = new Set();
  const summary = { received: rows.length, createdStudents: 0, enrolled: 0, alreadyEnrolled: 0, reactivated: 0, skipped: 0, errors: 0 };
  const results = rows.map((row, index) => {
    const result = { ...row, row: index + 1, status: 'enrolled', createdStudent: false };
    if (seen.has(row.document)) {
      summary.skipped++;
      return { ...result, status: 'skipped', reason: 'Cédula repetida en la lista.' };
    }
    seen.add(row.document);
    const student = users.get(row.document);
    if (student && (student.active === false || student.role === 'admin')) {
      summary.errors++;
      return { ...result, name: student.name, status: 'error', error: 'Cuenta no habilitada para matrícula.' };
    }
    if (student) result.name = student.name;
    const enrollment = student && existing.get(student.id);
    if (enrollment) {
      const expired = enrollment.expiresAt && Date.parse(enrollment.expiresAt) <= at;
      if (enrollment.status === 'active' && !expired) {
        summary.alreadyEnrolled++;
        return { ...result, status: 'already_enrolled', reason: 'La matrícula actual se conserva.' };
      }
      if (!reactivate) {
        summary.skipped++;
        return { ...result, status: 'skipped', reason: 'Matrícula vencida o revocada: requiere reactivación.' };
      }
      summary.reactivated++;
      return { ...result, status: 'reactivated' };
    }
    summary.enrolled++;
    if (!student) { summary.createdStudents++; result.createdStudent = true; }
    return result;
  });
  return { summary, results };
}

export function enrollmentResultLabel(row) {
  return ({ enrolled: row.createdStudent ? 'Estudiante creado y matriculado' : 'Matriculado', already_enrolled: 'Ya matriculado', reactivated: 'Matrícula reactivada', skipped: 'Omitido', error: 'Revisar' })[row.status] || 'Revisar';
}
