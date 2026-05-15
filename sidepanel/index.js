import { state, loadState } from './state.js';
import { generateSummary, getSharedSummarizer, onSummarizerProgress } from './summarizer.js';
import { analyzePageForMusic, ensurePromptSession, onPromptProgress } from './llm.js';
import { getRecommendedTrack } from './music.js';
import { renderHistory, showSkeletonHistory, addToHistory, trimHistory } from './history.js';
import { setupSettings } from './settings.js';
import { setupSettingsToggle, updateWarning, renderNowPlaying, hideNowPlaying } from './ui.js';
import { addProcessCard, updateProcessCard } from './processCards.js';
import * as log from './logger.js';

let isAnalyzing = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const BLOCKED_SCHEMES = new Set(['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:']);
const BLOCKED_HOSTS = [/^chromewebstore\.google\.com$/i, /^chrome\.google\.com$/i];

function isBlockedUrl(url) {
  if (typeof url !== 'string' || !url) return true;
  try {
    const u = new URL(url);
    if (BLOCKED_SCHEMES.has(u.protocol)) return true;
    if (BLOCKED_HOSTS.some(p => p.test(u.hostname))) return true;
    return false;
  } catch {
    return true;
  }
}

function trySendExtractMessage(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_VISIBLE_TEXT' }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, reason: 'no-listener', error: err.message });
      } else if (typeof response?.text === 'string') {
        resolve({ ok: true, text: response.text });
      } else {
        resolve({ ok: false, reason: 'empty-response' });
      }
    });
  });
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/extract-content.js'],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function extractContentFromTab(tab) {
  if (!tab?.id) {
    return { ok: false, reason: 'no-tab', text: '' };
  }
  if (isBlockedUrl(tab.url)) {
    log.warn(`extract blocked for url scheme/host`, tab.url);
    return { ok: false, reason: 'blocked-url', text: '' };
  }

  const fast = await trySendExtractMessage(tab.id);
  if (fast.ok && fast.text.trim()) return { ok: true, text: fast.text, path: 'static' };

  log.event('content script missing; injecting on demand', { firstAttempt: fast.reason });
  const injected = await injectContentScript(tab.id);
  if (!injected.ok) {
    log.error('content script injection failed', injected.error);
    return { ok: false, reason: 'injection-failed', error: injected.error, text: '' };
  }

  const second = await trySendExtractMessage(tab.id);
  if (second.ok && second.text.trim()) return { ok: true, text: second.text, path: 'lazy-injected' };

  return { ok: false, reason: 'empty-after-inject', text: '' };
}

async function pickTrack(analysis) {
  return getRecommendedTrack(analysis.tags);
}

function capTitle(s) {
  if (typeof s !== 'string') return 'Unknown Page';
  return s.length > 300 ? s.slice(0, 300) : s;
}

function safePageUrl(s) {
  if (typeof s !== 'string') return '#';
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {}
  return '#';
}

