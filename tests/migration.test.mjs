import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { digest, hashPassword } from '../server/security.mjs';

const freshPassword = () => `Migration-${randomBytes(24).toString('base64url')}`;
const at = '2026-01-15T10:00:00.000Z';

async function fixture(t) {
  const parent = resolve(tmpdir());
  const dataDir = await mkdtemp(join(parent, 'aula-migration-test-'));
  let app;
  t.after(async () => {
    if (app) await new Promise((done, reject) => app.server.close(error => error ? reject(error) : done()));
    const target = resolve(dataDir);
    assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith('aula-migration-test-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const adminPassword = freshPassword();
  app = await createApp({ dataDir, env: {
    NODE_ENV: 'test', ADMIN_DOCUMENT: '50000001', ADMIN_NAME: 'Administración de destino', ADMIN_PASSWORD: adminPassword
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
        return { status: response.status, headers: response.headers, text, data: payload?.data };
      }
    };
  }
  const admin = client();
  status(await admin.request('/api/auth/login', { method: 'POST', body: { document: '50000001', password: adminPassword } }), 200);
  return { ...app, base, admin, client, adminPassword };
}

function status(response, expected) {
  assert.equal(response.status, expected, `Estado HTTP inesperado: ${response.text.slice(0, 500)}`);
  return response.data;
}

async function bundle() {
  const password = freshPassword();
  const studentId = randomUUID(), secondStudentId = randomUUID(), courseId = randomUUID();
  const moduleId = randomUUID(), resourceId = randomUUID(), fileId = randomUUID();
  const fileText = '%PDF-1.7\nMaterial ficticio de migración\n%%EOF';
  return {
    password, fileText,
    value: {
      format: 'aula-abierta-migration', version: 1, exportedAt: at,
      students: [
        { id: studentId, document: '00020001', name: 'Estudiante de prueba', email: 'estudiante@example.test', active: true, passwordHash: await hashPassword(password), createdAt: at, updatedAt: at },
        { id: secondStudentId, document: '00020002', name: 'Cuenta sin activar', email: '', active: false, passwordHash: null, createdAt: at, updatedAt: at }
      ],
      courses: [{ id: courseId, title: 'Curso de migración', description: 'Contenido sintético', accessMode: 'password', published: true, coverUrl: '', createdAt: at, updatedAt: at }],
      modules: [{ id: moduleId, courseId, title: 'Primer capítulo', position: 2 }],
      resources: [{ id: resourceId, moduleId, title: 'Lectura de prueba', kind: 'pdf', url: '', content: '', position: 3, fileId, createdAt: at, updatedAt: at }],
      enrollments: [{ id: randomUUID(), studentId, courseId, status: 'active', startsAt: null, expiresAt: null, createdAt: at }],
      progress: [{ studentId, resourceId, completed: true, updatedAt: at }],
      files: [{ id: fileId, name: 'lectura.pdf', mime: 'application/pdf', base64: Buffer.from(fileText).toString('base64') }]
    }
  };
}

function snapshot(db) {
  return Object.fromEntries(['users', 'courses', 'modules', 'resources', 'enrollments', 'progress', 'settings', 'sessions', 'activations']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

async function importBundle(client, value, headers) {
  return client.request('/api/admin/migration', { method: 'POST', body: value, headers });
}

test('migra relaciones, contraseñas y archivos sin reemplazar al administrador ni trasladar sesiones', async t => {
  const app = await fixture(t);
  const source = await bundle();
  const value = source.value;
  const originalAdmin = app.db.prepare("SELECT * FROM users WHERE role='admin'").get();
  status(await app.admin.request('/api/admin/settings', { method: 'PATCH', body: { name: 'Aula de destino', subtitle: 'Configuración conservada', contactEmail: 'destino@example.test' } }), 200);
  const originalSettings = app.db.prepare('SELECT * FROM settings').all();
  const originalSessions = app.db.prepare('SELECT * FROM sessions').all();
  const obsoleteToken = randomBytes(32).toString('base64url');
  value.students[0].role = 'admin';
  value.students[0].activationCode = obsoleteToken;
  value.settings = { name: 'No reemplazar destino' };
  value.admins = [{ ...value.students[0], document: '99999999', role: 'admin' }];
  value.sessions = [{ token_hash: digest(obsoleteToken), user_id: value.students[0].id, assurance: 'password', expires_at: '2099-01-01T00:00:00.000Z', created_at: at }];
  value.activations = [{ token_hash: digest(obsoleteToken), user_id: value.students[0].id, expires_at: '2099-01-01T00:00:00.000Z', created_at: at }];

  const response = await importBundle(app.admin, value);
  assert.deepEqual(status(response, 201).imported, { students: 2, courses: 1, enrollments: 1, modules: 1, resources: 1, progress: 1, files: 1 });
  assert.ok(!response.text.includes(source.password));
  assert.ok(!response.text.includes(value.students[0].passwordHash));
  assert.deepEqual(app.db.prepare("SELECT * FROM users WHERE role='admin'").get(), originalAdmin);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin'").get().count, 1);
  assert.equal(app.db.prepare('SELECT role FROM users WHERE id=?').get(value.students[0].id).role, 'student');
  assert.equal(app.db.prepare('SELECT password_hash FROM users WHERE id=?').get(value.students[0].id).password_hash, value.students[0].passwordHash);
  const pending = app.db.prepare('SELECT password_hash,active FROM users WHERE id=?').get(value.students[1].id);
  assert.equal(pending.password_hash, null);
  assert.equal(pending.active, 0);
  for (const row of originalSettings) assert.equal(app.db.prepare('SELECT value FROM settings WHERE key=?').get(row.key).value, row.value);
  assert.deepEqual(app.db.prepare('SELECT * FROM sessions').all(), originalSessions);
  assert.deepEqual(app.db.prepare('SELECT * FROM activations').all(), []);
  assert.equal(status(await app.admin.request('/api/auth/me'), 200).user.id, originalAdmin.id);

  const anonymous = app.client(), student = app.client();
  const fileUrl = `/api/resources/${value.resources[0].id}/file`;
  status(await anonymous.request(fileUrl), 401);
  status(await anonymous.request(`/api/courses/${value.courses[0].id}`), 401);
  status(await student.request('/api/auth/login', { method: 'POST', body: { document: value.students[0].document } }), 401);
  status(await student.request(fileUrl), 401);
  const session = status(await student.request('/api/auth/login', { method: 'POST', body: { document: value.students[0].document, password: source.password } }), 200);
  assert.equal(session.assurance, 'password');
  assert.equal(session.user.role, 'student');
  const file = await student.request(fileUrl);
  status(file, 200);
  assert.equal(file.text, source.fileText);
  assert.match(file.headers.get('content-type'), /^application\/pdf/);
  assert.equal(file.headers.get('cache-control'), 'no-store');
  const progress = status(await student.request('/api/progress'), 200);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].resourceId, value.resources[0].id);
  assert.equal(progress[0].completed, true);
  status(await importBundle(student, value), 403);
  status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: value.students[0].document, code: obsoleteToken, password: freshPassword() } }), 401);
  status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: value.students[1].document } }), 401);

  const afterImport = snapshot(app.db);
  status(await importBundle(app.admin, value), 409);
  assert.deepEqual(snapshot(app.db), afterImport);
  // El marcador debe impedir reutilizar la herramienta incluso después de vaciar el contenido.
  app.db.exec("DELETE FROM courses; DELETE FROM users WHERE role='student';");
  status(await importBundle(app.admin, value), 409);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM courses').get().count, 0);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='student'").get().count, 0);
});

