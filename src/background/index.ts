import "webextension-polyfill"

import { registerMessageRouter } from "@/background/message-router"
import { registerPortRouter } from "@/background/port-router"
import { initializeBackgroundStartup } from "@/background/startup"

initializeBackgroundStartup()
registerPortRouter()
registerMessageRouter()

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
