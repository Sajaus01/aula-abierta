import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/database.mjs';
import { createApp } from '../server/index.mjs';
import { hashPassword } from '../server/security.mjs';

const old = '2025-01-01T10:00:00.000Z';
const later = '2025-02-01T10:00:00.000Z';
const latest = '2025-03-01T10:00:00.000Z';
const freshPassword = () => `Learning-${randomBytes(24).toString('base64url')}`;

async function temporaryData(t, close = async () => {}) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'aula-learning-test-'));
  t.after(async () => {
    await close();
    const target = resolve(directory);
    assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith('aula-learning-test-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return directory;
}

function status(response, expected) {
  assert.equal(response.status, expected, `Estado HTTP inesperado: ${response.text.slice(0, 500)}`);
  return response.data;
}

function iso(value) {
  assert.equal(typeof value, 'string');
  assert.equal(new Date(value).toISOString(), value);
}

function seed(db) {
  return {
    course(id, { accessMode = 'public', published = true } = {}) {
      db.prepare('INSERT INTO courses(id,title,access_mode,published,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, `Curso ${id}`, accessMode, Number(published), old, old);
      return id;
    },
    module(id, courseId, position = 0) {
      db.prepare('INSERT INTO modules(id,course_id,title,position) VALUES (?,?,?,?)').run(id, courseId, `Capítulo ${id}`, position);
      return id;
    },
    resource(id, moduleId, { position = 0, kind = 'html' } = {}) {
      db.prepare('INSERT INTO resources(id,module_id,title,kind,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, moduleId, `Material ${id}`, kind, position, old, old);
      return id;
    },
    enrollment(courseId, { studentId = 'student', status = 'active', startsAt = null, expiresAt = null } = {}) {
      db.prepare('INSERT INTO enrollments(id,student_id,course_id,status,starts_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(`${studentId}-${courseId}`, studentId, courseId, status, startsAt, expiresAt, old);
    },
    progress(resourceId, { studentId = 'student', completed = false, updatedAt = old, openedAt = null, lastOpenedAt = null } = {}) {
      db.prepare('INSERT INTO progress(user_id,resource_id,completed,updated_at,opened_at,last_opened_at) VALUES (?,?,?,?,?,?)')
        .run(studentId, resourceId, Number(completed), updatedAt, openedAt, lastOpenedAt);
    }
  };
}

async function fixture(t) {
  let app;
  const dataDir = await temporaryData(t, async () => {
    if (app) await new Promise((done, reject) => app.server.close(error => error ? reject(error) : done()));
  });
  const adminPassword = freshPassword(), studentPassword = freshPassword();
  app = await createApp({ dataDir, env: {
    NODE_ENV: 'test', ADMIN_DOCUMENT: '50000001', ADMIN_NAME: 'Administración sintética', ADMIN_PASSWORD: adminPassword
  } });
  const passwordHash = await hashPassword(studentPassword);
  for (const [id, document] of [['student', '20000001'], ['other-student', '20000002']]) {
    app.db.prepare('INSERT INTO users(id,document,name,role,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, document, `Estudiante ${id}`, 'student', passwordHash, old, old);
  }
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
        return { status: response.status, headers: response.headers, text, data: payload?.data };
      }
    };
  }
  const admin = client(), student = client();
  status(await admin.request('/api/auth/login', { method: 'POST', body: { document: '50000001', password: adminPassword } }), 200);
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: '20000001', password: studentPassword } }), 200);
  return { ...app, ...seed(app.db), admin, student, client, studentPassword };
}

function material(app, id = 'material', options = {}) {
  const courseId = app.course(`course-${id}`, options);
  const moduleId = app.module(`module-${id}`, courseId);
  app.resource(id, moduleId);
  return { courseId, moduleId, id };
}

const open = (client, id, headers) => client.request(`/api/progress/${id}/open`, { method: 'POST', body: {}, headers });
const complete = (client, id, completed) => client.request(`/api/progress/${id}`, { method: 'PUT', body: { completed } });
const progressRow = (app, id) => app.db.prepare('SELECT * FROM progress WHERE user_id=? AND resource_id=?').get('student', id);
const resourceView = (id, moduleId, kind = 'html') => ({ id, title: `Material ${id}`, moduleTitle: `Capítulo ${moduleId}`, kind });

