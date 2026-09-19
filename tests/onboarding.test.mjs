import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/database.mjs';
import { digest, hashPassword, verifyPassword } from '../server/security.mjs';

const at = '2026-01-01T00:00:00.000Z';
const freshPassword = () => `Onboarding-${randomBytes(20).toString('base64url')}`;

function status(response, expected) {
  assert.equal(response.status, expected, `Estado HTTP inesperado: ${response.text.slice(0, 500)}`);
  return response.data;
}

function requiresChange(response) {
  status(response, 403);
  assert.equal(response.payload.code, 'PASSWORD_CHANGE_REQUIRED');
}

async function fixture(t, seed) {
  const parent = resolve(tmpdir());
  const dataDir = await mkdtemp(join(parent, 'aula-onboarding-test-'));
  let app;
  t.after(async () => {
    if (app) await new Promise((done, reject) => app.server.close(error => error ? reject(error) : done()));
    const target = resolve(dataDir);
    assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith('aula-onboarding-test-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  if (seed) {
    const db = openDatabase(dataDir);
    try { await seed(db); } finally { db.close(); }
  }
  const adminPassword = freshPassword();
  const env = { NODE_ENV: 'test', ADMIN_DOCUMENT: '50000001', ADMIN_NAME: 'Administración sintética', ADMIN_PASSWORD: adminPassword };
  let base;
  async function start() {
    app = await createApp({ dataDir, env });
    await new Promise((done, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', done);
    });
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  await start();
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
  status(await admin.request('/api/auth/login', { method: 'POST', body: { document: env.ADMIN_DOCUMENT, password: adminPassword } }), 200);
  return {
    get db() { return app.db; }, admin, client, adminPassword,
    async restart() {
      await new Promise((done, reject) => app.server.close(error => error ? reject(error) : done()));
      app = null;
      await start();
    },
    async student(document = '00020001') {
      return status(await admin.request('/api/admin/students', { method: 'POST', body: { document, name: 'Estudiante sintético' } }), 201);
    }
  };
}

async function initialLogin(client, document) {
  const login = status(await client.request('/api/auth/login', { method: 'POST', body: { document, password: document } }), 200);
  assert.equal(login.assurance, 'password');
  assert.equal(login.user.mustChangePassword, true);
  return login;
}

async function firstPassword(client, password = '2468') {
  const changed = status(await client.request('/api/auth/first-password', {
    method: 'POST', body: { newPassword: password, confirmPassword: password }
  }), 200);
  assert.equal(changed.user.mustChangePassword, false);
  assert.equal(changed.assurance, 'password');
  return changed;
}

test('crear estudiantes individualmente y por lista genera claves iniciales protegidas y conserva ceros', async t => {
  const f = await fixture(t);
  const student = await f.student();
  assert.equal(student.document, '00020001');
  assert.equal(student.mustChangePassword, true);
  assert.equal(student.hasPassword, true);
  assert.equal('activationCode' in student, false);
  const first = f.db.prepare('SELECT * FROM users WHERE id=?').get(student.id);
  assert.equal(first.must_change_password, 1);
  assert.notEqual(first.password_hash, student.document);
  assert.equal(await verifyPassword(student.document, first.password_hash), true);
  const imported = status(await f.admin.request('/api/admin/students/bulk', { method: 'POST', body: { students: [
    { document: '00020002', name: 'Estudiante dos' },
    { document: '00020003', name: 'Estudiante tres' },
    { document: student.document, name: 'No reemplazar' }
  ] } }), 201);
  assert.equal(imported.created.length, 2);
  assert.deepEqual(imported.errors.map(row => row.row), [3]);
  for (const created of imported.created) {
    assert.equal(created.mustChangePassword, true);
    assert.equal('activationCode' in created, false);
    const row = f.db.prepare('SELECT * FROM users WHERE id=?').get(created.id);
    assert.equal(row.must_change_password, 1);
    assert.equal(await verifyPassword(created.document, row.password_hash), true);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM activations').get().count, 0);
  const list = await f.admin.request('/api/admin/students');
  status(list, 200);
  assert.equal(list.text.includes('password_hash'), false);
  assert.equal(list.text.includes('activationCode'), false);
  assert.equal(f.db.prepare('SELECT name FROM users WHERE id=?').get(student.id).name, student.name);
});

test('la sesión inicial bloquea todas las rutas de contenido y otros caminos de autenticación', async t => {
  const f = await fixture(t);
  const person = await f.student();
  const create = async (path, body) => status(await f.admin.request(path, { method: 'POST', body }), 201);
  const courses = [];
  const resources = [];
  for (const accessMode of ['public', 'document', 'password']) {
    const course = await create('/api/admin/courses', { title: `Curso ${accessMode}`, accessMode, published: true });
    courses.push(course);
    const module = await create(`/api/admin/courses/${course.id}/modules`, { title: 'Unidad sintética' });
    resources.push(await create(`/api/admin/modules/${module.id}/resources`, {
      title: 'HTML sintético', kind: 'html', file: { name: 'contenido.html', base64: Buffer.from('<!doctype html><title>Prueba</title>').toString('base64') }
    }));
    if (accessMode !== 'public') await create('/api/admin/enrollments', { studentId: person.id, courseId: course.id });
  }
  const student = f.client();
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: 'incorrecta' } }), 401);
  requiresChange(await student.request('/api/auth/login', { method: 'POST', body: { document: person.document } }));
  assert.equal(student.cookie, '', 'El acceso con cédula no debe emitir una sesión inicial');
  await initialLogin(student, person.document);
  const me = status(await student.request('/api/auth/me'), 200);
  assert.equal(me.user.mustChangePassword, true);
  assert.equal(me.user.document, person.document);
  assert.equal(typeof me.user.mustChangePassword, 'boolean');
  status(await student.request('/api/status'), 200);
  status(await student.request('/api/settings'), 200);
  const routes = [
    ['/api/courses'], ['/api/learning'], ['/api/progress'], ['/api/admin/students'], ['/api/admin/settings'],
    ['/api/auth/login', 'POST', { document: person.document, password: person.document }],
    ['/api/auth/password', 'POST', { currentPassword: person.document, newPassword: '2468' }],
    ['/api/auth/activate', 'POST', { document: person.document, code: 'invalid', password: '2468' }],
    ['/api/settings', 'PUT', { name: 'No permitido' }],
    ['/api/status', 'POST', {}], ['/api/auth/me', 'POST', {}],
    ...courses.map(course => [`/api/courses/${course.id}`]),
    ...resources.flatMap(resource => [
      [resource.fileUrl], [resource.previewUrl],
      [`/api/progress/${resource.id}`, 'PUT', { completed: true }],
      [`/api/progress/${resource.id}/open`, 'POST', {}]
    ])
  ];
  for (const [path, method = 'GET', body] of routes) {
    await t.test(`${method} ${path}`, async () => requiresChange(await student.request(path, { method, body })));
  }
  for (const resource of resources) {
    status(await student.request(resource.fileUrl, { method: 'HEAD' }), 403);
    status(await student.request(resource.previewUrl, { method: 'HEAD' }), 403);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM progress').get().count, 0);
  const old = student.cookie;
  status(await student.request('/api/auth/logout', { method: 'POST', body: {} }), 200);
  student.cookie = old;
  assert.equal(status(await student.request('/api/auth/me'), 200).user, null);
});

test('el primer cambio exige confirmación, admite cuatro dígitos y rota todas las sesiones', async t => {
  const f = await fixture(t);
  const person = await f.student();
  const student = f.client(), concurrent = f.client(), anonymous = f.client();
  status(await anonymous.request('/api/auth/first-password', { method: 'POST', body: { newPassword: '2468', confirmPassword: '2468' } }), 401);
  await initialLogin(student, person.document);
  await initialLogin(concurrent, person.document);
  const previousCookie = student.cookie;
  const initialHash = f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(person.id).password_hash;
  for (const body of [
    { newPassword: '123', confirmPassword: '123' },
    { newPassword: person.document, confirmPassword: person.document },
    { newPassword: '2468', confirmPassword: '2469' },
    { newPassword: '2468' }, { newPassword: 2468, confirmPassword: 2468 },
    { newPassword: 'a'.repeat(257), confirmPassword: 'a'.repeat(257) }
  ]) {
    status(await student.request('/api/auth/first-password', { method: 'POST', body }), 400);
    assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(person.id).password_hash, initialHash);
    assert.equal(status(await student.request('/api/auth/me'), 200).user.mustChangePassword, true);
  }
  await firstPassword(student);
  assert.notEqual(student.cookie, previousCookie);
  const saved = f.db.prepare('SELECT * FROM users WHERE id=?').get(person.id);
  assert.equal(saved.must_change_password, 0);
  assert.equal(await verifyPassword('2468', saved.password_hash), true);
  assert.equal(await verifyPassword(person.document, saved.password_hash), false);
  assert.equal(status(await concurrent.request('/api/auth/me'), 200).user, null);
  const stale = f.client();
  stale.cookie = previousCookie;
  assert.equal(status(await stale.request('/api/auth/me'), 200).user, null);
  status(await stale.request('/api/auth/first-password', { method: 'POST', body: { newPassword: '1357', confirmPassword: '1357' } }), 401);
  status(await student.request('/api/courses'), 200);
  status(await student.request('/api/learning'), 200);
  status(await student.request('/api/auth/first-password', { method: 'POST', body: { newPassword: '1357', confirmPassword: '1357' } }), 403);
  status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: person.document } }), 401);
  await f.restart();
  const afterRestart = f.client();
  const login = status(await afterRestart.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: '2468' } }), 200);
  assert.equal(login.user.mustChangePassword, false);
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(person.id).password_hash, saved.password_hash);
});

