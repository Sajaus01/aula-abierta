import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDatabase, bootstrapAdmin } from '../server/database.mjs';
import { hashPassword, verifyPassword } from '../server/security.mjs';
import { createApp } from '../server/index.mjs';

const freshPassword = () => `T-${randomBytes(24).toString('base64url')}`;

async function temporaryData(t, beforeRemove = async () => {}) {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'aula-abierta-test-'));
  t.after(async () => {
    await beforeRemove();
    const target = resolve(directory);
    assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith('aula-abierta-test-'));
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return directory;
}

test('las contraseñas se verifican con hash y sal únicos', async () => {
  const password = freshPassword();
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second, 'Dos cuentas no deben compartir el mismo hash de una contraseña');
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(freshPassword(), first), false);
  assert.equal(await verifyPassword(password, null), false);
});

async function httpFixture(t, environment = {}) {
  let app;
  const dataDir = await temporaryData(t, async () => {
    if (app) await new Promise((resolveClose, reject) => app.server.close(error => error ? reject(error) : resolveClose()));
  });
  const adminPassword = freshPassword();
  app = await createApp({ dataDir, env: { NODE_ENV: 'test', ADMIN_DOCUMENT: '50000001', ADMIN_NAME: 'Administración de pruebas', ADMIN_PASSWORD: adminPassword, ...environment } });
  await new Promise((resolveListen, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolveListen);
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  function client() {
    return {
      cookie: '',
      async request(path, { method = 'GET', body, headers = {} } = {}) {
        const requestHeaders = { ...(!['GET', 'HEAD'].includes(method) ? { Origin: base } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers };
        const response = await fetch(base + path, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
        const cookie = response.headers.get('set-cookie');
        if (cookie) this.cookie = cookie.split(';')[0];
        const text = await response.text();
        const payload = text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
        return { status: response.status, headers: response.headers, text, payload, data: payload?.data };
      }
    };
  }
  return { ...app, base, client, adminPassword };
}

function status(response, expected) {
  assert.equal(response.status, expected, `Estado HTTP inesperado: ${response.text.slice(0, 500)}`);
  return response.data;
}

test('la API aplica permisos, sesiones, matrículas y controles de archivos', async t => {
  const fixture = await httpFixture(t);
  const anonymous = fixture.client();
  const admin = fixture.client();
  const student = fixture.client();
  const otherStudent = fixture.client();
  const create = async (path, body) => status(await admin.request(path, { method: 'POST', body }), 201);
  let alpha, beta, secureCourse, documentCourse, openCourse, draftCourse, secureModule, secureFile, draftFile, openFile, enrollment, htmlResource;
  const studentPassword = freshPassword();

  await t.test('el administrador requiere contraseña y las respuestas no filtran secretos', async () => {
    const initial = status(await anonymous.request('/api/status'), 200);
    assert.equal(initial.setupRequired, false);
    status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: '50000001' } }), 401);
    status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: '59999999', password: freshPassword() } }), 401);
    const response = await admin.request('/api/auth/login', { method: 'POST', body: { document: '50000001', password: fixture.adminPassword } });
    const session = status(response, 200);
    assert.equal(session.assurance, 'password');
    assert.equal(session.user.role, 'admin');
    assert.ok(!response.text.includes('password_hash') && !response.text.includes(fixture.adminPassword));
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(status(await admin.request('/api/admin/courses'), 200), []);
  });

  await t.test('rechaza mutaciones de otro origen y usuarios sin permisos de administrador', async () => {
    status(await admin.request('/api/admin/courses', { method: 'POST', headers: { Origin: 'https://otro-sitio.invalid' }, body: { title: 'No debe existir' } }), 403);
    status(await admin.request('/api/admin/courses', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { title: 'No debe existir' } }), 403);
    status(await anonymous.request('/api/admin/students'), 403);
    status(await anonymous.request('/api/admin/courses', { method: 'POST', body: { title: 'No debe existir' } }), 403);
    assert.deepEqual(status(await admin.request('/api/admin/courses'), 200), []);
  });

  await t.test('prepara matrículas y materiales sin datos privados en el catálogo público', async () => {
    alpha = await create('/api/admin/students', { document: '20000001', name: 'Estudiante Uno', email: 'uno@example.test' });
    beta = await create('/api/admin/students', { document: '20000002', name: 'Estudiante Dos' });
    assert.equal(alpha.mustChangePassword, true);
    assert.equal(alpha.activationCode, undefined);
    status(await student.request('/api/auth/login', { method: 'POST', body: { document: alpha.document, password: alpha.document } }), 200);
    status(await student.request('/api/auth/first-password', { method: 'POST', body: { newPassword: studentPassword, confirmPassword: studentPassword } }), 200);
    status(await student.request('/api/auth/logout', { method: 'POST', body: {} }), 200);
    secureCourse = await create('/api/admin/courses', { title: 'Curso con contraseña', accessMode: 'password', published: true });
    documentCourse = await create('/api/admin/courses', { title: 'Curso con cédula', accessMode: 'document', published: true });
    openCourse = await create('/api/admin/courses', { title: 'Curso abierto', accessMode: 'public', published: true });
    draftCourse = await create('/api/admin/courses', { title: 'Borrador oculto', accessMode: 'public', published: false });
    secureModule = await create(`/api/admin/courses/${secureCourse.id}/modules`, { published: true, title: 'Unidad privada' });
    const draftModule = await create(`/api/admin/courses/${draftCourse.id}/modules`, { published: true, title: 'Unidad borrador' });
    const openModule = await create(`/api/admin/courses/${openCourse.id}/modules`, { published: true, title: 'Unidad libre' });
    const file = { name: 'apuntes.pdf', base64: Buffer.from('%PDF-1.7\nmaterial de prueba\n%%EOF').toString('base64') };
    secureFile = await create(`/api/admin/modules/${secureModule.id}/resources`, { published: true, title: 'Archivo privado', kind: 'pdf', file });
    draftFile = await create(`/api/admin/modules/${draftModule.id}/resources`, { published: true, title: 'Archivo borrador', kind: 'pdf', file });
    openFile = await create(`/api/admin/modules/${openModule.id}/resources`, { published: true, title: 'Archivo abierto', kind: 'pdf', file });
    enrollment = await create('/api/admin/enrollments', { studentId: alpha.id, courseId: secureCourse.id });
    await create('/api/admin/enrollments', { studentId: alpha.id, courseId: documentCourse.id });
    const catalogResponse = await anonymous.request('/api/courses');
    const catalog = status(catalogResponse, 200);
    assert.equal(catalog.length, 3);
    assert.ok(!catalog.some(course => course.id === draftCourse.id));
    assert.ok(!catalogResponse.text.includes(secureFile.id));
    assert.ok(!catalogResponse.text.includes(alpha.document));
    status(await anonymous.request(`/api/courses/${openCourse.id}`), 200);
    status(await anonymous.request(openFile.fileUrl), 200);
    status(await anonymous.request(`/api/courses/${secureCourse.id}`), 401);
    status(await anonymous.request(secureFile.fileUrl), 401);
    status(await anonymous.request(secureFile.fileUrl, { method: 'HEAD' }), 401);
    status(await anonymous.request(`/api/courses/${draftCourse.id}`), 404);
    status(await anonymous.request(draftFile.fileUrl), 404);
    status(await admin.request(draftFile.fileUrl), 200);
  });

  await t.test('una sesión por cédula no abre cursos de contraseña ni permite cambiarla', async () => {
    const login = status(await student.request('/api/auth/login', { method: 'POST', body: { document: alpha.document } }), 200);
    assert.equal(login.assurance, 'document');
    status(await student.request(`/api/courses/${documentCourse.id}`), 200);
    status(await student.request(`/api/courses/${secureCourse.id}`), 403);
    status(await student.request(secureFile.fileUrl), 403);
    status(await student.request('/api/auth/password', { method: 'POST', body: { newPassword: freshPassword() } }), 403);
    status(await student.request('/api/admin/students'), 403);
    status(await student.request(`/api/admin/courses/${secureCourse.id}`, { method: 'DELETE' }), 403);
  });

  await t.test('la activación es de un solo uso e invalida la sesión de cédula anterior', async () => {
    const priorDocumentCookie = student.cookie;
    alpha.activationCode = status(await admin.request(`/api/admin/students/${alpha.id}/activation`, { method: 'POST', body: {} }), 200).activationCode;
    const activated = status(await student.request('/api/auth/activate', { method: 'POST', body: { document: alpha.document, code: alpha.activationCode, password: studentPassword } }), 200);
    assert.equal(activated.assurance, 'password');
    status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: alpha.document, code: alpha.activationCode, password: freshPassword() } }), 401);
    const stale = fixture.client();
    stale.cookie = priorDocumentCookie;
    assert.equal(status(await stale.request('/api/auth/me'), 200).user, null);
    status(await student.request(`/api/courses/${secureCourse.id}`), 200);
    const file = await student.request(secureFile.fileUrl);
    status(file, 200);
    assert.match(file.text, /^%PDF-/);
    assert.equal(file.headers.get('cache-control'), 'no-store');
    assert.match(file.headers.get('content-disposition'), /^inline;/);
    status(await student.request(secureFile.fileUrl, { headers: { Range: 'bytes=0-4' } }), 206);
    const stored = fixture.db.prepare('SELECT password_hash FROM users WHERE id=?').get(alpha.id);
    assert.notEqual(stored.password_hash, studentPassword);
  });

  await t.test('la matrícula de otra cuenta no permite consultar materiales ni escribir progreso', async () => {
    status(await otherStudent.request('/api/auth/login', { method: 'POST', body: { document: beta.document, password: beta.document } }), 200);
    const betaPassword = freshPassword();
    status(await otherStudent.request('/api/auth/first-password', { method: 'POST', body: { newPassword: betaPassword, confirmPassword: betaPassword } }), 200);
    status(await otherStudent.request(`/api/courses/${secureCourse.id}`), 403);
    status(await otherStudent.request(secureFile.fileUrl), 403);
    status(await otherStudent.request(`/api/progress/${secureFile.id}`, { method: 'PUT', body: { completed: true } }), 403);
    status(await student.request(`/api/progress/${secureFile.id}`, { method: 'PUT', body: { completed: true } }), 200);
    assert.deepEqual(status(await otherStudent.request('/api/progress'), 200), []);
    const progress = status(await student.request('/api/progress'), 200);
    assert.equal(progress.length, 1);
    assert.equal(progress[0].resourceId, secureFile.id);
  });

  await t.test('cambiar la modalidad protege de inmediato los enlaces ya conocidos', async () => {
    status(await admin.request(`/api/admin/courses/${secureCourse.id}`, { method: 'PATCH', body: { accessMode: 'public' } }), 200);
    status(await anonymous.request(secureFile.fileUrl), 200);
    status(await admin.request(`/api/admin/courses/${secureCourse.id}`, { method: 'PATCH', body: { accessMode: 'password' } }), 200);
    status(await anonymous.request(secureFile.fileUrl), 401);
    status(await student.request(secureFile.fileUrl), 200);
  });

  await t.test('matrículas vencidas, futuras o revocadas bloquean descarga y progreso', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    status(await admin.request(`/api/admin/enrollments/${enrollment.id}`, { method: 'PATCH', body: { expiresAt: past } }), 200);
    status(await student.request(secureFile.fileUrl), 403);
    assert.deepEqual(status(await student.request('/api/progress'), 200), []);
    status(await admin.request(`/api/admin/enrollments/${enrollment.id}`, { method: 'PATCH', body: { expiresAt: null, startsAt: future } }), 200);
    status(await student.request(secureFile.fileUrl), 403);
    status(await admin.request(`/api/admin/enrollments/${enrollment.id}`, { method: 'PATCH', body: { startsAt: null } }), 200);
    status(await student.request(secureFile.fileUrl), 200);
    status(await admin.request(`/api/admin/enrollments/${enrollment.id}`, { method: 'DELETE' }), 200);
    status(await student.request(secureFile.fileUrl), 403);
    status(await student.request(`/api/progress/${secureFile.id}`, { method: 'PUT', body: { completed: false } }), 403);
    status(await admin.request(`/api/admin/enrollments/${enrollment.id}`, { method: 'PATCH', body: { status: 'active' } }), 200);
  });

  await t.test('pasar un curso a borrador bloquea incluso al estudiante matriculado', async () => {
    status(await admin.request(`/api/admin/courses/${secureCourse.id}`, { method: 'PATCH', body: { published: false } }), 200);
    status(await student.request(secureFile.fileUrl), 404);
    status(await admin.request(secureFile.fileUrl), 200);
    status(await admin.request(`/api/admin/courses/${secureCourse.id}`, { method: 'PATCH', body: { published: true } }), 200);
  });

  await t.test('los archivos rechazan rutas, formatos falsos y scripts; HTML se descarga', async () => {
    const path = `/api/admin/modules/${secureModule.id}/resources`;
    for (const name of ['../archivo.txt', '..\\archivo.txt', 'codigo.js', 'imagen.svg']) {
      status(await admin.request(path, { method: 'POST', body: { title: 'Archivo no permitido', kind: 'html', file: { name, base64: Buffer.from('archivo').toString('base64') } } }), 400);
    }
    status(await admin.request(path, { method: 'POST', body: { title: 'PDF falso', kind: 'pdf', file: { name: 'falso.pdf', base64: Buffer.from('<script>alert(1)</script>').toString('base64') } } }), 400);
    htmlResource = await create(path, { published: true, title: 'HTML descargable', kind: 'html', file: { name: 'pagina.html', base64: Buffer.from('<!doctype html><title>Archivo de prueba</title><script>window.lessonTest = 1;</script>').toString('base64') } });
    const response = await student.request(htmlResource.fileUrl);
    status(response, 200);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const key = fixture.db.prepare('SELECT file_key FROM resources WHERE id=?').get(secureFile.id).file_key;
    status(await anonymous.request(`/uploads/${key}`), 404);
    status(await anonymous.request('/data/aula.sqlite'), 404);
    status(await anonymous.request('/.env'), 404);
  });

  await t.test('la vista previa HTML conserva los permisos y ejecuta solo scripts internos en un origen aislado', async () => {
    assert.equal(htmlResource.previewUrl, `/api/resources/${htmlResource.id}/preview`);
    status(await anonymous.request(htmlResource.previewUrl), 401);
    status(await otherStudent.request(htmlResource.previewUrl), 403);
    const response = await student.request(htmlResource.previewUrl);
    status(response, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.text, /<script>window\.lessonTest = 1;<\/script>/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const csp = Object.fromEntries(response.headers.get('content-security-policy').split(';').map(directive => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }));
    assert.deepEqual(csp.sandbox, ['allow-scripts']);
    assert.ok(!response.headers.get('content-security-policy').includes('allow-same-origin'));
    assert.deepEqual(csp['default-src'], ["'none'"]);
    assert.deepEqual(csp['script-src'], ["'unsafe-inline'"]);
    assert.deepEqual(csp['connect-src'], ["'none'"]);
    assert.deepEqual(csp['form-action'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    status(await student.request(htmlResource.previewUrl, { method: 'HEAD' }), 200);
    status(await anonymous.request(htmlResource.previewUrl, { method: 'HEAD' }), 401);
    status(await student.request(`/api/resources/${secureFile.id}/preview`), 404);
    status(await admin.request(`/api/admin/courses/${secureCourse.id}`, { method: 'PATCH', body: { published: false } }), 200);
    status(await student.request(htmlResource.previewUrl), 404);
    status(await admin.request(`/api/admin/courses/${secureCourse.id}`, { method: 'PATCH', body: { published: true } }), 200);
    const openModule = await create(`/api/admin/courses/${openCourse.id}/modules`, { published: true, title: 'Capítulo interactivo público' });
    const content = '<!doctype html><title>Capítulo libre</title><script>document.title = "Interactivo";</script>';
    const openHtml = await create(`/api/admin/modules/${openModule.id}/resources`, { published: true, title: 'HTML público', kind: 'html', content });
    assert.equal(status(await anonymous.request(`/api/courses/${openCourse.id}`), 200).locked, false);
    const publicPreview = await anonymous.request(openHtml.previewUrl);
    status(publicPreview, 200);
    assert.equal(publicPreview.text, content);
  });

  await t.test('la importación informa duplicados sin sobrescribir cuentas existentes', async () => {
    const imported = status(await admin.request('/api/admin/students/bulk', { method: 'POST', body: { students: [
      { document: alpha.document, name: 'No sobrescribir' },
      { document: '00030001', name: 'Estudiante nuevo' },
      { document: '00030001', name: 'Duplicado en lote' },
      { document: 'no-valido', name: 'Inválido' }
    ] } }), 201);
    assert.equal(imported.created.length, 1);
    assert.equal(imported.created[0].document, '00030001');
    assert.deepEqual(imported.errors.map(row => row.row), [1, 3, 4]);
    const listResponse = await admin.request('/api/admin/students');
    const list = status(listResponse, 200);
    assert.equal(list.find(person => person.id === alpha.id).name, 'Estudiante Uno');
    assert.ok(!listResponse.text.includes('password_hash'));
    assert.ok(!listResponse.text.includes('activationCode'));
    assert.ok(!listResponse.text.includes(alpha.activationCode));
  });

  await t.test('un código nuevo revoca sesiones y códigos anteriores; suspender bloquea el ingreso', async () => {
    const first = status(await admin.request(`/api/admin/students/${alpha.id}/activation`, { method: 'POST', body: {} }), 200);
    assert.equal(status(await student.request('/api/auth/me'), 200).user, null);
    status(await student.request(secureFile.fileUrl), 401);
    const second = status(await admin.request(`/api/admin/students/${alpha.id}/activation`, { method: 'POST', body: {} }), 200);
    status(await anonymous.request('/api/auth/activate', { method: 'POST', body: { document: alpha.document, code: first.activationCode, password: freshPassword() } }), 401);
    const replacementPassword = freshPassword();
    status(await student.request('/api/auth/activate', { method: 'POST', body: { document: alpha.document, code: second.activationCode, password: replacementPassword } }), 200);
    status(await admin.request(`/api/admin/students/${alpha.id}`, { method: 'DELETE' }), 200);
    status(await student.request(secureFile.fileUrl), 401);
    status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: alpha.document, password: replacementPassword } }), 401);
    status(await anonymous.request('/api/auth/login', { method: 'POST', body: { document: alpha.document } }), 401);
  });

  await t.test('cierra la sesión del administrador y rechaza la cookie anterior', async () => {
    const old = admin.cookie;
    status(await admin.request('/api/auth/logout', { method: 'POST', body: {} }), 200);
    admin.cookie = old;
    status(await admin.request('/api/admin/students'), 403);
  });
});

