const HTTPS_HOST_ALLOWLIST = /^https:\/\/(music\.apple\.com|itunes\.apple\.com|[a-z0-9.-]+\.mzstatic\.com)(\/|$)/i;

function safeHttpsHref(s) {
  if (typeof s !== 'string') return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    if (!HTTPS_HOST_ALLOWLIST.test(s)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function safeImageSrc(s) {
  if (typeof s !== 'string') return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cap(s, max = 300) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

function loadImageWithCors(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function extractDominantColor(img) {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  let data;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }

  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const light = (max + min) / 510;
    if (sat < 0.2) continue;
    if (light < 0.18 || light > 0.82) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const prev = buckets.get(key);
    if (prev) {
      prev.count++;
      prev.r += r; prev.g += g; prev.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  if (buckets.size === 0) return null;
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  };
}

function relativeLuminance(r, g, b) {
  const norm = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b);
}

function applyAccent({ r, g, b }) {
  const root = document.documentElement;
  root.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.14)`);
  const fg = relativeLuminance(r, g, b) > 0.55 ? '#0a0a0a' : '#ffffff';
  root.style.setProperty('--accent-fg', fg);
}

export function resetAccent() {
  const root = document.documentElement;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-soft');
  root.style.removeProperty('--accent-fg');
}

async function applyAccentFromArtwork(src) {
  if (!src) return;
  try {
    const img = await loadImageWithCors(src);
    const color = extractDominantColor(img);
    if (color) applyAccent(color);
  } catch {
    /* image failed to load with CORS — keep theme accent */
  }
}

function streamingSearchUrls(name, artist, appleMusicHref) {
  const q = `${artist} ${name}`.trim();
  const enc = encodeURIComponent(q);
  return {
    apple: appleMusicHref || `https://music.apple.com/search?term=${enc}`,
    spotify: `https://open.spotify.com/search/${enc}`,
    ytMusic: `https://music.youtube.com/search?q=${enc}`,
    youtube: `https://www.youtube.com/results?search_query=${enc}`,
  };
}

function setStreamingLinks(track, appleMusicHref) {
  const urls = streamingSearchUrls(track.name, track.artist, appleMusicHref);
  const setHref = (id, href) => {
    const el = document.querySelector(id);
    if (el) el.setAttribute('href', href);
  };
  setHref('#appleMusicLink', urls.apple);
  setHref('#spotifyLink', urls.spotify);
  setHref('#ytMusicLink', urls.ytMusic);
  setHref('#youtubeLink', urls.youtube);
}

export function updateWarning(text) {
  const el = document.querySelector('#warning');
  if (!el) return;
  el.textContent = text;
  if (text) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

function setMarquee(element, text) {
  element.replaceChildren();
  const span = document.createElement('span');
  span.textContent = text;
  span.className = element.id === 'trackName' ? 'track-name-scroll' : 'track-artist-scroll';
  const duration = Math.max(8, Math.min(20, text.length * 0.4));
  span.style.setProperty('--marquee-duration', `${duration}s`);
  element.appendChild(span);
}

export function renderNowPlaying(track, analysis) {
  const energy = cap(analysis?.energy || '', 16);
  const tags = Array.isArray(analysis?.tags) ? analysis.tags.slice(0, 3).map(t => cap(t, 32)) : [];
  document.querySelector('#musicBpm').textContent = energy || '—';
  document.querySelector('#musicGenres').textContent = tags.join(', ');

  setMarquee(document.querySelector('#trackName'), cap(track.name));
  setMarquee(document.querySelector('#trackArtist'), cap(track.artist));

  const albumCover = document.querySelector('#albumCover');
  const albumCoverLink = document.querySelector('#albumCoverLink');
  const trackLink = document.querySelector('#trackLink');

  const trackHref = safeHttpsHref(track.trackViewUrl) || '#';
  trackLink?.setAttribute('href', trackHref);
  trackLink?.setAttribute('rel', 'noopener noreferrer');
  if (albumCoverLink) {
    albumCoverLink.setAttribute('href', trackHref);
    albumCoverLink.setAttribute('rel', 'noopener noreferrer');
  }

  setStreamingLinks(track, safeHttpsHref(track.trackViewUrl));

  const artSrc = safeImageSrc(track.artwork);
  if (artSrc) {
    albumCover.setAttribute('src', artSrc);
    albumCover.removeAttribute('hidden');
    applyAccentFromArtwork(artSrc);
  } else {
    albumCover.removeAttribute('src');
    albumCover.setAttribute('hidden', '');
    resetAccent();
  }

  document.querySelector('#musicInfo').removeAttribute('hidden');
  document.querySelector('#trackInfo').removeAttribute('hidden');
}

export function hideNowPlaying() {
  document.querySelector('#musicInfo')?.setAttribute('hidden', '');
}

export function setupSettingsToggle() {
  const settingsButton = document.querySelector('#settingsButton');
  const settingsPanel = document.querySelector('#settingsPanel');
  const dynamicIsland = document.querySelector('#dynamicIsland');
  if (!settingsButton || !settingsPanel) return;

  settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (settingsPanel.hasAttribute('hidden')) {
      settingsPanel.removeAttribute('hidden');
      dynamicIsland?.classList.add('settings-open');
    } else {
      settingsPanel.setAttribute('hidden', '');
      dynamicIsland?.classList.remove('settings-open');
    }
  });

  document.addEventListener('click', (e) => {
    if (!settingsPanel.hasAttribute('hidden') && !dynamicIsland?.contains(e.target)) {
      settingsPanel.setAttribute('hidden', '');
      dynamicIsland?.classList.remove('settings-open');
    }
  });
}
