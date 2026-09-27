# README image snippets

Paste these into the README when revising it. Paths are relative to the repo root, where `README.md` lives.

Each `<picture>` shows the dark image to readers using GitHub's dark theme and the light image otherwise. The `<img>` inside is the fallback for renderers that ignore `<source>`, such as npm and some editors. The images have transparent backgrounds, so they sit cleanly on either theme.

## Hero (under the title)

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.png">
    <img src="docs/readme/hero-light.png" width="860" alt="Tuned In side panel: settings, a Penguin Cafe Orchestra recommendation, and a recommendation from pasted text">
  </picture>
</p>
```

## Feature rows

A two-column table keeps each image beside its description. GitHub strips inline CSS, so use `width` attributes and `align`.

```html
<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/readme/now-playing-dark.png">
        <img src="docs/readme/now-playing-light.png" alt="Now-playing card with album art, preview button and streaming links">
      </picture>
    </td>
    <td>
      <h3>One song for whatever you're reading</h3>
      On-device AI reads the page's mood and energy and picks a track, with a 30-second preview and links to Apple Music, Spotify, YouTube Music and YouTube.
    </td>
  </tr>
  <tr>
    <td>
      <h3>You choose what it reads</h3>
      Read the opening of a page, the whole page, or text you paste in. Set how much of the opening it reads, and whether picks lean towards hidden gems or hits.
    </td>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/readme/settings-dark.png">
        <img src="docs/readme/settings-light.png" alt="Settings popover, with the Advanced section open on the right">
      </picture>
    </td>
  </tr>
  <tr>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/readme/history-dark.png">
        <img src="docs/readme/history-light.png" alt="History list, and one entry expanded to show the exact text the AI read">
      </picture>
    </td>
    <td>
      <h3>History that shows its work</h3>
      Every pick is saved in your browser along with its genres, energy, source page, and the exact text the AI read.
    </td>
  </tr>
</table>
```

## Light and dark

`themes.png` is a single image (light and dark split on a diagonal), so it needs no `<picture>`:

```html
<p align="center">
  <img src="docs/readme/themes.png" width="300" alt="The same panel in light and dark themes">
</p>
```

## Setup: model loading

For the Getting Started section, next to the note about the status bar:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/loading-dark.png">
  <img src="docs/readme/loading-light.png" width="360" alt="Status card shown while the on-device model loads">
</picture>
```
