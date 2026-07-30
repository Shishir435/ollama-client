import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  PERSISTENCE_ENSURE,
  PERSISTENCE_MARKER,
  type PersistenceStateRequest,
  type PersistenceStateScope
} from "./protocol"

const STORAGE_KEY_BY_SCOPE: Record<PersistenceStateScope, string> = {
  backend: STORAGE_KEYS.PERSISTENCE.BACKEND,
  receipt: STORAGE_KEYS.PERSISTENCE.MIGRATION_RECEIPT,
  override: STORAGE_KEYS.PERSISTENCE.LEGACY_OVERRIDE
}

/**
 * Fill in the extension version on a receipt the offscreen owner wrote.
 *
 * `runtime.getManifest()` does not answer in the offscreen document — receipts
 * written there recorded "unknown" through both the polyfill and the `chrome`
 * alias. The service worker can read it, and it is already handling the write.
 */
const stampExtensionVersion = (
  scope: PersistenceStateScope,
  value: unknown
): unknown => {
  if (scope !== "receipt" || typeof value !== "object" || value === null) {
    return value
  }
  const receipt = value as { extensionVersion?: string }
  if (receipt.extensionVersion && receipt.extensionVersion !== "unknown") {
    return value
  }
  try {
    return {
      ...receipt,
      extensionVersion: chrome.runtime.getManifest().version
    }
  } catch {
    return value
  }
}

// Chromium control plane for the persistence owner. The background service
// worker never opens the database itself: it guarantees that the offscreen
// owner document exists (for its own calls and on behalf of extension pages,
// which cannot create offscreen documents).

const OFFSCREEN_PATH = "persistence-host.html"
// The owner=1 parameter is the host page's registration guard: only the
// document the background creates carries it, so a user-opened tab of the
// same page never becomes a second owner.
const OFFSCREEN_URL = `${OFFSCREEN_PATH}?owner=1`

let creating: Promise<void> | null = null

const hasOwnerDocument = async (): Promise<boolean> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType]
  })
  const ownerExists = contexts.some((context) =>
    (context as { documentUrl?: string }).documentUrl?.includes(
      `/${OFFSCREEN_PATH}`
    )
  )
  if (!ownerExists && contexts.length > 0) {
    // Chrome has one offscreen slot per extension. Anything else occupying
    // it must surface as an explicit conflict, not a silent RPC timeout.
    throw new Error(
      "Offscreen document slot is occupied by another page; cannot host the chat database owner"
    )
  }
  return ownerExists
}

export const ensurePersistenceOwner = async (): Promise<void> => {
  if (await hasOwnerDocument()) return
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["WORKERS" as chrome.offscreen.Reason],
        justification:
          "Hosts the single SQLite worker that owns durable chat history"
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

/** Register on Chromium background startup: pages ask the service worker to
 * ensure the owner exists; the SW's own database calls use the globalThis
 * ensure hook (a service worker cannot runtime-message itself). */
export const registerChromiumPersistenceControl = (): void => {
  globalThis.__persistenceEnsureOwner = ensurePersistenceOwner

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type
    if (type === PERSISTENCE_ENSURE) {
      ensurePersistenceOwner()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: String(error) })
        )
      return true
    }
    if (type === PERSISTENCE_MARKER) {
      // The offscreen owner has no chrome.storage; read/write the backend
      // marker, migration receipt, and operator override on its behalf.
      const request = message as PersistenceStateRequest
      const key = STORAGE_KEY_BY_SCOPE[request.scope]
      if (!key) {
        sendResponse({
          ok: false,
          error: `Unknown persistence state scope: ${String(request.scope)}`
        })
        return true
      }
      ;(async () => {
        if (request.action === "get") {
          const stored = await chrome.storage.local.get(key)
          sendResponse({ ok: true, value: stored[key] })
          return
        }
        await chrome.storage.local.set({
          [key]: stampExtensionVersion(request.scope, request.value)
        })
        sendResponse({ ok: true })
      })().catch((error: unknown) =>
        sendResponse({ ok: false, error: String(error) })
      )
      return true
    }
    return false
  })

  // Create the owner eagerly so the one-time legacy migration runs at boot,
  // not on the first user interaction.
  void ensurePersistenceOwner().catch((error) => {
    logger.error("Failed to start persistence owner", "Persistence", { error })
  })
}
