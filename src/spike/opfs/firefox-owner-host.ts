import { createOwnerHost } from "./owner-host-core"
import {
  SPIKE_OWNER_BG_WRITE,
  SPIKE_OWNER_CLOSE,
  SPIKE_OWNER_ENSURE
} from "./owner-protocol"

/**
 * Register the experimental Firefox MV2 owner. Its persistent background page
 * owns SQLite directly; close terminates the worker and the next operation
 * respawns from OPFS using the same wire semantics as Chromium.
 */
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
