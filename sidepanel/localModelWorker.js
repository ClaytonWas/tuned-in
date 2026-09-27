import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { composeTags } from './tags.js';
import { MODEL_ID, TASK_PREFIX, PROTOTYPE_SETS, prototypeText } from './prototypes.js';

// Browser-agnostic fallback for Gemini Nano: EmbeddingGemma (300M params, 4-bit, ~200MB) bundled
// with the extension (no Chrome-only APIs, multilingual). Runs in this worker so inference never
// blocks the side panel; uses WebGPU when available and threaded WASM otherwise. Tags are picked by
// cosine similarity between the page text and a short description of each tag.
// Three chunks spread across the page agree with a full 10k-char read on mood/genre ~96% of the
// time at under half the compute, which matters on CPU-only machines.
const CHUNK_CHARS = 1500;
const MAX_CHUNKS = 3;
const MAX_CHUNKS_FULL = 24;
const EMBED_BATCH = 4;
// How much a style's fit with the detected moods/energy counts versus its direct match with the text.
const AFFINITY_WEIGHT = 0.3;

// Workers don't get chrome.* APIs; this file is served from <extension root>/sidepanel/.
const EXTENSION_ROOT = new URL('../', self.location.href).href;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${EXTENSION_ROOT}models/`;
env.useBrowserCache = false;
// The WASM cache re-imports the runtime from a blob: URL, which the extension CSP blocks. Files are local anyway.
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: `${EXTENSION_ROOT}ort/ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${EXTENSION_ROOT}ort/ort-wasm-simd-threaded.asyncify.wasm`,
};
// The manifest opts extension pages into cross-origin isolation, which WASM threads need. Fall back to
// one thread if a browser doesn't honor it.
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  : 1;

// Near-synonym groups: the two chosen styles must come from different groups.
const STYLE_GROUPS = [
  ['ambient', 'chill', 'lo-fi', 'piano'],
  ['electronic', 'house', 'techno', 'synthwave'],
  ['rock', 'indie', 'alternative', 'punk', 'metal'],
  ['pop', 'indie pop'],
  ['hip-hop', 'rap'],
  ['r&b', 'soul', 'funk'],
  ['jazz', 'blues'],
  ['classical', 'soundtrack'],
  ['folk', 'acoustic', 'country'],
  ['reggae', 'latin'],
];

// Moods and energies each style suits. Mood/energy detection is more reliable than direct genre
// matching, so styles are partly scored by how well they fit what was detected.
const STYLE_AFFINITY = {
  ambient: [['atmospheric', 'dreamy', 'melancholic', 'dark'], ['calm']],
  chill: [['happy', 'dreamy', 'nostalgic', 'romantic'], ['mellow', 'calm']],
  'lo-fi': [['nostalgic', 'melancholic', 'dreamy'], ['mellow', 'calm']],
  electronic: [['energetic', 'atmospheric', 'dreamy', 'epic'], ['driving', 'moderate']],
  house: [['happy', 'energetic', 'uplifting'], ['driving']],
  techno: [['dark', 'energetic', 'aggressive'], ['driving', 'intense']],
  synthwave: [['nostalgic', 'dreamy', 'epic', 'energetic'], ['driving', 'moderate']],
  rock: [['energetic', 'aggressive', 'epic', 'uplifting'], ['driving', 'intense']],
  indie: [['melancholic', 'nostalgic', 'dreamy', 'happy'], ['moderate', 'mellow']],
  alternative: [['melancholic', 'dark', 'aggressive'], ['moderate', 'driving']],
  punk: [['aggressive', 'energetic'], ['intense']],
  metal: [['aggressive', 'dark', 'epic'], ['intense']],
  pop: [['happy', 'uplifting', 'romantic', 'energetic'], ['moderate', 'driving']],
  'indie pop': [['happy', 'dreamy', 'romantic', 'nostalgic'], ['moderate', 'mellow']],
  'hip-hop': [['energetic', 'aggressive', 'uplifting'], ['driving', 'moderate']],
  rap: [['aggressive', 'energetic', 'dark'], ['driving', 'intense']],
  'r&b': [['romantic', 'melancholic', 'sad'], ['mellow']],
  soul: [['romantic', 'sad', 'uplifting', 'melancholic'], ['mellow', 'moderate']],
  funk: [['happy', 'energetic'], ['driving', 'moderate']],
  jazz: [['romantic', 'nostalgic', 'melancholic', 'dreamy'], ['mellow', 'calm']],
  blues: [['sad', 'melancholic'], ['mellow', 'calm']],
  classical: [['epic', 'melancholic', 'atmospheric', 'dreamy'], ['calm', 'moderate']],
  piano: [['sad', 'melancholic', 'romantic', 'nostalgic'], ['calm']],
  soundtrack: [['epic', 'dark', 'atmospheric'], ['intense', 'moderate']],
  folk: [['nostalgic', 'melancholic', 'sad'], ['calm', 'mellow']],
  acoustic: [['sad', 'romantic', 'nostalgic', 'happy'], ['calm', 'mellow']],
  country: [['nostalgic', 'sad', 'happy'], ['mellow', 'moderate']],
  reggae: [['happy', 'uplifting'], ['mellow']],
  latin: [['romantic', 'happy', 'energetic'], ['driving', 'moderate']],
};

let tokenizer = null;
let model = null;
let initPromise = null;
let protoCache = null;

function emit(phase, progress) {
  self.postMessage({ type: 'progress', phase, progress });
}

// The panel's logger reads settings from chrome.storage, so log lines are forwarded to it.
function send(fn, label, data) {
  self.postMessage({ type: 'log', fn, label, data: data instanceof Error ? String(data) : data });
}

const log = {
  stage: (label, data) => send('stage', label, data),
  event: (label, data) => send('event', label, data),
  warn: (label, data) => send('warn', label, data),
  error: (label, data) => send('error', label, data),
  timer(label) {
    const start = performance.now();
    return { end: (data) => send('stage', `${label} · ${Math.round(performance.now() - start)}ms`, data) };
  },
};

async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const inputs = tokenizer(texts.slice(i, i + EMBED_BATCH).map(t => TASK_PREFIX + t), { padding: true, truncation: true });
    const { sentence_embedding } = await model(inputs);
    out.push(...sentence_embedding.normalize(2, -1).tolist());
  }
  return out;
}

// Uses the build-time embeddings when their text still matches, and embeds anything that changed.
async function loadPrototypes() {
  let cached = {};
  try {
    const res = await fetch(`${EXTENSION_ROOT}models/prototypes.json`);
    if (res.ok) {
      const json = await res.json();
      if (json.model === MODEL_ID && json.prefix === TASK_PREFIX) cached = json.vectors;
    }
  } catch (e) {
    log.warn('prototype cache unavailable; embedding at runtime', e);
  }

  const out = {};
  const missing = [];
  for (const [set, protos] of Object.entries(PROTOTYPE_SETS)) {
    out[set] = Object.entries(protos).map(([tag, desc]) => {
      const text = prototypeText(tag, desc);
      const hit = cached[text];
      const entry = { tag, vec: hit || null, text };
      if (!hit) missing.push(entry);
      return entry;
    });
  }
  if (missing.length) {
    log.event('embedding prototypes at runtime', { count: missing.length });
    const vecs = await embed(missing.map(m => m.text));
    missing.forEach((m, i) => { m.vec = vecs[i]; });
  }
  return out;
}

async function loadModel() {
  // The regular q4 export uses GatherBlockQuantized, which the WASM backend doesn't implement.
  const options = { dtype: 'q4', model_file_name: 'model_no_gather' };
  if (self.navigator.gpu) {
    try {
      const adapter = await self.navigator.gpu.requestAdapter();
      // A software (fallback) adapter is much slower than threaded WASM.
      const isFallback = adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter;
      if (adapter && !isFallback) {
        const m = await AutoModel.from_pretrained(MODEL_ID, { ...options, device: 'webgpu' });
        log.event('local model device', 'webgpu');
        return m;
      }
    } catch (e) {
      log.warn('WebGPU unavailable for local model; using WASM', e);
    }
  }
  log.event('local model device', `wasm (${env.backends.onnx.wasm.numThreads} threads)`);
  return AutoModel.from_pretrained(MODEL_ID, { ...options, device: 'wasm' });
}

async function ensureLocalModel() {
  if (model && protoCache) return model;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      emit('initializing', 0);
      const t = log.timer('local model load');
      const tt = log.timer('local tokenizer load');
      tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
      tt.end();
      const tm = log.timer('local model session');
      model = await loadModel();
      tm.end();
      const tp = log.timer('local prototype embed');
      protoCache = await loadPrototypes();
      tp.end();
      t.end({ model: MODEL_ID });
      emit('ready', 1);
      return model;
    } catch (e) {
      log.error('local model init failed', e);
      tokenizer = null;
      model = null;
      protoCache = null;
      emit('error', 0);
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v) {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map(x => x / n);
}

function chunkEvenly(text, fullTextMode) {
  const max = fullTextMode ? MAX_CHUNKS_FULL : MAX_CHUNKS;
  const all = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) all.push(text.slice(i, i + CHUNK_CHARS));
  if (all.length <= max) return all;
  const step = all.length / max;
  return Array.from({ length: max }, (_, i) => all[Math.floor(i * step)]);
}

function rank(docVec, protos) {
  return protos
    .map(p => ({ tag: p.tag, score: dot(docVec, p.vec) }))
    .sort((a, b) => b.score - a.score);
}

// Softmax sampling over the top candidates keeps results varied between runs, like the
// temperature on the Prompt API path, without straying far from the best matches.
function sample(ranked, k, temperature = 0.015) {
  const top = ranked.slice(0, k);
  const max = top[0].score;
  const weights = top.map(r => Math.exp((r.score - max) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (let i = 0; i < top.length; i++) {
    x -= weights[i];
    if (x <= 0) return top[i];
  }
  return top[top.length - 1];
}

function groupOf(style) {
  return STYLE_GROUPS.findIndex(g => g.includes(style));
}

function zScores(ranked) {
  const xs = ranked.map(r => r.score);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  return Object.fromEntries(ranked.map(r => [r.tag, (r.score - mean) / sd]));
}

function blendStyles(styleRanked, moodRanked, energyRanked) {
  const zs = zScores(styleRanked);
  const zm = zScores(moodRanked);
  const ze = zScores(energyRanked);
  return styleRanked
    .map(({ tag }) => {
      const [moods, energies] = STYLE_AFFINITY[tag];
      const fit = (Math.max(...moods.map(m => zm[m])) + 0.5 * Math.max(...energies.map(e => ze[e]))) / 1.5;
      return { tag, score: (1 - AFFINITY_WEIGHT) * zs[tag] + AFFINITY_WEIGHT * fit };
    })
    .sort((a, b) => b.score - a.score);
}

// Blended style scores are in standard-deviation units, so they need a wider temperature.
function pickStyles(ranked) {
  const first = sample(ranked, 3, 0.25);
  const rest = ranked.filter(r => groupOf(r.tag) !== groupOf(first.tag));
  const second = sample(rest, 3, 0.25);
  return [first.tag, second.tag];
}

function pickMoods(ranked) {
  const picked = [];
  let pool = ranked.slice(0, 3);
  while (picked.length < 2 && pool.length) {
    const choice = sample(pool, pool.length);
    picked.push(choice.tag);
    pool = pool.filter(r => r !== choice);
  }
  // Add a third only when it's nearly as strong as the second.
  const third = ranked.find(r => !picked.includes(r.tag));
  const second = ranked.find(r => r.tag === picked[1]);
  if (third && second && second.score - third.score < 0.02) picked.push(third.tag);
  return picked;
}

// Only tag a scene when one clearly stands out; most pages don't have one.
function pickScene(ranked) {
  const [top, next] = ranked;
  return top.score >= 0.4 && top.score - next.score >= 0.06 ? [top.tag] : [];
}

async function analyzeLocally(text, fullTextMode) {
  const ready = await ensureLocalModel();
  if (!ready) {
    log.warn('analyzeLocally: model unavailable, returning defaults');
    return { energy: 'moderate', tags: ['chill', 'ambient'], seeds: [] };
  }

  const chunks = chunkEvenly(text.replace(/\s+/g, ' ').trim(), fullTextMode);
  const t = log.timer('local embed');
  let vecs;
  try {
    vecs = await embed(chunks);
  } catch (e) {
    log.error('local embed failed', e);
    return { energy: 'moderate', tags: ['chill', 'ambient'], seeds: [] };
  }
  t.end({ chunks: chunks.length });

  const docVec = normalize(vecs[0].map((_, d) => vecs.reduce((s, v) => s + v[d], 0) / vecs.length));

  const energyRanked = rank(docVec, protoCache.energy);
  const moodRanked = rank(docVec, protoCache.moods);
  const styleRanked = rank(docVec, protoCache.styles);
  const sceneRanked = rank(docVec, protoCache.scenes);
  log.event('local · scores', {
    energy: energyRanked.slice(0, 3),
    moods: moodRanked.slice(0, 5),
    styles: styleRanked.slice(0, 6),
    scenes: sceneRanked.slice(0, 3),
  });

  const energy = sample(energyRanked, 2, 0.02).tag;
  const tags = composeTags(
    pickStyles(blendStyles(styleRanked, moodRanked, energyRanked)),
    pickMoods(moodRanked),
    pickScene(sceneRanked),
  );

  log.stage('analyzeLocally: composed', { energy, tags });
  return { energy, tags, seeds: [] };
}

self.onmessage = async ({ data: msg }) => {
  if (msg.type === 'init') {
    await ensureLocalModel();
  } else if (msg.type === 'analyze') {
    let analysis;
    try {
      analysis = await analyzeLocally(msg.text, msg.fullTextMode);
    } catch (e) {
      log.error('analyzeLocally threw', e);
      analysis = { energy: 'moderate', tags: ['chill', 'ambient'], seeds: [] };
    }
    self.postMessage({ type: 'result', id: msg.id, analysis });
  }
};
