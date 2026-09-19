import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { hashPassword, verifyPassword } from '../server/security.mjs';

const at = '2026-01-01T00:00:00.000Z';
const freshPassword = () => `Bulk-${randomBytes(20).toString('base64url')}`;

function status(response, expected) {
  assert.equal(response.status, expected, `Estado HTTP inesperado: ${response.text.slice(0, 500)}`);
  return response.data;
}

function summary(overrides = {}) {
  return { received: 0, createdStudents: 0, enrolled: 0, alreadyEnrolled: 0, reactivated: 0, skipped: 0, errors: 0, ...overrides };
}

async function fixture(t) {
  const parent = resolve(tmpdir());
  const dataDir = await mkdtemp(join(parent, 'aula-bulk-enrollment-test-'));
  let app;
  t.after(async () => {
    if (app) await new Promise((done, reject) => app.server.close(error => error ? reject(error) : done()));
    const target = resolve(dataDir);
    assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith('aula-bulk-enrollment-test-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const adminPassword = freshPassword();
  app = await createApp({ dataDir, env: {
    NODE_ENV: 'test', ADMIN_DOCUMENT: '50000001', ADMIN_NAME: 'Administración sintética', ADMIN_PASSWORD: adminPassword
  } });
  await new Promise((done, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', done);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  function client() {
    return {
      cookie: '',
      async request(path, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(base + path, {
          method, redirect: 'manual',
          headers: {
            ...(!['GET', 'HEAD'].includes(method) ? { Origin: base } : {}),
            ...(this.cookie ? { Cookie: this.cookie } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const cookie = response.headers.get('set-cookie');
        if (cookie) this.cookie = cookie.split(';')[0];
        const text = await response.text();
        const payload = text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
        return { status: response.status, headers: response.headers, text, payload, data: payload?.data };
      }
    };
  }
  const admin = client();
  status(await admin.request('/api/auth/login', { method: 'POST', body: { document: '50000001', password: adminPassword } }), 200);
  const course = status(await admin.request('/api/admin/courses', { method: 'POST', body: { title: 'Curso sintético', accessMode: 'password', published: true } }), 201);
  const endpoint = `/api/admin/courses/${course.id}/enrollments/bulk`;
  return {
    ...app, admin, client, course, endpoint, adminPassword,
    async bulk(students, options = {}, requester = admin) {
      return requester.request(endpoint, { method: 'POST', body: { students, ...options } });
    },
    async seedStudent(document, { initial = false, active = true, name = `Estudiante ${document}`, email = 'original@example.test' } = {}) {
      const id = randomUUID(), password = initial ? document : freshPassword();
      const hash = await hashPassword(password);
      app.db.prepare('INSERT INTO users(id,document,name,email,role,password_hash,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, document, name, email, 'student', hash, Number(initial), Number(active), at, at);
      return { id, document, name, email, password };
    },
    seedEnrollment(studentId, { enrollmentStatus = 'active', startsAt = null, expiresAt = null } = {}) {
      const id = randomUUID();
      app.db.prepare('INSERT INTO enrollments(id,student_id,course_id,status,starts_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, studentId, course.id, enrollmentStatus, startsAt, expiresAt, at);
      return app.db.prepare('SELECT * FROM enrollments WHERE id=?').get(id);
    }
  };
}

test('la matrícula por lista reutiliza cuentas, crea las nuevas y devuelve resultados individuales sin secretos', async t => {
  const f = await fixture(t);
  const personal = await f.seedStudent('00021001');
  const initial = await f.seedStudent('00021002', { initial: true });
  const inactive = await f.seedStudent('00021003', { active: false });
  const snapshots = [personal, initial, inactive].map(person => f.db.prepare('SELECT * FROM users WHERE id=?').get(person.id));
  const students = [
    { document: personal.document, name: 'No sustituir nombre', email: 'diferente@example.test' },
    { document: initial.document, name: 'Tampoco sustituir' },
    { document: '00021004', name: 'Estudiante nuevo', email: 'nuevo@example.test' },
    { document: '00021004', name: 'Duplicado' },
    { document: 'no-valido', name: 'Documento inválido' },
    { document: '50000001', name: 'Administrador no matriculable' },
    { document: inactive.document, name: 'Suspendido' },
    { document: '00021005', name: 'Correo inválido', email: 'no-es-correo' },
    { document: '00021006', name: '' },
    null
  ];
  const response = await f.bulk(students);
  const result = status(response, 201);
  assert.deepEqual(result.course, { id: f.course.id, title: f.course.title });
  assert.deepEqual(result.summary, summary({ received: 10, createdStudents: 1, enrolled: 3, skipped: 1, errors: 6 }));
  assert.deepEqual(result.results.map(row => row.row), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(result.results.map(row => row.status), ['enrolled', 'enrolled', 'enrolled', 'skipped', 'error', 'error', 'error', 'error', 'error', 'error']);
  assert.deepEqual(result.results.slice(0, 4).map(row => row.createdStudent), [false, false, true, false]);
  for (const row of result.results.slice(0, 3)) {
    assert.equal(typeof row.studentId, 'string');
    assert.equal(typeof row.enrollmentId, 'string');
    assert.equal(f.db.prepare('SELECT student_id FROM enrollments WHERE id=?').get(row.enrollmentId).student_id, row.studentId);
  }
  assert.equal(typeof result.results[3].reason, 'string');
  for (const row of result.results.slice(4)) {
    assert.equal(typeof row.error, 'string');
    assert.equal(row.createdStudent, false);
  }
  for (const snapshot of snapshots) assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=?').get(snapshot.id), snapshot);
  const created = f.db.prepare('SELECT * FROM users WHERE document=?').get('00021004');
  assert.equal(created.must_change_password, 1);
  assert.equal(created.active, 1);
  assert.equal(await verifyPassword('00021004', created.password_hash), true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count, 3);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 5);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM activations').get().count, 0);
  assert.equal(/password_hash|activationCode|scrypt\$/.test(response.text), false);
});

test('el lote valida curso, tamaño, fechas y opciones antes de crear estudiantes o matrículas', async t => {
  const f = await fixture(t);
  const students = [{ document: '00022001', name: 'No debe crearse' }];
  const baseCounts = () => [
    f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count
  ];
  const baseline = baseCounts();
  const invalidBodies = [
    {}, { students: null }, { students: {} }, { students: [] },
    { students: Array.from({ length: 501 }, (_, index) => ({ document: String(22000000 + index), name: 'No debe crearse' })) },
    { students, startsAt: 'fecha-no-válida' }, { students, expiresAt: 123 },
    { students, startsAt: '' }, { students, startsAt: '2030-01-01' },
    { students, expiresAt: '2030-01-01T10:00:00' },
    { students, startsAt: '2030-01-02T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' },
    { students, startsAt: '2030-01-01T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' },
    { students, reactivate: 'true' }
  ];
  for (const body of invalidBodies) {
    status(await f.admin.request(f.endpoint, { method: 'POST', body }), 400);
    assert.deepEqual(baseCounts(), baseline);
  }
  status(await f.admin.request('/api/admin/courses/curso-inexistente/enrollments/bulk', { method: 'POST', body: { students } }), 404);
  assert.deepEqual(baseCounts(), baseline);
});

test('el límite permitido de quinientas filas conserva el orden y omite duplicados del archivo', async t => {
  const f = await fixture(t);
  const person = await f.seedStudent('00022501');
  const students = Array.from({ length: 500 }, () => ({ document: person.document, name: person.name }));
  const result = status(await f.bulk(students), 201);
  assert.deepEqual(result.summary, summary({ received: 500, enrolled: 1, skipped: 499 }));
  assert.equal(result.results.length, 500);
  assert.equal(result.results[0].status, 'enrolled');
  assert.equal(result.results[499].row, 500);
  assert.ok(result.results.slice(1).every(row => row.status === 'skipped' && row.createdStudent === false));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count, 1);
});

test('solo administración autenticada del mismo origen puede importar matrículas', async t => {
  const f = await fixture(t);
  const person = await f.seedStudent('00023001');
  const student = f.client();
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: person.password } }), 200);
  const students = [{ document: '00023002', name: 'No debe crearse' }];
  status(await f.bulk(students, {}, f.client()), 403);
  status(await f.bulk(students, {}, student), 403);
  status(await f.admin.request(f.endpoint, { method: 'POST', headers: { Origin: 'https://otro-origen.invalid' }, body: { students } }), 403);
  status(await f.admin.request(f.endpoint, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { students } }), 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count, 0);
  assert.equal(f.db.prepare('SELECT id FROM users WHERE document=?').get('00023002'), undefined);
});

test('las matrículas actuales y futuras se conservan; las vencidas o revocadas requieren reactivación explícita', async t => {
  const f = await fixture(t);
  const current = await f.seedStudent('00024001');
  const future = await f.seedStudent('00024002');
  const expired = await f.seedStudent('00024003');
  const revoked = await f.seedStudent('00024004');
  const futureStart = new Date(Date.now() + 10 * 86400000).toISOString();
  const futureEnd = new Date(Date.now() + 20 * 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const snapshots = [
    f.seedEnrollment(current.id),
    f.seedEnrollment(future.id, { startsAt: futureStart, expiresAt: futureEnd }),
    f.seedEnrollment(expired.id, { expiresAt: past }),
    f.seedEnrollment(revoked.id, { enrollmentStatus: 'revoked' })
  ];
  const students = [current, future, expired, revoked].map(person => ({ document: person.document, name: person.name }));
  const result = status(await f.bulk(students, { startsAt: null, expiresAt: null }), 201);
  assert.deepEqual(result.summary, summary({ received: 4, alreadyEnrolled: 2, skipped: 2 }));
  assert.deepEqual(result.results.map(row => row.status), ['already_enrolled', 'already_enrolled', 'skipped', 'skipped']);
  assert.ok(result.results.slice(2).every(row => typeof row.reason === 'string' && row.reason.length));
  for (const snapshot of snapshots) assert.deepEqual(f.db.prepare('SELECT * FROM enrollments WHERE id=?').get(snapshot.id), snapshot);
  const reactivateStart = new Date(Date.now() + 86400000).toISOString();
  const reactivateEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  const reactivated = status(await f.bulk(students, { reactivate: true, startsAt: reactivateStart, expiresAt: reactivateEnd }), 201);
  assert.deepEqual(reactivated.summary, summary({ received: 4, alreadyEnrolled: 2, reactivated: 2 }));
  assert.deepEqual(reactivated.results.map(row => row.status), ['already_enrolled', 'already_enrolled', 'reactivated', 'reactivated']);
  for (const snapshot of snapshots.slice(0, 2)) assert.deepEqual(f.db.prepare('SELECT * FROM enrollments WHERE id=?').get(snapshot.id), snapshot);
  for (const snapshot of snapshots.slice(2)) {
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM enrollments WHERE id=?').get(snapshot.id) }, {
      ...snapshot, status: 'active', starts_at: reactivateStart, expires_at: reactivateEnd
    });
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count, 4);
});

test('fechas normalizadas se aplican a las nuevas matrículas y un reintento no altera cuentas ni fechas', async t => {
  const f = await fixture(t);
  const students = [{ document: '00025001', name: 'Nueva cuenta', email: 'estudiante@example.test' }];
  const first = status(await f.bulk(students, { startsAt: '2030-02-01T08:00:00-05:00', expiresAt: '2030-03-01T08:00:00-05:00' }), 201);
  assert.deepEqual(first.summary, summary({ received: 1, createdStudents: 1, enrolled: 1 }));
  const user = f.db.prepare('SELECT * FROM users WHERE document=?').get(students[0].document);
  const enrollment = f.db.prepare('SELECT * FROM enrollments WHERE student_id=? AND course_id=?').get(user.id, f.course.id);
  assert.equal(enrollment.starts_at, '2030-02-01T13:00:00.000Z');
  assert.equal(enrollment.expires_at, '2030-03-01T13:00:00.000Z');
  const retry = status(await f.bulk([{ ...students[0], name: 'No reemplazar', email: 'otro@example.test' }], { startsAt: null, expiresAt: null, reactivate: true }), 201);
  assert.deepEqual(retry.summary, summary({ received: 1, alreadyEnrolled: 1 }));
  assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=?').get(user.id), user);
  assert.deepEqual(f.db.prepare('SELECT * FROM enrollments WHERE id=?').get(enrollment.id), enrollment);
  assert.equal(retry.results[0].studentId, user.id);
  assert.equal(retry.results[0].enrollmentId, enrollment.id);
});

test('un fallo de matrícula revierte la cuenta de esa fila y no interrumpe las siguientes ni filtra SQL', async t => {
  const f = await fixture(t);
  f.db.exec(`CREATE TRIGGER fail_synthetic_bulk_enrollment BEFORE INSERT ON enrollments
    WHEN (SELECT document FROM users WHERE id=NEW.student_id)='00026001'
    BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQL_SENTINEL insert into enrollments'); END;`);
  const resultResponse = await f.bulk([
    { document: '00026001', name: 'Debe revertirse' },
    { document: '00026002', name: 'Debe continuar' }
  ]);
  const result = status(resultResponse, 201);
  assert.deepEqual(result.summary, summary({ received: 2, createdStudents: 1, enrolled: 1, errors: 1 }));
  assert.deepEqual(result.results.map(row => row.status), ['error', 'enrolled']);
  assert.equal(result.results[0].createdStudent, false);
  assert.equal(typeof result.results[0].error, 'string');
  assert.equal(f.db.prepare('SELECT id FROM users WHERE document=?').get('00026001'), undefined);
  assert.ok(f.db.prepare('SELECT id FROM users WHERE document=?').get('00026002'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count, 1);
  assert.equal(/PRIVATE_SQL_SENTINEL|insert into|SQLITE_|password_hash|scrypt\$/i.test(resultResponse.text), false);
  f.db.exec('DROP TRIGGER fail_synthetic_bulk_enrollment');
  const retry = status(await f.bulk([{ document: '00026001', name: 'Ahora permitido' }]), 201);
  assert.deepEqual(retry.summary, summary({ received: 1, createdStudents: 1, enrolled: 1 }));
});

test('dos lotes concurrentes con la misma cédula crean una sola cuenta y una sola matrícula', async t => {
  const f = await fixture(t);
  const otherAdmin = f.client();
  otherAdmin.cookie = f.admin.cookie;
  const students = [{ document: '00027001', name: 'Estudiante concurrente' }];
  const responses = await Promise.all([f.bulk(students), f.bulk(students, {}, otherAdmin)]);
  const results = responses.map(response => status(response, 201));
  assert.deepEqual(results.map(result => result.results[0].status).sort(), ['already_enrolled', 'enrolled']);
  assert.equal(results.reduce((total, result) => total + result.summary.createdStudents, 0), 1);
  assert.equal(results.reduce((total, result) => total + result.summary.enrolled, 0), 1);
  assert.equal(results.reduce((total, result) => total + result.summary.alreadyEnrolled, 0), 1);
  assert.equal(results.reduce((total, result) => total + result.summary.errors, 0), 0);
  const users = f.db.prepare('SELECT * FROM users WHERE document=?').all(students[0].document);
  assert.equal(users.length, 1);
  assert.equal(await verifyPassword(students[0].document, users[0].password_hash), true);
  assert.equal(users[0].must_change_password, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE student_id=? AND course_id=?').get(users[0].id, f.course.id).count, 1);
  assert.equal(results[0].results[0].studentId, results[1].results[0].studentId);
  assert.equal(results[0].results[0].enrollmentId, results[1].results[0].enrollmentId);
});

test('la revocación de administración entre filas detiene el lote y permite reintentar sin duplicar lo guardado', async t => {
  const f = await fixture(t);
  const existing = await f.seedStudent('00028001');
  f.db.exec(`CREATE TRIGGER revoke_synthetic_bulk_admin AFTER INSERT ON enrollments
    WHEN (SELECT document FROM users WHERE id=NEW.student_id)='00028001'
    BEGIN DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin'); END;`);
  const students = [
    { document: existing.document, name: existing.name },
    { document: '00028002', name: 'Fila pendiente' }
  ];
  status(await f.bulk(students), 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE student_id=? AND course_id=?').get(existing.id, f.course.id).count, 1);
  assert.equal(f.db.prepare('SELECT id FROM users WHERE document=?').get('00028002'), undefined);
  assert.equal(status(await f.admin.request('/api/auth/me'), 200).user, null);
  f.db.exec('DROP TRIGGER revoke_synthetic_bulk_admin');
  status(await f.admin.request('/api/auth/login', { method: 'POST', body: { document: '50000001', password: f.adminPassword } }), 200);
  const retried = status(await f.bulk(students), 201);
  assert.deepEqual(retried.summary, summary({ received: 2, createdStudents: 1, enrolled: 1, alreadyEnrolled: 1 }));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments').get().count, 2);
});