test('dos primeros cambios simultáneos solo aceptan uno y el límite de 256 caracteres es válido', async t => {
  const f = await fixture(t);
  const person = await f.student();
  const clients = [f.client(), f.client()];
  for (const client of clients) await initialLogin(client, person.document);
  const cookies = clients.map(client => client.cookie);
  const passwords = ['a'.repeat(256), 'b'.repeat(256)];
  const responses = await Promise.all(clients.map((client, index) => client.request('/api/auth/first-password', {
    method: 'POST', body: { newPassword: passwords[index], confirmPassword: passwords[index] }
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
  const winner = responses.findIndex(response => response.status === 200);
  assert.equal(responses[winner].data.user.mustChangePassword, false);
  const row = f.db.prepare('SELECT * FROM users WHERE id=?').get(person.id);
  assert.equal(row.must_change_password, 0);
  assert.equal(await verifyPassword(passwords[winner], row.password_hash), true);
  assert.equal(await verifyPassword(passwords[1 - winner], row.password_hash), false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').get(person.id).count, 1);
  for (const cookie of cookies) {
    const stale = f.client();
    stale.cookie = cookie;
    assert.equal(status(await stale.request('/api/auth/me'), 200).user, null);
  }
  status(await clients[winner].request('/api/learning'), 200);
});

test('cambiar una contraseña personal conserva la política estudiantil y la del administrador', async t => {
  const f = await fixture(t);
  const person = await f.student(), student = f.client();
  await initialLogin(student, person.document);
  await firstPassword(student);
  for (const newPassword of ['123', person.document, 'x'.repeat(257)]) {
    status(await student.request('/api/auth/password', { method: 'POST', body: { currentPassword: '2468', newPassword } }), 400);
  }
  status(await student.request('/api/auth/password', { method: 'POST', body: { currentPassword: 'incorrecta', newPassword: '1357' } }), 401);
  const before = student.cookie;
  const changed = status(await student.request('/api/auth/password', { method: 'POST', body: { currentPassword: '2468', newPassword: '1357' } }), 200);
  assert.equal(changed.user.mustChangePassword, false);
  assert.notEqual(student.cookie, before);
  const stale = f.client();
  stale.cookie = before;
  assert.equal(status(await stale.request('/api/auth/me'), 200).user, null);
  status(await f.admin.request('/api/auth/password', { method: 'POST', body: { currentPassword: f.adminPassword, newPassword: '2468' } }), 400);
  status(await f.admin.request('/api/auth/password', { method: 'POST', body: { currentPassword: f.adminPassword, newPassword: 'a'.repeat(11) } }), 400);
  const replacement = randomBytes(9).toString('base64url');
  assert.equal(replacement.length, 12);
  const adminChanged = status(await f.admin.request('/api/auth/password', { method: 'POST', body: { currentPassword: f.adminPassword, newPassword: replacement } }), 200);
  assert.equal(adminChanged.user.mustChangePassword, false);
  status(await f.admin.request('/api/admin/students'), 200);
});

test('restablecer la clave revoca sesiones y códigos y vuelve a exigir el cambio inicial', async t => {
  const f = await fixture(t);
  const person = await f.student(), student = f.client(), anonymous = f.client();
  await initialLogin(student, person.document);
  await firstPassword(student);
  const recovery = status(await f.admin.request(`/api/admin/students/${person.id}/activation`, { method: 'POST', body: {} }), 200);
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: '2468' } }), 200);
  const priorCookie = student.cookie;
  status(await student.request(`/api/admin/students/${person.id}/reset-password`, { method: 'POST', body: {} }), 403);
  const reset = status(await f.admin.request(`/api/admin/students/${person.id}/reset-password`, { method: 'POST', body: {} }), 200);
  assert.deepEqual(reset, { success: true, mustChangePassword: true });
  student.cookie = priorCookie;
  assert.equal(status(await student.request('/api/auth/me'), 200).user, null);
  status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: '2468' } }), 401);
  status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: person.document, code: recovery.activationCode, password: '1357' } }), 401);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM activations WHERE user_id=?').get(person.id).count, 0);
  const row = f.db.prepare('SELECT * FROM users WHERE id=?').get(person.id);
  assert.equal(row.must_change_password, 1);
  assert.equal(await verifyPassword(person.document, row.password_hash), true);
  requiresChange(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: person.document } }));
  await initialLogin(student, person.document);
  requiresChange(await student.request('/api/courses'));
  await firstPassword(student, '1357');
});

