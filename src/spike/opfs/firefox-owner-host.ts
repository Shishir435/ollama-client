import { createOwnerHost } from "./owner-host-core"
import {
  SPIKE_OWNER_BG_WRITE,
  SPIKE_OWNER_CLOSE,
  SPIKE_OWNER_ENSURE
} from "./owner-protocol"

// Section 9.4 spike: Firefox MV2 owner host. Firefox has no chrome.offscreen,
// but its MV2 background runs in a persistent background page that can host
// the SQLite worker directly — the page IS the owner document. The wire
// protocol is identical to the Chromium topology, so spike-owner.html and the
// gate semantics work unchanged:
//
// - ENSURE is a no-op success: the persistent page always exists.
// - CLOSE terminates the worker (Chromium's closeDocument analog); the next
//   op respawns a fresh generation, which must recover from OPFS.
// - Background-originated writes call the host in-process — a background
//   page cannot runtime-message its own listeners, same rule as the SW.

export const registerSpikeOwnerHostMv2 = (): void => {
  const host = createOwnerHost()
  host.registerRpcListener()
  ;(
    globalThis as {
      __spikeOwnerBgWrite?: (payload: unknown) => Promise<unknown>
    }
  ).__spikeOwnerBgWrite = async (payload: unknown) => {
    try {
      const result = await host.handleOp("upsertCheckpoint", payload)
      return { ok: true, result }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type

    if (type === SPIKE_OWNER_ENSURE) {
      sendResponse({ ok: true })
      return true
    }

    if (type === SPIKE_OWNER_CLOSE) {
      host
        .handleOp("terminateWorker")
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: String(error) })
        )
      return true
    }

    if (type === SPIKE_OWNER_BG_WRITE) {
      host
        .handleOp(
          "upsertCheckpoint",
          (message as { payload?: unknown }).payload
        )
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: String(error) })
        )
      return true
    }

    return false
  })
}
