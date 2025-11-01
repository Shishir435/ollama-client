import "webextension-polyfill"

import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { handleDeleteModel } from "@/background/handlers/handle-delete-model"
import { handleGetLoadedModels } from "@/background/handlers/handle-get-loaded-model"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { handleGetOllamaVersion } from "@/background/handlers/handle-get-ollama-version"
import { handleModelPull } from "@/background/handlers/handle-model-pull"
import { handleScrapeModel } from "@/background/handlers/handle-scrape-model"
import { handleScrapeModelVariants } from "@/background/handlers/handle-scrape-model-variants"
import { handleShowModelDetails } from "@/background/handlers/handle-show-model-details"
import { handleUnloadModel } from "@/background/handlers/handle-unload-model"
import { handleUpdateBaseUrl } from "@/background/handlers/handle-update-base-url"
import { abortAndClearController } from "@/background/lib/abort-controller-registry"
import { updateDNRRules } from "@/background/lib/dnr"
import { safeSendResponse } from "@/background/lib/utils"
import { browser, isChromiumBased } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type {
  ChatWithModelMessage,
  ChromeMessage,
  ChromePort,
  ModelPullMessage,
  PortStatusFunction
} from "@/types"

const openOllamaClient = () => {
  browser.windows.create({
    url: browser.runtime.getURL("sidepanel.html"),
    type: "popup",
    width: 420,
    height: 640
  })
}

if (isChromiumBased() && "sidePanel" in browser) {
  // Type assertion for Chrome-specific sidePanel API
  ;(
    browser as unknown as {
      sidePanel: {
        setPanelBehavior: (options: {
          openPanelOnActionClick: boolean
        }) => Promise<void>
      }
    }
  ).sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: Error) => console.error("SidePanel error:", error))
} else {
  // Firefox uses browserAction, Chrome uses action (polyfill handles both)
  const actionAPI =
    browser.action ||
    (browser as unknown as { browserAction?: typeof browser.action })
      .browserAction
  if (actionAPI) {
    actionAPI.onClicked.addListener(() => {
      openOllamaClient()
    })
  }
}

if (!isChromiumBased()) {
  console.warn("DNR not available: skipping CORS workaround (likely Firefox)")
}

if (isChromiumBased()) {
  browser.runtime.onInstalled.addListener(() => updateDNRRules())
  browser.runtime.onStartup.addListener(() => updateDNRRules())
}

browser.runtime.onConnect.addListener((port: ChromePort) => {
  let isPortClosed = false

  const getPortStatus: PortStatusFunction = () => isPortClosed

  port.onDisconnect.addListener(() => {
    isPortClosed = true
    abortAndClearController(port.name)
  })

  port.onMessage.addListener(async (msg: ChromeMessage) => {
    if (msg.type === MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL) {
      await handleChatWithModel(
        msg as ChatWithModelMessage,
        port,
        getPortStatus
      )
    }

    if (msg.type === MESSAGE_KEYS.OLLAMA.STOP_GENERATION) {
      console.log("Stop generation requested")
      abortAndClearController(port.name) // Reset the controller
    }
  })

  if (port.name === MESSAGE_KEYS.OLLAMA.PULL_MODEL) {
    port.onMessage.addListener(async (msg: ChromeMessage) => {
      await handleModelPull(msg as ModelPullMessage, port, getPortStatus)
    })
  }
})

// Handle one-time message requests
browser.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case MESSAGE_KEYS.OLLAMA.GET_MODELS: {
        handleGetModels(sendResponse)
        return true
      }

      case MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS: {
        if (typeof message.payload === "string") {
          handleShowModelDetails(message.payload, sendResponse)
        }
        return true
      }

      case MESSAGE_KEYS.BROWSER.OPEN_TAB: {
        browser.tabs.query({}).then((tabs) => {
          console.log(tabs)
          safeSendResponse(sendResponse, { success: true, tabs })
        })
        return true
      }

      case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL: {
        if (message.query && typeof message.query === "string") {
          handleScrapeModel(message.query, sendResponse)
          return true
        }
        break
      }

      case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS: {
        if (message.name && typeof message.name === "string") {
          handleScrapeModelVariants(message.name, sendResponse)
          return true
        }
        break
      }

      case MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL: {
        if (typeof message.payload === "string")
          handleUpdateBaseUrl(message.payload, sendResponse)
        return true
      }

      case MESSAGE_KEYS.OLLAMA.GET_LOADED_MODELS: {
        handleGetLoadedModels(sendResponse)
        return true
      }

      case MESSAGE_KEYS.OLLAMA.UNLOAD_MODEL: {
        if (typeof message.payload === "string") {
          handleUnloadModel(message.payload, sendResponse)
        }
        return true
      }

      case MESSAGE_KEYS.OLLAMA.DELETE_MODEL: {
        if (typeof message.payload === "string") {
          handleDeleteModel(message.payload, sendResponse)
        }
        return true
      }

      case MESSAGE_KEYS.OLLAMA.GET_OLLAMA_VERSION: {
        handleGetOllamaVersion(sendResponse)
        return true
      }
    }
  }
)
