import "webextension-polyfill"

import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { initializeContextMenu } from "@/background/handlers/handle-context-menu"
import { handleDeleteModel } from "@/background/handlers/handle-delete-model"
import {
  handleEmbedFileChunks,
  handleEmbedFileChunksPort
} from "@/background/handlers/handle-embed-chunks"
import {
  checkEmbeddingModelExists,
  downloadEmbeddingModelSilently,
  handlePrepareEmbeddingModel
} from "@/background/handlers/handle-embedding-download"
import { handleGetLoadedModels } from "@/background/handlers/handle-get-loaded-model"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { handleGetProviderVersion } from "@/background/handlers/handle-get-provider-version"
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
import {
  DEFAULT_EMBEDDING_MODEL,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { migrateLegacyProviderStorage } from "@/lib/storage/provider-migration"
import type {
  ChatWithModelMessage,
  ChromeMessage,
  ChromePort,
  ChromeSidePanel,
  ModelPullMessage,
  PortStatusFunction
} from "@/types"

const openClientWindow = () => {
  browser.windows.create({
    url: browser.runtime.getURL("sidepanel.html"),
    type: "popup",
    width: 420,
    height: 640
  })
}

const actionAPI =
  browser.action ||
  (browser as unknown as { browserAction?: typeof browser.action })
    .browserAction

void migrateLegacyProviderStorage()

if (isChromiumBased() && "sidePanel" in browser) {
  // Type assertion for Chrome-specific sidePanel API
  const sidePanel = (
    browser as unknown as {
      sidePanel: ChromeSidePanel
    }
  ).sidePanel

  sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: Error) => console.error("SidePanel error:", error))

  // Explicit action handler to avoid browser/version quirks where panel behavior
  // is not applied consistently.
  if (actionAPI) {
    actionAPI.onClicked.addListener((tab) => {
      const windowId = tab.windowId
      if (!windowId) {
        openClientWindow()
        return
      }

      sidePanel
        .open({
          windowId,
          tabId: tab.id
        })
        .catch((error) => {
          console.warn(
            "Failed to open side panel, falling back to popup:",
            error
          )
          openClientWindow()
        })
    })
  }
} else {
  if (actionAPI) {
    actionAPI.onClicked.addListener(() => {
      openClientWindow()
    })
  }
}

if (!isChromiumBased()) {
  console.warn("DNR not available: skipping CORS workaround (likely Firefox)")
}

if (isChromiumBased()) {
  browser.runtime.onInstalled.addListener(async (details) => {
    updateDNRRules()
    initializeContextMenu()

    // Auto-download embedding model on first install
    if (details.reason === "install") {
      console.log("Extension installed - downloading embedding model...")

      // Check if already downloaded
      const alreadyDownloaded = await plasmoGlobalStorage.get<boolean>(
        STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED
      )

      if (!alreadyDownloaded) {
        // Try to download embedding model in background
        downloadEmbeddingModelSilently(DEFAULT_EMBEDDING_MODEL)
          .then((result) => {
            if (result.success) {
              console.log(
                `✅ Successfully downloaded embedding model: ${DEFAULT_EMBEDDING_MODEL}`
              )
            } else {
              console.warn(
                `⚠️ Failed to auto-download embedding model: ${result.error}`
              )
            }
          })
          .catch((error) => {
            console.error("Error during embedding model download:", error)
          })
      }
    }
  })

  browser.runtime.onStartup.addListener(() => updateDNRRules())
}

// Note: Content scripts are registered from src/entrypoints/content.ts and
// src/entrypoints/selection-button.content.tsx

browser.runtime.onConnect.addListener((port: ChromePort) => {
  let isPortClosed = false

  const getPortStatus: PortStatusFunction = () => isPortClosed

  port.onDisconnect.addListener(() => {
    isPortClosed = true
    abortAndClearController(port.name)
  })

  port.onMessage.addListener(async (msg: ChromeMessage) => {
    if (
      msg.type === MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL ||
      msg.type === MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL
    ) {
      await handleChatWithModel(
        msg as ChatWithModelMessage,
        port,
        getPortStatus
      )
    }

    if (
      msg.type === MESSAGE_KEYS.PROVIDER.STOP_GENERATION ||
      msg.type === MESSAGE_KEYS.OLLAMA.STOP_GENERATION
    ) {
      console.log("Stop generation requested")
      abortAndClearController(port.name) // Reset the controller
    }
  })

  if (
    port.name === MESSAGE_KEYS.PROVIDER.PULL_MODEL ||
    port.name === MESSAGE_KEYS.OLLAMA.PULL_MODEL
  ) {
    port.onMessage.addListener(async (msg: ChromeMessage) => {
      await handleModelPull(msg as ModelPullMessage, port, getPortStatus)
    })
  }

  if (
    port.name === MESSAGE_KEYS.PROVIDER.EMBED_FILE_CHUNKS ||
    port.name === MESSAGE_KEYS.OLLAMA.EMBED_FILE_CHUNKS
  ) {
    // Use streaming port handler to receive chunk batches and send progress back
    try {
      handleEmbedFileChunksPort(port)
    } catch (err) {
      console.error("Error attaching embed chunks port handler:", err)
      try {
        port.postMessage({
          status: "error",
          message: err instanceof Error ? err.message : String(err)
        } as unknown as ChromeMessage)
      } catch (_) {}
      port.disconnect()
    }
  }
})