async function handleGenerate(override) {
  if (isAnalyzing) return;
  isAnalyzing = true;
  updateWarning('');
  hideNowPlaying();

  const forcedContent = typeof override?.content === 'string' ? override.content.trim() : '';
  const isCustomText = forcedContent.length > 0;

  let pageTitle = 'Unknown Page';
  let pageUrl = '#';
  let tab;

  if (isCustomText) {
    pageTitle = `Custom text · ${forcedContent.slice(0, 60)}${forcedContent.length > 60 ? '…' : ''}`;
    pageUrl = '#';
  } else {
    try {
      tab = await getActiveTab();
      pageTitle = capTitle(tab.title);
      pageUrl = safePageUrl(tab.url);
    } catch (e) {
      console.error('Error getting active tab:', e);
      log.error('active tab lookup failed', e);
    }
  }

  const runTimer = log.timer('TOTAL RUN');
  log.stage('▶ Run started', {
    pageTitle,
    pageUrl,
    fullTextMode: state.fullTextMode,
    source: isCustomText ? 'custom-text' : 'active-tab',
  });

  const processId = addProcessCard('recommend', 'Generating Recommendation', pageTitle);

  let content = '';
  if (isCustomText) {
    log.stage('1. extract · skipped (custom text)', { chars: forcedContent.length, sample: forcedContent });
    content = forcedContent;
  } else {
    const extractTimer = log.timer('1. extract');
    const extractResult = tab
      ? await extractContentFromTab(tab)
      : { ok: false, reason: 'no-tab', text: '' };
    content = extractResult.text || '';
    extractTimer.end({
      chars: content.length,
      ok: extractResult.ok,
      reason: extractResult.reason,
      path: extractResult.path,
      sample: content,
    });

    if (!extractResult.ok || !content.trim()) {
      let msg;
      switch (extractResult.reason) {
        case 'blocked-url':
          msg = 'Chrome blocks extension content extraction on this page. Use the custom text input below.';
          break;
        case 'injection-failed':
          msg = 'Extension can\'t access this page. Try refreshing the tab — or use the custom text input below.';
          break;
        case 'empty-after-inject':
        case 'empty-response':
          msg = 'No readable content found on this page.';
          break;
        case 'no-tab':
          msg = 'No active tab found.';
          break;
        default:
          msg = 'No content could be extracted from this page.';
      }
      updateWarning(msg);
      updateProcessCard(processId, { progress: 100, status: 'error' });
      log.warn(`extract aborted: ${extractResult.reason}`, { error: extractResult.error });
      isAnalyzing = false;
      return;
    }
  }

  if (typeof Summarizer !== 'undefined' && typeof Summarizer.reset === 'function') {
    Summarizer.reset();
  }

  updateProcessCard(processId, { progress: 0, status: 'running' });
  const summaryTimer = log.timer('2. summarize');
  const summary = await generateSummary(content, state.fullTextMode, (progress) => {
    updateProcessCard(processId, { progress, status: 'running' });
  });
  summaryTimer.end({ inputChars: content.length, outputChars: summary.length, output: summary });

  if (summary.startsWith('Error:')) {
    updateWarning("This feature requires Chrome's on-device AI model (Gemini Nano). Please upgrade Chrome.");
    updateProcessCard(processId, { progress: 100, status: 'error' });
    log.error('summarizer unavailable', summary);
    isAnalyzing = false;
    return;
  }

  let progress = 50;
  const tick = setInterval(() => {
    progress = Math.min(100, progress + 2);
    updateProcessCard(processId, { progress, status: 'running' });
  }, 100);

  const analysisTimer = log.timer('3. analyze');
  const analysis = await analyzePageForMusic(summary);
  clearInterval(tick);
  analysisTimer.end({
    energy: analysis.energy,
    tags: analysis.tags,
    seedCount: analysis.seeds?.length || 0,
    seeds: analysis.seeds,
  });

  try {
    const pickTimer = log.timer('4. pick');
    const track = await pickTrack(analysis);
    pickTimer.end(track ? {
      name: track.name,
      artist: track.artist,
      trackId: track.trackId,
      trackViewUrl: track.trackViewUrl,
    } : { result: 'null — no track resolved' });

    updateProcessCard(processId, { progress: 100, status: 'done' });

    if (!track) {
      updateWarning('Could not find a matching track.');
      log.warn('no track resolved for analysis', analysis);
      runTimer.end({ result: 'no-track' });
      return;
    }

    renderNowPlaying(track, analysis);
    addToHistory({
      trackName: track.name,
      trackArtist: track.artist,
      trackId: track.trackId,
      trackViewUrl: track.trackViewUrl,
      artistViewUrl: track.artistViewUrl || track.trackViewUrl,
      previewUrl: track.previewUrl || '',
      artwork: track.artwork || '',
      tags: analysis.tags,
      energy: analysis.energy,
      pageUrl,
      pageTitle,
      extractedContent: content,
      summary,
    });
    runTimer.end({ result: 'ok', track: `${track.artist} — ${track.name}` });
  } catch (e) {
    console.error('Error fetching track:', e);
    updateProcessCard(processId, { progress: 100, status: 'error' });
    updateWarning('Error fetching track.');
    log.error('pick stage threw', e);
    runTimer.end({ result: 'error' });
  } finally {
    isAnalyzing = false;
  }
}

