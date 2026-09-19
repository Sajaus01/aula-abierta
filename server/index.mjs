import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join, extname, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, bootstrapAdmin, backfillStudentInitialPasswords } from './database.mjs';
import { token, digest, hashPassword, verifyPassword, passwordError, RateLimiter } from './security.mjs';
import { importMigration, MigrationError, MIGRATION_MAX_BYTES } from './migration.mjs';
import { createAcademics } from './academics.mjs';
import { createQuickResources } from './quick-resources.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const RESOURCE_KINDS = new Set(['pdf', 'slides', 'video', 'book', 'image', 'exercise', 'html', 'link']);
const FILE_TYPES = { '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv':'text/csv', '.pdf':'application/pdf', '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.txt':'text/plain', '.html':'text/html', '.htm':'text/html' };
const STATIC_TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.webp':'image/webp', '.woff2':'font/woff2' };
const now = () => new Date().toISOString();
class ApiError extends Error { constructor(status, message, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new ApiError(status, message, code); };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function string(value, name, maximum, required = false) {
  if (value === undefined || value === null) { if (required) fail(400, `Falta ${name}.`); return ''; }
  if (typeof value !== 'string') fail(400, `${name} debe ser texto.`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum) fail(400, `${name} debe tener ${required ? 'entre 1 y ' : 'hasta '}${maximum} caracteres.`);
  return result;
}
function documentNumber(value) {
  const result = string(value, 'la cédula', 20, true);
  if (!/^\d{4,20}$/.test(result)) fail(400, 'La cédula debe contener entre 4 y 20 dígitos, sin puntos ni espacios.');
  return result;
}
function emailAddress(value) {
  const result = string(value, 'el correo', 254);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'El correo electrónico no es válido.');
  return result;
}
function webUrl(value) {
  const result = string(value, 'el enlace', 2048);
  if (!result) return '';
  let url;
  try { url = new URL(result); } catch { fail(400, 'El enlace debe ser una URL completa con https:// o http://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(400, 'Solo se permiten enlaces HTTP o HTTPS sin credenciales.');
  return url.href;
}
function boolean(value, name) { if (typeof value !== 'boolean') fail(400, `${name} debe ser verdadero o falso.`); return value ? 1 : 0; }
function position(value) { if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000000) fail(400, 'La posición no es válida.'); return value; }
function timestamp(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, `${name} no es una fecha válida.`);
  return new Date(value).toISOString();
}
function validDates(starts, expires) { if (starts && expires && starts >= expires) fail(400, 'La fecha final debe ser posterior a la inicial.'); }
function enrollmentImportDate(value, name) {
  if (value === undefined || value === null) return null;
  // The batch API accepts explicit ISO instants, avoiding locale-dependent dates.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail(400, `${name} debe ser una fecha ISO con zona horaria o estar vacía.`);
  const result = timestamp(value, name);
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail(400, `${name} no es una fecha válida.`);
  return result;
}
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify({ data })); }
function userView(user) { return { id:user.id, document:user.document, name:user.name, email:user.email, role:user.role, mustChangePassword:user.role === 'student' && Boolean(user.must_change_password) }; }

async function readJson(req, limit = 1024 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Envía los datos como application/json.');
  const length = Number(req.headers['content-length']);
  if (Number.isFinite(length) && length > limit) fail(413, 'El archivo o la solicitud supera el tamaño permitido.');
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'El archivo o la solicitud supera el tamaño permitido.');
    parts.push(chunk);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { fail(400, 'JSON no válido.'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail(400, 'La solicitud debe contener un objeto JSON.');
  return parsed;
}

export function validateFile(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) fail(400, 'El archivo no es válido.');
  const name = string(file.name, 'el nombre del archivo', 180, true);
  if (/[\x00-\x1f\x7f\\/]/.test(name)) fail(400, 'El nombre del archivo contiene caracteres no permitidos.');
  const extension = extname(name).toLowerCase();
  const mime = FILE_TYPES[extension];
  if (!mime) fail(400, 'Formato no admitido. Usa PDF, PPTX, DOCX, PNG, JPG, GIF, WebP, TXT o HTML.');
  if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(UPLOAD_MAX_BYTES / 3) * 4 || file.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.base64)) fail(400, 'El contenido del archivo no es válido.');
  const buffer = Buffer.from(file.base64, 'base64');
  if (buffer.toString('base64') !== file.base64) fail(400, 'El contenido del archivo no es válido.');
  if (!buffer.length || buffer.length > UPLOAD_MAX_BYTES) fail(413, 'El archivo debe tener contenido y pesar como máximo 20 MB.');
  const head = buffer.subarray(0, 12);
  const signatureOK = extension === '.pdf' ? head.subarray(0, 5).toString() === '%PDF-'
    : ['.pptx', '.docx', '.xlsx'].includes(extension) ? head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
    : extension === '.png' ? head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : ['.jpg', '.jpeg'].includes(extension) ? head[0] === 255 && head[1] === 216 && head[2] === 255
    : extension === '.gif' ? ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString())
    : extension === '.webp' ? head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP'
    : !buffer.includes(0);
  if (!signatureOK) fail(400, 'El contenido del archivo no coincide con su formato.');
  return { key:randomUUID() + extension, name, mime, buffer, size:buffer.length };
}

