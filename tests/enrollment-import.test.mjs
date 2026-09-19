import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudentsCsv } from '../public/lib.js';
import { enrollmentPreview, enrollmentResultLabel } from '../public/enrollment-import.js';

test('CSV de matrícula admite repetidos para informar cada registro y preserva ceros', () => {
  const csv = 'cedula;nombre;correo\n00001234;Ana;\n00001234;Ana repetida;\n2345;Luis;';
  assert.throws(() => parseStudentsCsv(csv), /repetida/);
  const rows = parseStudentsCsv(csv, { allowDuplicates: true });
  assert.deepEqual(rows.map(row => row.document), ['00001234', '00001234', '2345']);
  const preview = enrollmentPreview(rows, [], [], 'course');
  assert.equal(preview.summary.createdStudents, 2);
  assert.equal(preview.summary.enrolled, 2);
  assert.equal(preview.summary.skipped, 1);
  assert.equal(preview.results[1].row, 2);
});

test('vista previa conserva matrículas programadas, separa reactivación y cuentas suspendidas', () => {
  const students = [1, 2, 3, 4].map(id => ({ id: String(id), document: String(1000 + id), name: 'Nombre guardado', active: id !== 4 }));
  const enrollments = [
    { studentId: '1', courseId: 'course', status: 'active', startsAt: '2099-01-01T00:00:00Z', expiresAt: null },
    { studentId: '2', courseId: 'course', status: 'active', expiresAt: '2020-01-01T00:00:00Z' },
    { studentId: '3', courseId: 'course', status: 'revoked' },
    { studentId: '4', courseId: 'course', status: 'revoked' }
  ];
  const rows = students.map(student => ({ document: student.document, name: 'Nombre de lista', email: '' }));
  const first = enrollmentPreview(rows, students, enrollments, 'course', { at: Date.parse('2026-01-01T00:00:00Z') });
  assert.deepEqual(first.summary, { received: 4, createdStudents: 0, enrolled: 0, alreadyEnrolled: 1, reactivated: 0, skipped: 2, errors: 1 });
  assert.equal(first.results[0].name, 'Nombre guardado');
  const second = enrollmentPreview(rows, students, enrollments, 'course', { reactivate: true });
  assert.equal(second.summary.reactivated, 2);
  assert.equal(second.summary.errors, 1);
  assert.equal(second.summary.enrolled, 0);
  assert.equal(enrollments[2].status, 'revoked');
});

test('otras matrículas no se confunden con el curso elegido y distingue alta de matrícula', () => {
  const rows = [{ document: '1234', name: 'Existente' }, { document: '5678', name: 'Nuevo' }];
  const result = enrollmentPreview(rows, [{ id: 'u', document: '1234', active: true }], [{ studentId: 'u', courseId: 'otro', status: 'active' }], 'curso');
  assert.equal(result.summary.createdStudents, 1);
  assert.equal(result.summary.enrolled, 2);
  assert.equal(enrollmentResultLabel(result.results[0]), 'Matriculado');
  assert.equal(enrollmentResultLabel(result.results[1]), 'Estudiante creado y matriculado');
});
