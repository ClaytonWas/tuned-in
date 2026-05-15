import { state, saveState } from './state.js';

const MAX_FIELD = 300;
const MAX_EXTRACT = 4000;
const MAX_SUMMARY = 2000;
const HTTPS_HOST_ALLOWLIST = /^https:\/\/(music\.apple\.com|itunes\.apple\.com|[a-z0-9.-]+\.mzstatic\.com|audio-ssl\.itunes\.apple\.com)(\/|$)/i;

function cap(s, max = MAX_FIELD) {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

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

function safePageHref(s) {
  if (typeof s !== 'string') return null;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return null;
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

const historyListEl = () => document.querySelector('#historyList');
const historyCountEl = () => document.querySelector('#historyCount');

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.href) node.setAttribute('href', opts.href);
  if (opts.target) node.setAttribute('target', opts.target);
  if (opts.rel) node.setAttribute('rel', opts.rel);
  if (opts.src) node.setAttribute('src', opts.src);
  if (opts.alt !== undefined) node.setAttribute('alt', opts.alt);
  if (opts.loading) node.setAttribute('loading', opts.loading);
  if (opts.controls) node.setAttribute('controls', '');
  if (opts.preload) node.setAttribute('preload', opts.preload);
  return node;
}

function appendLink(parent, text, href, fallback = 'span') {
  const safe = safeHttpsHref(href);
  if (safe) {
    parent.appendChild(el('a', { text, href: safe, target: '_blank', rel: 'noopener noreferrer' }));
  } else {
    parent.appendChild(el(fallback, { text }));
  }
}

function appendPageLink(parent, text, href) {
  const safe = safePageHref(href);
  if (safe) {
    parent.appendChild(el('a', { text, href: safe, target: '_blank', rel: 'noopener noreferrer' }));
  } else {
    parent.appendChild(el('span', { text }));
  }
}

export function showSkeletonHistory() {
  const list = historyListEl();
  if (!list) return;
  list.replaceChildren();
  for (let i = 0; i < 2; i++) {
    const li = el('li', { className: 'history-item' });
    li.appendChild(el('div', { className: 'skeleton skeleton-text' }));
    li.appendChild(el('div', { className: 'skeleton skeleton-text' }));
    li.appendChild(el('div', { className: 'skeleton skeleton-embed' }));
    list.appendChild(li);
  }
}

function renderItem(item) {
  const trackName = cap(item.trackName);
  const trackArtist = cap(item.trackArtist);
  const pageTitle = cap(item.pageTitle);
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3).map(t => cap(t, 32)) : [];
  const energy = cap(item.energy || '', 16);

  const trackHref = safeHttpsHref(item.trackViewUrl);
  const artistHref = safeHttpsHref(item.artistViewUrl) || trackHref;
  const artSrc = safeImageSrc(item.artwork);
  const previewSrc = safeImageSrc(item.previewUrl);

  const li = el('li', { className: 'history-item' });

  const content = el('div', { className: 'history-content' });
  const artwork = el('div', { className: 'history-artwork' });
  if (artSrc) {
    const a = el('a', { href: trackHref || '#', target: '_blank', rel: 'noopener noreferrer' });
    a.appendChild(el('img', { src: artSrc, alt: 'Album cover', loading: 'lazy' }));
    artwork.appendChild(a);
  }
  content.appendChild(artwork);

  const details = el('div', { className: 'history-details' });

  const trackRow = el('div', { className: 'history-track' });
  appendLink(trackRow, trackName, trackHref);
  details.appendChild(trackRow);

  const artistRow = el('div', { className: 'history-artist' });
  appendLink(artistRow, trackArtist, artistHref);
  details.appendChild(artistRow);

  const meta = el('div', { className: 'history-meta' });
  meta.appendChild(el('span', { text: tags.join(', ') }));
  meta.appendChild(el('span', { text: '•' }));
  meta.appendChild(el('span', { text: energy }));
  details.appendChild(meta);

  content.appendChild(details);
  li.appendChild(content);

  const source = el('div', { className: 'source-link' });
  source.appendChild(el('span', { className: 'source-label', text: 'Source:' }));
  const sourceStrong = el('strong');
  appendPageLink(sourceStrong, pageTitle, item.pageUrl);
  source.appendChild(sourceStrong);
  li.appendChild(source);

  const detailsBlock = el('details');
  detailsBlock.appendChild(el('summary', { text: 'More Info' }));
  const detailsContent = el('div', { className: 'details-content' });

  if (previewSrc) {
    detailsContent.appendChild(el('audio', { src: previewSrc, controls: true, preload: 'none' }));
  }

  const rowTrack = el('div', { className: 'details-row' });
  rowTrack.appendChild(el('span', { className: 'details-label', text: 'Track:' }));
  const tSpan = el('span');
  appendLink(tSpan, trackName, trackHref);
  rowTrack.appendChild(tSpan);
  detailsContent.appendChild(rowTrack);

  const rowArtist = el('div', { className: 'details-row' });
  rowArtist.appendChild(el('span', { className: 'details-label', text: 'Artist:' }));
  const aSpan = el('span');
  appendLink(aSpan, trackArtist, artistHref);
  rowArtist.appendChild(aSpan);
  detailsContent.appendChild(rowArtist);

  const rowTags = el('div', { className: 'details-row' });
  rowTags.appendChild(el('span', { className: 'details-label', text: 'Tags:' }));
  rowTags.appendChild(el('span', { text: tags.join(', ') }));
  detailsContent.appendChild(rowTags);

  const rowEnergy = el('div', { className: 'details-row' });
  rowEnergy.appendChild(el('span', { className: 'details-label', text: 'Energy:' }));
  rowEnergy.appendChild(el('span', { text: energy }));
  detailsContent.appendChild(rowEnergy);

  if (typeof item.extractedContent === 'string' && item.extractedContent.length > 0) {
    detailsContent.appendChild(buildContentBlock('Scanned from page', item.extractedContent, item.extractedTruncated));
  }
  if (typeof item.summary === 'string' && item.summary.length > 0) {
    detailsContent.appendChild(buildContentBlock('Summary fed to AI', item.summary, item.summaryTruncated));
  }

  detailsBlock.appendChild(detailsContent);
  li.appendChild(detailsBlock);

  return li;
}

