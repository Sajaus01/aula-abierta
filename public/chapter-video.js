import {escapeHtml} from './lib.js';
import {videoPlayer} from './activity-media.js';
import {originalVideoUrl, videoEmbed} from './video-embed.js';

// postMessage payloads from a chapter are untrusted, even when its author is a teacher.
export function chapterPlayerUrl(value, campusOrigin) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  let source;
  try { source = new URL(value); } catch { return null; }
  if (source.username || source.password || source.origin === campusOrigin) return null;
  return videoEmbed(value) || (source.protocol === 'https:' ? source.href : null);
}

// The original player slot is expressed in fractions of the chapter viewport.
// Anchor the player only when both its controls and the frame fit fully inside it.
function positionInChapter(dialog, frame, slot) {
  if (!Array.isArray(slot) || slot.length !== 4 || !slot.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return;
  const chapter = frame.getBoundingClientRect();
  const [x1, y1, x2, y2] = slot;
  const width = (x2 - x1) * chapter.width;
  const height = (y2 - y1) * chapter.height;
  const left = chapter.left + x1 * chapter.width;
  const toolbar = dialog.querySelector('header').offsetHeight;
  const top = chapter.top + y1 * chapter.height - toolbar;
  if (width < 320 || height < 200 || left < 0 || top < Math.max(0, chapter.top) || left + width > innerWidth || top + toolbar + height > innerHeight) return;
  dialog.classList.add('at-video-slot');
  dialog.style.left = left + 'px';
  dialog.style.top = top + 'px';
  dialog.style.width = width + 'px';
  dialog.style.setProperty('--chapter-video-height', height + 'px');
}

export function bindChapterVideos(modal) {
  window.addEventListener('message', event => {
    if (event.origin !== 'null' || event.data?.type !== 'aula:chapter-video' || !modal.open) return;
    const frame = [...modal.querySelectorAll('iframe[data-chapter-preview]')].find(item => item.contentWindow === event.source);
    if (!frame || !frame.getClientRects().length || (navigator.userActivation && !navigator.userActivation.isActive)) return;
    const url = chapterPlayerUrl(event.data.href, location.origin);
    if (!url || modal.querySelector('.chapter-video-dialog')) return;
    const title = typeof event.data.title === 'string' && event.data.title.trim() ? event.data.title.trim().slice(0, 240) : 'Video';
    const dialog = document.createElement('dialog');
    dialog.className = 'chapter-video-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<header><button type="button" class="btn secondary" autofocus>Volver al capítulo</button><a class="btn secondary" target="_blank" rel="noopener noreferrer" href="${escapeHtml(originalVideoUrl(event.data.href))}">Abrir original ↗</a></header>${videoPlayer(url, title)}`;
    const video = dialog.querySelector('video');
    if (video) video.autoplay = true;
    modal.append(dialog);
    const closeWithChapter = () => { if (!modal.open) dialog.close(); };
    const centerPlayer = () => { dialog.classList.remove('at-video-slot'); dialog.removeAttribute('style'); };
    modal.addEventListener('close', closeWithChapter);
    dialog.addEventListener('close', () => {
      modal.removeEventListener('close', closeWithChapter);
      window.removeEventListener('resize', centerPlayer);
      dialog.remove();
      if (modal.open && frame.isConnected) frame.focus();
    }, {once: true});
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.showModal();
    positionInChapter(dialog, frame, event.data.slot);
    window.addEventListener('resize', centerPlayer, {once: true});
  });
}
