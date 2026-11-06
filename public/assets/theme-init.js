/**
 * Pre-paint theme. Runs synchronously from <head>, before the page's React
 * bundle, so the first frame already carries the stored theme class instead of
 * flashing light. An inline script would be refused by the extension CSP, so
 * this is an external file. The preference lives in chrome.storage, which has
 * no synchronous read; `use-theme-watcher.ts` mirrors it to localStorage under
 * this key, and a first-ever open falls back to the OS preference.
 */
;(function () {
  var theme = "system"
  try {
    var stored = window.localStorage.getItem("ollama-client-theme-mirror")
    if (stored === "light" || stored === "dark" || stored === "system") {
      theme = stored
    }
  } catch (e) {}
  var dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.add(dark ? "dark" : "light")
})()
