import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, bootstrapAdmin } from './database.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(process.env.DATA_DIR || join(root, 'data'));
try {
  if (db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    console.log('Ya existe un administrador. El proceso de instalación no cambia su contraseña.');
  } else if (await bootstrapAdmin(db)) {
    console.log('Administrador creado. Retira ADMIN_PASSWORD del entorno después de la instalación.');
  } else {
    console.error('Define ADMIN_DOCUMENT, ADMIN_PASSWORD (mínimo 12 caracteres) y opcionalmente ADMIN_NAME antes de ejecutar este comando.');
    process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db.close(); }