function showModelStatus() {
  const el = document.querySelector('#modelStatus');
  if (!el) return;
  el.classList.remove('is-hiding');
  el.removeAttribute('hidden');
}

function hideModelStatus() {
  const el = document.querySelector('#modelStatus');
  if (!el) return;
  el.classList.add('is-hiding');
  setTimeout(() => {
    el.setAttribute('hidden', '');
    el.classList.remove('is-hiding');
  }, 600);
}

function renderModelRow(modelKey, { phase }) {
  const row = document.querySelector(`.model-status-row[data-model="${modelKey}"]`);
  if (!row) return;
  const fill = row.querySelector('.model-status-progress-fill');
  const stateEl = row.querySelector('.model-status-row-state');
  row.classList.remove('is-ready', 'is-error', 'is-unavailable');

  let label = '';
  let indeterminate = false;
  let width = 0;

  switch (phase) {
    case 'idle':
      label = 'Waiting…';
      break;
    case 'preparing':
    case 'downloading':
    case 'initializing':
      label = 'Loading…';
      indeterminate = true;
      break;
    case 'ready':
      label = 'Ready';
      width = 100;
      row.classList.add('is-ready');
      break;
    case 'unavailable':
      label = 'Unavailable';
      row.classList.add('is-unavailable');
      break;
    case 'error':
      label = 'Error';
      row.classList.add('is-error');
      break;
    default:
      label = phase;
  }

  if (indeterminate) {
    row.classList.add('is-indeterminate');
    if (fill) fill.style.width = '';
  } else {
    row.classList.remove('is-indeterminate');
    if (fill) fill.style.width = `${width}%`;
  }
  if (stateEl) stateEl.textContent = label;
}

async function warmupModels() {
  log.stage('warmup: starting model preload');
  showModelStatus();

  const ready = { summarizer: false, prompt: false };
  let fadeScheduled = false;
  const maybeScheduleFade = () => {
    if (fadeScheduled) return;
    if (ready.summarizer && ready.prompt) {
      fadeScheduled = true;
      setTimeout(hideModelStatus, 5000);
    }
  };
  const onModelEvent = (key, evt) => {
    renderModelRow(key, evt);
    if (evt.phase === 'ready') {
      ready[key] = true;
      maybeScheduleFade();
    }
  };
  const unsubSummarizer = onSummarizerProgress((evt) => onModelEvent('summarizer', evt));
  const unsubPrompt = onPromptProgress((evt) => onModelEvent('prompt', evt));

  const summarizerWarm = (async () => {
    const start = performance.now();
    try {
      const s = await getSharedSummarizer();
      if (!s) {
        log.warn('warmup: summarizer unavailable, skipping');
        return;
      }
      await s.summarize('Warmup.');
      log.ok(`warmup: summarizer ready in ${Math.round(performance.now() - start)}ms`);
    } catch (e) {
      log.error('warmup: summarizer failed', e);
    }
  })();

  const promptWarm = (async () => {
    const start = performance.now();
    try {
      const session = await ensurePromptSession();
      if (!session) {
        log.warn('warmup: prompt session unavailable, skipping');
        return;
      }
      await session.prompt('Ready?');
      log.ok(`warmup: prompt API ready in ${Math.round(performance.now() - start)}ms`);
    } catch (e) {
      log.error('warmup: prompt API failed', e);
    }
  })();

  await Promise.allSettled([summarizerWarm, promptWarm]);
  unsubSummarizer();
  unsubPrompt();
  log.stage('warmup: complete');
}

async function init() {
  await loadState();
  showSkeletonHistory();
  trimHistory();
  setupSettings();
  setupSettingsToggle();

  document.querySelector('#summarizeButton').addEventListener('click', () => handleGenerate());

  const customSubmit = document.querySelector('#customTextSubmit');
  const customArea = document.querySelector('#customTextArea');
  customSubmit?.addEventListener('click', () => {
    const value = customArea?.value || '';
    if (!value.trim()) {
      updateWarning('Paste some text first.');
      return;
    }
    handleGenerate({ content: value });
  });

  renderHistory();

  // Fire-and-forget: warm both models in the background. Doesn't block UI.
  warmupModels();
}

init();
