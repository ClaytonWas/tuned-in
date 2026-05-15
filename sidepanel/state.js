const DEFAULTS = {
  historyLimit: 20,
  popularityMin: 25,
  popularityMax: 100,
  charLimit: 10000,
  fullTextMode: false,
  themeMode: 'light',
  showScrollbar: false,
  debugMode: false,
  summaryHistory: [],
};

export const state = { ...DEFAULTS };

export async function loadState() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] !== undefined) state[key] = stored[key];
  }
}

export function saveState(partial) {
  Object.assign(state, partial);
  chrome.storage.local.set(partial);
}