test('editar la cédula actualiza solo la clave inicial y conserva una contraseña personal', async t => {
  const f = await fixture(t);
  const person = await f.student(), student = f.client();
  await initialLogin(student, person.document);
  const pendingCookie = student.cookie;
  const newDocument = '00030001';
  const updated = status(await f.admin.request(`/api/admin/students/${person.id}`, { method: 'PATCH', body: { document: newDocument } }), 200);
  assert.equal(updated.mustChangePassword, true);
  student.cookie = pendingCookie;
  assert.equal(status(await student.request('/api/auth/me'), 200).user, null);
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: newDocument, password: person.document } }), 401);
  await initialLogin(student, newDocument);
  await firstPassword(student);
  const savedHash = f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(person.id).password_hash;
  const finalDocument = '00040001';
  const personal = status(await f.admin.request(`/api/admin/students/${person.id}`, { method: 'PATCH', body: { document: finalDocument } }), 200);
  assert.equal(personal.mustChangePassword, false);
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(person.id).password_hash, savedHash);
  const login = status(await student.request('/api/auth/login', { method: 'POST', body: { document: finalDocument, password: '2468' } }), 200);
  assert.equal(login.user.mustChangePassword, false);
  status(await f.client().request('/api/auth/login', { method: 'POST', body: { document: finalDocument, password: finalDocument } }), 401);
});

