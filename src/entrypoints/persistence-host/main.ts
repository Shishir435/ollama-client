import { registerPersistenceHost } from "@/lib/persistence/owner-host"

// Chromium offscreen document: the production chat-database owner. Created
// only by the background service worker (see chromium-owner.ts). The page is
// also reachable as a normal tab by URL, and a tab must never become a
// second owner — the opfs-sahpool VFS is single-instance and a competing
// host would race RPC responses.
//
// Guard, verified empirically: offscreen documents expose runtime messaging
// but NOT chrome.storage (and their location.search reads empty, and
// visibilityState reports "visible" — neither is usable). A user-opened tab
// of an extension page always has chrome.storage, so its absence identifies
// the real offscreen context.

const isOffscreenDocument = !chrome.storage?.local

if (isOffscreenDocument) {
  registerPersistenceHost()
} else {
  document.body.textContent =
    "This is an internal page of the extension; it has no user-facing content."
}
