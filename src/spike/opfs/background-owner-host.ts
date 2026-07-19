import {
  SPIKE_OWNER_BG_WRITE,
  SPIKE_OWNER_CLOSE,
  SPIKE_OWNER_ENSURE,
  SPIKE_OWNER_RPC
} from "./owner-protocol"

// Section 9.4 spike phase 2: background side of the single-owner topology.
// The service worker never opens the database; it only guarantees that the
// offscreen owner document exists and can issue writes through it while all
// visible extension pages are closed (gate 3). Registered from
// src/background/index.ts behind a dev-only build flag.

const OFFSCREEN_URL = "spike-owner-offscreen.html"

let creating: Promise<void> | null = null

const hasOwnerDocument = async (): Promise<boolean> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType]
  })
  // Chrome has one offscreen-document slot per extension; another feature
  // could own it. Only a document actually hosting the owner page counts —
  // anything else must surface as a conflict, not a silent RPC timeout.
  const ownerExists = contexts.some((context) =>
    (context as { documentUrl?: string }).documentUrl?.endsWith(
      `/${OFFSCREEN_URL}`
    )
  )
  if (!ownerExists && contexts.length > 0) {
    throw new Error(
      "Offscreen document slot is occupied by another page; cannot host the SQLite owner"
    )
  }
  return ownerExists
}

const ensureOwner = async (): Promise<void> => {
  if (await hasOwnerDocument()) return
  // Chrome allows one offscreen document per extension and rejects concurrent
  // createDocument calls, so creation is serialized behind one promise.
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS" as chrome.offscreen.Reason],
        justification:
          "Development spike: hosts the single SQLite OPFS owner worker"
      })
      .catch((error: unknown) => {
        // A concurrent path may have created it already.
        if (!String(error).includes("Only a single offscreen")) throw error
      })
      .finally(() => {
        creating = null
      })
  }
  await creating
}

// Gate 3: a durable write initiated by background code itself while no
// extension page is open. This is a direct function (also exposed on
// globalThis for the gate runner) because chrome.runtime.sendMessage never
// delivers to the sender's own context — background code cannot message
// itself, it calls the owner client directly.
const backgroundWrite = async (payload: unknown): Promise<unknown> => {
  await ensureOwner()
  return chrome.runtime.sendMessage({
    type: SPIKE_OWNER_RPC,
    op: "upsertCheckpoint",
    payload
  })
}

export const registerSpikeOwnerHost = (): void => {
  ;(
    globalThis as {
      __spikeOwnerBgWrite?: (payload: unknown) => Promise<unknown>
    }
  ).__spikeOwnerBgWrite = backgroundWrite

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type

    if (type === SPIKE_OWNER_ENSURE) {
      ensureOwner()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: String(error) })
        )
      return true
    }

    if (type === SPIKE_OWNER_CLOSE) {
      chrome.offscreen
        .closeDocument()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: String(error) })
        )
      return true
    }

    if (type === SPIKE_OWNER_BG_WRITE) {
      // Same write, reachable from extension pages via messaging.
      backgroundWrite((message as { payload?: unknown }).payload)
        .then((response) => sendResponse(response))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: String(error) })
        )
      return true
    }

    return false
  })
}
