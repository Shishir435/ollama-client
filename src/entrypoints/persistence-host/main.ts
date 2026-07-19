import { registerPersistenceHost } from "@/lib/persistence/owner-host"

// Chromium offscreen document: the production chat-database owner. Created
// only by the background service worker (see chromium-owner.ts). The page is
// reachable as a normal tab by URL, and a tab must never become a second
// owner — the opfs-sahpool VFS is single-instance, and a competing host
// would race RPC responses. Register only when this document is the real
// offscreen context.

const isOffscreenContext = async (): Promise<boolean> => {
  try {
    const getContexts = (
      chrome.runtime as unknown as {
        getContexts?: (filter: {
          contextTypes: string[]
        }) => Promise<{ documentUrl?: string }[]>
      }
    ).getContexts
    if (!getContexts) return false
    const contexts = await getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    })
    return contexts.some(
      (context) => context.documentUrl === window.location.href
    )
  } catch {
    return false
  }
}

void isOffscreenContext().then((offscreen) => {
  if (offscreen) {
    registerPersistenceHost()
    return
  }
  document.body.textContent =
    "This is an internal page of the extension; it has no user-facing content."
})
