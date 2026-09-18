import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(String(value)).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  // A real derivation on unknown accounts reduces account enumeration by timing.
  const [, cost, salt, hash] = (encoded || 'scrypt$32768$00000000000000000000000000000000$' + '0'.repeat(128)).split('$');
  if (!salt || !hash) return false;
  const candidate = await scrypt(password, salt, 64, { N: Number(cost), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'hex');
  return Boolean(encoded) && expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function passwordError(value) {
  return typeof value !== 'string' || value.length < 12 || value.length > 256
    ? 'La contraseña debe tener entre 12 y 256 caracteres.' : null;
}

export class RateLimiter {
  constructor() { this.entries = new Map(); }
  allow(key, maximum, duration) {
    const now = Date.now();
    let item = this.entries.get(key);
    if (!item || item.until <= now) {
      if (this.entries.size >= 20000 && !item) {
        for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
        if (this.entries.size >= 20000) return false;
      }
      item = { count: 0, until: now + duration };
      this.entries.set(key, item);
    }
    item.count += 1;
    if (this.entries.size > 10000) {
      for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
    }
    return item.count <= maximum;
  }
}

