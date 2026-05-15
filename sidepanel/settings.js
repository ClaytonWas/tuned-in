import { state, saveState } from './state.js';
import { renderHistory, trimHistory, exportHistory, clearHistory } from './history.js';

const THEME_ORDER = ['light', 'dark', 'forest'];
const THEME_LABELS = {
  light: '🌞 Light',
  dark: '🌚 Dark',
  forest: '🌲 Forest',
};

export function applyTheme() {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark', 'theme-forest');
  const mode = THEME_ORDER.includes(state.themeMode) ? state.themeMode : 'light';
  root.classList.add(`theme-${mode}`);
}

export function applyScrollbar() {
  document.documentElement.classList.toggle('show-scrollbar', state.showScrollbar);
}

function setupTheme() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  const label = () => {
    toggle.textContent = THEME_LABELS[state.themeMode] || THEME_LABELS.light;
  };
  label();
  toggle.addEventListener('click', () => {
    const idx = THEME_ORDER.indexOf(state.themeMode);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    saveState({ themeMode: next });
    applyTheme();
    label();
  });
}

function setupCharLimit(onChange) {
  const input = document.querySelector('#charLimit');
  const value = document.querySelector('#charLimitValue');
  if (!input || !value) return;
  input.value = state.charLimit;
  value.textContent = state.charLimit;
  input.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    value.textContent = v;
    saveState({ charLimit: v });
    onChange?.();
  });
}

function setupFullTextMode(onChange) {
  const cb = document.querySelector('#fullTextMode');
  if (!cb) return;
  cb.checked = state.fullTextMode;
  cb.addEventListener('change', (e) => {
    saveState({ fullTextMode: e.target.checked });
    onChange?.();
  });
}

function setupHistoryLimit() {
  const input = document.querySelector('#historyLimit');
  if (!input) return;
  input.value = state.historyLimit;
  input.addEventListener('change', (e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v) || v < 3) v = 3;
    else if (v > 1000) v = 1000;
    input.value = v;
    saveState({ historyLimit: v });
    if (state.summaryHistory.length > v) {
      trimHistory();
      renderHistory();
    }
  });
}

function setupScrollbar() {
  const cb = document.querySelector('#showScrollbar');
  if (!cb) return;
  cb.checked = state.showScrollbar;
  cb.addEventListener('change', (e) => {
    saveState({ showScrollbar: e.target.checked });
    applyScrollbar();
  });
}

function setupDebugMode() {
  const cb = document.querySelector('#debugMode');
  if (!cb) return;
  cb.checked = state.debugMode;
  cb.addEventListener('change', (e) => {
    saveState({ debugMode: e.target.checked });
  });
}

function setupPopularitySlider() {
  const minInput = document.querySelector('#popularityMin');
  const maxInput = document.querySelector('#popularityMax');
  const minLabel = document.querySelector('#popularityMinValue');
  const maxLabel = document.querySelector('#popularityMaxValue');
  const fill = document.querySelector('.range-fill');
  if (!minInput || !maxInput) return;

  function applyFromInputs(source) {
    let lo = parseInt(minInput.value, 10);
    let hi = parseInt(maxInput.value, 10);
    if (lo > hi) {
      if (source === minInput) minInput.value = hi;
      else maxInput.value = lo;
      lo = parseInt(minInput.value, 10);
      hi = parseInt(maxInput.value, 10);
    }
    minLabel.textContent = lo;
    maxLabel.textContent = hi;
    fill.style.left = `${lo}%`;
    fill.style.width = `${hi - lo}%`;
    saveState({ popularityMin: lo, popularityMax: hi });
  }

  minInput.value = state.popularityMin;
  maxInput.value = state.popularityMax;
  minLabel.textContent = state.popularityMin;
  maxLabel.textContent = state.popularityMax;
  fill.style.left = `${state.popularityMin}%`;
  fill.style.width = `${state.popularityMax - state.popularityMin}%`;

  minInput.addEventListener('input', (e) => applyFromInputs(e.target));
  maxInput.addEventListener('input', (e) => applyFromInputs(e.target));
}

function setupHistoryButtons() {
  document.querySelector('#exportHistory')?.addEventListener('click', exportHistory);
  document.querySelector('#clearHistory')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
      clearHistory();
    }
  });
}

export function setupSettings(onContentRelevantChange) {
  applyTheme();
  applyScrollbar();
  setupTheme();
  setupCharLimit(onContentRelevantChange);
  setupFullTextMode(onContentRelevantChange);
  setupHistoryLimit();
  setupScrollbar();
  setupDebugMode();
  setupPopularitySlider();
  setupHistoryButtons();
}
