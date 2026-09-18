import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeUrl, videoEmbed, parseStudentsCsv } from '../public/lib.js';

test('importar CSV conserva cédulas de texto, comillas, comas y correos', () => {
  const rows = parseStudentsCsv('\uFEFFcédula,nombre,correo\r\n00001234,"Pérez, Ana",ana@example.test\r\n1234,"Luis ""Pepe"" López",\r\n');
  assert.deepEqual(rows, [
    { document: '00001234', name: 'Pérez, Ana', email: 'ana@example.test' },
    { document: '1234', name: 'Luis "Pepe" López', email: '' }
  ]);
});

test('importar CSV admite punto y coma, orden de columnas e ignora filas vacías', () => {
  const rows = parseStudentsCsv('correo;NOMBRE;CEDULA\r\nuno@example.test;Estudiante Uno;00004444\r\n\r\n;Estudiante Dos;12345678901234567890\r\n');
  assert.deepEqual(rows, [
    { document: '00004444', name: 'Estudiante Uno', email: 'uno@example.test' },
    { document: '12345678901234567890', name: 'Estudiante Dos', email: '' }
  ]);
});

test('la importación avisa duplicados y errores de formato antes de enviar datos', () => {
  assert.throws(() => parseStudentsCsv('cedula,nombre\n1234,Ana\n1234,Luis'), /repetida/i);
  assert.throws(() => parseStudentsCsv('nombre,correo\nAna,ana@example.test'), /columnas/i);
  assert.throws(() => parseStudentsCsv('cedula,correo\n1234,ana@example.test'), /columnas/i);
  assert.throws(() => parseStudentsCsv('cedula,nombre\n1234,"Nombre sin cierre'), /comillas/i);
  assert.throws(() => parseStudentsCsv('cedula,nombre\n1e10,Ana'), /fila 2/i);
  assert.throws(() => parseStudentsCsv('cedula,nombre\n123,Ana'), /fila 2/i);
  assert.throws(() => parseStudentsCsv('cedula,nombre\n1234,'), /fila 2/i);
  assert.deepEqual(parseStudentsCsv('cedula,nombre,correo\n'), []);
});

test('los videos conocidos se convierten a reproductores de proveedores permitidos', () => {
  const youtube = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
  assert.equal(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30'), youtube);
  assert.equal(videoEmbed('https://youtu.be/dQw4w9WgXcQ'), youtube);
  assert.equal(videoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ'), youtube);
  assert.equal(videoEmbed('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), youtube);
  assert.equal(videoEmbed('https://vimeo.com/123456789'), 'https://player.vimeo.com/video/123456789');
});

test('los reproductores rechazan sitios falsos y enlaces con protocolos ejecutables', () => {
  for (const value of [
    'javascript:alert(1)',
    'javascript://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'data:text/html,<script>alert(1)</script>',
    'https://www.youtube.com.attacker.test/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com@attacker.test/watch?v=dQw4w9WgXcQ',
    'https://vimeo.com/123<script>',
    'https://youtu.be/no-valido',
    'no es una URL'
  ]) assert.equal(videoEmbed(value), null, value);
});

test('los enlaces generales rechazan código ejecutable y rutas relativas', () => {
  assert.equal(safeUrl('https://example.test/material?q=uno'), 'https://example.test/material?q=uno');
  assert.equal(safeUrl('http://example.test'), 'http://example.test/');
  for (const value of ['javascript:alert(1)', 'data:text/html,<b>texto</b>', '/ruta-local', '//example.test', '']) assert.equal(safeUrl(value), '');
});

test('el texto de ejercicios se escapa para impedir que se convierta en HTML ejecutable', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)"> & \'texto\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;texto&#39;');
  assert.equal(escapeHtml('<script>document.cookie</script>'), '&lt;script&gt;document.cookie&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

