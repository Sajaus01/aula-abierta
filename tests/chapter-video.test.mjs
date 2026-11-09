import test from 'node:test';
import assert from 'node:assert/strict';
import {chapterPlayerUrl} from '../public/chapter-video.js';

test('los reproductores de un capítulo conservan el fragmento y admiten un proveedor HTTPS externo', () => {
  const campus = 'https://campus.example';
  const clip = chapterPlayerUrl('https://www.youtube-nocookie.com/embed/Y0-P5gndOq8?autoplay=1&start=50&end=230', campus);
  assert.equal(new URL(clip).pathname, '/embed/Y0-P5gndOq8');
  assert.deepEqual(Object.fromEntries(new URL(clip).searchParams), {autoplay: '1', start: '50', end: '230'});
  const external = 'https://media.example/player/abc?start=30';
  assert.equal(chapterPlayerUrl(external, campus), external);
});

test('un mensaje de capítulo no puede incrustar URLs del campus, credenciales ni esquemas ejecutables', () => {
  const campus = 'https://campus.example';
  for (const value of [campus + '/api/admin/students', 'https://user:pw@media.example/video',
    'data:text/html,<script>alert(1)</script>', 'javascript:alert(1)', 'blob:https://media.example/id',
    'http://media.example/player', '/archivo', {}, null]) {
    assert.equal(chapterPlayerUrl(value, campus), null);
  }
});
