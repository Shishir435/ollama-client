import { logger } from "@/lib/logger"
import { PERSISTENCE_ENSURE } from "./protocol"

// Chromium control plane for the persistence owner. The background service
// worker never opens the database itself: it guarantees that the offscreen
// owner document exists (for its own calls and on behalf of extension pages,
// which cannot create offscreen documents).

const OFFSCREEN_URL = "persistence-host.html"

let creating: Promise<void> | null = null

const hasOwnerDocument = async (): Promise<boolean> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType]
  })
  const ownerExists = contexts.some((context) =>
    (context as { documentUrl?: string }).documentUrl?.endsWith(
      `/${OFFSCREEN_URL}`
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
    if ((message as { type?: string } | undefined)?.type !== PERSISTENCE_ENSURE)
      return false
    ensurePersistenceOwner()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: String(error) })
      )
    return true
  })

  // Create the owner eagerly so the one-time legacy migration runs at boot,
  // not on the first user interaction.
  void ensurePersistenceOwner().catch((error) => {
    logger.error("Failed to start persistence owner", "Persistence", { error })
  })
}
