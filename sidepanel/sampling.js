// How much text each engine reads. Shared by the settings UI, the run pipeline and the
// local model worker so the slider and tooltips always match what the models actually get.

// The local model embeds text in passages this long; every Opening length is a whole number of them.
export const PASSAGE_CHARS = 1500;

// Opening reads this much of the start of the page. Three passages agree with a full 10k-char
// read on mood/genre ~96% of the time at under half the compute, so that's the default.
export const OPENING_MIN = PASSAGE_CHARS;
export const OPENING_MAX = PASSAGE_CHARS * 7;
export const OPENING_DEFAULT = PASSAGE_CHARS * 3;

// scripts/extract-content.js stops at this many chars (it's a content script, so it keeps its own copy).
export const MAX_PAGE_CHARS = 20000;

// Whole page / Enter text on the local model: passages spread evenly across the text.
// 24 × 1.5k covers the whole 20k-char page extraction; only longer pasted text gets sampled.
export const WHOLE_TEXT_PASSAGES = 24;

// Whole page / Enter text on Gemini Nano: summarised in pieces this long, then combined.
export const NANO_CHUNK_CHARS = 10000;

// Snaps older saved values (e.g. 7500 or 10000 from the 500-step slider) onto the passage grid.
export function clampOpening(n) {
  const v = Number.isFinite(n) ? n : OPENING_DEFAULT;
  const snapped = Math.ceil(v / PASSAGE_CHARS) * PASSAGE_CHARS;
  return Math.min(OPENING_MAX, Math.max(OPENING_MIN, snapped));
}