test('la recuperación heredada requiere código válido y no puede usarse desde una sesión restringida', async t => {
  const f = await fixture(t);
  const person = await f.student(), student = f.client(), anonymous = f.client();
  status(await f.admin.request(`/api/admin/students/${person.id}/activation`, { method: 'POST', body: {} }), 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM activations WHERE user_id=?').get(person.id).count, 0);
  await initialLogin(student, person.document);
  await firstPassword(student, '1357');
  const recovery = status(await f.admin.request(`/api/admin/students/${person.id}/activation`, { method: 'POST', body: {} }), 200);
  const pending = await f.student('00020002'), restricted = f.client();
  await initialLogin(restricted, pending.document);
  requiresChange(await restricted.request('/api/auth/activate', { method: 'POST', body: { document: person.document, code: recovery.activationCode, password: '2468' } }));
  // Simulate an old, valid code left behind for an account now in onboarding.
  const staleInitialCode = randomBytes(32).toString('base64url');
  f.db.prepare('INSERT INTO activations(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(digest(staleInitialCode), pending.id, new Date(Date.now() + 86400000).toISOString(), at);
  status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: pending.document, code: staleInitialCode, password: '2468' } }), 401);
  assert.equal(f.db.prepare('SELECT must_change_password FROM users WHERE id=?').get(pending.id).must_change_password, 1);
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: person.document, password: '1357' } }), 200);
  const priorCookie = student.cookie;
  status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: person.document, code: 'invalid', password: '2468' } }), 401);
  for (const password of ['123', person.document]) {
    status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: person.document, code: recovery.activationCode, password } }), 400);
  }
  const recovered = status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: person.document, code: recovery.activationCode, password: '2468' } }), 200);
  assert.equal(recovered.user.mustChangePassword, false);
  status(await anonymous.request('/api/courses'), 200);
  student.cookie = priorCookie;
  assert.equal(status(await student.request('/api/auth/me'), 200).user, null);
  status(await f.client().request('/api/auth/activate', { method: 'POST', body: { document: person.document, code: recovery.activationCode, password: '1357' } }), 401);
});

