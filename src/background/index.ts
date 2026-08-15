import "webextension-polyfill"

import { registerMessageRouter } from "@/background/message-router"
import { startPersistenceTopology } from "@/background/persistence-readiness"
import { registerPortRouter } from "@/background/port-router"
import { initializeBackgroundStartup } from "@/background/startup"
import { registerTabLifecycle } from "@/background/tab-lifecycle"

/**
 * The persistence topology starts first and hands its readiness to startup,
 * because every durable recovery task startup runs needs an owner that can
 * answer. Routing registers after and is not gated on it: an incoming request
 * waits on the same promise inside the persistence client, not on the order
 * these lines happen to run in.
 */
const persistenceReady = startPersistenceTopology()

initializeBackgroundStartup(persistenceReady)
registerPortRouter()
registerMessageRouter()
registerTabLifecycle()

/**
 * Dev-only section 9.4 spike host (offscreen OPFS owner). The flag is false
 * in store builds, so this branch and its chunk are eliminated entirely.
 */
if (typeof __SPIKE_OPFS_OWNER__ !== "undefined" && __SPIKE_OPFS_OWNER__) {
  void import("@/spike/opfs/background-owner-host").then((module) =>
    module.registerSpikeOwnerHost()
  )
}

/**
 * Firefox MV2 variant: the persistent background page hosts the owner worker
 * itself — no offscreen API exists there. Same dead-code elimination rule.
 */
if (
  typeof __SPIKE_OPFS_OWNER_MV2__ !== "undefined" &&
  __SPIKE_OPFS_OWNER_MV2__
) {
  void import("@/spike/opfs/firefox-owner-host").then((module) =>
    module.registerSpikeOwnerHostMv2()
  )
}
