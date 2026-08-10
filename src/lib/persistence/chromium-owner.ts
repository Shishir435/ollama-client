import type { RuntimeSenderLike } from "@ollama-client/runtime-core/runtime-sender"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  isPersistenceOwnerSender,
  isTrustedPersistenceSender
} from "./host-authorization"
import {
  PERSISTENCE_ENSURE,
  PERSISTENCE_MARKER,
  PERSISTENCE_RPC,
  PersistenceEnsureRequestSchema,
  PersistenceRpcResponseSchema,
  PersistenceStateRequestSchema,
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

/**
 * Chromium control plane for the persistence owner. The background service
 * worker never opens the database itself: it guarantees that the offscreen
 * owner document exists (for its own calls and on behalf of extension pages,
 * which cannot create offscreen documents).
 */

const OFFSCREEN_PATH = "persistence-host.html"
/**
 * The owner=1 parameter is the host page's registration guard: only the
 * document the background creates carries it, so a user-opened tab of the
 * same page never becomes a second owner.
 */
const OFFSCREEN_URL = `${OFFSCREEN_PATH}?owner=1`

/**
 * How long a caller waits for a freshly created owner to answer, and how the
 * wait is spaced. `createDocument()` resolves before the host page has
 * evaluated its script, so the first pings land on a document with no
 * listener and reject with "receiving end does not exist". That is a normal
 * cold start, not a failure, and the only way to tell the two apart is to
 * keep asking until the deadline.
 */
const OWNER_READY_TIMEOUT_MS = 15_000
const OWNER_PING_FIRST_DELAY_MS = 25
const OWNER_PING_MAX_DELAY_MS = 400

/**
 * Cap on one accepted-but-unanswered ping.
 *
 * The retry deadline above only bounds attempts that *fail*. A host whose
 * listener accepted the message and never called `sendResponse` — a worker that
 * died between spawn and first message, a migration wedged on a lock — leaves
 * the send pending forever, and readiness with it, taking every database
 * startup task with it. Same 30s the persistence client applies to every other
 * request: a host that cannot answer a ping inside it cannot serve a query
 * either. Failing here is recoverable — the rejection is not cached, so the
 * next caller re-pings and a migration that has since finished answers.
 */
const OWNER_PING_TIMEOUT_MS = 30_000

let creating: Promise<void> | null = null
let ownerReady: Promise<void> | null = null
let ownerProven = false

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

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

/**
 * Guarantee the owner document exists. Resolves true when this call — or the
 * concurrent call it coalesced with — had to create it, which tells the caller
 * it is looking at a fresh owner instance whose readiness nobody has proven.
 */
const ensureOwnerDocument = async (): Promise<boolean> => {
  if (await hasOwnerDocument()) return false
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
  return true
}

/**
 * One ping, bounded. Resolves with whatever the host answered; rejects when the
 * send fails or when an accepted send never settles.
 */
const pingOnce = async (): Promise<unknown> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      chrome.runtime.sendMessage({
        type: PERSISTENCE_RPC,
        request: { op: "ping" }
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("owner accepted the ping and never answered it")),
          OWNER_PING_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ask the owner to answer one `ping`, retrying until it does or the deadline
 * passes.
 *
 * The retry loop exists for the gap between `createDocument()` resolving and
 * the host page evaluating its script: until the listener is registered,
 * `sendMessage` rejects with "receiving end does not exist". That is a normal
 * cold start, not a failure. A host that *accepts* the message keeps the send
 * pending while it works, so one slow first-boot migration is one slow attempt
 * rather than a retry storm — but only up to `OWNER_PING_TIMEOUT_MS`, because
 * a send that never settles would otherwise outlive this deadline entirely.
 */
const pingOwner = async (): Promise<void> => {
  const deadline = Date.now() + OWNER_READY_TIMEOUT_MS
  let wait = OWNER_PING_FIRST_DELAY_MS
  let lastError = "no response"
  for (;;) {
    try {
      const parsed = PersistenceRpcResponseSchema.safeParse(await pingOnce())
      if (!parsed.success) {
        lastError = "owner returned an invalid response"
      } else if (parsed.data.ok) {
        return
      } else {
        lastError = parsed.data.error
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() >= deadline) break
    await delay(wait)
    wait = Math.min(wait * 2, OWNER_PING_MAX_DELAY_MS)
  }
  throw new Error(`Persistence owner is not ready: ${lastError}`)
}

/**
 * Guarantee an owner that can actually serve a request.
 *
 * `createDocument()` completing is not readiness: it says a document exists,
 * not that its listener, its worker, the SQLite WASM binary, or the backend
 * choice are up. Callers that skipped the handshake raced a cold owner and
 * saw their first query reject on a page that was about to work.
 *
 * The proof is cached, so this costs one extra round trip per owner instance
 * and nothing afterwards. A rejection is not cached — a later caller retries
 * rather than inheriting a failure from a boot that has since been fixed.
 */
export const ensurePersistenceOwnerReady = async (): Promise<void> => {
  const provenBy = ownerReady
  if (ownerProven) {
    // The offscreen document can be torn down under us, and a proof of the
    // instance that is gone says nothing about the one that replaces it.
    if (await hasOwnerDocument()) return
    if (ownerReady === provenBy) {
      ownerProven = false
      ownerReady = null
    }
  }
  if (!ownerReady) {
    ownerReady = (async () => {
      await ensureOwnerDocument()
      await pingOwner()
      ownerProven = true
    })().catch((error: unknown) => {
      ownerReady = null
      throw error
    })
  }
  await ownerReady
}

/** Register on Chromium background startup: pages ask the service worker to
 * ensure the owner exists; the SW's own database calls use the globalThis
 * ensure hook (a service worker cannot runtime-message itself). */
export const handleChromiumPersistenceControlMessage = (
  message: unknown,
  sender: RuntimeSenderLike,
  sendResponse: (response: unknown) => void
): boolean => {
  const extensionUrlPrefix = chrome.runtime.getURL("")
  const ownerUrl = chrome.runtime.getURL(OFFSCREEN_URL)
  const type = (message as { type?: string } | undefined)?.type
  if (type === PERSISTENCE_ENSURE) {
    if (
      !isTrustedPersistenceSender(
        sender,
        chrome.runtime.id,
        extensionUrlPrefix
      ) ||
      !PersistenceEnsureRequestSchema.safeParse(message).success
    ) {
      sendResponse({ ok: false, error: "Persistence request forbidden" })
      return true
    }
    // Extension pages cannot create the offscreen document, so this is where
    // their cold start waits — answering before the owner can serve would just
    // move the failure into their first query.
    ensurePersistenceOwnerReady()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: String(error) })
      )
    return true
  }
  if (type === PERSISTENCE_MARKER) {
    if (
      !isPersistenceOwnerSender(
        sender,
        chrome.runtime.id,
        extensionUrlPrefix,
        ownerUrl
      )
    ) {
      sendResponse({ ok: false, error: "Persistence marker forbidden" })
      return true
    }
    const parsed = PersistenceStateRequestSchema.safeParse(message)
    if (!parsed.success) {
      sendResponse({ ok: false, error: "Invalid persistence marker request" })
      return true
    }
    // The offscreen owner has no chrome.storage; read/write the backend marker,
    // migration receipt, and operator override on its behalf.
    const request = parsed.data
    const key = STORAGE_KEY_BY_SCOPE[request.scope]
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
}

/**
 * Register the control plane. Bringing the owner up is deliberately not done
 * here: the background composition root owns that promise, because startup
 * tasks have to await the same readiness this registration would otherwise
 * kick off and forget.
 */
export const registerChromiumPersistenceControl = (): void => {
  globalThis.__persistenceEnsureOwner = ensurePersistenceOwnerReady

  chrome.runtime.onMessage.addListener(handleChromiumPersistenceControlMessage)
}
