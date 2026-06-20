import type { Tabs } from "webextension-polyfill"
import { browser, supportsOmnibox } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"

type OmniboxApi = {
  setDefaultSuggestion?: (suggestion: { description: string }) => void
  onInputChanged?: {
    addListener: (listener: (text: string) => void) => void
  }
  onInputEntered?: {
    addListener: (
      listener: (
        text: string,
        disposition?: "currentTab" | "newForegroundTab" | "newBackgroundTab"
      ) => void
    ) => void
  }
}

const getOmniboxApi = (): OmniboxApi | undefined =>
  (chrome as unknown as { omnibox?: OmniboxApi }).omnibox

// Cache of the active tab, kept fresh so the omnibox `onInputEntered` listener
// can open the side panel SYNCHRONOUSLY. `chrome.sidePanel.open()` requires an
// active user gesture, which Chrome consumes at the first `await`. Querying the
// tab inside the listener (an async call) would discard the gesture and make
// `open()` throw, falling back to a popup window. So we resolve the window ahead
// of time and refresh it on tab/window focus changes.
let cachedTab: { id?: number; windowId?: number } | undefined

const queryActiveTab = async (): Promise<Tabs.Tab | undefined> => {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  })
  return tab
}

const refreshCachedTab = (): void => {
  void queryActiveTab()
    .then((tab) => {
      if (tab) cachedTab = { id: tab.id, windowId: tab.windowId }
    })
    .catch(() => undefined)
}

export const registerOmniboxQuickAsk = (
  openChatSurface: (tab?: { id?: number; windowId?: number }) => void
): void => {
  if (!supportsOmnibox()) return

  const omnibox = getOmniboxApi()
  if (!omnibox?.onInputEntered) return

  omnibox.setDefaultSuggestion?.({
    description: "Ask Ollama Client"
  })

  // Prime the cache and keep it current. `onInputChanged` fires while the user
  // is still typing the query, so the window is resolved before Enter.
  refreshCachedTab()
  browser.tabs?.onActivated?.addListener(refreshCachedTab)
  browser.windows?.onFocusChanged?.addListener(refreshCachedTab)
  omnibox.onInputChanged?.addListener?.(refreshCachedTab)

  omnibox.onInputEntered.addListener((text, disposition) => {
    const query = text.trim()
    if (!query) return

    // Open synchronously FIRST, before any await, to preserve the user gesture
    // required by sidePanel.open().
    openChatSurface(cachedTab)

    void (async () => {
      await setPlasmoStoredValue(
        STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY,
        query
      )

      // Refresh in the background so the next invocation has a current window.
      refreshCachedTab()

      browser.runtime
        .sendMessage({
          type: MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY,
          payload: query,
          disposition,
          fromBackground: true
        })
        .catch((error) => {
          logger.debug("Could not forward omnibox query to chat", "Omnibox", {
            error
          })
        })
    })().catch((error) => {
      logger.warn("Omnibox quick ask failed", "Omnibox", { error })
    })
  })
}
