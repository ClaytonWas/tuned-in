import * as log from './logger.js';

// Main-thread client for localModelWorker.js, which runs the bundled model off the UI thread.
let worker = null;
let nextId = 0;
const pending = new Map();
const progressListeners = new Set();
let lastEvent = { phase: 'idle', progress: 0 };

function getWorker() {
  if (worker) return worker;
  worker = new Worker('localModelWorker.js', { type: 'module' });
  worker.onmessage = ({ data: msg }) => {
    if (msg.type === 'progress') {
      lastEvent = { phase: msg.phase, progress: msg.progress };
      for (const fn of progressListeners) {
        try { fn(lastEvent); } catch {}
      }
    } else if (msg.type === 'log') {
      log[msg.fn]?.(msg.label, msg.data);
    } else if (msg.type === 'result') {
      pending.get(msg.id)?.(msg.analysis);
      pending.delete(msg.id);
    }
  };
  worker.onerror = (e) => {
    log.error('local model worker failed', e.message);
    lastEvent = { phase: 'error', progress: 0 };
    for (const fn of progressListeners) {
      try { fn(lastEvent); } catch {}
    }
    for (const resolve of pending.values()) resolve({ energy: 'moderate', tags: ['chill', 'ambient'], seeds: [] });
    pending.clear();
  };
  return worker;
}

export function onLocalModelProgress(fn) {
  try { fn(lastEvent); } catch {}
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

// Resolves once the model is ready (true) or failed to load (false).
export function ensureLocalModel() {
  if (lastEvent.phase === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const unsub = onLocalModelProgress(({ phase }) => {
      if (phase === 'ready' || phase === 'error') {
        queueMicrotask(() => unsub());
        resolve(phase === 'ready');
      }
    });
    getWorker().postMessage({ type: 'init' });
  });
}

export function analyzeLocally(text, fullTextMode) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    getWorker().postMessage({ type: 'analyze', id, text, fullTextMode });
  });
}
