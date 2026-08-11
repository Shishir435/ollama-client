import { logger } from "@/lib/logger"

/**
 * The background composition root's one persistence-readiness promise.
 *
 * Registering the topology used to be a fire-and-forget dynamic import, so
 * nothing could wait for it. A startup task that touched the database during
 * that window found no ensure hook installed and fell back to runtime
 * messaging — from the service worker, which never receives its own messages —
 * and sat there until the client's 30s timeout. This module gives that work a
 * promise to await.
 *
 * Resolving means: the owner exists, its listener answers, and it has settled
 * on a backend. It does not mean the migration succeeded — a migration that
 * fails verification resolves onto the legacy backend, and the owner serves
 * from there.
 */

let readiness: Promise<void> | null = null

/**
 * Chromium: the service worker guarantees the offscreen owner document exists
 * (for itself and for extension pages, which cannot create one). Firefox: the
 * persistent background page IS the owner and hosts the SQLite worker itself.
 *
 * The branch is resolved at build time via __FIREFOX_BG_OWNER__ (not a runtime
 * browser check) so the bundler dead-code eliminates the unused arm. On
 * Chromium that drops owner-host and its ~1.4 MB SQLite worker chunk from the
 * background entry entirely.
 */
const startOwner = async (): Promise<void> => {
  if (__FIREFOX_BG_OWNER__) {
    const module = await import("@/lib/persistence/owner-host")
    module.registerPersistenceHost()
    if (
      typeof document !== "undefined" &&
      !document.querySelector("#ingestion-processor-host")
    ) {
      const frame = document.createElement("iframe")
      frame.id = "ingestion-processor-host"
      frame.hidden = true
      frame.src = chrome.runtime.getURL("ingestion-processor.html?host=1")
      document.body.append(frame)
    }
    // In-process host: the owner is ready once the worker has answered and the
    // backend is chosen, which is exactly what ensureMigrated resolves on.
    await module.ensureMigrated()
    return
  }
  const module = await import("@/lib/persistence/chromium-owner")
  module.registerChromiumPersistenceControl()
  await module.ensurePersistenceOwnerReady()
}

/**
 * True where a persistence owner is neither wanted nor reachable: unit tests
 * with a minimal chrome mock, and benchmark builds whose section 9.4 spike
 * owner claims the one offscreen slot Chromium allows per extension.
 * Registering the production topology beside the spike would race for that
 * slot and silently drop the spike's owner RPC when createDocument loses.
 */
const hasNoOwnerTopology = (): boolean =>
  !chrome?.runtime?.onMessage?.addListener ||
  (typeof __SPIKE_OPFS_OWNER__ !== "undefined" && __SPIKE_OPFS_OWNER__) ||
  (typeof __SPIKE_OPFS_OWNER_MV2__ !== "undefined" && __SPIKE_OPFS_OWNER_MV2__)

/**
 * Start the persistence topology, or join the start already in progress.
 *
 * Concurrent callers share one promise, and a rejected one is cleared so a
 * later caller retries the owner rather than inheriting a boot failure.
 */
export const startPersistenceTopology = (): Promise<void> => {
  if (!readiness) {
    readiness = (hasNoOwnerTopology() ? Promise.resolve() : startOwner()).catch(
      (error: unknown) => {
        readiness = null
        logger.error("Failed to start persistence owner", "Persistence", {
          error
        })
        throw error
      }
    )
  }
  return readiness
}
