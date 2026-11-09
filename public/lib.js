export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export {videoEmbed} from './video-embed.js';
export function parseStudentsCsv(text, { allowDuplicates = false } = {}) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/)[0].includes(';') ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('Hay comillas sin cerrar en el archivo CSV.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  const header = rows.shift()?.map(x => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) || [];
  if (!header.includes('cedula') || !header.includes('nombre')) throw new Error('El CSV debe tener las columnas cedula,nombre,correo.');
  const seen = new Set();
  return rows.map((r, i) => {
    const document = r[header.indexOf('cedula')] || '', name = r[header.indexOf('nombre')] || '', email = r[header.indexOf('correo')] || '';
    if (!/^\d{4,20}$/.test(document) || !name) throw new Error(`Revisa la cédula y el nombre de la fila ${i + 2}. Conserva la cédula como texto.`);
    if (!allowDuplicates && seen.has(document)) throw new Error(`La cédula de la fila ${i + 2} está repetida.`);
    seen.add(document); return {document,name,email};
  });
}

