import { OPENING_DEFAULT, clampOpening } from './sampling.js';

const DEFAULTS = {
  historyLimit: 20,
  popularityMin: 25,
  popularityMax: 100,
  charLimit: OPENING_DEFAULT, // Opening length in chars
  // What the AI reads: 'start' (opening of the page), 'full' (whole page) or 'text' (pasted text)
  sampleArea: 'start',
  fullTextMode: false, // pre-sampleArea setting, read once to migrate
  themeMode: 'light',
  showScrollbar: false,
  debugMode: false,
  aiEngine: 'auto',
  summaryHistory: [],
};

export const state = { ...DEFAULTS };

async function load(keys) {
  const stored = await chrome.storage.local.get(keys);
  for (const key of keys) {
    if (stored[key] !== undefined) state[key] = stored[key];
  }
  return stored;
}

// History can hold up to 1000 entries with page text, so it loads separately and the
// small settings read never waits on it.
const SETTINGS_KEYS = Object.keys(DEFAULTS).filter(k => k !== 'summaryHistory');

export async function loadSettings() {
  const stored = await load(SETTINGS_KEYS);
  if (stored.sampleArea === undefined && stored.fullTextMode) state.sampleArea = 'full';
  state.charLimit = clampOpening(Number(state.charLimit));
}
export const loadHistory = () => load(['summaryHistory']);

export function saveState(partial) {
  Object.assign(state, partial);
  chrome.storage.local.set(partial);
}
