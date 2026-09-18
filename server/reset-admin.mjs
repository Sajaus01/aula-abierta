import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.mjs';
import { hashPassword, passwordError } from './security.mjs';

// Operator-only recovery: never exposed as a browser/API endpoint.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(process.env.DATA_DIR || join(root, 'data'));
try {
  const document = process.env.ADMIN_DOCUMENT?.trim();
  if (!/^\d{4,20}$/.test(document || '')) throw new Error('Define ADMIN_DOCUMENT con la cédula del administrador.');
  const error = passwordError(process.env.ADMIN_PASSWORD);
  if (error) throw new Error(`ADMIN_PASSWORD: ${error}`);
  const user = db.prepare("SELECT id FROM users WHERE document=? AND role='admin'").get(document);
  if (!user) throw new Error('No se encontró un administrador con esa cédula.');
  const hash = await hashPassword(process.env.ADMIN_PASSWORD);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash=?,active=1,updated_at=? WHERE id=?').run(hash, new Date().toISOString(), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    db.prepare('DELETE FROM activations WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO audit(actor_id,action,target_id,created_at) VALUES (?,?,?,?)').run(user.id, 'admin.password.recover.cli', user.id, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  console.log('Contraseña del administrador restablecida. Sus sesiones anteriores se cerraron. Retira ADMIN_PASSWORD del entorno.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db.close(); }