// Handle one-time message requests
browser.runtime.onMessage.addListener(
  (message: ChromeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case MESSAGE_KEYS.PROVIDER.GET_MODELS:
      case MESSAGE_KEYS.OLLAMA.GET_MODELS: {
        handleGetModels(sendResponse)
        return true
      }

      case MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS:
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

      case MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL:
      case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL: {
        if (message.query && typeof message.query === "string") {
          handleScrapeModel(message.query, sendResponse)
          return true
        }
        break
      }

      case MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL_VARIANTS:
      case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS: {
        if (message.name && typeof message.name === "string") {
          handleScrapeModelVariants(message.name, sendResponse)
          return true
        }
        break
      }

      case MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL:
      case MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL: {
        if (typeof message.payload === "string")
          handleUpdateBaseUrl(message.payload, sendResponse)
        return true
      }

      case MESSAGE_KEYS.PROVIDER.GET_LOADED_MODELS:
      case MESSAGE_KEYS.OLLAMA.GET_LOADED_MODELS: {
        handleGetLoadedModels(sendResponse)
        return true
      }

      case MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL:
      case MESSAGE_KEYS.OLLAMA.UNLOAD_MODEL: {
        if (typeof message.payload === "string") {
          handleUnloadModel(message.payload, sendResponse)
        }
        return true
      }

      case MESSAGE_KEYS.PROVIDER.DELETE_MODEL:
      case MESSAGE_KEYS.OLLAMA.DELETE_MODEL: {
        if (typeof message.payload === "string") {
          handleDeleteModel(message.payload, sendResponse)
        }
        return true
      }

      case MESSAGE_KEYS.PROVIDER.GET_PROVIDER_VERSION:
      case MESSAGE_KEYS.OLLAMA.GET_OLLAMA_VERSION: {
        handleGetProviderVersion(sendResponse)
        return true
      }

      case MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL:
      case MESSAGE_KEYS.OLLAMA.CHECK_EMBEDDING_MODEL: {
        if (typeof message.payload === "string") {
          // Handle async operation separately to maintain correct return type
          checkEmbeddingModelExists(message.payload as string)
            .then((result) => {
              safeSendResponse(sendResponse, {
                success: true,
                data: result
              })
            })
            .catch((error) => {
              safeSendResponse(sendResponse, {
                success: false,
                error: {
                  status: 0,
                  message:
                    error instanceof Error ? error.message : String(error)
                }
              })
            })
        }
        return true
      }

      case MESSAGE_KEYS.PROVIDER.PREPARE_EMBEDDING_MODEL:
      case MESSAGE_KEYS.OLLAMA.PREPARE_EMBEDDING_MODEL: {
        handlePrepareEmbeddingModel(message.payload, sendResponse)
        return true
      }

      case MESSAGE_KEYS.PROVIDER.EMBED_FILE_CHUNKS:
      case MESSAGE_KEYS.OLLAMA.EMBED_FILE_CHUNKS: {
        handleEmbedFileChunks(message, sendResponse).catch((err) => {
          safeSendResponse(sendResponse, {
            success: false,
            error: {
              status: 0,
              message: err instanceof Error ? err.message : String(err)
            }
          })
        })
        return true
      }

      case MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT: {
        // Open sidepanel if possible (Chrome specific)
        if (isChromiumBased() && "sidePanel" in browser) {
          const sidePanel = (
            browser as unknown as { sidePanel: ChromeSidePanel }
          ).sidePanel
          const windowId = _sender.tab?.windowId
          if (windowId && sidePanel.open) {
            sidePanel.open({ windowId }).catch((err: unknown) => {
              console.error(
                "Failed to open sidepanel:",
                err instanceof Error ? err.message : String(err)
              )
            })
          }
        }

        setTimeout(() => {
          if ((message as ChromeMessage).fromBackground) return

          browser.runtime
            .sendMessage({
              ...message,
              fromBackground: true
            })
            .catch((err) => {
              console.log(
                "Could not forward selection to chat (sidepanel might be closed):",
                err
              )
            })
        }, 500)

        return true
      }
    }
  }
)