function buildContentBlock(label, body, truncated) {
  const wrap = el('details', { className: 'scanned-block' });
  const summary = el('summary', { className: 'scanned-summary' });
  const truncatedNote = truncated ? ' (truncated)' : '';
  summary.appendChild(el('span', { className: 'details-label', text: label }));
  summary.appendChild(el('span', { className: 'scanned-meta', text: `${body.length.toLocaleString()} chars${truncatedNote}` }));
  wrap.appendChild(summary);
  wrap.appendChild(el('pre', { className: 'scanned-content', text: body }));
  return wrap;
}

export async function renderHistory() {
  const list = historyListEl();
  const count = historyCountEl();
  if (!list) return;
  const history = state.summaryHistory;

  list.replaceChildren();

  if (history.length === 0) {
    list.appendChild(el('li', { className: 'empty-state', text: 'No recommendations yet. Generate your first one above!' }));
    if (count) count.textContent = '0';
    return;
  }

  if (count) count.textContent = history.length.toString();

  for (let i = 0; i < history.length; i++) {
    list.appendChild(renderItem(history[i]));
    if (i % 3 === 2 && i < history.length - 1) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

function capLong(s, max) {
  if (typeof s !== 'string') return { text: '', truncated: false };
  const trimmed = s.trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, max), truncated: true };
}

function sanitizeEntry(entry) {
  const extract = capLong(entry.extractedContent, MAX_EXTRACT);
  const summary = capLong(entry.summary, MAX_SUMMARY);
  return {
    trackName: cap(entry.trackName),
    trackArtist: cap(entry.trackArtist),
    trackId: Number.parseInt(entry.trackId, 10) || 0,
    trackViewUrl: safeHttpsHref(entry.trackViewUrl) || '',
    artistViewUrl: safeHttpsHref(entry.artistViewUrl) || '',
    previewUrl: safeImageSrc(entry.previewUrl) || '',
    artwork: safeImageSrc(entry.artwork) || '',
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 5).map(t => cap(t, 32)) : [],
    energy: cap(entry.energy || '', 16),
    pageUrl: safePageHref(entry.pageUrl) || '#',
    pageTitle: cap(entry.pageTitle),
    extractedContent: extract.text,
    extractedTruncated: extract.truncated,
    summary: summary.text,
    summaryTruncated: summary.truncated,
  };
}

export function addToHistory(entry) {
  const safe = sanitizeEntry(entry);
  const next = [safe, ...state.summaryHistory].slice(0, state.historyLimit);
  saveState({ summaryHistory: next });
  renderHistory();
}

export function trimHistory() {
  if (state.summaryHistory.length > state.historyLimit) {
    saveState({ summaryHistory: state.summaryHistory.slice(0, state.historyLimit) });
  }
}

export function clearHistory() {
  saveState({ summaryHistory: [] });
  renderHistory();
}

export function exportHistory() {
  const blob = new Blob([JSON.stringify(state.summaryHistory, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tuned-in-history-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