test('abrir un material registra fechas ISO, conserva su primera apertura y no altera la finalización', async t => {
  const app = await fixture(t);
  const { id } = material(app);
  const first = status(await open(app.student, id), 200);
  assert.deepEqual(Object.keys(first).sort(), ['resourceId', 'completed', 'updatedAt', 'openedAt', 'lastOpenedAt'].sort());
  assert.equal(first.resourceId, id);
  assert.equal(first.completed, false);
  [first.updatedAt, first.openedAt, first.lastOpenedAt].forEach(iso);
  assert.equal(first.openedAt, first.lastOpenedAt);

  // Fijar el pasado evita temporizadores y hace observable la reapertura.
  app.db.prepare('UPDATE progress SET opened_at=?,last_opened_at=?,updated_at=? WHERE resource_id=?').run(old, later, later, id);
  const reopened = status(await open(app.student, id), 200);
  assert.equal(reopened.openedAt, old);
  assert.ok(reopened.lastOpenedAt > later);
  iso(reopened.lastOpenedAt);
  assert.equal(reopened.completed, false);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM progress').get().count, 1);

  status(await complete(app.student, id, true), 200);
  app.db.prepare('UPDATE progress SET last_opened_at=? WHERE resource_id=?').run(later, id);
  const afterCompletion = status(await open(app.student, id), 200);
  assert.equal(afterCompletion.completed, true);
  assert.equal(afterCompletion.openedAt, old);
  assert.ok(afterCompletion.lastOpenedAt > later);
  assert.deepEqual(status(await app.student.request('/api/progress'), 200), [afterCompletion]);
});

test('completar implica apertura y desmarcar conserva la historia; pendiente nuevo no inventa visitas', async t => {
  const app = await fixture(t);
  const { id, moduleId } = material(app);
  app.resource('unseen', moduleId);
  const pending = status(await complete(app.student, id, false), 200);
  assert.equal(pending.completed, false);
  assert.equal(pending.openedAt, null);
  assert.equal(pending.lastOpenedAt, null);

  const completed = status(await complete(app.student, id, true), 200);
  assert.equal(completed.completed, true);
  iso(completed.openedAt);
  iso(completed.lastOpenedAt);
  app.db.prepare('UPDATE progress SET opened_at=?,last_opened_at=? WHERE resource_id=?').run(old, later, id);
  const uncompleted = status(await complete(app.student, id, false), 200);
  assert.equal(uncompleted.completed, false);
  assert.equal(uncompleted.openedAt, old);
  assert.equal(uncompleted.lastOpenedAt, later);
  const repeated = status(await complete(app.student, id, true), 200);
  assert.equal(repeated.openedAt, old);
  assert.equal(repeated.lastOpenedAt, later);
  const directCompletion = status(await complete(app.student, 'unseen', true), 200);
  iso(directCompletion.openedAt);
  iso(directCompletion.lastOpenedAt);
  assert.equal(directCompletion.completed, true);
});

test('progreso antiguo conserva finalización, infiere aperturas solo cuando hay evidencia y expone columnas nulas', async t => {
  const app = await fixture(t);
  const { id, courseId, moduleId } = material(app, 'legacy');
  app.resource('legacy-uncomplete', moduleId, { position: 1 });
  app.resource('legacy-pending', moduleId, { position: 2 });
  app.progress(id, { completed: true, updatedAt: old });
  app.progress('legacy-uncomplete', { completed: true, updatedAt: later });
  app.progress('legacy-pending', { completed: false, updatedAt: latest });
  const before = status(await app.student.request('/api/progress'), 200);
  for (const row of before) {
    assert.equal(row.openedAt, null);
    assert.equal(row.lastOpenedAt, null);
  }
  const learning = status(await app.student.request('/api/learning'), 200);
  const course = learning.courses.find(row => row.courseId === courseId);
  assert.equal(course.opened, 2);
  assert.equal(course.completed, 2);
  assert.equal(course.lastResource.id, 'legacy-uncomplete');
  assert.equal(course.lastResource.lastOpenedAt, later);
  assert.deepEqual(learning.recent.map(row => [row.resourceId, row.lastOpenedAt]), [['legacy-uncomplete', later], [id, old]]);
  assert.deepEqual(course.nextResource, resourceView('legacy-pending', moduleId));

  const reopened = status(await open(app.student, id), 200);
  assert.equal(reopened.completed, true);
  assert.equal(reopened.openedAt, old);
  assert.ok(reopened.lastOpenedAt > old);
  const uncompleted = status(await complete(app.student, 'legacy-uncomplete', false), 200);
  assert.equal(uncompleted.completed, false);
  assert.equal(uncompleted.openedAt, later);
  assert.equal(uncompleted.lastOpenedAt, later);
  assert.equal(progressRow(app, 'legacy-pending').opened_at, null);
});

