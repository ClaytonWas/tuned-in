import { state, loadSettings, loadHistory } from './state.js';
import { generateSummary, getSharedSummarizer, onSummarizerProgress } from './summarizer.js';
import { analyzePageForMusic, ensurePromptSession, onPromptProgress } from './llm.js';
import { analyzeLocally, ensureLocalModel, onLocalModelProgress } from './localModel.js';
import { resolveEngine } from './engine.js';
import { getRecommendedTrack } from './music.js';
import { renderHistory, showSkeletonHistory, addToHistory, trimHistory } from './history.js';
import { setupSettings } from './settings.js';
import {
  setupSettingsToggle, setupHoloPills, setupPreviewPlayer, updateWarning, renderNowPlaying,
  startNowPlayingLoading, setNowPlayingProgress, cancelNowPlayingLoading,
} from './ui.js';
import * as log from './logger.js';

let isAnalyzing = false;
// Set in init(); new entries wait on it so they never save over a history that hasn't loaded yet
let historyLoaded = Promise.resolve();

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

  const forcedContent = typeof override?.content === 'string' ? override.content.trim() : '';
  const isCustomText = forcedContent.length > 0;
  // Pasted text is read in full, like Whole page; only Opening cuts the input short
  const fullTextMode = isCustomText || state.sampleArea === 'full';

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
    sampleArea: state.sampleArea,
    source: isCustomText ? 'custom-text' : 'active-tab',
  });

  startNowPlayingLoading(pageTitle);

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
      cancelNowPlayingLoading();
      log.warn(`extract aborted: ${extractResult.reason}`, { error: extractResult.error });
      isAnalyzing = false;
      return;
    }
  }

  let progress = 0;
  let tick = null;
  // Creeps toward 90 while the model works; the last stretch is the song lookup
  const startTicking = (from) => {
    progress = from;
    tick = setInterval(() => {
      progress = Math.min(90, progress + 2);
      setNowPlayingProgress(progress);
    }, 100);
  };

  // What the AI reads: Opening cuts the page to the opening length, the other modes take it all
  const readText = fullTextMode ? content : content.slice(0, state.charLimit);

  let engine = await resolveEngine();
  let summary = '';
  let analysis;

  if (engine === 'nano') {
    const summaryTimer = log.timer('2. summarize');
    summary = await generateSummary(readText, fullTextMode, (p) => {
      setNowPlayingProgress(p);
    });
    summaryTimer.end({ inputChars: readText.length, outputChars: summary.length, output: summary });

    if (summary.startsWith('Error:')) {
      log.warn('Gemini Nano summarizer unavailable; falling back to local model', summary);
      summary = '';
      engine = 'local';
    }
  }

  const analysisTimer = log.timer(`3. analyze (${engine})`);
  if (engine === 'nano') {
    startTicking(50);
    analysis = await analyzePageForMusic(summary);
  } else {
    startTicking(10);
    analysis = await analyzeLocally(readText, fullTextMode);
  }
  clearInterval(tick);
  setNowPlayingProgress(90);
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

    if (!track) {
      cancelNowPlayingLoading();
      updateWarning('Could not find a matching track.');
      log.warn('no track resolved for analysis', analysis);
      runTimer.end({ result: 'no-track' });
      return;
    }

    renderNowPlaying(track);
    await historyLoaded;
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
      extractedContent: readText,
      pageChars: content.length,
      sampleArea: isCustomText ? 'text' : state.sampleArea,
      summary,
    });
    runTimer.end({ result: 'ok', track: `${track.artist} — ${track.name}` });
  } catch (e) {
    console.error('Error fetching track:', e);
    cancelNowPlayingLoading();
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
  const engine = await resolveEngine();
  log.stage('warmup: starting model preload', { engine });
  showModelStatus();

  const keys = engine === 'nano' ? ['summarizer', 'prompt'] : ['local'];
  for (const row of document.querySelectorAll('.model-status-row')) {
    row.hidden = !keys.includes(row.dataset.model);
  }
  const hint = document.querySelector('#modelStatusHint');
  if (hint && engine === 'local') hint.textContent = 'Loading the bundled model. Usually takes a few seconds.';

  const ready = Object.fromEntries(keys.map(k => [k, false]));
  let fadeScheduled = false;
  const maybeScheduleFade = () => {
    if (fadeScheduled) return;
    if (Object.values(ready).every(Boolean)) {
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

  if (engine === 'local') {
    const unsubLocal = onLocalModelProgress((evt) => onModelEvent('local', evt));
    const start = performance.now();
    const model = await ensureLocalModel();
    if (model) log.ok(`warmup: local model ready in ${Math.round(performance.now() - start)}ms`);
    unsubLocal();
    log.stage('warmup: complete');
    return;
  }

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
  historyLoaded = loadHistory();
  showSkeletonHistory();
  await loadSettings();

  // Model loading is the slowest part of opening the panel, so start it before building the UI.
  // Fire-and-forget: it reports progress into the status card and doesn't block anything.
  warmupModels();

  setupSettings();
  setupSettingsToggle();
  setupHoloPills();
  setupPreviewPlayer();

  document.querySelector('#summarizeButton').addEventListener('click', () => {
    if (state.sampleArea !== 'text') {
      handleGenerate();
      return;
    }
    const value = document.querySelector('#customTextArea')?.value || '';
    if (!value.trim()) {
      updateWarning('Paste some text first.');
      return;
    }
    handleGenerate({ content: value });
  });

  await historyLoaded;
  trimHistory();
  renderHistory();
}

init();
