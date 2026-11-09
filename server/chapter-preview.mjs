import {videoEmbed, isVideoFile, originalVideoUrl} from '../public/video-embed.js';

// Runs inside the authored document, whose sandbox deliberately has an opaque origin.
// Keep its external player in the campus window so the provider retains its own origin.
function connectChapterVideos(videoEmbed, isVideoFile, originalVideoUrl) {
  const players = new WeakMap();
  const enabledScripts = new WeakSet();
  let clickPath = [];

  function play(href, title, frame) {
    if (parent === window) {
      location.assign(originalVideoUrl(href));
      return;
    }
    const rect = frame?.getBoundingClientRect();
    const slot = rect && [rect.left / innerWidth, rect.top / innerHeight, rect.right / innerWidth, rect.bottom / innerHeight];
    parent.postMessage({type: 'aula:chapter-video', href, title, slot}, location.origin);
  }

  window.addEventListener('click', event => {
    if (!event.isTrusted) return;
    clickPath = event.composedPath();
    setTimeout(() => { clickPath = []; }, 0);
    const link = event.target.closest?.('a[href]');
    if (!link || (!videoEmbed(link.href) && !isVideoFile(link.href))) return;
    event.preventDefault();
    play(link.href, link.title || link.textContent.trim());
  }, true);

  // A placeholder stays inside the original iframe so authored CSS, dimensions,
  // responsive slide layouts and scripts that find this element still work.
  const placeholder = '<!doctype html><html lang="es"><meta charset="utf-8"><style>html,body,button{width:100%;height:100%;margin:0}button{border:0;background:#18221c;color:white;font:600 1rem system-ui;cursor:pointer}button:focus-visible{outline:3px solid white;outline-offset:-5px}</style><button type="button" onclick="parent.postMessage(\'aula:play-placeholder\',\'*\')">▶ Reproducir video</button>';
  window.addEventListener('message', event => {
    if (event.data !== 'aula:play-placeholder') return;
    for (const frame of document.querySelectorAll('iframe[src]')) {
      if (event.source === frame.contentWindow && players.has(frame)) {
        play(players.get(frame), frame.title, frame);
        break;
      }
    }
  });

  function prepare(frame) {
    if (frame.hasAttribute('srcdoc') && !players.has(frame)) return;
    const href = frame.src;
    let url;
    try { url = new URL(href); } catch { /* A cleared src resets the player. */ }
    if (!url || url.username || url.password || url.origin === location.origin || (url.protocol !== 'https:' && !videoEmbed(href))) {
      if (players.delete(frame)) {
        if (enabledScripts.delete(frame)) frame.sandbox.remove('allow-scripts');
        frame.removeAttribute('srcdoc');
      }
      return;
    }
    if (players.get(frame) === href) return;
    players.set(frame, href);
    if (frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-scripts')) {
      frame.sandbox.add('allow-scripts');
      enabledScripts.add(frame);
    }
    frame.srcdoc = placeholder;
    // Some slide decks create the iframe only after a click on their own play button.
    if (clickPath.includes(frame.parentElement)) play(href, frame.title, frame);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches('iframe')) prepare(node);
    for (const frame of node.querySelectorAll('iframe[src]')) prepare(frame);
  }
  scan(document.documentElement);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches('iframe')) prepare(record.target);
      }
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
}

const bridge = `\n<script>(() => { ${videoEmbed}\n${isVideoFile}\n${originalVideoUrl}\n(${connectChapterVideos})(videoEmbed, isVideoFile, originalVideoUrl); })();</script>`;

export function sendChapterPreview(res, method, content) {
  const html = content + bridge;
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; media-src https: data: blob:; frame-src about:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(html));
  res.end(method === 'HEAD' ? undefined : html);
}