test('la migración exige administrador y rechaza solicitudes de otro origen antes de modificar datos', async t => {
  const app = await fixture(t);
  const { value } = await bundle();
  const initial = snapshot(app.db);
  status(await importBundle(app.client(), value), 403);
  status(await importBundle(app.admin, value, { Origin: 'https://otro-sitio.invalid' }), 403);
  status(await importBundle(app.admin, value, { 'Sec-Fetch-Site': 'cross-site' }), 403);
  assert.deepEqual(snapshot(app.db), initial);
  assert.deepEqual(await readdir(join(app.dataDir, 'uploads')), []);
});

test('un fallo al confirmar revierte las filas y retira archivos ya movidos, permitiendo reintentar', async t => {
  const app = await fixture(t);
  const { value } = await bundle();
  const initial = snapshot(app.db);
  // El marcador se escribe después de mover los archivos a su ubicación definitiva.
  app.db.exec(`CREATE TRIGGER migration_test_failure BEFORE INSERT ON audit
    WHEN NEW.action='migration.import.complete'
    BEGIN SELECT RAISE(ABORT, 'fallo simulado al confirmar migración'); END;`);
  try {
    status(await importBundle(app.admin, value), 500);
    assert.deepEqual(snapshot(app.db), initial);
    assert.deepEqual(await readdir(join(app.dataDir, 'uploads')), []);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='migration.import.complete'").get().count, 0);
  } finally {
    app.db.exec('DROP TRIGGER migration_test_failure');
  }
  status(await importBundle(app.admin, value), 201);
  assert.equal((await readdir(join(app.dataDir, 'uploads'))).length, 1);
});