test('al reiniciar se preparan únicamente estudiantes antiguos sin clave y se conservan las elegidas', async t => {
  const chosen = freshPassword();
  const chosenHash = await hashPassword(chosen);
  const f = await fixture(t, async db => {
    const insert = db.prepare('INSERT INTO users(id,document,name,role,password_hash,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
    insert.run('legacy-null', '00060001', 'Sin clave', 'student', null, 1, at, at);
    insert.run('legacy-personal', '00060002', 'Con clave personal', 'student', chosenHash, 1, at, at);
    insert.run('legacy-inactive', '00060003', 'Suspendido', 'student', null, 0, at, at);
    const future = new Date(Date.now() + 86400000).toISOString();
    db.prepare('INSERT INTO sessions(token_hash,user_id,assurance,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run(digest('legacy-pending-session'), 'legacy-null', 'document', future, at);
    db.prepare('INSERT INTO activations(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
      .run(digest('legacy-pending-activation'), 'legacy-null', future, at);
  });
  const pending = f.db.prepare('SELECT * FROM users WHERE id=?').get('legacy-null');
  const personal = f.db.prepare('SELECT * FROM users WHERE id=?').get('legacy-personal');
  assert.equal(pending.must_change_password, 1);
  assert.equal(await verifyPassword(pending.document, pending.password_hash), true);
  assert.equal(personal.must_change_password, 0);
  assert.equal(personal.password_hash, chosenHash);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?').get('legacy-null').count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM activations WHERE user_id=?').get('legacy-null').count, 0);
  const initial = f.client();
  await initialLogin(initial, pending.document);
  requiresChange(await initial.request('/api/courses'));
  const personalClient = f.client();
  const login = status(await personalClient.request('/api/auth/login', { method: 'POST', body: { document: personal.document, password: chosen } }), 200);
  assert.equal(login.user.mustChangePassword, false);
  status(await f.client().request('/api/auth/login', { method: 'POST', body: { document: '00060003', password: '00060003' } }), 401);
  await f.restart();
  const repeated = f.db.prepare('SELECT * FROM users WHERE id=?').get('legacy-null');
  assert.equal(repeated.password_hash, pending.password_hash);
  assert.equal(repeated.must_change_password, 1);
  assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get('legacy-personal').password_hash, chosenHash);
});

