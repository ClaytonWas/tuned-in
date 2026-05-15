import { state } from './state.js';
import * as log from './logger.js';

const LASTFM_API_KEY = 'ee6e03a79bd34151ee77c2b25f458f49';
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const ITUNES_BASE = 'https://itunes.apple.com/search';

const TAG_ALLOWLIST = new Set([
  'ambient', 'chill', 'chillout', 'chillwave', 'lo-fi', 'downtempo',
  'electronic', 'edm', 'house', 'techno', 'trance', 'dubstep', 'idm', 'synthwave',
  'rock', 'indie', 'indie rock', 'alternative', 'punk', 'metal', 'hard rock', 'grunge',
  'pop', 'indie pop', 'synth pop', 'dance pop', 'k-pop', 'j-pop',
  'hip-hop', 'hip hop', 'rap', 'trap', 'r&b', 'soul', 'funk',
  'jazz', 'blues', 'classical', 'piano', 'orchestral', 'soundtrack',
  'folk', 'acoustic', 'singer-songwriter', 'country', 'americana',
  'reggae', 'latin', 'world',
  'sad', 'melancholic', 'melancholy', 'happy', 'energetic', 'aggressive',
  'romantic', 'dreamy', 'atmospheric', 'dark', 'epic', 'uplifting', 'nostalgic',
  'study', 'focus', 'sleep', 'meditation', 'workout', 'driving', 'rainy day',
  'summer', 'late night', 'morning',
]);

const TAG_NORMALIZE = {
  'hiphop': 'hip-hop',
  'hip hop': 'hip-hop',
  'rnb': 'r&b',
  'r and b': 'r&b',
  'lofi': 'lo-fi',
  'lo fi': 'lo-fi',
  'melancholy': 'melancholic',
  'edm': 'electronic',
  'synthwave': 'electronic',
};

function normalizeTag(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.toLowerCase().trim().replace(/[^\w\s&-]/g, '').replace(/\s+/g, ' ');
  if (t.length < 2 || t.length > 32) return null;
  return TAG_NORMALIZE[t] || t;
}

