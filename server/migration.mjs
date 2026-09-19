import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashPassword } from './security.mjs';

export const MIGRATION_MAX_BYTES = 64 * 1024 * 1024;
export class MigrationError extends Error {
  constructor(message, status = 400, code = 'INVALID_MIGRATION') {
    super(message); this.status = status; this.code = code;
  }
}
const invalid = message => { throw new MigrationError(message); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['pdf', 'slides', 'video', 'book', 'image', 'exercise', 'html', 'link']);
const HASH = /^scrypt\$32768\$[0-9a-f]{32}\$[0-9a-f]{128}$/;
const LIMITS = { students:5000, courses:1000, enrollments:50000, modules:10000, resources:20000, progress:100000, files:2000 };

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('El paquete contiene una fila no válida.');
  return value;
}
function id(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('El paquete contiene un identificador no válido.');
  return value.toLowerCase();
}
function text(value, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\0')) invalid('El paquete contiene un campo de texto no válido.');
  return value;
}
function bool(value) { if (typeof value !== 'boolean') invalid('El paquete contiene un estado no válido.'); return value; }
function date(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid('Las fechas del paquete deben estar en formato ISO UTC.');
  return value;
}
function order(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000000) invalid('El paquete contiene un orden no válido.');
  return value;
}
function url(value) {
  const result = text(value, 2048);
  if (!result) return '';
  let parsed;
  try { parsed = new URL(result); } catch { invalid('El paquete contiene un enlace no válido.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid('El paquete contiene un enlace no permitido.');
  return parsed.href;
}
function unique(rows, label) {
  const result = new Map();
  for (const row of rows) {
    if (result.has(row.id)) invalid(`El paquete contiene identificadores repetidos de ${label}.`);
    result.set(row.id, row);
  }
  return result;
}

// Build new allowlisted objects. Extra fields never become SQL columns or roles.
export function validateMigrationBundle(bundle, validateFile) {
  record(bundle);
  if (bundle.format !== 'aula-abierta-migration' || bundle.version !== 1) invalid('El archivo no es una exportación compatible de Aula Abierta.');
  date(bundle.exportedAt);
  for (const [key, maximum] of Object.entries(LIMITS)) {
    if (!Array.isArray(bundle[key]) || bundle[key].length > maximum) invalid('Las listas del paquete están incompletas o exceden el límite.');
    bundle[key].forEach(record);
  }
  if (!bundle.students.length && !bundle.courses.length) invalid('El paquete está vacío.');
  const students = bundle.students.map(row => {
    const document = text(row.document, 20, true);
    if (!/^\d{4,20}$/.test(document)) invalid('El paquete contiene una cédula no válida.');
    const email = text(row.email, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('El paquete contiene un correo no válido.');
    if (row.passwordHash !== null && (typeof row.passwordHash !== 'string' || !HASH.test(row.passwordHash))) invalid('El paquete contiene un hash de contraseña no compatible.');
    const mustChangePassword = row.mustChangePassword === undefined ? row.passwordHash === null : bool(row.mustChangePassword) || row.passwordHash === null;
    return { id:id(row.id), document, name:text(row.name, 160, true), email, active:bool(row.active), passwordHash:row.passwordHash, mustChangePassword, createdAt:date(row.createdAt), updatedAt:date(row.updatedAt) };
  });
  if (new Set(students.map(row => row.document)).size !== students.length) invalid('El paquete contiene cédulas repetidas.');
  const courses = bundle.courses.map(row => {
    if (!['public', 'document', 'password'].includes(row.accessMode)) invalid('El paquete contiene una modalidad de curso no válida.');
    return { id:id(row.id), title:text(row.title, 200, true), description:text(row.description, 10000), accessMode:row.accessMode, published:bool(row.published), coverUrl:url(row.coverUrl), createdAt:date(row.createdAt), updatedAt:date(row.updatedAt) };
  });
  const modules = bundle.modules.map(row => ({ id:id(row.id), courseId:id(row.courseId), title:text(row.title, 200, true), position:order(row.position) }));
  const resources = bundle.resources.map(row => {
    if (!KINDS.has(row.kind)) invalid('El paquete contiene un tipo de recurso no válido.');
    const result = { id:id(row.id), moduleId:id(row.moduleId), title:text(row.title, 200, true), kind:row.kind, url:url(row.url), content:text(row.content, 1000000), position:order(row.position), fileId:row.fileId === null ? null : id(row.fileId), createdAt:date(row.createdAt), updatedAt:date(row.updatedAt) };
    if (!result.url && !result.content && !result.fileId) invalid('El paquete contiene un recurso sin contenido.');
    return result;
  });
  const enrollments = bundle.enrollments.map(row => {
    if (!['active', 'revoked'].includes(row.status)) invalid('El paquete contiene una matrícula con estado no válido.');
    const result = { id:id(row.id), studentId:id(row.studentId), courseId:id(row.courseId), status:row.status, startsAt:date(row.startsAt, true), expiresAt:date(row.expiresAt, true), createdAt:date(row.createdAt) };
    if (result.startsAt && result.expiresAt && result.startsAt >= result.expiresAt) invalid('El paquete contiene fechas de matrícula incompatibles.');
    return result;
  });
  const progress = bundle.progress.map(row => ({ studentId:id(row.studentId), resourceId:id(row.resourceId), completed:bool(row.completed), updatedAt:date(row.updatedAt) }));
  const studentsById = unique(students, 'estudiantes'), coursesById = unique(courses, 'cursos');
  const modulesById = unique(modules, 'capítulos'), resourcesById = unique(resources, 'recursos');
  unique(enrollments, 'matrículas');
  for (const row of modules) if (!coursesById.has(row.courseId)) invalid('Un capítulo hace referencia a un curso que falta.');
  for (const row of resources) if (!modulesById.has(row.moduleId)) invalid('Un recurso hace referencia a un capítulo que falta.');
  const enrollmentPairs = new Set();
  for (const row of enrollments) {
    if (!studentsById.has(row.studentId) || !coursesById.has(row.courseId)) invalid('Una matrícula hace referencia a un estudiante o curso que falta.');
    const pair = `${row.studentId}:${row.courseId}`;
    if (enrollmentPairs.has(pair)) invalid('El paquete contiene matrículas repetidas.');
    enrollmentPairs.add(pair);
  }
  const progressPairs = new Set();
  for (const row of progress) {
    if (!studentsById.has(row.studentId) || !resourcesById.has(row.resourceId)) invalid('Un avance hace referencia a un estudiante o recurso que falta.');
    const pair = `${row.studentId}:${row.resourceId}`;
    if (progressPairs.has(pair)) invalid('El paquete contiene registros de avance repetidos.');
    progressPairs.add(pair);
  }
  // Validate all metadata and references before allocating uploaded file buffers.
  const fileRows = bundle.files.map(row => ({ id:id(row.id), name:row.name, mime:row.mime, base64:row.base64 }));
  const fileRowsById = unique(fileRows, 'archivos'), fileReferences = new Set();
  for (const row of resources) {
    if (!row.fileId) continue;
    if (!fileRowsById.has(row.fileId)) invalid('Un recurso hace referencia a un archivo que falta.');
    if (fileReferences.has(row.fileId)) invalid('Cada archivo debe pertenecer a un solo recurso.');
    fileReferences.add(row.fileId);
  }
  if (fileReferences.size !== fileRows.length) invalid('El paquete contiene archivos sin un recurso asociado.');
  const files = fileRows.map(row => {
    const validated = validateFile(row);
    if (row.mime !== validated.mime) invalid('El tipo de un archivo no coincide con su formato.');
    return { id:row.id, ...validated };
  });
  return { students, courses, enrollments, modules, resources, progress, files };
}

function requireEmpty(db) {
  const tables = ['courses', 'modules', 'resources', 'enrollments', 'progress'];
  const used = db.prepare("SELECT 1 FROM audit WHERE action='migration.import.complete' LIMIT 1").get();
  const students = db.prepare("SELECT 1 FROM users WHERE role='student' LIMIT 1").get();
  if (used || students || tables.some(table => db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) {
    throw new MigrationError('La importación inicial requiere una plataforma sin cursos ni estudiantes y solo se puede ejecutar una vez.', 409, 'MIGRATION_NOT_EMPTY');
  }
}

export async function importMigration({ db, uploadsDir, bundle, validateFile, actorId }) {
  requireEmpty(db);
  const data = validateMigrationBundle(bundle, validateFile);
  for (const student of data.students) {
    if (db.prepare('SELECT 1 FROM users WHERE id=? OR document=?').get(student.id, student.document)) {
      throw new MigrationError('Un estudiante del paquete coincide con una cuenta existente en el destino.', 409, 'MIGRATION_CONFLICT');
    }
  }
  // Legacy null passwords and explicit pending accounts both use the same initial
  // password flow. Personal hashes from older v1 bundles are preserved unchanged.
  for (const student of data.students) if (student.mustChangePassword) student.passwordHash = await hashPassword(student.document);
  const filesById = new Map(data.files.map(file => [file.id, file]));
  const stageDir = join(uploadsDir, `.migration-${randomUUID()}`);
  const staged = [], moved = [];
  let transaction = false;
  mkdirSync(stageDir, { mode:0o700 });
  try {
    for (const file of data.files) {
      staged.push(file.key);
      writeFileSync(join(stageDir, file.key), file.buffer, { flag:'wx', mode:0o600 });
    }
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    requireEmpty(db);
    const studentInsert = db.prepare("INSERT INTO users(id,document,name,email,role,password_hash,must_change_password,active,created_at,updated_at) VALUES (?,?,?,?,'student',?,?,?,?,?)");
    for (const row of data.students) studentInsert.run(row.id, row.document, row.name, row.email, row.passwordHash, row.mustChangePassword ? 1 : 0, row.active ? 1 : 0, row.createdAt, row.updatedAt);
    const courseInsert = db.prepare('INSERT INTO courses(id,title,description,access_mode,published,cover_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
    for (const row of data.courses) courseInsert.run(row.id, row.title, row.description, row.accessMode, row.published ? 1 : 0, row.coverUrl, row.createdAt, row.updatedAt);
    const moduleInsert = db.prepare('INSERT INTO modules(id,course_id,title,position) VALUES (?,?,?,?)');
    for (const row of data.modules) moduleInsert.run(row.id, row.courseId, row.title, row.position);
    const resourceInsert = db.prepare('INSERT INTO resources(id,module_id,title,kind,url,content,position,file_key,file_name,file_mime,file_size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const row of data.resources) {
      const file = row.fileId ? filesById.get(row.fileId) : null;
      resourceInsert.run(row.id, row.moduleId, row.title, row.kind, row.url, row.content, row.position, file?.key || null, file?.name || null, file?.mime || null, file?.size || null, row.createdAt, row.updatedAt);
    }
    const enrollmentInsert = db.prepare('INSERT INTO enrollments(id,student_id,course_id,status,starts_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)');
    for (const row of data.enrollments) enrollmentInsert.run(row.id, row.studentId, row.courseId, row.status, row.startsAt, row.expiresAt, row.createdAt);
    const progressInsert = db.prepare('INSERT INTO progress(user_id,resource_id,completed,updated_at) VALUES (?,?,?,?)');
    for (const row of data.progress) progressInsert.run(row.studentId, row.resourceId, row.completed ? 1 : 0, row.updatedAt);
    for (const file of data.files) {
      renameSync(join(stageDir, file.key), join(uploadsDir, file.key));
      moved.push(file.key);
    }
    const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
    db.prepare('INSERT INTO audit(actor_id,action,target_id,created_at) VALUES (?,?,?,?)').run(actorId, 'migration.import.complete', JSON.stringify(counts), new Date().toISOString());
    db.exec('COMMIT');
    transaction = false;
    return { imported:counts };
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    for (const key of moved) { try { unlinkSync(join(uploadsDir, key)); } catch { /* Preserve the original failure. */ } }
    throw error;
  } finally {
    // Only the generated filenames are removed; no user-supplied filesystem paths.
    for (const key of staged) { try { unlinkSync(join(stageDir, key)); } catch { /* Already moved or absent. */ } }
    try { rmdirSync(stageDir); } catch { /* An interrupted disk write can leave a private staging directory. */ }
  }
}

