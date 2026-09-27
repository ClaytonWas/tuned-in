# 🎵 Tuned In [![Chrome](https://img.shields.io/badge/Chrome-0A1929?logo=googlechrome&logoColor=4FC3F7)](#)

**A music recommender for whatever's on your screen**

[![License: MIT](https://img.shields.io/badge/License-MIT-0A1929?logoColor=4FC3F7)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Available-0A1929?logo=googlechrome&logoColor=4FC3F7)](https://chromewebstore.google.com/detail/tuned-in/jfpnhopfpcgkpfjeifjnoimjehhclcem)
[![Gemini Nano](https://img.shields.io/badge/Gemini%20Nano-On--device-0A1929?logo=googlegemini&logoColor=4FC3F7)](https://developer.chrome.com/docs/ai)

## About

Tuned In is a Chrome side panel extension that reads the page you're on, captures its mood and energy with on-device AI, and recommends one song that fits, with links to play it on Apple Music, Spotify, YouTube Music, or YouTube.

All analysis runs locally. On Chrome with Gemini Nano installed it uses the built-in Summarizer and Prompt APIs; everywhere else (Edge, Brave, Opera, Vivaldi, Arc, or Chrome without Nano) it uses Google's EmbeddingGemma model, bundled with the extension. No tracking, no external servers, no webpage data ever leaves your browser.

### Features

- ⚡ **On-device AI** using Gemini Nano when available, or a bundled local model on any Chromium browser, fully private.
- 📝 **Custom text mode** for analyzing anything you paste instead of the page.

## Screenshots

<p align="center">
<table>
<tr>

<td>
  <img width="500" height="720" alt="Light mode song recommendation" src="https://github.com/user-attachments/assets/a487e26c-f9dd-49bc-95ad-0752179a2edd" />
</td>

<td>
  <img width="310" height="350" alt="Light mode settings" src="https://github.com/user-attachments/assets/6eb6ba78-a2e0-481f-84d2-eea859530cd8" />

  <img width="310" height="350" alt="Dark mode settings" src="https://github.com/user-attachments/assets/8687c682-90c9-464a-864f-f1dc20f0bacd" />
</td>

<td>
  <img width="500" height="750" alt="Dark mode song recommendation from custom prompt" src="https://github.com/user-attachments/assets/a0dc26ba-0128-41d0-8351-45bcad1943a7" />
</td>

</tr>
</table>
</p>

## Getting Started

### Dependencies

- Any recent Chromium-based browser (Chrome, Edge, Brave, Opera, Vivaldi, Arc)
- [**Node.js** (v18 or higher)](https://nodejs.org/en/download)
- A free [**Last.fm API key**](https://www.last.fm/api/account/create)

### Installation

#### From Source

1. Clone the repository:
```bash
git clone https://github.com/ClaytonWas/tuned-in.git
cd tuned-in
```

2. Install dependencies:
```bash
npm install
```

3. Open [`sidepanel/music.js`](sidepanel/music.js) and replace the `LASTFM_API_KEY` value with your own key.

4. Build the extension:
```bash
npm run build
```

5. Load the extension:
   - Open `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the generated `dist/` folder
   - Pin the extension and open the side panel from the toolbar icon

`npm run build` downloads the local model ([EmbeddingGemma 300M](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX), 4-bit, ~200MB) into `models/` on first run, precomputes the tag embeddings, and bundles both into `dist/`.

When the side panel opens, a status bar shows the model loading. The bundled model is ready in about 2 seconds; Gemini Nano takes 15 to 30 seconds.

## Usage

### Recommending a Song

1. Open the **Tuned In** side panel from the toolbar
2. Navigate to any page you'd like a song for
3. Click **Tune In** to run the pipeline on the active tab
4. Review the now-playing card with album art and a 30-second preview
5. Click any platform link to open the track in Apple Music, Spotify, YouTube Music, or YouTube

### Custom Text Mode

1. Toggle **Custom text mode** in the side panel
2. Paste or type the text you want analyzed
3. Click **Tune In** to recommend a song based on the pasted text instead of the page

### Settings

Access settings via the gear icon in the side panel:

- **Theme**: Cycles Light → Dark → Forest (a mellow sage/cream palette)
- **Full text mode**: Process the entire page rather than just the first chunk
- **Chunk size**: Characters per processing chunk (1K to 10K)
- **History limit**: Max saved recommendations (3 to 1000)
- **Discovery range**: Listener-percentile slice (0 = obscure, 100 = mainstream)
- **Export / Clear history**: Download all stored recommendations as JSON, or wipe local storage
- **Show scrollbar**: Toggle native scrollbar visibility
- **Debug logging**: Enable verbose stage-by-stage timing logs
- **AI engine**: Auto (Gemini Nano if already installed, otherwise the local model), Local model, or Gemini Nano

## How It Works

The pipeline runs entirely in the side panel after one button press.

1. **Content extraction**: A content script runs in the active tab and pulls meaningful text.
2. **Engine selection**: Gemini Nano is used when Chrome reports both the Summarizer and Prompt APIs as `available`. Otherwise the bundled local model is used. It runs in a Web Worker on WebGPU when available, or multi-threaded WASM otherwise, so no GPU is required.
3. **Mood characterization**:
   - **Local model**: three chunks spread across the page (or up to 24 in full text mode) are embedded with EmbeddingGemma and compared against a short description of every energy, mood, style and scene tag. Styles are also scored by how well they fit the detected moods and energy. The closest matches are sampled with a little randomness so repeat runs vary.
   - **Gemini Nano**: the text is summarized with Chrome's [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api), then four focused prompts run via the [Prompt API](https://developer.chrome.com/docs/extensions/ai/prompt-api):
   - **Energy**: one of `calm | mellow | moderate | driving | intense`
   - **Moods**: 2 to 3 from a fixed pool (`melancholic`, `dreamy`, `nostalgic`, `aggressive`, ...)
   - **Styles**: 2 genres from a fixed pool, chosen to differ in feel
   - **Scenes**: 0 to 1 listening contexts (`study`, `late night`, `driving`, ...)
4. **Retrieval (Last.fm)**: Top 3 tags are sent to [`tag.getTopTracks`](https://www.last.fm/api/show/tag.getTopTracks), paginating randomly across the first few pages. The pool is deduped (one track per artist) and sliced by listener-count based on the Discovery Range slider.
5. **Resolution (iTunes Search)**: Each candidate resolves to a playable track via [Apple's iTunes Search API](https://performance-partners.apple.com/search-api), yielding an Apple Music URL, 300×300 artwork, 30-second preview MP3, and clean metadata. URLs are validated against an HTTPS Apple-host allowlist.
6. **Surface**: The now-playing card builds direct Apple Music links and search URLs for Spotify, YouTube Music, and YouTube. Album art is downsampled to 32×32 and the dominant non-grayscale color becomes the UI accent.

## Privacy & Security

- **Local AI**: Mood characterization runs on-device, via Gemini Nano or the model bundled in the extension. The model is never downloaded at runtime.
- **No accounts, no OAuth, no tracking.**
- **External requests are limited to:**
  - `ws.audioscrobbler.com` (Last.fm): sends only allowlisted mood/genre tags
  - `itunes.apple.com` (search): sends only artist+track strings produced by Last.fm
  - `*.mzstatic.com` (album artwork): image fetch only, for display and color sampling

None of these endpoints ever receive your page content.

## Development

### Project Structure

```
tuned-in/
├── sidepanel/              # Side panel UI and pipeline
│   ├── index.html          # Side panel markup
│   ├── index.css           # Design tokens, themes, animatable accent
│   ├── index.js            # Pipeline orchestration
│   ├── state.js            # chrome.storage.local state shape + helpers
│   ├── summarizer.js       # Wraps Chrome Summarizer; load-progress events
│   ├── llm.js              # Wraps Chrome Prompt API; 4-prompt classifier
│   ├── localModel.js       # Client for the local model worker
│   ├── localModelWorker.js # EmbeddingGemma tag classifier (any Chromium)
│   ├── prototypes.js       # Tag descriptions the page is compared against
│   ├── engine.js           # Picks Gemini Nano or the local model
│   ├── tags.js             # Shared energy/mood/style/scene tag pools
│   ├── music.js            # Last.fm + iTunes retrieval, filtering
│   ├── ui.js               # Now-playing rendering, accent extraction
│   ├── settings.js         # Settings panel handlers
│   ├── history.js          # History list with previews
│   ├── processCards.js     # Progress card UI
│   └── logger.js           # Stage-aware console logger
├── scripts/
│   └── extract-content.js  # Content script for active tab
├── tools/
│   ├── fetch-model.mjs     # Downloads the local model at build time
│   └── embed-prototypes.mjs # Precomputes tag embeddings at build time
├── background.js           # Service worker, opens side panel
├── manifest.json           # MV3 manifest
└── rollup.config.mjs       # Build config
```

### Tech Stack

- **Runtime**: Chrome Extension Manifest V3 (side panel)
- **On-device AI**: Gemini Nano via Summarizer and Prompt APIs, or [Transformers.js](https://huggingface.co/docs/transformers.js) + EmbeddingGemma 300M on WebGPU/WASM
- **Build**: Rollup
- **APIs**: Last.fm, iTunes Search

### Building

```bash
# Production build
npm run build
```

The Gemini Nano path requires **Chrome 138+** on [supported hardware](https://developer.chrome.com/docs/ai/get-started#hardware). Without it, the extension uses the local model automatically.

## Future Features

| Feature | Description |
| ------- | ----------- |
| 🎚️ **Multi-track recommendations** | Return a short queue rather than a single track |
| 🧠 **Listener feedback loop** | Use thumbs up/down to bias future tag selection |

## Contributing

Contributions are welcome! Open an issue or submit a pull request. For major changes, please include a comment with decisions made.

## Resources

- [Chrome AI documentation](https://developer.chrome.com/docs/ai)
- [Summarizer API reference](https://developer.chrome.com/docs/ai/summarizer-api)
- [Prompt API reference](https://developer.chrome.com/docs/extensions/ai/prompt-api)
- [Last.fm API](https://www.last.fm/api)
- [iTunes Search API](https://performance-partners.apple.com/search-api)


<div align="center">

**Made with 💙 by [ClaytonWas](https://github.com/ClaytonWas)**

[Report Bug/Request Feature](https://github.com/ClaytonWas/tuned-in/issues)

</div>