export function sanitizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of rawTags) {
    const t = normalizeTag(raw);
    if (!t || seen.has(t)) continue;
    if (!TAG_ALLOWLIST.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

function isHttpsUrl(s) {
  if (typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeAssign(obj, key, value, maxLen = 200) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  obj[key] = trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function endpointLabel(url) {
  try {
    const u = new URL(url);
    const method = u.searchParams.get('method');
    if (method) return `lastfm:${method}`;
    if (u.hostname.includes('itunes')) return 'itunes:search';
    return u.hostname;
  } catch {
    return 'unknown';
  }
}

async function fetchJson(url, { timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const label = endpointLabel(url);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      log.warn(`fetch ${label} → HTTP ${res.status}`, { ms });
      return null;
    }
    const text = await res.text();
    if (text.length > 2_000_000) {
      log.warn(`fetch ${label} → payload too large (${text.length} bytes)`, { ms });
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      log.event(`fetch ${label} → ${res.status}`, { ms, bytes: text.length });
      return parsed;
    } catch {
      log.warn(`fetch ${label} → invalid JSON`, { ms, bytes: text.length });
      return null;
    }
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    log.warn(`fetch ${label} → aborted/threw`, { ms, error: String(e?.name || e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildLastfmUrl(method, params) {
  const url = new URL(LASTFM_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', LASTFM_API_KEY);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function tagTopTracks(tag, limit = 50) {
  if (!TAG_ALLOWLIST.has(tag)) return [];
  const page = 1 + Math.floor(Math.random() * 3);
  const data = await fetchJson(buildLastfmUrl('tag.getTopTracks', { tag, limit, page }));
  log.event(`tagTopTracks: tag=${tag} page=${page}`);
  const raw = data?.tracks?.track;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => ({
      name: typeof t?.name === 'string' ? t.name : '',
      artist: typeof t?.artist?.name === 'string' ? t.artist.name : '',
      listeners: Number.parseInt(t?.listeners, 10) || 0,
    }))
    .filter(t => t.name && t.artist);
}

function dedupe(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const key = `${t.artist.toLowerCase()}|${t.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function popularityFilter(tracks) {
  if (tracks.length === 0) return [];
  const sorted = [...tracks].sort((a, b) => a.listeners - b.listeners);
  const loPct = state.popularityMin / 100;
  const hiPct = state.popularityMax / 100;
  const loIdx = Math.floor(sorted.length * loPct);
  const hiIdx = Math.max(loIdx + 1, Math.ceil(sorted.length * hiPct));
  const slice = sorted.slice(loIdx, hiIdx);
  return slice.length > 0 ? slice : tracks;
}

function diversifyByArtist(tracks, maxPerArtist = 1) {
  const counts = new Map();
  const out = [];
  for (const t of tracks) {
    const k = t.artist.toLowerCase();
    const n = counts.get(k) || 0;
    if (n >= maxPerArtist) continue;
    counts.set(k, n + 1);
    out.push(t);
  }
  return out;
}

async function discoverPool(tags) {
  const work = [];
  const sources = [];
  for (const tag of tags.slice(0, 3)) {
    work.push(tagTopTracks(tag, 50));
    sources.push(`tag:${tag}`);
  }
  log.event('discoverPool: sources', sources);
  const results = await Promise.allSettled(work);
  const flat = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      log.event(`discoverPool: ${sources[i]} → ${r.value.length} tracks`);
      flat.push(...r.value);
    } else {
      log.warn(`discoverPool: ${sources[i]} → rejected`, r.reason);
    }
  }
  const deduped = dedupe(flat);
  const diversified = diversifyByArtist(deduped, 2);
  log.stage('discoverPool: pool built', {
    rawHits: flat.length,
    afterDedupe: deduped.length,
    afterDiversify: diversified.length,
  });
  return diversified;
}

function normalizeForMatch(s) {
  return s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\w\s]/g, '').trim();
}

async function itunesResolve(artist, title) {
  if (!artist || !title) return null;
  const term = `${artist} ${title}`.slice(0, 200);
  const url = `${ITUNES_BASE}?${new URLSearchParams({
    term, entity: 'song', limit: '5', media: 'music',
  })}`;
  const data = await fetchJson(url);
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length === 0) return null;

  const wantTitle = normalizeForMatch(title);
  const wantArtist = normalizeForMatch(artist);
  const verified = results.find(r => {
    const rt = normalizeForMatch(r?.trackName || '');
    const ra = normalizeForMatch(r?.artistName || '');
    return rt.includes(wantTitle) && (ra.includes(wantArtist) || wantArtist.includes(ra));
  }) || results[0];

  if (!verified) return null;

  const trackId = Number.parseInt(verified.trackId, 10);
  if (!Number.isFinite(trackId) || trackId <= 0) return null;

  const artwork100 = typeof verified.artworkUrl100 === 'string' ? verified.artworkUrl100 : '';
  const artwork = artwork100.replace('100x100bb', '300x300bb');
  const trackViewUrl = isHttpsUrl(verified.trackViewUrl) ? verified.trackViewUrl : null;
  const previewUrl = isHttpsUrl(verified.previewUrl) ? verified.previewUrl : null;
  const artistViewUrl = isHttpsUrl(verified.artistViewUrl) ? verified.artistViewUrl : null;

  if (!trackViewUrl) return null;

  const out = { trackId, previewUrl, trackViewUrl, artistViewUrl };
  safeAssign(out, 'name', verified.trackName);
  safeAssign(out, 'artist', verified.artistName);
  safeAssign(out, 'albumName', verified.collectionName);
  if (isHttpsUrl(artwork)) out.artwork = artwork;
  return out.name && out.artist ? out : null;
}

export async function getRecommendedTrack(tags) {
  const allowed = sanitizeTags(tags);
  log.stage('getRecommendedTrack: tag sanitization', {
    inputTags: tags,
    allowedTags: allowed,
    rejectedTags: (tags || []).filter(t => !allowed.includes(typeof t === 'string' ? t.toLowerCase() : t)),
  });
  if (allowed.length === 0) {
    log.warn('getRecommendedTrack: no allowed tags — aborting');
    return null;
  }

  const pool = await discoverPool(allowed);
  if (pool.length === 0) {
    log.warn('getRecommendedTrack: discoverPool returned empty');
    return null;
  }

  const filtered = popularityFilter(pool);
  log.event('popularityFilter', {
    range: `${state.popularityMin}-${state.popularityMax}`,
    before: pool.length,
    after: filtered.length,
  });

  const shortlist = filtered.slice(0, 25);
  for (let i = shortlist.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shortlist[i], shortlist[j]] = [shortlist[j], shortlist[i]];
  }
  log.event('shortlist (top 8 will be tried)', shortlist.slice(0, 8).map(t => `${t.artist} — ${t.name}`));

  for (const candidate of shortlist.slice(0, 8)) {
    const resolved = await itunesResolve(candidate.artist, candidate.name);
    if (resolved) {
      log.ok(`resolved candidate: ${candidate.artist} — ${candidate.name}`);
      return resolved;
    }
  }
  log.warn('getRecommendedTrack: none of the top 8 candidates resolved on iTunes');
  return null;
}
