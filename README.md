# Tuned In

**AI-powered music discovery for the web.** Tuned In analyzes any webpage and recommends songs that match its mood, energy, and themes—all powered by on-device AI for complete privacy.

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Available-4285F4?logo=google-chrome&logoColor=white)](https://chromewebstore.google.com/detail/tuned-in/jfpnhopfpcgkpfjeifjnoimjehhclcem)

## Screenshots

<p align="center">
  <img src="docs/nowPlaying.gif" width="300" alt="Now Playing card with album art and track details" />
  <img src="docs/dynamicIsland.gif" width="300" alt="Dynamic Island header" />
</p>

<p align="center">
  <img src="docs/settings.gif" width="300" alt="Settings panel" />
  <img src="docs/history.gif" width="300" alt="Recommendation history list" />
</p>

## How It Works

### Content Extraction

When you click "Generate," the extension uses a **DOM TreeWalker** to extract visible text content from the active tab. The walker traverses the page and intelligently filters out:
- Hidden elements (via CSS `display`, `visibility`, `opacity`)
- Navigation, headers, footers, and sidebars
- Cookie banners, privacy notices, and modals
- Ads, login forms, and other boilerplate
- Short/repetitive text fragments

This approach captures the meaningful content while stripping away UI noise. If the TreeWalker fails, Mozilla's [Readability](https://github.com/mozilla/readability) library is used as a fallback—the same algorithm that powers Firefox's Reader View.

### On-Device Summarization

The extracted text is fed to Chrome's experimental [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api), which runs **Gemini Nano** locally on your device. No data is sent to external servers.

For long pages, the text is chunked (configurable 1K–10K characters) and summarized in passes:
1. Each chunk is summarized independently
2. Chunk summaries are concatenated
3. If the combined summary exceeds the model limit, it's summarized again into a final condensed form

The summarizer is instantiated once per session and reused—no repeated model loading.

### Musical Analysis

The summary is passed back through the same on-device model with a structured prompt that requests:
- **BPM** (tempo): 60–180, mapped from the content's perceived energy
- **Genres**: 2–3 music genres matching the content's mood

The prompt explicitly constrains output to valid Spotify seed genres and prevents the model from suggesting content-based genres like "thriller" or "documentary."

Example output:
```
bpm: 110
genres: ["indie", "chill", "folk"]
```

### Genre Mapping

AI-suggested genres are normalized to Spotify's supported seed genres via a mapping table. This handles synonyms (`hip hop` → `hip-hop`, `r&b` → `r-n-b`) and mood-to-genre conversions (`romantic` → `r-n-b`, `aggressive` → `metal`).

Invalid genres are filtered against Spotify's [official seed genre list](https://developer.spotify.com/documentation/web-api/reference/get-recommendations). If nothing maps, fallback genres (`pop`, `chill`) are used.

### Audio Feature Calculation

BPM is converted to Spotify audio feature targets:

| BPM Range | Energy | Description |
|-----------|--------|-------------|
| < 80 | 0.2–0.4 | Slow, ambient |
| 80–100 | 0.3–0.5 | Chill, mellow |
| 100–120 | 0.4–0.6 | Moderate, groovy |
| 120–140 | 0.6–0.8 | Upbeat, driving |
| 140+ | 0.7–1.0 | Fast, intense |

Valence (musical positivity) is derived from genre keywords:
- `sad`, `melancholic` → 0.2
- `aggressive`, `metal` → 0.3
- `romantic`, `chill` → 0.6
- `happy`, `party` → 0.8

### Track Search Strategy

The extension employs a multi-strategy approach to find the best match:

**Strategy 1: Genre-Filtered Search**

Queries Spotify's Search API with `genre:` filters:
```
genre:indie genre:chill
```

Multiple genre combinations are tried (single, dual, triple) with randomization for variety. Tempo keywords are occasionally added as a secondary signal, but deprioritized since they're unreliable in track metadata.

**Strategy 2: Multi-Genre Text Search**

Falls back to plain text queries combining genre names:
```
indie chill folk
```

**Strategy 3: Playlist Mining**

Searches for playlists matching the genre profile, then samples tracks from a random result. This surfaces tracks that wouldn't appear in direct searches.

**Strategy 4: Simple Fallback**

Single-genre search with no filters—ensures something always returns.

### Track Scoring

Since Spotify deprecated the Audio Features API for free-tier apps, tracks are scored using:

| Factor | Weight | Source |
|--------|--------|--------|
| Genre relevance | 85% | Track/artist name contains genre keywords |
| Popularity | 7.5% | Spotify popularity metric (0–100) |
| Tempo relevance | 7.5% | Bonus-only; tempo keywords in track name |

Tracks are scored, sorted, then artist-diversified—taking the top track from each unique artist before filling the pool with remaining high-scorers. A random selection from this pool ensures variety across runs.

### Popularity Filtering

The dual-range slider sets min/max popularity bounds. If no tracks fall within the range, bounds expand by ±10 iteratively until matches are found or the full 0–100 range is used.

## Privacy

- 100% local AI processing via Gemini Nano
- No data collection or tracking
- No external API calls except Spotify (for track search only)
- Open source and auditable

## Installation

### Prerequisites
- Chrome 138+ (Stable channel)
- Node.js & npm
- Spotify Developer account

### Setup

```bash
git clone https://github.com/ClaytonWas/tuned-in.git
cd tuned-in
npm install
npm run build
```

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `dist` folder
4. Deploy [tuned-in-api](https://github.com/ClaytonWas/tuned-in-api) backend
5. Configure your origin trial token in `manifest.json`

## Settings

| Setting | Description |
|---------|-------------|
| Full Text Mode | Process entire page vs. first chunk |
| Chunk Size | Characters per processing chunk (1K–10K) |
| Theme | Light / Dark |
| History Limit | Max saved recommendations (1–100) |
| Popularity Range | Min–max Spotify popularity filter |
| Show Scrollbar | Toggle scrollbar visibility |

---

**Note**: The Summarizer API requires Chrome 138+ and an origin trial token. See [Chrome's AI documentation](https://developer.chrome.com/docs/ai/summarizer-api) for setup details.
