// Loaded synchronously in <head>, before the stylesheet paints. chrome.storage is async, so
// settings.js mirrors the theme into localStorage and this applies it before first paint,
// which keeps dark-mode users from seeing a light flash when the panel opens.
(function () {
  try {
    var mode = localStorage.getItem('themeMode');
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.classList.add('theme-' + mode);
    }
  } catch (e) {}
})();
