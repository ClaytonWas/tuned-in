import { state } from './state.js';
import * as log from './logger.js';

let cached = null;

async function nanoReady() {
  if (typeof Summarizer === 'undefined' || typeof LanguageModel === 'undefined') return false;
  try {
    const [s, p] = await Promise.all([Summarizer.availability(), LanguageModel.availability()]);
    log.event('Gemini Nano availability', { summarizer: s, prompt: p });
    // 'downloadable' needs a multi-GB download and a user gesture, so auto mode only uses Nano once it's installed.
    return s === 'available' && p === 'available';
  } catch (e) {
    log.warn('Gemini Nano availability check failed', e);
    return false;
  }
}

// Resolves to 'nano' (Chrome built-in AI) or 'local' (bundled model that runs in any Chromium browser).
export async function resolveEngine() {
  if (state.aiEngine === 'local') return 'local';
  if (state.aiEngine === 'nano') return 'nano';
  if (!cached) cached = nanoReady().then(ok => (ok ? 'nano' : 'local'));
  return cached;
}
