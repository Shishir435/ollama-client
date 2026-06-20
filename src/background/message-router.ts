import { handleDeleteModel } from "@/background/handlers/handle-delete-model"
import { handleEmbedFileChunks } from "@/background/handlers/handle-embed-chunks"
import {
  checkEmbeddingModelExists,
  handlePrepareEmbeddingModel
} from "@/background/handlers/handle-embedding-download"
import { handleGetLoadedModels } from "@/background/handlers/handle-get-loaded-model"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { handleGetProviderVersion } from "@/background/handlers/handle-get-provider-version"
import { handleScrapeModel } from "@/background/handlers/handle-scrape-model"
import { handleScrapeModelVariants } from "@/background/handlers/handle-scrape-model-variants"
import { handleShowModelDetails } from "@/background/handlers/handle-show-model-details"
import { handleUnloadModel } from "@/background/handlers/handle-unload-model"
import { handleUpdateBaseUrl } from "@/background/handlers/handle-update-base-url"
import { handleWarmupModel } from "@/background/handlers/handle-warmup-model"
import {
  parseModelRef,
  parseProviderIdPayload,
  parseStringPayload
} from "@/background/lib/message-payloads"
import { postSelectionToSidePanels } from "@/background/lib/selection-bridge"
import { safeSendResponse } from "@/background/lib/utils"
import { browser, isChromiumBased } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import type {
  ChromeMessage,
  ChromeSidePanel,
  SendResponseFunction
} from "@/types"

const respondInvalidPayload = (sendResponse: SendResponseFunction) =>
  safeSendResponse(sendResponse, {
    success: false,
    error: { status: 400, message: "Invalid message payload" }
  })

const openSidePanelForSelection = (tab?: {
  windowId?: number
  id?: number
}) => {
  if (!isChromiumBased() || !("sidePanel" in browser)) return

  const sidePanel = (browser as unknown as { sidePanel: ChromeSidePanel })
    .sidePanel
  const windowId = tab?.windowId
  const tabId = tab?.id
  if (!windowId || !sidePanel.open) return

  sidePanel.open({ windowId, tabId }).catch((err: unknown) => {
    logger.error("Failed to open sidepanel", "BackgroundSW", {
      error: err instanceof Error ? err.message : String(err)
    })
  })
}

const handleSelectionMessage = (
  message: ChromeMessage,
  tab: { windowId?: number; id?: number } | undefined,
  sendResponse: SendResponseFunction
): true => {
  if (message.fromBackground) {
    safeSendResponse(sendResponse, { success: true })
    return true
  }

  const selectionText =
    typeof message.payload === "string" ? message.payload.trim() : ""

  if (!selectionText) {
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 400,
        message: "Selection text is required"
      }
    })
    return true
  }

  const pendingSelectionWrite = setPlasmoStoredValue(
    STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
    selectionText
  )

  openSidePanelForSelection(tab)

  pendingSelectionWrite
    .then(() => {
      safeSendResponse(sendResponse, { success: true })
      postSelectionToSidePanels(selectionText)

      setTimeout(() => {
        postSelectionToSidePanels(selectionText)
        browser.runtime
          .sendMessage({
            type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
            payload: selectionText,
            fromBackground: true
          })
          .catch((err) => {
            logger.debug(
              "Could not forward selection to chat (sidepanel might be closed)",
              "BackgroundSW",
              { error: err }
            )
          })
      }, 500)
    })
    .catch((error) => {
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 0,
          message: getErrorMessage(error)
        }
      })
    })

  return true
}

export const registerMessageRouter = () => {
  browser.runtime.onMessage.addListener(
    (rawMessage, sender, sendResponse): true | undefined => {
      const response = sendResponse as SendResponseFunction
      const message = rawMessage as ChromeMessage

      switch (message.type) {
        case MESSAGE_KEYS.PROVIDER.GET_MODELS:
        case MESSAGE_KEYS.OLLAMA.GET_MODELS: {
          handleGetModels(response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS: {
          const ref = parseModelRef(message.payload)
          if (ref) handleShowModelDetails(ref, response)
          return true
        }

        case MESSAGE_KEYS.BROWSER.OPEN_TAB: {
          browser.tabs
            .query({})
            .then((tabs) => {
              logger.info("Queried browser tabs", "BackgroundSW", {
                tabCount: tabs.length
              })
              safeSendResponse(response, { success: true, tabs })
            })
            .catch((error: unknown) => {
              logger.error("Failed to query browser tabs", "BackgroundSW", {
                error
              })
              safeSendResponse(response, {
                success: false,
                error: {
                  status: 0,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Failed to query tabs"
                }
              })
            })
          return true
        }

        case MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL:
        case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL: {
          const query = parseStringPayload(message.query)
          if (query) {
            handleScrapeModel(query, response)
            return true
          }
          break
        }

        case MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL_VARIANTS:
        case MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS: {
          const name = parseStringPayload(message.name)
          if (name) {
            handleScrapeModelVariants(name, response)
            return true
          }
          break
        }

        case MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL:
        case MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL: {
          const baseUrl = parseStringPayload(message.payload)
          if (baseUrl) handleUpdateBaseUrl(baseUrl, response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.GET_LOADED_MODELS:
        case MESSAGE_KEYS.OLLAMA.GET_LOADED_MODELS: {
          handleGetLoadedModels(
            parseProviderIdPayload(message.payload),
            response
          )
          return true
        }

        case MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL: {
          const ref = parseModelRef(message.payload)
          if (ref) handleUnloadModel(ref, response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.WARMUP_MODEL: {
          const ref = parseModelRef(message.payload)
          if (ref) handleWarmupModel(ref, response)
          else respondInvalidPayload(response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.DELETE_MODEL: {
          const modelName = parseStringPayload(message.payload)
          if (modelName) handleDeleteModel(modelName, response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.GET_PROVIDER_VERSION:
        case MESSAGE_KEYS.OLLAMA.GET_OLLAMA_VERSION: {
          handleGetProviderVersion(response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL: {
          const ref = parseModelRef(message.payload)

          if (!ref) {
            safeSendResponse(response, {
              success: false,
              error: { status: 400, message: "Invalid embedding model request" }
            })
            return true
          }

          checkEmbeddingModelExists(ref.model, ref.providerId)
            .then((result) => {
              safeSendResponse(response, {
                success: true,
                data: result
              })
            })
            .catch((error) => {
              safeSendResponse(response, {
                success: false,
                error: {
                  status: 0,
                  message: getErrorMessage(error)
                }
              })
            })
          return true
        }

        case MESSAGE_KEYS.PROVIDER.PREPARE_EMBEDDING_MODEL: {
          handlePrepareEmbeddingModel(message.payload, response)
          return true
        }

        case MESSAGE_KEYS.PROVIDER.EMBED_FILE_CHUNKS: {
          handleEmbedFileChunks(message, response).catch((err) => {
            safeSendResponse(response, {
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
          return handleSelectionMessage(message, sender.tab, response)
        }
      }
    }
  )
}