test('los destinos con estudiantes o cursos previos no se sobrescriben', async t => {
  for (const [label, path, body] of [
    ['estudiantes', '/api/admin/students', { document: '70000001', name: 'Cuenta existente' }],
    ['cursos', '/api/admin/courses', { title: 'Curso existente', accessMode: 'public', published: false }]
  ]) {
    await t.test(label, async child => {
      const app = await fixture(child);
      status(await app.admin.request(path, { method: 'POST', body }), 201);
      const initial = snapshot(app.db);
      status(await importBundle(app.admin, (await bundle()).value), 409);
      assert.deepEqual(snapshot(app.db), initial);
      assert.deepEqual(await readdir(join(app.dataDir, 'uploads')), []);
    });
  }
});

test('los paquetes inválidos se rechazan completos sin filas, archivos ni bloqueo permanente', async t => {
  const app = await fixture(t);
  const { value } = await bundle();
  const initial = snapshot(app.db);
  const cases = [
    ['formato desconocido', b => { b.format = 'otro-formato'; }],
    ['versión desconocida', b => { b.version = 2; }],
    ['lista ausente', b => { delete b.enrollments; }],
    ['identificador que contiene una ruta', b => { b.students[0].id = '../cuenta'; }],
    ['identificador duplicado', b => { b.students[1].id = b.students[0].id; }],
    ['cédula duplicada', b => { b.students[1].document = b.students[0].document; }],
    ['cédula del administrador de destino', b => { b.students[0].document = '50000001'; }, 409],
    ['identificador del administrador de destino', b => {
      const administrator = app.db.prepare("SELECT id FROM users WHERE role='admin'").get();
      const previous = b.students[0].id;
      b.students[0].id = administrator.id;
      b.enrollments.filter(row => row.studentId === previous).forEach(row => { row.studentId = administrator.id; });
      b.progress.filter(row => row.studentId === previous).forEach(row => { row.studentId = administrator.id; });
    }, 409],
    ['cédula inválida', b => { b.students[0].document = 'no-es-cedula'; }],
    ['hash sin protección', b => { b.students[0].passwordHash = 'contraseña-en-texto'; }],
    ['costo de hash no permitido', b => { b.students[0].passwordHash = b.students[0].passwordHash.replace('$32768$', '$1073741824$'); }],
    ['hash truncado', b => { b.students[0].passwordHash = b.students[0].passwordHash.slice(0, -2); }],
    ['curso inexistente', b => { b.modules[0].courseId = randomUUID(); }],
    ['módulo inexistente', b => { b.resources[0].moduleId = randomUUID(); }],
    ['estudiante inexistente', b => { b.enrollments[0].studentId = randomUUID(); }],
    ['recurso de progreso inexistente', b => { b.progress[0].resourceId = randomUUID(); }],
    ['archivo inexistente', b => { b.resources[0].fileId = randomUUID(); }],
    ['archivo sin recurso', b => { b.files.push({ ...b.files[0], id: randomUUID() }); }],
    ['archivo compartido por dos recursos', b => { b.resources.push({ ...b.resources[0], id: randomUUID() }); }],
    ['tipo MIME que no corresponde', b => { b.files[0].mime = 'text/html'; }],
    ['modalidad inexistente', b => { b.courses[0].accessMode = 'sin-control'; }],
    ['estado de matrícula inexistente', b => { b.enrollments[0].status = 'unknown'; }],
    ['fecha no válida', b => { b.students[0].createdAt = 'ayer'; }],
    ['intervalo invertido', b => { b.enrollments[0].startsAt = '2026-03-01T00:00:00.000Z'; b.enrollments[0].expiresAt = '2026-02-01T00:00:00.000Z'; }],
    ['ruta relativa en el nombre del archivo', b => { b.files[0].name = '../lectura.pdf'; }],
    ['ruta Windows en el nombre del archivo', b => { b.files[0].name = '..\\lectura.pdf'; }],
    ['JavaScript suelto no admitido', b => { b.files[0].name = 'codigo.js'; }],
    ['SVG activo no admitido', b => { b.files[0].name = 'imagen.svg'; }],
    ['PDF con contenido falsificado', b => { b.files[0].base64 = Buffer.from('<script>alert(1)</script>').toString('base64'); }],
    ['contenido base64 inválido', b => { b.files[0].base64 = '%%%contenido-inválido%%%'; }]
  ];
  for (const [label, mutate, expected = 400] of cases) {
    await t.test(label, async () => {
      const invalid = structuredClone(value);
      mutate(invalid);
      status(await importBundle(app.admin, invalid), expected);
      assert.deepEqual(snapshot(app.db), initial, 'El rechazo debe conservar toda la base de destino');
      assert.deepEqual(await readdir(join(app.dataDir, 'uploads')), [], 'El rechazo no debe dejar archivos');
    });
  }
  status(await importBundle(app.admin, value), 201);
});

