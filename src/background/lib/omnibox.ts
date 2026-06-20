import type { Tabs } from "webextension-polyfill"
import { browser, supportsOmnibox } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"

type OmniboxApi = {
  setDefaultSuggestion?: (suggestion: { description: string }) => void
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

const getActiveTab = async (): Promise<Tabs.Tab | undefined> => {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  })
  return tab
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

  omnibox.onInputEntered.addListener((text, disposition) => {
    const query = text.trim()
    if (!query) return

    void (async () => {
      await setPlasmoStoredValue(
        STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY,
        query
      )

      const tab = await getActiveTab().catch(() => undefined)
      openChatSurface(tab)

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
