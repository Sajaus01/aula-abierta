export const videoPermissions = 'autoplay; encrypted-media; picture-in-picture; fullscreen';

// Also used to recognize players in isolated HTML chapters. Keep this function DOM-independent.
export function videoEmbed(value) {
  let source;
  try { source = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.port) return null;

  const host = source.hostname;
  const path = source.pathname.replace(/\/$/, '');
  const params = source.searchParams;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    let id;
    if (host === 'youtu.be') id = path.slice(1);
    else if (path === '/watch') id = params.get('v');
    else id = path.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})$/)?.[1];
    const playlist = ['/playlist', '/embed', '/embed/videoseries'].includes(path) && /^[\w-]+$/.test(params.get('list') || '');
    if (!playlist && (id === 'videoseries' || !/^[\w-]{11}$/.test(id || ''))) return null;
    const player = new URL('https://www.youtube-nocookie.com/embed/' + (playlist ? 'videoseries' : id));
    // Public share URLs use t=1m30s. The embedded player takes seconds in start.
    const time = params.get('start') || params.get('t') || new URLSearchParams(source.hash.slice(1)).get('t');
    if (/^\d+$/.test(time || '')) player.searchParams.set('start', time);
    else if (time) {
      const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time);
      if (match) player.searchParams.set('start', String(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)));
    }
    for (const key of ['end', 'list', 'listType', 'index', 'playlist', 'controls', 'autoplay', 'mute', 'loop', 'playsinline', 'rel', 'fs', 'cc_load_policy', 'cc_lang_pref', 'hl', 'iv_load_policy', 'disablekb', 'enablejsapi', 'origin']) {
      if (params.has(key)) player.searchParams.set(key, params.get(key));
    }
    return player.href;
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const match = host === 'player.vimeo.com' ? /^\/video\/(\d+)$/.exec(path) : /^\/(\d+)(?:\/([\w-]+))?$/.exec(path);
    if (!match) return null;
    const player = new URL('https://player.vimeo.com/video/' + match[1]);
    if (host === 'player.vimeo.com') player.search = source.search;
    const privacyHash = match[2] || params.get('h');
    if (privacyHash) player.searchParams.set('h', privacyHash);
    player.hash = source.hash;
    return player.href;
  }
  return null;
}

export function isVideoFile(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && /\.(mp4|m4v|webm|ogv)$/i.test(url.pathname);
  } catch { return false; }
}

// An embed URL opened as a top-level page can lack the referrer required by the player.
export function originalVideoUrl(value) {
  const embed = videoEmbed(value);
  if (!embed) return value;
  const url = new URL(value);
  const player = new URL(embed);
  if (/^\/embed(?:\/|$)/.test(url.pathname)) {
    const id = player.pathname.split('/').pop();
    const page = new URL(id === 'videoseries' ? 'https://www.youtube.com/playlist' : 'https://www.youtube.com/watch');
    if (id !== 'videoseries') page.searchParams.set('v', id);
    if (player.searchParams.has('list')) page.searchParams.set('list', player.searchParams.get('list'));
    if (player.searchParams.has('start')) page.searchParams.set('t', player.searchParams.get('start') + 's');
    return page.href;
  }
  if (url.hostname === 'player.vimeo.com') {
    const page = new URL('https://vimeo.com/' + player.pathname.split('/').pop());
    const hash = player.searchParams.get('h');
    if (hash && /^[\w-]+$/.test(hash)) page.pathname += '/' + hash;
    page.hash = player.hash;
    return page.href;
  }
  return value;
}