export async function createApp(options = {}) {
  const env = options.env || process.env;
  const dataDir = resolve(options.dataDir || env.DATA_DIR || join(ROOT, 'data'));
  const publicDir = resolve(options.publicDir || join(ROOT, 'public'));
  // Never allow storage to become part of the directory served publicly.
  if (dataDir === publicDir || dataDir.startsWith(publicDir + sep)) throw new Error('DATA_DIR debe estar fuera de public.');
  const db = openDatabase(dataDir);
  await bootstrapAdmin(db, env);
  await backfillStudentInitialPasswords(db);
  const configuredUrl = env.APP_URL || env.RENDER_EXTERNAL_URL;
  const appOrigin = configuredUrl ? new URL(configuredUrl).origin : null;
  if (env.NODE_ENV === 'production' && (!appOrigin || !appOrigin.startsWith('https://'))) throw new Error('En producción configura APP_URL con la URL pública HTTPS.');
  const secure = env.NODE_ENV === 'production' || appOrigin?.startsWith('https://');
  const limiter = new RateLimiter();
  const uploadsDir = join(dataDir, 'uploads');
  const query = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const audit = (actor, action, target) => run('INSERT INTO audit(actor_id,action,target_id,created_at) VALUES (?,?,?,?)', actor?.id || null, action, target || null, now());
  const requireAdmin = auth => { if (!auth || auth.user.role !== 'admin' || auth.assurance !== 'password') fail(403, 'Se requiere una sesión de administración.', 'ADMIN_REQUIRED'); };
  const requireAuth = auth => { if (!auth) fail(401, 'Inicia sesión para continuar.', 'LOGIN_REQUIRED'); return auth; };
  const requirePersonalPassword = auth => {
    if (auth?.user.role === 'student' && auth.user.must_change_password) fail(403, 'Configura tu contraseña personal antes de entrar al aula.', 'PASSWORD_CHANGE_REQUIRED');
  };
  const requireStudent = auth => {
    requireAuth(auth);
    if (auth.user.role !== 'student') fail(403, 'Esta función está disponible para estudiantes.', 'STUDENT_REQUIRED');
    requirePersonalPassword(auth);
    return auth;
  };

  function readSession(req) {
    const match = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('aula_session='));
    if (!match) return null;
    const value = match.slice('aula_session='.length);
    if (!/^[\w-]{43}$/.test(value)) return null;
    const session = one('SELECT s.*,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1', digest(value), now());
    return session ? { user:session, assurance:session.assurance, tokenHash:digest(value) } : null;
  }
  function issueSession(res, user, assurance) {
    const secret = token();
    const seconds = user.role === 'student' && user.must_change_password ? 15 * 60 : assurance === 'password' ? 12 * 60 * 60 : 4 * 60 * 60;
    run('DELETE FROM sessions WHERE expires_at<=?', now());
    run('INSERT INTO sessions(token_hash,user_id,assurance,expires_at,created_at) VALUES (?,?,?,?,?)', digest(secret), user.id, assurance, new Date(Date.now() + seconds * 1000).toISOString(), now());
    res.setHeader('Set-Cookie', `aula_session=${secret}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
    return { user:userView(user), assurance };
  }
  function clearSession(res) { res.setHeader('Set-Cookie', `aula_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`); }
  function isEnrolled(userId, courseId) {
    if (!userId) return false;
    const at = now();
    return Boolean(one("SELECT id FROM enrollments WHERE student_id=? AND course_id=? AND status='active' AND (starts_at IS NULL OR starts_at<=?) AND (expires_at IS NULL OR expires_at>?)", userId, courseId, at, at));
  }
  function canAccess(course, auth) {
    if (auth?.user.role === 'student' && auth.user.must_change_password) return false;
    if (auth?.user.role === 'admin' && auth.assurance === 'password') return true;
    if (!course.published) return false;
    if (course.access_mode === 'public') return true;
    if (!auth || !isEnrolled(auth.user.id, course.id)) return false;
    return course.access_mode === 'document' || auth.assurance === 'password';
  }
  function requireCourse(courseId, auth) {
    requirePersonalPassword(auth);
    const course = one('SELECT * FROM courses WHERE id=?', courseId);
    if (!course || (!course.published && auth?.user.role !== 'admin')) fail(404, 'Curso no encontrado.', 'NOT_FOUND');
    if (!canAccess(course, auth)) fail(auth ? 403 : 401, course.access_mode === 'password' && auth?.assurance === 'document' ? 'Este curso requiere cédula y contraseña.' : 'Necesitas una matrícula vigente y el acceso requerido para consultar este curso.', 'COURSE_LOCKED');
    return course;
  }
  function requirePublishedResource(row, auth) {
    requireCourse(row.course_id, auth);
    if (auth?.user.role !== 'admin' && (!row.published || !row.module_published)) fail(404, 'Material no disponible.', 'NOT_FOUND');
  }
  function resourceView(row) {
    return { id:row.id, moduleId:row.module_id, published:Boolean(row.published), title:row.title, kind:row.kind, url:row.url, content:row.content, position:row.position, fileName:row.file_name, fileMime:row.file_mime, fileSize:row.file_size, fileUrl:row.file_key ? `/api/resources/${row.id}/file` : null, previewUrl:row.kind === 'html' && (row.content || row.file_key) ? `/api/resources/${row.id}/preview` : null, createdAt:row.created_at, updatedAt:row.updated_at };
  }
  function courseView(course, auth, details = false) {
    const teacher = auth?.user.role === 'admin' && auth.assurance === 'password';
    const modules = query('SELECT * FROM modules WHERE course_id=? ORDER BY position,id', course.id).filter(m => teacher || m.published);
    const resourceScope = 'FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=? AND (?=1 OR (r.published=1 AND m.published=1))';
    const resources = details ? query(`SELECT r.* ${resourceScope} ORDER BY r.position,r.id`, course.id, Number(teacher)) : [];
    const resourceCount = details ? resources.length : one(`SELECT COUNT(*) AS count ${resourceScope}`, course.id, Number(teacher)).count;
    const result = { id:course.id, title:course.title, description:course.description, accessMode:course.access_mode, published:Boolean(course.published), coverUrl:course.cover_url, createdAt:course.created_at, updatedAt:course.updated_at, enrolled:isEnrolled(auth?.user.id, course.id), locked:!canAccess(course, auth), resourceCount, moduleCount:modules.length };
    if (auth?.user.role === 'admin') result.enrollmentCount = one("SELECT COUNT(*) AS count FROM enrollments WHERE course_id=? AND status='active'", course.id).count;
    if (details) result.modules = modules.map(module => ({ id:module.id, courseId:module.course_id, title:module.title, position:module.position, published:Boolean(module.published), resources:resources.filter(r => r.module_id === module.id).map(resourceView) }));
    if (details) {
      const teacher = auth?.user.role === 'admin' && auth.assurance === 'password';
      // Course listings expose only activity metadata, never questions, keys or grades.
      result.activities = !result.locked && (teacher || result.enrolled) ? query('SELECT id,module_id,config FROM activities WHERE course_id=? ORDER BY created_at,id', course.id).flatMap(row => {
        const a = JSON.parse(row.config);
        if (!teacher && (a.status !== 'published' || (row.module_id && !modules.some(m => m.id === row.module_id)))) return [];
        const submitted = !teacher && auth?.assurance === 'password' ? Boolean(one("SELECT id FROM submissions WHERE activity_id=? AND student_id=? AND state!='draft' LIMIT 1", row.id, auth.user.id)) : false;
        return [{id:row.id,moduleId:row.module_id,title:a.title,kind:a.kind,status:a.status,weight:a.weight,dueAt:a.dueAt,opensAt:a.opensAt,closesAt:a.closesAt,submitted}];
      }) : [];
    }
    if (details) result.quickResources = result.locked ? [] : quickResources.list(course.id, auth);
    return result;
  }
  function progressView(row) {
    return { resourceId:row.resource_id, completed:Boolean(row.completed), updatedAt:row.updated_at, openedAt:row.opened_at || null, lastOpenedAt:row.last_opened_at || null };
  }
  function learningSummary(auth) {
    const courses = [], recent = [], activities = [];
    const resourceSummary = row => ({ id:row.id, title:row.title, moduleTitle:row.module_title, kind:row.kind });
    const byRecent = (a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.id.localeCompare(b.id);
    for (const course of query('SELECT * FROM courses WHERE published=1 ORDER BY created_at DESC,id')) {
      if (!canAccess(course, auth)) continue;
      const resources = query(`SELECT r.id,r.title,r.kind,m.title AS module_title,
        p.completed,p.updated_at,p.opened_at,p.last_opened_at
        FROM resources r JOIN modules m ON m.id=r.module_id
        LEFT JOIN progress p ON p.resource_id=r.id AND p.user_id=?
        WHERE m.course_id=? AND m.published=1 AND r.published=1 ORDER BY m.position,m.id,r.position,r.id`, auth.user.id, course.id);
      const opened = resources.filter(row => row.opened_at || row.last_opened_at || row.completed);
      const history = opened.map(row => ({ ...resourceSummary(row), lastOpenedAt:row.last_opened_at || row.opened_at || row.updated_at })).sort(byRecent);
      const next = resources.find(row => !row.completed);
      courses.push({ courseId:course.id, total:resources.length, opened:opened.length,
        completed:resources.filter(row => row.completed).length,
        exercisesTotal:resources.filter(row => row.kind === 'exercise').length,
        exercisesCompleted:resources.filter(row => row.kind === 'exercise' && row.completed).length,
        nextResource:next ? resourceSummary(next) : null, lastResource:history[0] || null });
      for (const row of history) recent.push({ courseId:course.id, courseTitle:course.title, resourceId:row.id, title:row.title, kind:row.kind, lastOpenedAt:row.lastOpenedAt });
      for (const row of resources) if (row.kind === 'exercise' && !row.completed && activities.length < 5) {
        activities.push({ courseId:course.id, courseTitle:course.title, resourceId:row.id, title:row.title, kind:row.kind });
      }
    }
    recent.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.resourceId.localeCompare(b.resourceId));
    return { courses, recent:recent.slice(0, 5), activities };
  }
  function studentView(user) {
    return { ...userView(user), active:Boolean(user.active), hasPassword:Boolean(user.password_hash), createdAt:user.created_at, updatedAt:user.updated_at, enrollmentCount:one("SELECT COUNT(*) AS count FROM enrollments WHERE student_id=? AND status='active'", user.id).count };
  }
  function settings() { return Object.fromEntries(query('SELECT key,value FROM settings').map(row => [row.key, row.value])); }
  function activation(userId) {
    const code = token();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    run('DELETE FROM activations WHERE user_id=?', userId);
    run('INSERT INTO activations(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)', digest(code), userId, expiresAt, now());
    return { activationCode:code, activationExpiresAt:expiresAt };
  }
  async function addStudent(input) {
    const document = documentNumber(input.document);
    const name = string(input.name, 'el nombre', 160, true);
    const email = emailAddress(input.email);
    if (one('SELECT id FROM users WHERE document=?', document)) fail(409, 'Ya existe un usuario con esa cédula.', 'DUPLICATE_DOCUMENT');
    const hash = await hashPassword(document);
    if (one('SELECT id FROM users WHERE document=?', document)) fail(409, 'Ya existe un usuario con esa cédula.', 'DUPLICATE_DOCUMENT');
    const id = randomUUID(), at = now();
    run('INSERT INTO users(id,document,name,email,role,password_hash,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,?,?)', id, document, name, email, 'student', hash, at, at);
    return studentView(one('SELECT * FROM users WHERE id=?', id));
  }
  async function importCourseEnrollments(req, originalAuth, courseId, body) {
    const checkScope = () => {
      const current = readSession(req);
      requireAdmin(current);
      if (current.user.id !== originalAuth.user.id || current.tokenHash !== originalAuth.tokenHash) fail(403, 'La sesión de administración cambió. Vuelve a ingresar.', 'ADMIN_REQUIRED');
      return existing('courses', courseId, 'Curso');
    };
    const course = checkScope();
    if (!Array.isArray(body.students) || !body.students.length || body.students.length > 500) fail(400, 'Envía entre 1 y 500 estudiantes por importación.');
    const startsAt = enrollmentImportDate(body.startsAt, 'La fecha inicial');
    const expiresAt = enrollmentImportDate(body.expiresAt, 'La fecha final');
    validDates(startsAt, expiresAt);
    const reactivate = own(body, 'reactivate') ? Boolean(boolean(body.reactivate, 'Reactivar matrículas')) : false;
    const summary = { received:body.students.length, createdStudents:0, enrolled:0, alreadyEnrolled:0, reactivated:0, skipped:0, errors:0 };
    const results = [], seen = new Set();
    for (let index = 0; index < body.students.length; index++) {
      checkScope();
      const input = body.students[index];
      const result = { row:index + 1, document:typeof input?.document === 'string' ? input.document.slice(0, 20) : '', name:typeof input?.name === 'string' ? input.name.slice(0, 160) : '', createdStudent:false };
      let transaction = false;
      try {
        if (!input || Array.isArray(input) || typeof input !== 'object') fail(400, 'Fila no válida.');
        const document = documentNumber(input.document);
        result.document = document;
        if (seen.has(document)) {
          result.status = 'skipped';
          result.reason = 'Cédula repetida en este archivo; se procesa únicamente su primera fila.';
        } else {
          seen.add(document);
          const name = string(input.name, 'el nombre', 160, true), email = emailAddress(input.email);
          result.name = name;
          const prior = one('SELECT * FROM users WHERE document=?', document);
          if (prior && (prior.role !== 'student' || !prior.active)) fail(400, prior.role !== 'student' ? 'La cédula pertenece a una cuenta de administración.' : 'El estudiante está suspendido. Revisa su cuenta antes de matricularlo.');
          // Only one derivation at a time; no transaction is held while hashing.
          const hash = prior ? null : await hashPassword(document);
          checkScope();
          db.exec('BEGIN IMMEDIATE');
          transaction = true;
          checkScope();
          let student = one('SELECT * FROM users WHERE document=?', document);
          if (student && (student.role !== 'student' || !student.active)) fail(400, student.role !== 'student' ? 'La cédula pertenece a una cuenta de administración.' : 'El estudiante está suspendido. Revisa su cuenta antes de matricularlo.');
          if (!student) {
            if (!hash) fail(409, 'La cuenta cambió durante la importación. Reintenta esta fila.');
            const id = randomUUID(), at = now();
            run('INSERT INTO users(id,document,name,email,role,password_hash,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,?,?)', id, document, name, email, 'student', hash, at, at);
            student = one('SELECT * FROM users WHERE id=?', id);
            result.createdStudent = true;
            audit(originalAuth.user, 'student.create', id);
          }
          result.studentId = student.id;
          result.name = student.name;
          const enrollment = one('SELECT * FROM enrollments WHERE student_id=? AND course_id=?', student.id, course.id);
          const at = now();
          if (enrollment && enrollment.status === 'active' && (!enrollment.expires_at || enrollment.expires_at > at)) {
            // Scheduled enrollments count as existing too; their dates stay intact.
            result.enrollmentId = enrollment.id;
            result.status = 'already_enrolled';
            result.reason = 'El estudiante ya tiene una matrícula vigente o programada en este curso.';
          } else if (enrollment && !reactivate) {
            result.enrollmentId = enrollment.id;
            result.status = 'skipped';
            result.reason = 'La matrícula está vencida o revocada. Requiere revisión o reactivación explícita.';
          } else if (enrollment) {
            run("UPDATE enrollments SET status='active',starts_at=?,expires_at=? WHERE id=?", startsAt, expiresAt, enrollment.id);
            result.enrollmentId = enrollment.id;
            result.status = 'reactivated';
            audit(originalAuth.user, 'enrollment.reactivate', enrollment.id);
          } else {
            const id = randomUUID();
            run("INSERT INTO enrollments(id,student_id,course_id,status,starts_at,expires_at,created_at) VALUES (?,?,?,'active',?,?,?)", id, student.id, course.id, startsAt, expiresAt, at);
            result.enrollmentId = id;
            result.status = 'enrolled';
            audit(originalAuth.user, 'enrollment.create', id);
          }
          db.exec('COMMIT');
          transaction = false;
        }
      } catch (error) {
        if (transaction) db.exec('ROLLBACK');
        if (error instanceof ApiError && ['ADMIN_REQUIRED', 'NOT_FOUND'].includes(error.code)) throw error;
        // SQL errors can contain private data. Return only a generic row error.
        result.status = 'error';
        result.createdStudent = false;
        delete result.studentId;
        delete result.enrollmentId;
        delete result.reason;
        result.error = error instanceof ApiError ? error.message : 'No se pudo guardar esta fila. No se crearon cuentas ni matrículas para ella; puedes reintentarla.';
      }
      if (result.createdStudent) summary.createdStudents += 1;
      const counter = { enrolled:'enrolled', already_enrolled:'alreadyEnrolled', reactivated:'reactivated', skipped:'skipped', error:'errors' }[result.status];
      summary[counter] += 1;
      results.push(result);
    }
    return { course:{ id:course.id, title:course.title }, summary, results };
  }
  function existing(table, id, label) { const row = one(`SELECT * FROM ${table} WHERE id=?`, id); if (!row) fail(404, `${label} no encontrado.`, 'NOT_FOUND'); return row; }
  function deleteFiles(rows) { for (const row of rows) if (row.file_key) { try { unlinkSync(join(uploadsDir, row.file_key)); } catch (error) { if (error.code !== 'ENOENT') console.error('No se pudo retirar un archivo huérfano.'); } } }
  function authLimit(req, document) {
    const ip = req.socket.remoteAddress || 'unknown';
    // A generous IP limit accommodates classrooms and reverse proxies. The tighter
    // account limit remains effective without trusting caller-controlled proxy headers.
    if (!limiter.allow(`auth-ip:${ip}`, 1000, 15 * 60000) || !limiter.allow(`auth-document:${document}`, 15, 15 * 60000)) fail(429, 'Demasiados intentos. Vuelve a intentarlo en 15 minutos.', 'RATE_LIMIT');
  }
  function csrf(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origen de solicitud no permitido.', 'INVALID_ORIGIN');
    const origin = req.headers.origin;
    if (origin) {
      const expected = appOrigin || `http://${req.headers.host}`;
      if (origin !== expected) fail(403, 'Origen de solicitud no permitido.', 'INVALID_ORIGIN');
    } else if (req.headers['sec-fetch-site']) {
      fail(403, 'La solicitud del navegador debe incluir su origen.', 'INVALID_ORIGIN');
    }
  }

  function fileResponse(req, res, filePath, mime, name, attachment = false, privateFile = false) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) fail(404, 'Archivo no encontrado.', 'NOT_FOUND');
    const size = statSync(filePath).size;
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    if (privateFile) {
      const safeName = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
      res.setHeader('Content-Disposition', `${attachment ? 'attachment' : 'inline'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`);
    }
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${size}`); fail(416, 'Rango no válido.'); }
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
      else { start = Math.max(0, size - Number(match[2])); }
      if (start >= size || start > end || start < 0) { res.setHeader('Content-Range', `bytes */${size}`); fail(416, 'Rango no válido.'); }
      status = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Length', Math.max(0, end - start + 1));
    res.writeHead(status);
    if (req.method === 'HEAD' || size === 0) return res.end();
    const stream = createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  const academics = createAcademics({db,fail,json,readJson,readSession,requireAdmin,requireStudent,requireCourse,isEnrolled,validateFile,fileResponse,uploadsDir,audit,env});
  const quickResources = createQuickResources({db,fail,json,readJson,readSession,requireAdmin,requireCourse,validateFile,fileResponse,uploadsDir,audit,string,webUrl,boolean});
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self'; frame-src 'self' https:; media-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      const method = req.method;
      const auth = readSession(req);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) csrf(req);
      const initialAllowed = (method === 'GET' && ['/api/status', '/api/settings', '/api/auth/me'].includes(path)) || (method === 'POST' && ['/api/auth/logout', '/api/auth/first-password'].includes(path));
      if (path.startsWith('/api/') && !initialAllowed) requirePersonalPassword(auth);
      if (await academics.handler(req,res,path,method,auth)) return;
      if (await quickResources.handler(req,res,path,method,auth)) return;
      if (path === '/api/status' && method === 'GET') return json(res, { setupRequired:!one("SELECT id FROM users WHERE role='admin'"), uploadMaxBytes:UPLOAD_MAX_BYTES });
      if (path === '/api/settings' && method === 'GET') return json(res, settings());
      if (path === '/api/auth/me' && method === 'GET') return json(res, auth ? { user:userView(auth.user), assurance:auth.assurance } : { user:null, assurance:null });
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await readJson(req);
        const document = documentNumber(body.document);
        authLimit(req, document);
        const user = one('SELECT * FROM users WHERE document=?', document);
        const hasPassword = typeof body.password === 'string' && body.password.length > 0;
        if (own(body, 'password') && typeof body.password !== 'string') fail(400, 'La contraseña debe ser texto.');
        if (hasPassword && body.password.length > 256) fail(400, 'Contraseña no válida.');
        const validPassword = hasPassword ? await verifyPassword(body.password, user?.password_hash) : false;
        const fresh = user ? one('SELECT * FROM users WHERE id=?', user.id) : null;
        if (!fresh?.active || fresh.document !== document || (hasPassword && (!validPassword || fresh.password_hash !== user.password_hash)) || (!hasPassword && user.role === 'admin')) fail(401, 'Los datos de acceso no son válidos.', 'INVALID_CREDENTIALS');
        if (!hasPassword) {
          requirePersonalPassword({ user:fresh });
          const at = now();
          const documentAccess = one("SELECT e.id FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.student_id=? AND e.status='active' AND c.published=1 AND c.access_mode='document' AND (e.starts_at IS NULL OR e.starts_at<=?) AND (e.expires_at IS NULL OR e.expires_at>?) LIMIT 1", user.id, at, at);
          if (!documentAccess) fail(401, 'Los datos de acceso no son válidos o no hay una matrícula habilitada para ingresar solo con cédula.', 'INVALID_CREDENTIALS');
        }
        if (auth) run('DELETE FROM sessions WHERE token_hash=?', auth.tokenHash);
        audit(user, hasPassword ? 'auth.login.password' : 'auth.login.document', user.id);
        return json(res, issueSession(res, fresh, hasPassword ? 'password' : 'document'));
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        await readJson(req);
        if (auth) run('DELETE FROM sessions WHERE token_hash=?', auth.tokenHash);
        clearSession(res);
        return json(res, { success:true });
      }
      if (path === '/api/auth/first-password' && method === 'POST') {
        requireAuth(auth);
        if (auth.user.role !== 'student' || auth.assurance !== 'password' || !auth.user.must_change_password) fail(403, 'Ingresa con tu contraseña inicial para configurar la personal.', 'INITIAL_PASSWORD_REQUIRED');
        const body = await readJson(req);
        const error = passwordError(body.newPassword, 'student', auth.user.document);
        if (error) fail(400, error);
        if (body.confirmPassword !== body.newPassword) fail(400, 'Las contraseñas no coinciden.');
        authLimit(req, auth.user.document);
        const hash = await hashPassword(body.newPassword);
        // Recheck after scrypt. A reset, document change, logout or parallel first
        // password request must invalidate this attempt instead of overwriting it.
        const current = readSession(req);
        if (!current || current.tokenHash !== auth.tokenHash || current.user.id !== auth.user.id || !current.user.must_change_password || current.assurance !== 'password' || current.user.document !== auth.user.document || current.user.password_hash !== auth.user.password_hash) fail(401, 'La sesión ha cambiado. Vuelve a ingresar.', 'LOGIN_REQUIRED');
        run('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?', hash, now(), auth.user.id);
        run('DELETE FROM sessions WHERE user_id=?', auth.user.id);
        run('DELETE FROM activations WHERE user_id=?', auth.user.id);
        audit(auth.user, 'auth.password.first', auth.user.id);
        return json(res, issueSession(res, one('SELECT * FROM users WHERE id=?', auth.user.id), 'password'));
      }
      if (path === '/api/auth/activate' && method === 'POST') {
        const body = await readJson(req);
        const document = documentNumber(body.document);
        authLimit(req, document);
        const code = string(body.code, 'el código de activación', 128, true);
        const error = passwordError(body.password, 'student', document);
        if (error) fail(400, error);
        const user = one("SELECT * FROM users WHERE document=? AND role='student' AND active=1", document);
        const record = user ? one('SELECT * FROM activations WHERE token_hash=? AND user_id=? AND expires_at>?', digest(code), user.id, now()) : null;
        if (!record || user.must_change_password) fail(401, 'El código de activación no es válido o ha vencido.', 'INVALID_ACTIVATION');
        const hash = await hashPassword(body.password);
        // Recheck after the expensive asynchronous hash: a code is consumed once.
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!one('SELECT a.token_hash FROM activations a JOIN users u ON u.id=a.user_id WHERE a.token_hash=? AND a.user_id=? AND a.expires_at>? AND u.active=1 AND u.must_change_password=0 AND u.document=?', digest(code), user.id, now(), document)) fail(401, 'El código de activación no es válido o ha vencido.', 'INVALID_ACTIVATION');
          run('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?', hash, now(), user.id);
          run('DELETE FROM activations WHERE user_id=?', user.id);
          run('DELETE FROM sessions WHERE user_id=?', user.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        audit(user, 'auth.activate', user.id);
        return json(res, issueSession(res, one('SELECT * FROM users WHERE id=?', user.id), 'password'));
      }
      if (path === '/api/auth/password' && method === 'POST') {
        requireAuth(auth);
        if (auth.assurance !== 'password') fail(403, 'Debes ingresar con contraseña o usar un código de activación.', 'PASSWORD_REQUIRED');
        const body = await readJson(req);
        const error = passwordError(body.newPassword, auth.user.role, auth.user.document);
        if (error) fail(400, error);
        authLimit(req, auth.user.document);
        if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 256 || !await verifyPassword(body.currentPassword, auth.user.password_hash)) fail(401, 'La contraseña actual no es correcta.', 'INVALID_CREDENTIALS');
        const hash = await hashPassword(body.newPassword);
        if (!one('SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=1 AND u.password_hash=? AND u.document=? AND u.must_change_password=0 AND s.token_hash=? AND s.expires_at>?', auth.user.id, auth.user.password_hash, auth.user.document, auth.tokenHash, now())) fail(401, 'La sesión ha cambiado. Vuelve a ingresar.', 'LOGIN_REQUIRED');
        run('UPDATE users SET password_hash=?,updated_at=? WHERE id=?', hash, now(), auth.user.id);
        run('DELETE FROM sessions WHERE user_id=?', auth.user.id);
        run('DELETE FROM activations WHERE user_id=?', auth.user.id);
        audit(auth.user, 'auth.password.change', auth.user.id);
        return json(res, issueSession(res, auth.user, 'password'));
      }

      if (path === '/api/courses' && method === 'GET') return json(res, query('SELECT * FROM courses WHERE published=1 ORDER BY created_at DESC').map(course => courseView(course, auth)));
      let match = /^\/api\/courses\/([^/]+)$/.exec(path);
      if (match && method === 'GET') return json(res, courseView(requireCourse(match[1], auth), auth, true));
      match = /^\/api\/resources\/([^/]+)\/preview$/.exec(path);
      if (match && ['GET', 'HEAD'].includes(method)) {
        const resource = one('SELECT r.*,m.course_id,m.published AS module_published FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?', match[1]);
        if (!resource || resource.kind !== 'html') fail(404, 'Vista previa no encontrada.', 'NOT_FOUND');
        requirePublishedResource(resource, auth);
        let content = resource.content;
        if (!content && resource.file_key) {
          if (!['text/html', 'text/plain'].includes(resource.file_mime)) fail(415, 'La vista previa de capítulos requiere un archivo HTML o texto.');
          const filePath = join(uploadsDir, resource.file_key);
          if (!existsSync(filePath)) fail(404, 'Archivo no encontrado.', 'NOT_FOUND');
          content = readFileSync(filePath, 'utf8');
        }
        if (!content) fail(404, 'Este capítulo aún no tiene contenido HTML.', 'NOT_FOUND');
        // A separate HTTP document avoids inheriting the campus CSP. Sandbox creates
        // an opaque origin even if opened directly; scripts cannot access sessions,
        // the parent DOM, storage, forms, network APIs, popups or top-level navigation.
        res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(content));
        res.writeHead(200);
        return res.end(method === 'HEAD' ? undefined : content);
      }
      match = /^\/api\/resources\/([^/]+)\/file$/.exec(path);
      if (match && ['GET', 'HEAD'].includes(method)) {
        const resource = one('SELECT r.*,m.course_id,m.published AS module_published FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?', match[1]);
        if (!resource?.file_key) fail(404, 'Archivo no encontrado.', 'NOT_FOUND');
        requirePublishedResource(resource, auth);
        const inline = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(resource.file_mime);
        // HTML never executes on the application's authenticated origin.
        return fileResponse(req, res, join(uploadsDir, resource.file_key), resource.file_mime, resource.file_name, !inline || url.searchParams.get('download') === '1', true);
      }
      if (path === '/api/progress' && method === 'GET') {
        requireAuth(auth);
        const rows = query('SELECT p.*,m.course_id,r.published,m.published AS module_published FROM progress p JOIN resources r ON r.id=p.resource_id JOIN modules m ON m.id=r.module_id WHERE p.user_id=?', auth.user.id);
        return json(res, rows.filter(row => (auth.user.role === 'admin' || (row.published && row.module_published)) && canAccess(one('SELECT * FROM courses WHERE id=?', row.course_id), auth)).map(progressView));
      }
      if (path === '/api/learning' && method === 'GET') {
        requireStudent(auth);
        return json(res, learningSummary(auth));
      }
      match = /^\/api\/progress\/([^/]+)\/open$/.exec(path);
      if (match && method === 'POST') {
        requireStudent(auth);
        await readJson(req);
        const currentAuth = requireStudent(readSession(req));
        const row = one('SELECT m.course_id,r.published,m.published AS module_published FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?', match[1]);
        if (!row) fail(404, 'Recurso no encontrado.', 'NOT_FOUND');
        requirePublishedResource(row, currentAuth);
        const at = now();
        run(`INSERT INTO progress(user_id,resource_id,completed,updated_at,opened_at,last_opened_at) VALUES (?,?,0,?,?,?)
          ON CONFLICT(user_id,resource_id) DO UPDATE SET updated_at=excluded.updated_at,
          opened_at=COALESCE(progress.opened_at,progress.last_opened_at,CASE WHEN progress.completed=1 THEN progress.updated_at END,excluded.opened_at),
          last_opened_at=excluded.last_opened_at`, currentAuth.user.id, match[1], at, at, at);
        return json(res, progressView(one('SELECT * FROM progress WHERE user_id=? AND resource_id=?', currentAuth.user.id, match[1])));
      }
      match = /^\/api\/progress\/([^/]+)$/.exec(path);
      if (match && method === 'PUT') {
        requireStudent(auth);
        const body = await readJson(req), completed = boolean(body.completed, 'Completado');
        const currentAuth = requireStudent(readSession(req));
        const row = one('SELECT m.course_id,r.published,m.published AS module_published FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=?', match[1]);
        if (!row) fail(404, 'Recurso no encontrado.', 'NOT_FOUND');
        requirePublishedResource(row, currentAuth);
        const at = now(), opened = completed ? at : null;
        run(`INSERT INTO progress(user_id,resource_id,completed,updated_at,opened_at,last_opened_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(user_id,resource_id) DO UPDATE SET completed=excluded.completed,updated_at=excluded.updated_at,
          opened_at=COALESCE(progress.opened_at,progress.last_opened_at,CASE WHEN progress.completed=1 THEN progress.updated_at END,excluded.opened_at),
          last_opened_at=COALESCE(progress.last_opened_at,progress.opened_at,CASE WHEN progress.completed=1 THEN progress.updated_at END,excluded.last_opened_at)`, currentAuth.user.id, match[1], completed, at, opened, opened);
        return json(res, progressView(one('SELECT * FROM progress WHERE user_id=? AND resource_id=?', currentAuth.user.id, match[1])));
      }

      if (path.startsWith('/api/admin/')) {
        requireAdmin(auth);
        if (path === '/api/admin/migration' && method === 'POST') {
          const bundle = await readJson(req, MIGRATION_MAX_BYTES);
          return json(res, await importMigration({ db, uploadsDir, bundle, validateFile, actorId:auth.user.id }), 201);
        }
        if (path === '/api/admin/settings' && method === 'GET') return json(res, settings());
        if (path === '/api/admin/settings' && method === 'PATCH') {
          const body = await readJson(req), values = {};
          if (own(body, 'name')) values.name = string(body.name, 'el nombre de la plataforma', 80, true);
          if (own(body, 'subtitle')) values.subtitle = string(body.subtitle, 'el subtítulo', 240);
          if (own(body, 'contactEmail')) values.contactEmail = emailAddress(body.contactEmail);
          for (const [key, value] of Object.entries(values)) run('UPDATE settings SET value=? WHERE key=?', value, key);
          audit(auth.user, 'settings.update');
          return json(res, settings());
        }
        if (path === '/api/admin/students' && method === 'GET') return json(res, query("SELECT * FROM users WHERE role='student' ORDER BY name COLLATE NOCASE").map(studentView));
        if (path === '/api/admin/students' && method === 'POST') {
          const body = await readJson(req);
          const student = await addStudent(body);
          audit(auth.user, 'student.create', student.id);
          return json(res, student, 201);
        }
        if (path === '/api/admin/students/bulk' && method === 'POST') {
          const body = await readJson(req);
          if (!Array.isArray(body.students) || !body.students.length || body.students.length > 500) fail(400, 'Envía entre 1 y 500 estudiantes por importación.');
          const created = [], errors = [];
          for (let index = 0; index < body.students.length; index++) {
            try {
              const input = body.students[index];
              if (!input || Array.isArray(input) || typeof input !== 'object') fail(400, 'Fila no válida.');
              created.push(await addStudent(input));
            } catch (error) { if (!(error instanceof ApiError)) throw error; errors.push({ row:index + 1, document:typeof body.students[index]?.document === 'string' ? body.students[index].document : '', error:error.message }); }
          }
          audit(auth.user, 'student.bulk.create', String(created.length));
          return json(res, { created, errors }, 201);
        }
        match = /^\/api\/admin\/students\/([^/]+)\/reset-password$/.exec(path);
        if (match && method === 'POST') {
          await readJson(req);
          const user = existing('users', match[1], 'Estudiante');
          if (user.role !== 'student') fail(403, 'No puedes restablecer administradores desde estudiantes.');
          const hash = await hashPassword(user.document);
          const fresh = existing('users', user.id, 'Estudiante');
          if (fresh.document !== user.document) fail(409, 'La cédula cambió. Repite el restablecimiento.');
          run('UPDATE users SET password_hash=?,must_change_password=1,updated_at=? WHERE id=?', hash, now(), user.id);
          run('DELETE FROM sessions WHERE user_id=?', user.id);
          run('DELETE FROM activations WHERE user_id=?', user.id);
          audit(auth.user, 'student.password.reset', user.id);
          return json(res, { success:true, mustChangePassword:true });
        }
        match = /^\/api\/admin\/students\/([^/]+)\/activation$/.exec(path);
        if (match && method === 'POST') {
          await readJson(req);
          const user = existing('users', match[1], 'Estudiante');
          if (user.role !== 'student' || !user.active) fail(400, 'Solo puedes activar estudiantes habilitados.');
          if (user.must_change_password) fail(400, 'Este estudiante debe ingresar con su cédula como contraseña inicial.');
          run('DELETE FROM sessions WHERE user_id=?', user.id);
          audit(auth.user, 'student.activation.issue', user.id);
          return json(res, activation(user.id));
        }
        match = /^\/api\/admin\/students\/([^/]+)$/.exec(path);
        if (match && ['PATCH', 'DELETE'].includes(method)) {
          const user = existing('users', match[1], 'Estudiante');
          if (user.role !== 'student') fail(403, 'No puedes modificar administradores desde estudiantes.');
          if (method === 'DELETE') {
            run('UPDATE users SET active=0,updated_at=? WHERE id=?', now(), user.id);
            run('DELETE FROM sessions WHERE user_id=?', user.id);
            run('DELETE FROM activations WHERE user_id=?', user.id);
            audit(auth.user, 'student.suspend', user.id);
            return json(res, { success:true });
          }
          const body = await readJson(req);
          const document = own(body, 'document') ? documentNumber(body.document) : user.document;
          const duplicate = one('SELECT id FROM users WHERE document=? AND id<>?', document, user.id);
          if (duplicate) fail(409, 'Ya existe un usuario con esa cédula.', 'DUPLICATE_DOCUMENT');
          const name = own(body, 'name') ? string(body.name, 'el nombre', 160, true) : user.name;
          const email = own(body, 'email') ? emailAddress(body.email) : user.email;
          const active = own(body, 'active') ? boolean(body.active, 'Activo') : user.active;
          if (document !== user.document) {
            const initialHash = await hashPassword(document);
            if (one('SELECT id FROM users WHERE document=? AND id<>?', document, user.id)) fail(409, 'Ya existe un usuario con esa cédula.', 'DUPLICATE_DOCUMENT');
            run('UPDATE users SET document=?,name=?,email=?,active=?,password_hash=CASE WHEN must_change_password=1 THEN ? ELSE password_hash END,updated_at=? WHERE id=?', document, name, email, active, initialHash, now(), user.id);
          } else {
            run('UPDATE users SET document=?,name=?,email=?,active=?,updated_at=? WHERE id=?', document, name, email, active, now(), user.id);
          }
          if (!active || document !== user.document) { run('DELETE FROM sessions WHERE user_id=?', user.id); run('DELETE FROM activations WHERE user_id=?', user.id); }
          audit(auth.user, 'student.update', user.id);
          return json(res, studentView(existing('users', user.id, 'Estudiante')));
        }
        if (path === '/api/admin/courses' && method === 'GET') return json(res, query('SELECT * FROM courses ORDER BY created_at DESC').map(course => courseView(course, auth, true)));
        if (path === '/api/admin/courses' && method === 'POST') {
          const body = await readJson(req), id = randomUUID(), at = now();
          const title = string(body.title, 'el título', 200, true), description = string(body.description, 'la descripción', 10000);
          const accessMode = body.accessMode || 'password';
          if (!['public', 'document', 'password'].includes(accessMode)) fail(400, 'La modalidad de acceso no es válida.');
          const published = own(body, 'published') ? boolean(body.published, 'Publicado') : 0;
          run('INSERT INTO courses(id,title,description,access_mode,published,cover_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', id, title, description, accessMode, published, webUrl(body.coverUrl), at, at);
          audit(auth.user, 'course.create', id);
          return json(res, courseView(existing('courses', id, 'Curso'), auth, true), 201);
        }
        match = /^\/api\/admin\/courses\/([^/]+)\/enrollments\/bulk$/.exec(path);
        if (match && method === 'POST') {
          const body = await readJson(req);
          return json(res, await importCourseEnrollments(req, auth, match[1], body), 201);
        }
        match = /^\/api\/admin\/courses\/([^/]+)$/.exec(path);
        if (match && ['GET', 'PATCH', 'DELETE'].includes(method)) {
          const course = existing('courses', match[1], 'Curso');
          if (method === 'GET') return json(res, courseView(course, auth, true));
          if (method === 'DELETE') {
            const files = query('SELECT r.file_key FROM resources r JOIN modules m ON m.id=r.module_id WHERE m.course_id=?', course.id).concat(academics.courseFiles(course.id));
            files.push(...query('SELECT file_key FROM quick_resources WHERE course_id=?', course.id));
            run('DELETE FROM courses WHERE id=?', course.id);
            deleteFiles(files);
            audit(auth.user, 'course.delete', course.id);
            return json(res, { success:true });
          }
          const body = await readJson(req);
          const title = own(body, 'title') ? string(body.title, 'el título', 200, true) : course.title;
          const description = own(body, 'description') ? string(body.description, 'la descripción', 10000) : course.description;
          const accessMode = own(body, 'accessMode') ? body.accessMode : course.access_mode;
          if (!['public', 'document', 'password'].includes(accessMode)) fail(400, 'La modalidad de acceso no es válida.');
          const published = own(body, 'published') ? boolean(body.published, 'Publicado') : course.published;
          const coverUrl = own(body, 'coverUrl') ? webUrl(body.coverUrl) : course.cover_url;
          run('UPDATE courses SET title=?,description=?,access_mode=?,published=?,cover_url=?,updated_at=? WHERE id=?', title, description, accessMode, published, coverUrl, now(), course.id);
          audit(auth.user, 'course.update', course.id);
          return json(res, courseView(existing('courses', course.id, 'Curso'), auth, true));
        }
        if (path === '/api/admin/enrollments' && method === 'GET') return json(res, query('SELECT e.*,u.name AS student_name,u.document AS student_document,c.title AS course_title FROM enrollments e JOIN users u ON u.id=e.student_id JOIN courses c ON c.id=e.course_id ORDER BY e.created_at DESC').map(row => ({ id:row.id, studentId:row.student_id, courseId:row.course_id, studentName:row.student_name, studentDocument:row.student_document, courseTitle:row.course_title, status:row.status, startsAt:row.starts_at, expiresAt:row.expires_at, createdAt:row.created_at, active:isEnrolled(row.student_id, row.course_id) })));
        if (path === '/api/admin/enrollments' && method === 'POST') {
          const body = await readJson(req);
          const student = existing('users', string(body.studentId, 'el estudiante', 100, true), 'Estudiante');
          if (student.role !== 'student' || !student.active) fail(400, 'Selecciona un estudiante habilitado.');
          const course = existing('courses', string(body.courseId, 'el curso', 100, true), 'Curso');
          const startsAt = timestamp(body.startsAt, 'La fecha inicial'), expiresAt = timestamp(body.expiresAt, 'La fecha final');
          validDates(startsAt, expiresAt);
          if (one('SELECT id FROM enrollments WHERE student_id=? AND course_id=?', student.id, course.id)) fail(409, 'Este estudiante ya tiene una matrícula en el curso. Edita o reactiva la existente.', 'DUPLICATE_ENROLLMENT');
          const id = randomUUID(), createdAt = now();
          run('INSERT INTO enrollments(id,student_id,course_id,status,starts_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)', id, student.id, course.id, 'active', startsAt, expiresAt, createdAt);
          audit(auth.user, 'enrollment.create', id);
          return json(res, { id, studentId:student.id, courseId:course.id, status:'active', startsAt, expiresAt, createdAt }, 201);
        }
        match = /^\/api\/admin\/enrollments\/([^/]+)$/.exec(path);
        if (match && ['PATCH', 'DELETE'].includes(method)) {
          const row = existing('enrollments', match[1], 'Matrícula');
          const body = method === 'PATCH' ? await readJson(req) : { status:'revoked' };
          const status = own(body, 'status') ? body.status : row.status;
          if (!['active', 'revoked'].includes(status)) fail(400, 'El estado no es válido.');
          const startsAt = own(body, 'startsAt') ? timestamp(body.startsAt, 'La fecha inicial') : row.starts_at;
          const expiresAt = own(body, 'expiresAt') ? timestamp(body.expiresAt, 'La fecha final') : row.expires_at;
          validDates(startsAt, expiresAt);
          run('UPDATE enrollments SET status=?,starts_at=?,expires_at=? WHERE id=?', status, startsAt, expiresAt, row.id);
          audit(auth.user, 'enrollment.update', row.id);
          return json(res, { id:row.id, studentId:row.student_id, courseId:row.course_id, status, startsAt, expiresAt, createdAt:row.created_at });
        }
        match = /^\/api\/admin\/courses\/([^/]+)\/modules$/.exec(path);
        if (match && method === 'POST') {
          const course = existing('courses', match[1], 'Curso'), body = await readJson(req), id = randomUUID();
          const title = string(body.title, 'el título del capítulo', 200, true);
          const order = own(body, 'position') ? position(body.position) : one('SELECT COALESCE(MAX(position),-1)+1 AS next FROM modules WHERE course_id=?', course.id).next;
          const published = own(body, 'published') ? boolean(body.published, 'Publicado') : 0;
          run('INSERT INTO modules(id,course_id,title,position,published) VALUES (?,?,?,?,?)', id, course.id, title, order, published);
          audit(auth.user, 'module.create', id);
          return json(res, { id, courseId:course.id, title, position:order, published:Boolean(published), resources:[] }, 201);
        }
        match = /^\/api\/admin\/modules\/([^/]+)$/.exec(path);
        if (match && ['PATCH', 'DELETE'].includes(method)) {
          const module = existing('modules', match[1], 'Capítulo');
          if (method === 'DELETE') {
            const files = query('SELECT file_key FROM resources WHERE module_id=?', module.id);
            run('DELETE FROM modules WHERE id=?', module.id);
            deleteFiles(files);
            audit(auth.user, 'module.delete', module.id);
            return json(res, { success:true });
          }
          const body = await readJson(req);
          const title = own(body, 'title') ? string(body.title, 'el título del capítulo', 200, true) : module.title;
          const order = own(body, 'position') ? position(body.position) : module.position;
          const published = own(body, 'published') ? boolean(body.published, 'Publicado') : module.published;
          run('UPDATE modules SET title=?,position=?,published=? WHERE id=?', title, order, published, module.id);
          audit(auth.user, 'module.update', module.id);
          return json(res, { id:module.id, courseId:module.course_id, title, position:order, published:Boolean(published), resources:query('SELECT * FROM resources WHERE module_id=? ORDER BY position,id', module.id).map(resourceView) });
        }
        match = /^\/api\/admin\/modules\/([^/]+)\/resources$/.exec(path);
        if (match && method === 'POST') {
          const module = existing('modules', match[1], 'Capítulo');
          const body = await readJson(req, 29 * 1024 * 1024), id = randomUUID(), at = now();
          const title = string(body.title, 'el título del recurso', 200, true), kind = body.kind;
          if (!RESOURCE_KINDS.has(kind)) fail(400, 'El tipo de recurso no es válido.');
          const resourceUrl = webUrl(body.url), content = string(body.content, 'el contenido', 1000000);
          const order = own(body, 'position') ? position(body.position) : one('SELECT COALESCE(MAX(position),-1)+1 AS next FROM resources WHERE module_id=?', module.id).next;
          const published = own(body, 'published') ? boolean(body.published, 'Publicado') : 0;
          const file = body.file ? validateFile(body.file) : null;
          if (!resourceUrl && !content && !file) fail(400, 'Agrega un archivo, un enlace o contenido al recurso.');
          if (file) writeFileSync(join(uploadsDir, file.key), file.buffer, { flag:'wx', mode:0o600 });
          try { run('INSERT INTO resources(id,module_id,title,kind,url,content,position,file_key,file_name,file_mime,file_size,created_at,updated_at,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, module.id, title, kind, resourceUrl, content, order, file?.key || null, file?.name || null, file?.mime || null, file?.size || null, at, at, published); }
          catch (error) { if (file) deleteFiles([{ file_key:file.key }]); throw error; }
          audit(auth.user, 'resource.create', id);
          return json(res, resourceView(existing('resources', id, 'Recurso')), 201);
        }
        match = /^\/api\/admin\/resources\/([^/]+)$/.exec(path);
        if (match && ['PATCH', 'DELETE'].includes(method)) {
          const resource = existing('resources', match[1], 'Recurso');
          if (method === 'DELETE') {
            run('DELETE FROM resources WHERE id=?', resource.id);
            deleteFiles([resource]);
            audit(auth.user, 'resource.delete', resource.id);
            return json(res, { success:true });
          }
          const body = await readJson(req, 29 * 1024 * 1024);
          const title = own(body, 'title') ? string(body.title, 'el título del recurso', 200, true) : resource.title;
          const kind = own(body, 'kind') ? body.kind : resource.kind;
          if (!RESOURCE_KINDS.has(kind)) fail(400, 'El tipo de recurso no es válido.');
          const resourceUrl = own(body, 'url') ? webUrl(body.url) : resource.url;
          const content = own(body, 'content') ? string(body.content, 'el contenido', 1000000) : resource.content;
          const order = own(body, 'position') ? position(body.position) : resource.position;
          const file = own(body, 'file') && body.file !== null ? validateFile(body.file) : null;
          const published = own(body, 'published') ? boolean(body.published, 'Publicado') : resource.published;
          const replaceFile = own(body, 'file');
          const fileKey = replaceFile ? file?.key || null : resource.file_key;
          if (!resourceUrl && !content && !fileKey) fail(400, 'Agrega un archivo, un enlace o contenido al recurso.');
          if (file) writeFileSync(join(uploadsDir, file.key), file.buffer, { flag:'wx', mode:0o600 });
          try { run('UPDATE resources SET title=?,kind=?,url=?,content=?,position=?,file_key=?,file_name=?,file_mime=?,file_size=?,updated_at=?,published=? WHERE id=?', title, kind, resourceUrl, content, order, fileKey, replaceFile ? file?.name || null : resource.file_name, replaceFile ? file?.mime || null : resource.file_mime, replaceFile ? file?.size || null : resource.file_size, now(), published, resource.id); }
          catch (error) { if (file) deleteFiles([{ file_key:file.key }]); throw error; }
          if (replaceFile) deleteFiles([resource]);
          audit(auth.user, 'resource.update', resource.id);
          return json(res, resourceView(existing('resources', resource.id, 'Recurso')));
        }
        if (path === '/api/admin/audit' && method === 'GET') return json(res, query('SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100').map(row => ({ id:row.id, actorName:row.actor_name, action:row.action, targetId:row.target_id, createdAt:row.created_at })));
      }
      if (path.startsWith('/api/')) fail(404, 'Ruta no encontrada.', 'NOT_FOUND');
      if (!['GET', 'HEAD'].includes(method)) fail(405, 'Método no permitido.');
      if (path.startsWith('/pdfjs/')) {
        const relative=path.slice('/pdfjs/'.length);
        if (!/^(?:legacy\/build\/(?:pdf|pdf\.worker)\.mjs|(?:cmaps|standard_fonts|wasm)\/[A-Za-z0-9_-]+\.(?:bcmap|pfb|ttf|wasm))$/.test(relative)) fail(404, 'Archivo no encontrado.');
        return fileResponse(req,res,join(ROOT,'node_modules','pdfjs-dist',relative),relative.endsWith('.mjs')?'text/javascript; charset=utf-8':relative.endsWith('.wasm')?'application/wasm':'application/octet-stream',basename(relative));
      }
      if (path === '/pdf-viewer.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
      if (path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) fail(404, 'Página no encontrada.', 'NOT_FOUND');
      let filePath = resolve(publicDir, '.' + path.replace(/\\/g, '/'));
      if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) fail(404, 'Página no encontrada.', 'NOT_FOUND');
      if (filePath === publicDir || (existsSync(filePath) && statSync(filePath).isDirectory())) filePath = join(filePath, 'index.html');
      if (!existsSync(filePath)) {
        if (extname(path)) fail(404, 'Archivo no encontrado.', 'NOT_FOUND');
        filePath = join(publicDir, 'index.html');
      }
      const mime = STATIC_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
      return fileResponse(req, res, filePath, mime, basename(filePath));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const status = error instanceof ApiError || error instanceof MigrationError ? error.status : error instanceof URIError ? 400 : 500;
      if (status === 500) console.error('Error interno:', error.message);
      res.removeHeader('Content-Length');
      res.removeHeader('Content-Disposition');
      res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error:status === 500 ? 'No se pudo completar la solicitud.' : error.message, code:error.code || (status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST') }));
    }
  };
  const server = http.createServer({ maxHeaderSize:16384 }, handler);
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.on('close', () => db.close());
  return { server, db, dataDir };
}

export async function start(options = {}) {
  const app = await createApp(options);
  const env = options.env || process.env;
  const port = Number(env.PORT || 3000), host = env.HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  await new Promise((resolvePromise, reject) => { app.server.once('error', reject); app.server.listen(port, host, resolvePromise); });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().then(app => {
    console.log(`Aula Abierta: http://${process.env.HOST || 'localhost'}:${app.server.address().port}`);
    if (!app.db.prepare("SELECT id FROM users WHERE role='admin'").get()) console.log('Configuración pendiente: establece ADMIN_DOCUMENT y ADMIN_PASSWORD y reinicia.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
