import { state, saveState } from './state.js';
import { PASSAGE_CHARS, OPENING_MIN, OPENING_MAX, clampOpening } from './sampling.js';
import { renderHistory, trimHistory, exportHistory, clearHistory } from './history.js';

const THEMES = ['light', 'dark'];

export function applyTheme({ animate = false } = {}) {
  const root = document.documentElement;
  // Anything else (e.g. the retired 'forest' theme) falls back to light
  const mode = THEMES.includes(state.themeMode) ? state.themeMode : 'light';
  const swap = () => {
    root.classList.remove('theme-light', 'theme-dark', 'theme-forest');
    root.classList.add(`theme-${mode}`);
  };

  if (root.classList.contains(`theme-${mode}`)) {
    // Already painted by theme-init.js
  } else if (animate && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // One snapshot crossfade on the compositor instead of every element fading its own colours
    root.classList.add('theme-switching');
    document.startViewTransition(swap).finished.finally(() => root.classList.remove('theme-switching'));
  } else {
    swap();
  }
  // Mirrored for theme-init.js, which applies it before first paint on the next open
  try {
    localStorage.setItem('themeMode', mode);
  } catch {
    /* blocked storage — the panel just paints the default theme first */
  }
}

export function applyScrollbar() {
  document.documentElement.classList.toggle('show-scrollbar', state.showScrollbar);
}

function setupTheme() {
  const buttons = document.querySelectorAll('[data-theme-choice]');
  const sync = () => {
    const mode = THEMES.includes(state.themeMode) ? state.themeMode : 'light';
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.themeChoice === mode));
  };
  sync();
  for (const b of buttons) {
    b.addEventListener('click', () => {
      saveState({ themeMode: b.dataset.themeChoice });
      applyTheme({ animate: true });
      sync();
    });
  }
}

// One shared tooltip for every info dot. It's position: fixed and placed from the dot's
// rect, so it never gets clipped by the scrolling settings dropdown.
function setupInfoDots() {
  const tip = document.getElementById('settingTooltip');
  const panel = document.getElementById('settingsPanel');
  if (!tip || !panel) return;
  let current = null;
  let pinned = false;

  const show = (dot) => {
    current?.removeAttribute('aria-describedby');
    current = dot;
    tip.textContent = dot.dataset.info;
    tip.hidden = false;
    dot.setAttribute('aria-describedby', tip.id);

    const r = dot.getBoundingClientRect();
    const margin = 8;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(margin, r.left + r.width / 2 - w / 2), window.innerWidth - w - margin);
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - margin ? r.top - h - 6 : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => {
    current?.removeAttribute('aria-describedby');
    current = null;
    pinned = false;
    tip.hidden = true;
  };

  panel.addEventListener('mouseover', (e) => {
    const dot = e.target.closest('.info-dot');
    if (dot && !pinned) show(dot);
  });
  panel.addEventListener('mouseout', (e) => {
    if (e.target.closest('.info-dot') && !pinned) hide();
  });
  panel.addEventListener('focusin', (e) => {
    const dot = e.target.closest('.info-dot');
    if (dot) show(dot);
  });
  panel.addEventListener('focusout', (e) => {
    if (e.target.closest('.info-dot')) hide();
  });
  panel.addEventListener('click', (e) => {
    const dot = e.target.closest('.info-dot');
    if (!dot) return;
    // Several dots sit inside a <label>; don't let the click flip its switch
    e.preventDefault();
    if (pinned && current === dot) {
      hide();
    } else {
      show(dot);
      pinned = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  panel.addEventListener('scroll', hide, { passive: true });
  document.getElementById('settingsButton')?.addEventListener('click', hide);
}

const SAMPLE_AREAS = ['start', 'full', 'text'];

// Opening / Whole page / Enter text. Enter text swaps the page read for the text box above
// the Generate button, so that box only exists in that mode.
export function applySampleArea() {
  const mode = SAMPLE_AREAS.includes(state.sampleArea) ? state.sampleArea : 'start';
  for (const b of document.querySelectorAll('[data-sample-area]')) {
    b.setAttribute('aria-checked', String(b.dataset.sampleArea === mode));
  }
  const area = document.querySelector('#customTextArea');
  if (area) area.hidden = mode !== 'text';
  // Opening length only applies to Opening; the other modes read the whole text
  const openingRow = document.querySelector('#openingLengthRow');
  if (openingRow) openingRow.hidden = mode !== 'start';
  const label = document.querySelector('.generate-btn-text');
  if (label) label.textContent = mode === 'text' ? 'Generate from your text' : 'Generate recommendation';
}

function setupSampleArea(onChange) {
  applySampleArea();
  for (const b of document.querySelectorAll('[data-sample-area]')) {
    b.addEventListener('click', () => {
      saveState({ sampleArea: b.dataset.sampleArea });
      applySampleArea();
      onChange?.();
    });
  }
}

function setupChunkSize(onChange) {
  const input = document.querySelector('#charLimit');
  const value = document.querySelector('#charLimitValue');
  if (!input || !value) return;

  const sync = () => {
    const n = state.charLimit;
    value.textContent = `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k chars`;
  };
  input.min = OPENING_MIN;
  input.max = OPENING_MAX;
  input.step = PASSAGE_CHARS;
  input.value = state.charLimit;
  sync();
  input.addEventListener('input', (e) => {
    saveState({ charLimit: clampOpening(parseInt(e.target.value, 10)) });
    sync();
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

function setupAiEngine() {
  const select = document.querySelector('#aiEngine');
  if (!select) return;
  select.value = state.aiEngine;
  select.addEventListener('change', (e) => {
    saveState({ aiEngine: e.target.value });
    // Engine choice is resolved once per panel load; reload so the right model warms up.
    location.reload();
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
  setupInfoDots();
  setupSampleArea(onContentRelevantChange);
  setupChunkSize(onContentRelevantChange);
  setupHistoryLimit();
  setupScrollbar();
  setupDebugMode();
  setupAiEngine();
  setupPopularitySlider();
  setupHistoryButtons();
}