test('la sesión de producción requiere cookies Secure y el origen HTTPS configurado', async t => {
  const fixture = await httpFixture(t, { NODE_ENV: 'production', APP_URL: 'https://aula.example.test' });
  const admin = fixture.client();
  status(await admin.request('/api/auth/login', { method: 'POST', body: { document: '50000001', password: fixture.adminPassword } }), 403);
  const response = await admin.request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://aula.example.test' }, body: { document: '50000001', password: fixture.adminPassword } });
  status(response, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure(?:;|$)/);
  assert.match(response.headers.get('strict-transport-security'), /max-age=/);
});

test('el primer administrador requiere configuración y no se reemplaza al reiniciar', async t => {
  const dataDir = await temporaryData(t);
  const db = openDatabase(dataDir);
  try {
    assert.equal(await bootstrapAdmin(db, {}), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 0);
    await assert.rejects(bootstrapAdmin(db, { ADMIN_DOCUMENT: '50000001', ADMIN_PASSWORD: 'corta' }));
    const password = freshPassword();
    assert.equal(await bootstrapAdmin(db, { ADMIN_DOCUMENT: '50000001', ADMIN_NAME: 'Administración de pruebas', ADMIN_PASSWORD: password }), true);
    const user = db.prepare('SELECT * FROM users').get();
    assert.equal(user.role, 'admin');
    assert.equal(await verifyPassword(password, user.password_hash), true);
    assert.equal(await bootstrapAdmin(db, { ADMIN_DOCUMENT: '50000002', ADMIN_PASSWORD: freshPassword() }), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM users').get().total, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM courses').get().total, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM enrollments').get().total, 0);
  } finally {
    db.close();
  }
});
