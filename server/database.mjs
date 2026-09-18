import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword, passwordError } from './security.mjs';

export function openDatabase(dataDir) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, 'uploads'), { recursive: true, mode: 0o700 });
  const file = join(directory, 'aula.sqlite');
  const db = new DatabaseSync(file);
  try { chmodSync(file, 0o600); } catch { /* Windows may not implement POSIX modes. */ }
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, document TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('admin','student')),
      password_hash TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assurance TEXT NOT NULL CHECK(assurance IN ('document','password')),
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS activations (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      access_mode TEXT NOT NULL DEFAULT 'password' CHECK(access_mode IN ('public','document','password')),
      published INTEGER NOT NULL DEFAULT 0, cover_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
      starts_at TEXT, expires_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(student_id,course_id)
    );
    CREATE INDEX IF NOT EXISTS enrollments_student ON enrollments(student_id);
    CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL, position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      title TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '', position REAL NOT NULL DEFAULT 0,
      file_key TEXT, file_name TEXT, file_mime TEXT, file_size INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,resource_id)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL,
      target_id TEXT, created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  insert.run('name', 'Aula Abierta');
  insert.run('subtitle', 'Un lugar para aprender, a tu ritmo.');
  insert.run('contactEmail', '');
  return db;
}

export async function bootstrapAdmin(db, env = process.env) {
  if (db.prepare("SELECT id FROM users WHERE role='admin'").get()) return false;
  const document = env.ADMIN_DOCUMENT?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!document && !password) return false;
  if (!/^\d{4,20}$/.test(document || '')) throw new Error('ADMIN_DOCUMENT debe contener de 4 a 20 dígitos.');
  const error = passwordError(password);
  if (error) throw new Error(`ADMIN_PASSWORD: ${error}`);
  const name = (env.ADMIN_NAME || 'Administración').trim();
  if (!name || name.length > 160) throw new Error('ADMIN_NAME debe tener entre 1 y 160 caracteres.');
  const now = new Date().toISOString();
  const hash = await hashPassword(password);
  db.prepare('INSERT INTO users(id,document,name,email,role,password_hash,active,created_at,updated_at) VALUES (?,?,?, ?,?,?,1,?,?)')
    .run(randomUUID(), document, name, '', 'admin', hash, now, now);
  return true;
}

