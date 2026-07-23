import "webextension-polyfill"

import { registerMessageRouter } from "@/background/message-router"
import { registerPortRouter } from "@/background/port-router"
import { initializeBackgroundStartup } from "@/background/startup"

// Production persistence topology. Chromium: the service worker guarantees
// the offscreen owner document exists (for itself and for extension pages).
// Firefox: the persistent background page IS the owner and hosts the SQLite
// worker directly.
//
// The branch is resolved at build time via __FIREFOX_BG_OWNER__ (not a runtime
// browser check) so the bundler dead-code eliminates the unused arm. On
// Chromium that drops owner-host and its ~1.4 MB SQLite worker chunk from the
// background entry entirely — the offscreen document (persistence-host) is the
// only Chromium worker host.
function registerPersistenceTopology() {
  // Test environments mock a minimal chrome; the topology only registers
  // where runtime messaging actually exists.
  if (!chrome?.runtime?.onMessage?.addListener) return
  if (__FIREFOX_BG_OWNER__) {
    void import("@/lib/persistence/owner-host").then((module) =>
      module.registerPersistenceHost()
    )
    return
  }
  void import("@/lib/persistence/chromium-owner").then((module) =>
    module.registerChromiumPersistenceControl()
  )
}

initializeBackgroundStartup()
registerPortRouter()
registerMessageRouter()
registerPersistenceTopology()

// Dev-only section 9.4 spike host (offscreen OPFS owner). The flag is false
// in store builds, so this branch and its chunk are eliminated entirely.
if (typeof __SPIKE_OPFS_OWNER__ !== "undefined" && __SPIKE_OPFS_OWNER__) {
  void import("@/spike/opfs/background-owner-host").then((module) =>
    module.registerSpikeOwnerHost()
  )
}

// Firefox MV2 variant: the persistent background page hosts the owner worker
// itself — no offscreen API exists there. Same dead-code elimination rule.
if (
  typeof __SPIKE_OPFS_OWNER_MV2__ !== "undefined" &&
  __SPIKE_OPFS_OWNER_MV2__
) {
  void import("@/spike/opfs/firefox-owner-host").then((module) =>
    module.registerSpikeOwnerHostMv2()
  )
}
