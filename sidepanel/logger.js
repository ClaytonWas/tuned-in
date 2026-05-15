import { state } from './state.js';

const PREFIX = '%c[Tuned In]';
const STYLE_PREFIX = 'color:#6366f1;font-weight:600';
const STYLE_STAGE = 'color:#0891b2;font-weight:600';
const STYLE_DIM = 'color:#64748b';
const STYLE_OK = 'color:#16a34a;font-weight:600';
const STYLE_WARN = 'color:#d97706;font-weight:600';
const STYLE_ERR = 'color:#dc2626;font-weight:600';

function enabled() {
  return !!state.debugMode;
}

function clipString(s, max = 240) {
  if (typeof s !== 'string') return s;
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (+${s.length - max} more chars)`;
}

function clipValue(v) {
  if (typeof v === 'string') return clipString(v);
  if (Array.isArray(v) && v.length > 12) {
    return [...v.slice(0, 12), `…(+${v.length - 12} more)`];
  }
  return v;
}

export function stage(label, data) {
  if (!enabled()) return;
  console.groupCollapsed(`${PREFIX} %c${label}`, STYLE_PREFIX, STYLE_STAGE);
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      console.log(`%c${k}`, STYLE_DIM, clipValue(v));
    }
  }
  console.groupEnd();
}

export function event(label, data) {
  if (!enabled()) return;
  if (data === undefined) {
    console.log(`${PREFIX} %c${label}`, STYLE_PREFIX, STYLE_DIM);
  } else {
    console.log(`${PREFIX} %c${label}`, STYLE_PREFIX, STYLE_DIM, clipValue(data));
  }
}

export function ok(label, data) {
  if (!enabled()) return;
  if (data === undefined) {
    console.log(`${PREFIX} %c✓ ${label}`, STYLE_PREFIX, STYLE_OK);
  } else {
    console.log(`${PREFIX} %c✓ ${label}`, STYLE_PREFIX, STYLE_OK, clipValue(data));
  }
}

export function warn(label, data) {
  if (!enabled()) return;
  if (data === undefined) {
    console.warn(`${PREFIX} %c${label}`, STYLE_PREFIX, STYLE_WARN);
  } else {
    console.warn(`${PREFIX} %c${label}`, STYLE_PREFIX, STYLE_WARN, clipValue(data));
  }
}

export function error(label, err) {
  if (!enabled()) return;
  console.error(`${PREFIX} %c✗ ${label}`, STYLE_PREFIX, STYLE_ERR, err);
}

export function timer(label) {
  if (!enabled()) return { end: () => 0 };
  const start = performance.now();
  return {
    end(data) {
      const ms = Math.round(performance.now() - start);
      stage(`${label} · ${ms}ms`, data);
      return ms;
    },
  };
}
