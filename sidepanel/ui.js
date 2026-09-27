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

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Pulls a two-colour palette from the artwork: the most prominent vivid colour, plus the
 * strongest colour with a clearly different hue (or a rotated version of the first when the
 * cover is essentially one colour). Returns null for greyscale covers.
 */
function extractPalette(img) {
  const size = 40;
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
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const prev = buckets.get(key);
    if (prev) {
      prev.count++;
      prev.r += r; prev.g += g; prev.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  // Weight by saturation so a small vivid area beats a large muddy one
  const candidates = [];
  for (const bk of buckets.values()) {
    const hsl = rgbToHsl(bk.r / bk.count, bk.g / bk.count, bk.b / bk.count);
    if (hsl.s < 0.18 || hsl.l < 0.12 || hsl.l > 0.9) continue;
    candidates.push({ hsl, score: bk.count * (0.25 + hsl.s) });
  }
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => y.score - x.score);

  const primary = candidates[0].hsl;
  const second = candidates.find(c => hueDistance(c.hsl.h, primary.h) >= 35 && c.score >= candidates[0].score * 0.08);
  const secondary = second ? second.hsl : { ...primary, h: (primary.h + 40) % 360 };
  return { primary, secondary };
}

function relativeLuminance(r, g, b) {
  const norm = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Album colours are pulled into a lightness/saturation band that reads on the current
// theme: deeper on light paper, brighter on near-black.
function fitToTheme(hsl) {
  const dark = document.documentElement.classList.contains('theme-dark');
  return hslToRgb({
    h: hsl.h,
    s: clamp(hsl.s, 0.45, 0.88),
    l: dark ? clamp(hsl.l, 0.58, 0.72) : clamp(hsl.l, 0.34, 0.46),
  });
}

let currentPalette = null;

function applyPalette(palette) {
  currentPalette = palette;
  const root = document.documentElement;
  const a = fitToTheme(palette.primary);
  const b = fitToTheme(palette.secondary);
  root.style.setProperty('--accent', `rgb(${a.r}, ${a.g}, ${a.b})`);
  root.style.setProperty('--accent-2', `rgb(${b.r}, ${b.g}, ${b.b})`);
  root.style.setProperty('--accent-soft', `rgba(${a.r}, ${a.g}, ${a.b}, 0.16)`);
  // Text on accent fills (which blend into --accent-2) follows the lighter of the pair
  const lum = Math.max(relativeLuminance(a.r, a.g, a.b), relativeLuminance(b.r, b.g, b.b));
  root.style.setProperty('--accent-fg', lum > 0.4 ? '#0a0a0a' : '#ffffff');
}

export function resetAccent() {
  currentPalette = null;
  const root = document.documentElement;
  for (const p of ['--accent', '--accent-2', '--accent-soft', '--accent-fg']) root.style.removeProperty(p);
}

// Re-fit the album palette whenever the theme on <html> changes
let lastDark = document.documentElement.classList.contains('theme-dark');
new MutationObserver(() => {
  const dark = document.documentElement.classList.contains('theme-dark');
  if (dark === lastDark) return;
  lastDark = dark;
  if (currentPalette) applyPalette(currentPalette);
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

async function applyAccentFromArtwork(src) {
  if (!src) return;
  try {
    const img = await loadImageWithCors(src);
    const palette = extractPalette(img);
    if (palette) applyPalette(palette);
    else resetAccent(); // greyscale cover: fall back to the theme's own accent
  } catch {
    /* image failed to load with CORS — keep theme accent */
  }
}

export function streamingSearchUrls(name, artist, appleMusicHref) {
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

/**
 * Writes the cursor position into --x / --y on whichever .holo-pill is under it; the
 * gradient and hue shift live in index.css. One delegated listener covers pills that
 * are rendered later, and nothing re-renders on mouse move.
 */
export function setupHoloPills() {
  document.addEventListener('pointermove', (e) => {
    const pill = e.target instanceof Element ? e.target.closest('.holo-pill') : null;
    if (!pill) return;
    const rect = pill.getBoundingClientRect();
    pill.style.setProperty('--x', String(((e.clientX - rect.left) / rect.width) * 100));
    pill.style.setProperty('--y', String(((e.clientY - rect.top) / rect.height) * 100));
  }, { passive: true });
}

// One shared player for the now-playing sample; each new recommendation swaps its source.
const previewAudio = new Audio();
previewAudio.preload = 'none';

function syncPreviewButton() {
  const btn = document.querySelector('#previewButton');
  if (!btn) return;
  const playing = !previewAudio.paused;
  btn.classList.toggle('is-playing', playing);
  btn.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
  btn.setAttribute('title', playing ? 'Pause preview' : 'Play preview');
}

function setPreview(src) {
  const btn = document.querySelector('#previewButton');
  previewAudio.pause();
  if (src) previewAudio.src = src;
  else previewAudio.removeAttribute('src');
  btn?.toggleAttribute('hidden', !src);
  syncPreviewButton();
}

export function setupPreviewPlayer() {
  const btn = document.querySelector('#previewButton');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (previewAudio.paused) previewAudio.play().catch(() => syncPreviewButton());
    else previewAudio.pause();
  });
  for (const evt of ['play', 'pause', 'ended']) previewAudio.addEventListener(evt, syncPreviewButton);
}

export function renderNowPlaying(track) {
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
  setPreview(safeImageSrc(track.previewUrl));

  const artSrc = safeImageSrc(track.artwork);
  if (artSrc) {
    // Keep the placeholder showing until the new cover has actually downloaded
    if (albumCover.getAttribute('src') !== artSrc) {
      albumCover.classList.add('is-pending');
      const settle = () => albumCover.classList.remove('is-pending');
      albumCover.addEventListener('load', settle, { once: true });
      albumCover.addEventListener('error', settle, { once: true });
      albumCover.setAttribute('src', artSrc);
    }
    albumCover.removeAttribute('hidden');
    applyAccentFromArtwork(artSrc);
  } else {
    albumCover.removeAttribute('src');
    albumCover.setAttribute('hidden', '');
    resetAccent();
  }

  hasTrack = true;
  const card = document.querySelector('#musicInfo');
  card.removeAttribute('hidden');
  card.classList.remove('is-loading', 'is-revealed');
  void card.offsetWidth; // restart the reveal animation
  card.classList.add('is-revealed');
}

/* --------------------------------------------------
   Loading state: the now-playing card doubles as the progress card, so a run
   shows one card that fills in place instead of swapping cards in and out.
-------------------------------------------------- */
let hasTrack = false;

function statusWord(progress) {
  if (progress < 25) return 'Reading page';
  if (progress < 50) return 'Summarizing';
  if (progress < 75) return 'Analyzing';
  return 'Finding a song';
}

export function setNowPlayingProgress(progress) {
  const fill = document.querySelector('#nowPlayingProgressFill');
  const word = document.querySelector('#nowPlayingStatusWord');
  if (fill) fill.style.width = `${progress}%`;
  if (word) word.textContent = statusWord(progress);
}

export function startNowPlayingLoading(pageTitle) {
  const card = document.querySelector('#musicInfo');
  if (!card) return;
  previewAudio.pause();
  const title = document.querySelector('#nowPlayingStatusTitle');
  if (title) title.textContent = cap(pageTitle);
  setNowPlayingProgress(0);
  card.classList.remove('is-revealed');
  card.classList.add('is-loading');
  card.removeAttribute('hidden');
}

// A failed run puts back whatever the card showed before it started
export function cancelNowPlayingLoading() {
  const card = document.querySelector('#musicInfo');
  if (!card) return;
  card.classList.remove('is-loading');
  if (!hasTrack) card.setAttribute('hidden', '');
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