test('aprendizaje exige estudiante autenticado y abrir aplica CSRF sin mutaciones rechazadas', async t => {
  const app = await fixture(t);
  const { id } = material(app);
  const anonymous = app.client();
  status(await anonymous.request('/api/learning'), 401);
  status(await open(anonymous, id), 401);
  status(await complete(anonymous, id, true), 401);
  status(await app.admin.request('/api/learning'), 403);
  status(await open(app.admin, id), 403);
  status(await complete(app.admin, id, true), 403);
  assert.deepEqual(status(await app.admin.request('/api/progress'), 200), []);
  for (const headers of [{ Origin: 'https://otro-sitio.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    status(await open(app.student, id, headers), 403);
  }
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM progress').get().count, 0);
  status(await open(app.student, 'missing-material'), 404);
  status(await app.student.request(`/api/progress/${id}/open`, { method: 'POST', body: { studentId: 'other-student', userId: 'other-student' } }), 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM progress WHERE user_id=?').get('other-student').count, 0);
  assert.equal(progressRow(app, id).completed, 0);
  app.db.prepare('UPDATE users SET active=0 WHERE id=?').run('student');
  status(await app.student.request('/api/learning'), 401);
  status(await open(app.student, id), 401);
  status(await complete(app.student, id, true), 401);
});

test('el resumen y las aperturas respetan borradores, matrícula vigente y acceso con contraseña', async t => {
  const app = await fixture(t);
  const document = material(app, 'document', { accessMode: 'document' });
  app.enrollment(document.courseId);
  const documentClient = app.client();
  const login = status(await documentClient.request('/api/auth/login', { method: 'POST', body: { document: '20000001' } }), 200);
  assert.equal(login.assurance, 'document');
  const accessible = [document, material(app, 'public')];
  const restricted = [
    { ...material(app, 'draft', { published: false }), expected: 404 },
    { ...material(app, 'unregistered', { accessMode: 'document' }), expected: 403 },
    { ...material(app, 'revoked', { accessMode: 'document' }), expected: 403 },
    { ...material(app, 'expired', { accessMode: 'document' }), expected: 403 },
    { ...material(app, 'future', { accessMode: 'document' }), expected: 403 },
    { ...material(app, 'password', { accessMode: 'password' }), expected: 403 }
  ];
  app.enrollment('course-draft');
  app.enrollment('course-revoked', { status: 'revoked' });
  app.enrollment('course-expired', { expiresAt: '2000-01-01T00:00:00.000Z' });
  app.enrollment('course-future', { startsAt: '2999-01-01T00:00:00.000Z' });
  app.enrollment('course-password');
  for (const entry of [...accessible, ...restricted]) app.progress(entry.id, { completed: true, openedAt: old, lastOpenedAt: latest });
  app.resource('other-only-material', accessible[1].moduleId, { position: 1 });
  app.progress('other-only-material', { studentId: 'other-student', completed: true, openedAt: old, lastOpenedAt: latest });
  for (const entry of restricted) {
    status(await open(documentClient, entry.id), entry.expected);
    status(await complete(documentClient, entry.id, true), entry.expected);
  }
  const learningResponse = await documentClient.request('/api/learning');
  const learning = status(learningResponse, 200);
  assert.deepEqual(learning.courses.map(row => row.courseId).sort(), accessible.map(row => row.courseId).sort());
  assert.deepEqual(learning.recent.map(row => row.resourceId).sort(), accessible.map(row => row.id).sort());
  for (const entry of restricted) {
    assert.ok(!learningResponse.text.includes(entry.courseId), `No filtrar el curso ${entry.courseId}`);
    assert.ok(!learningResponse.text.includes(`Material ${entry.id}`), `No filtrar el material ${entry.id}`);
  }
  const publicSummary = learning.courses.find(row => row.courseId === 'course-public');
  assert.equal(publicSummary.total, 2);
  assert.equal(publicSummary.opened, 1);
  assert.equal(publicSummary.completed, 1);
  assert.equal(publicSummary.nextResource.id, 'other-only-material');
  assert.deepEqual(status(await documentClient.request('/api/progress'), 200).map(row => row.resourceId).sort(), accessible.map(row => row.id).sort());
  status(await open(app.student, 'password'), 200);
  assert.ok(status(await app.student.request('/api/learning'), 200).courses.some(row => row.courseId === 'course-password'));
  // Cambiar permisos debe retirar enseguida los datos de progreso previamente visibles.
  app.db.prepare("UPDATE enrollments SET status='revoked' WHERE student_id=? AND course_id=?").run('student', document.courseId);
  status(await open(documentClient, document.id), 403);
  const revoked = status(await documentClient.request('/api/learning'), 200);
  assert.ok(!revoked.courses.some(row => row.courseId === document.courseId));
  assert.ok(!revoked.recent.some(row => row.courseId === document.courseId));
});

test('resumen ordena capítulos y materiales, cuenta ejercicios y limita la actividad reciente a cinco', async t => {
  const app = await fixture(t);
  const courseId = app.course('ordered');
  app.course('empty');
  // Inserción inversa: el orden debe depender de position e id, no de rowid.
  app.module('module-later', courseId, 2);
  app.module('module-b', courseId, 1);
  app.module('module-a', courseId, 1);
  app.resource('b-2', 'module-b', { position: 0, kind: 'exercise' });
  app.resource('a-2', 'module-a', { position: 0, kind: 'exercise' });
  app.resource('a-1', 'module-a', { position: 0 });
  app.resource('a-later', 'module-a', { position: 1 });
  app.resource('z-2', 'module-later', { position: 0 });
  app.resource('z-1', 'module-later', { position: 0 });
  app.resource('z-3', 'module-later', { position: 1 });
  app.resource('z-4', 'module-later', { position: 2 });
  const order = ['a-1', 'a-2', 'a-later', 'b-2', 'z-1', 'z-2', 'z-3', 'z-4'];
  const details = status(await app.student.request(`/api/courses/${courseId}`), 200);
  assert.deepEqual(details.modules.flatMap(module => module.resources.map(resource => resource.id)), order);
  let learning = status(await app.student.request('/api/learning'), 200);
  assert.deepEqual(learning.courses.find(row => row.courseId === 'empty'), {
    courseId: 'empty', total: 0, opened: 0, completed: 0, exercisesTotal: 0, exercisesCompleted: 0, nextResource: null, lastResource: null
  });
  for (const id of order) {
    const next = status(await app.student.request('/api/learning'), 200).courses.find(row => row.courseId === courseId).nextResource;
    assert.equal(next.id, id);
    status(await complete(app.student, id, true), 200);
  }
  learning = status(await app.student.request('/api/learning'), 200);
  let course = learning.courses.find(row => row.courseId === courseId);
  assert.equal(course.nextResource, null);
  assert.equal(course.total, 8);
  assert.equal(course.opened, 8);
  assert.equal(course.completed, 8);
  assert.equal(course.exercisesTotal, 2);
  assert.equal(course.exercisesCompleted, 2);
  status(await complete(app.student, 'a-2', false), 200);
  // Fechas exactas y empate de dos elementos para comprobar desempate estable.
  for (const [index, id] of order.entries()) {
    const at = `2025-04-${String(Math.min(index + 1, 7)).padStart(2, '0')}T10:00:00.000Z`;
    app.db.prepare('UPDATE progress SET opened_at=?,last_opened_at=?,updated_at=? WHERE user_id=? AND resource_id=?').run(old, at, at, 'student', id);
  }
  learning = status(await app.student.request('/api/learning'), 200);
  course = learning.courses.find(row => row.courseId === courseId);
  assert.equal(course.opened, 8);
  assert.equal(course.completed, 7);
  assert.equal(course.exercisesCompleted, 1);
  assert.deepEqual(course.nextResource, resourceView('a-2', 'module-a', 'exercise'));
  assert.equal(learning.recent.length, 5);
  assert.deepEqual(learning.recent.map(row => row.resourceId), ['z-3', 'z-4', 'z-2', 'z-1', 'b-2']);
  for (let i = 1; i < learning.recent.length; i++) assert.ok(learning.recent[i - 1].lastOpenedAt >= learning.recent[i].lastOpenedAt);
  for (const row of learning.recent) {
    assert.equal(row.courseId, courseId);
    assert.equal(row.courseTitle, 'Curso ordered');
    assert.equal(row.title, `Material ${row.resourceId}`);
    iso(row.lastOpenedAt);
  }
  assert.equal(course.lastResource.id, learning.recent[0].resourceId);
  assert.equal(course.lastResource.lastOpenedAt, learning.recent[0].lastOpenedAt);
  assert.deepEqual(status(await app.student.request('/api/learning'), 200), learning);
});

test('actividades devuelve hasta cinco ejercicios pendientes accesibles en el orden de los cursos y capítulos', async t => {
  const app = await fixture(t);
  // Fecha de curso descendente, luego identificador ascendente en cada empate.
  app.course('activity-b');
  app.course('activity-a');
  app.course('activity-new');
  app.db.prepare('UPDATE courses SET created_at=? WHERE id=?').run(latest, 'activity-new');
  app.module('activity-module-b', 'activity-a', 0);
  app.module('activity-module-a', 'activity-a', 0);
  app.module('activity-new-module', 'activity-new');
  app.module('activity-last-module', 'activity-b');
  app.resource('activity-a-2', 'activity-module-a', { kind: 'exercise' });
  app.resource('activity-a-1', 'activity-module-a', { kind: 'exercise' });
  app.resource('activity-a-3', 'activity-module-a', { kind: 'exercise', position: 1 });
  app.resource('activity-a-4', 'activity-module-b', { kind: 'exercise' });
  app.resource('activity-new-first', 'activity-new-module', { kind: 'exercise' });
  app.resource('activity-b-last', 'activity-last-module', { kind: 'exercise' });
  app.resource('activity-finished', 'activity-module-a', { kind: 'exercise', position: -2 });
  app.resource('activity-not-exercise', 'activity-module-a', { kind: 'html', position: -1 });
  app.progress('activity-finished', { completed: true });
  app.progress('activity-a-1', { studentId: 'other-student', completed: true });
  app.progress('activity-a-2', { completed: false, openedAt: old, lastOpenedAt: later });
  for (const [id, options] of [
    ['activity-secret', { accessMode: 'password' }],
    ['activity-draft', { published: false }]
  ]) {
    app.course(id, options);
    app.module(`${id}-module`, id);
    app.resource(`${id}-exercise`, `${id}-module`, { kind: 'exercise' });
    app.db.prepare('UPDATE courses SET created_at=? WHERE id=?').run('2999-01-01T00:00:00.000Z', id);
  }
  let learning = status(await app.student.request('/api/learning'), 200);
  const expected = [
    ['activity-new-first', 'activity-new'],
    ['activity-a-1', 'activity-a'],
    ['activity-a-2', 'activity-a'],
    ['activity-a-3', 'activity-a'],
    ['activity-a-4', 'activity-a']
  ];
  assert.deepEqual(learning.activities, expected.map(([resourceId, courseId]) => ({
    courseId, courseTitle: `Curso ${courseId}`, resourceId, title: `Material ${resourceId}`, kind: 'exercise'
  })));
  status(await complete(app.student, 'activity-new-first', true), 200);
  learning = status(await app.student.request('/api/learning'), 200);
  assert.deepEqual(learning.activities.map(row => row.resourceId), ['activity-a-1', 'activity-a-2', 'activity-a-3', 'activity-a-4', 'activity-b-last']);
  for (const activity of learning.activities) status(await complete(app.student, activity.resourceId, true), 200);
  assert.deepEqual(status(await app.student.request('/api/learning'), 200).activities, []);
});

test('una base con progress antiguo añade columnas sin perder filas y permite reabrirse otra vez', async t => {
  let db;
  const directory = await temporaryData(t, async () => { db?.close(); });
  db = openDatabase(directory);
  const data = seed(db);
  db.prepare('INSERT INTO users(id,document,name,role,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('student', '20000001', 'Estudiante sintético', 'student', old, old);
  data.course('legacy-course');
  data.module('legacy-module', 'legacy-course');
  data.resource('legacy-completed', 'legacy-module');
  data.resource('legacy-pending', 'legacy-module');
  // Recrea exactamente el esquema de progreso anterior a la migración aditiva.
  db.exec(`
    DROP TABLE progress;
    CREATE TABLE progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,resource_id)
    );
  `);
  db.prepare('INSERT INTO progress(user_id,resource_id,completed,updated_at) VALUES (?,?,?,?)').run('student', 'legacy-completed', 1, old);
  db.prepare('INSERT INTO progress(user_id,resource_id,completed,updated_at) VALUES (?,?,?,?)').run('student', 'legacy-pending', 0, later);
  db.close();
  db = null;
  let snapshot;
  for (let attempt = 0; attempt < 2; attempt++) {
    db = openDatabase(directory);
    const columns = db.prepare('PRAGMA table_info(progress)').all();
    assert.equal(columns.filter(column => column.name === 'opened_at').length, 1);
    assert.equal(columns.filter(column => column.name === 'last_opened_at').length, 1);
    for (const name of ['opened_at', 'last_opened_at']) assert.equal(columns.find(column => column.name === name).notnull, 0);
    const rows = db.prepare('SELECT * FROM progress ORDER BY resource_id').all().map(row => ({ ...row }));
    assert.deepEqual(rows, [
      { user_id: 'student', resource_id: 'legacy-completed', completed: 1, updated_at: old, opened_at: null, last_opened_at: null },
      { user_id: 'student', resource_id: 'legacy-pending', completed: 0, updated_at: later, opened_at: null, last_opened_at: null }
    ]);
    if (snapshot) assert.deepEqual(rows, snapshot);
    snapshot = rows;
    db.close();
    db = null;
  }
});

