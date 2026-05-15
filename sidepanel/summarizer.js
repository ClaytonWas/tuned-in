import { state } from './state.js';
import * as log from './logger.js';

let sharedSummarizer = null;
let initPromise = null;

const progressListeners = new Set();
let lastEvent = { phase: 'idle', progress: 0 };

function emit(phase, progress) {
  lastEvent = { phase, progress };
  for (const fn of progressListeners) {
    try { fn(lastEvent); } catch {}
  }
}

export function onSummarizerProgress(fn) {
  try { fn(lastEvent); } catch {}
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

export async function getSharedSummarizer() {
  if (sharedSummarizer) return sharedSummarizer;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const availability = await Summarizer.availability();
    log.event('Summarizer.availability()', availability);
    if (availability === 'unavailable' || availability === 'no') {
      initPromise = null;
      emit('unavailable', 0);
      log.warn('Summarizer unavailable on this Chrome build');
      return null;
    }
    const isFreshDownload = availability === 'downloadable';
    emit(isFreshDownload ? 'preparing' : 'initializing', 0);
    const summarizer = await Summarizer.create({
      robustnessLevel: 'medium',
      sharedContext: 'Summarize the page for music recommendation. Capture mood, tone, themes, and emotional arc — the feeling a reader takes away, not just the facts.',
      type: 'key-points',
      expectedInputLanguages: ['en', 'ja', 'es'],
      outputLanguage: 'en',
      format: 'plain-text',
      length: 'short',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (!isFreshDownload) return;
          const raw = typeof e.loaded === 'number' ? e.loaded : 0;
          const fraction = raw > 1 ? raw / 100 : raw;
          emit('downloading', Math.max(0, Math.min(1, fraction)));
        });
      },
    });
    emit('initializing', 1);
    await summarizer.ready;
    sharedSummarizer = summarizer;
    emit('ready', 1);
    log.ok('Summarizer ready');
    return summarizer;
  })();

  try {
    return await initPromise;
  } catch (e) {
    console.error('Failed to initialize summarizer:', e);
    log.error('Summarizer.create() threw', e);
    emit('error', 0);
    initPromise = null;
    return null;
  }
}

function chunkText(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function generateSummary(text, fullTextMode, onProgress) {
  const summarizer = await getSharedSummarizer();
  if (!summarizer) return 'Error: Summarizer not available';

  const limit = state.charLimit;

  if (fullTextMode && text.length > limit) {
    const chunks = chunkText(text, limit);
    log.event('summarizer: chunked mode', { chunks: chunks.length, charLimit: limit });
    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      const t = log.timer(`summarize chunk ${i + 1}/${chunks.length}`);
      const out = await summarizer.summarize(chunks[i]);
      t.end({ inputChars: chunks[i].length, outputChars: out.length });
      summaries.push(out);
      onProgress?.(Math.round(((i + 1) / chunks.length) * 50));
    }
    const combined = summaries.join('\n\n');
    if (combined.length > limit) {
      log.event('summarizer: combined exceeds limit, re-summarizing', { combinedChars: combined.length, limit });
      return summarizer.summarize(combined.slice(0, limit));
    }
    return combined;
  }

  onProgress?.(50);
  const truncated = text.length > limit;
  log.event('summarizer: single-pass mode', { inputChars: Math.min(text.length, limit), truncated, charLimit: limit });
  return summarizer.summarize(text.slice(0, limit));
}

export async function analyzeMusicGenre(summaryText) {
  const summarizer = await getSharedSummarizer();
  if (!summarizer) return { bpm: 100, genres: ['ambient', 'electronic'] };

  const prompt = `Analyze this text and suggest MUSIC GENRES and tempo that would match its mood and energy.

IMPORTANT: Use ONLY real music genres like:
- Moods: ambient, chill, sad, happy, party, romantic, aggressive
- Styles: pop, rock, indie, electronic, hip-hop, jazz, classical, folk, country, r-n-b, soul, blues, reggae, metal
- Sub-genres: lo-fi, synthwave, trap, techno, house, disco, punk, grunge

DO NOT use content genres like "thriller", "drama", "documentary", "historical".

Output ONLY in this exact format:
bpm: 120
genres: ["genre1", "genre2", "genre3"]

Rules:
- Use 2-3 MUSIC genres that match the content's mood/energy
- BPM: 60-90 (slow/sad), 90-120 (medium/neutral), 120-180 (fast/energetic)
- Genres must be lowercase, no spaces (use hyphens: "hip-hop", "r-n-b")

Text to analyze:
"""${summaryText}"""`;

  const reply = await summarizer.summarize(prompt);
  const clean = reply.replace(/\*/g, '').trim();

  let genres = [];
  const genresMatch = clean.match(/genres:\s*\[([^\]]+)\]/i);
  if (genresMatch) {
    genres = genresMatch[1]
      .split(',')
      .map(g => g.trim().replace(/['"]/g, '').toLowerCase())
      .filter(g => g.length > 0);
  }
  if (genres.length === 0) genres = ['ambient', 'electronic'];
  genres = [...new Set(genres)].slice(0, 3);

  let bpm = 100;
  const bpmMatch = clean.match(/bpm:\s*(\d+)/i);
  if (bpmMatch) bpm = Math.max(60, Math.min(180, parseInt(bpmMatch[1], 10)));

  return { genres, bpm };
}
