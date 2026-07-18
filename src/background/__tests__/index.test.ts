import { beforeEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  RPC_CANCEL_MESSAGE_TYPE,
  RPC_REQUEST_MESSAGE_TYPE
} from "@/protocol/rpc"

// Mock browser API
const listeners = {
  onConnect: [] as any[],
  onMessage: [] as any[],
  onInstalled: [] as any[],
  onStartup: [] as any[]
}

const mockBrowser = {
  runtime: {
    id: "test-extension-id",
    onConnect: {
      addListener: vi.fn((fn) => listeners.onConnect.push(fn))
    },
    onMessage: {
      addListener: vi.fn((fn) => listeners.onMessage.push(fn))
    },
    onInstalled: {
      addListener: vi.fn((fn) => listeners.onInstalled.push(fn))
    },
    onStartup: {
      addListener: vi.fn((fn) => listeners.onStartup.push(fn))
    },
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
  },
  windows: {
    create: vi.fn()
  },
  action: {
    onClicked: {
      addListener: vi.fn()
    }
  }
}

const extensionSender = {
  id: "test-extension-id",
  url: "chrome-extension://test/sidepanel.html"
}

const contentScriptSender = {
  id: "test-extension-id",
  tab: { id: 42 },
  url: "https://example.com/page"
}

vi.mock("@/lib/browser-api", () => ({
  browser: mockBrowser,
  isChromiumBased: vi.fn().mockReturnValue(true),
  supportsAlarms: vi.fn().mockReturnValue(false),
  supportsOmnibox: vi.fn().mockReturnValue(false)
}))

// Mock Handlers
vi.mock("@/background/handlers/handle-chat-with-model", () => ({
  handleChatWithModel: vi.fn()
}))
vi.mock("@/background/handlers/handle-context-menu", () => ({
  initializeContextMenu: vi.fn()
}))
vi.mock("@/background/handlers/handle-delete-model", () => ({
  handleDeleteModel: vi.fn()
}))
vi.mock("@/background/handlers/handle-embedding-download", () => ({
  checkEmbeddingModelExists: vi.fn().mockResolvedValue(true),
  downloadEmbeddingModelSilently: vi.fn().mockResolvedValue({ success: true })
}))
vi.mock("@/background/handlers/handle-get-loaded-model", () => ({
  handleGetLoadedModels: vi.fn()
}))
vi.mock("@/background/handlers/handle-get-models", () => ({
  handleGetModels: vi.fn()
}))
vi.mock("@/background/handlers/handle-get-provider-version", () => ({
  handleGetProviderVersion: vi.fn()
}))
vi.mock("@/background/handlers/handle-model-pull", () => ({
  handleModelPull: vi.fn()
}))
vi.mock("@/background/handlers/handle-scrape-model", () => ({
  handleScrapeModel: vi.fn()
}))
vi.mock("@/background/handlers/handle-scrape-model-variants", () => ({
  handleScrapeModelVariants: vi.fn()
}))
vi.mock("@/background/handlers/handle-show-model-details", () => ({
  handleShowModelDetails: vi.fn()
}))
vi.mock("@/background/handlers/handle-unload-model", () => ({
  handleUnloadModel: vi.fn()
}))
vi.mock("@/background/handlers/handle-warmup-model", () => ({
  handleWarmupModel: vi.fn()
}))
vi.mock("@/background/handlers/handle-update-base-url", () => ({
  handleUpdateBaseUrl: vi.fn()
}))
vi.mock("@/background/rpc-server", () => ({
  handleRpcCancellation: vi.fn(),
  handleRpcRequest: vi.fn()
}))
vi.mock("@/background/lib/dnr", () => ({ updateDNRRules: vi.fn() }))
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn().mockResolvedValue(false),
  setPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  removePlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(false),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  }
}))

// Import handlers to verify calls
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { initializeContextMenu } from "@/background/handlers/handle-context-menu"
import { handleDeleteModel } from "@/background/handlers/handle-delete-model"
import { checkEmbeddingModelExists } from "@/background/handlers/handle-embedding-download"
import { handleGetLoadedModels } from "@/background/handlers/handle-get-loaded-model"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { handleGetProviderVersion } from "@/background/handlers/handle-get-provider-version"
import { handleModelPull } from "@/background/handlers/handle-model-pull"
import { handleScrapeModel } from "@/background/handlers/handle-scrape-model"
import { handleScrapeModelVariants } from "@/background/handlers/handle-scrape-model-variants"
import { handleShowModelDetails } from "@/background/handlers/handle-show-model-details"
import { handleUnloadModel } from "@/background/handlers/handle-unload-model"
import { handleUpdateBaseUrl } from "@/background/handlers/handle-update-base-url"
import { handleWarmupModel } from "@/background/handlers/handle-warmup-model"
import {
  handleRpcCancellation,
  handleRpcRequest
} from "@/background/rpc-server"

describe("Background Script Entry Point", () => {
  beforeEach(async () => {
    vi.clearAllMocks()

    // Re-import to trigger top-level code if not already loaded
    if (listeners.onConnect.length === 0) {
      await import("../index")
    }
  })

  describe("Message Routing", () => {
    it("registers context menu handling on service worker startup", () => {
      expect(initializeContextMenu).toHaveBeenCalled()
    })

    it("should route GET_MODELS", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()

      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.GET_MODELS },
        extensionSender,
        sendResponse
      )

      expect(handleGetModels).toHaveBeenCalledWith(sendResponse)
    })

    it("allows content scripts to use an allowlisted message", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()

      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.GET_MODELS },
        contentScriptSender,
        sendResponse
      )

      expect(handleGetModels).toHaveBeenCalledWith(sendResponse)
    })

    it("routes typed RPC envelopes to the RPC server", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()
      const message = { type: RPC_REQUEST_MESSAGE_TYPE }

      expect(onMessage(message, extensionSender, sendResponse)).toBe(true)

      expect(handleRpcRequest).toHaveBeenCalledWith(
        message,
        extensionSender,
        "test-extension-id",
        "chrome-extension://test/",
        sendResponse
      )
    })

    it("routes RPC cancellation to the active-request registry", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()
      const message = { type: RPC_CANCEL_MESSAGE_TYPE }

      expect(onMessage(message, extensionSender, sendResponse)).toBe(true)

      expect(handleRpcCancellation).toHaveBeenCalledWith(
        message,
        extensionSender,
        "test-extension-id",
        "chrome-extension://test/",
        sendResponse
      )
    })

    it("rejects typed RPC envelopes from content scripts", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()

      expect(
        onMessage(
          { type: RPC_REQUEST_MESSAGE_TYPE },
          contentScriptSender,
          sendResponse
        )
      ).toBe(true)

      expect(handleRpcRequest).not.toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 403, message: "Message not allowed from this context" }
      })
    })

    it("rejects privileged messages from content scripts", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()

      expect(
        onMessage(
          { type: MESSAGE_KEYS.PROVIDER.DELETE_MODEL, payload: "model" },
          contentScriptSender,
          sendResponse
        )
      ).toBe(true)

      expect(handleDeleteModel).not.toHaveBeenCalled()
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 403, message: "Message not allowed from this context" }
      })
    })

    it("rejects non-selection ports from content scripts", () => {
      const onConnect = listeners.onConnect[0]
      const port = {
        name: "request-id",
        sender: contentScriptSender,
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn()
      }

      onConnect(port)

      expect(port.disconnect).toHaveBeenCalledOnce()
      expect(port.onMessage.addListener).not.toHaveBeenCalled()
    })

    it("should route CHAT_WITH_MODEL via port", () => {
      const onConnect = listeners.onConnect[0]
      const port = {
        name: "test-port",
        sender: extensionSender,
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn()
      }

      onConnect(port)

      // Get the message listener registered on the port
      const portMessageListener = port.onMessage.addListener.mock.calls[0][0]

      const msg = { type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL }
      portMessageListener(msg)

      expect(handleChatWithModel).toHaveBeenCalled()
    })

    it("should route PULL_MODEL via named port", () => {
      const onConnect = listeners.onConnect[0]
      const port = {
        name: MESSAGE_KEYS.PROVIDER.PULL_MODEL,
        sender: extensionSender,
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn()
      }

      onConnect(port)

      // For named ports, it registers a specific listener.
      // Note: The generic listener is also registered first, so we want the last one.
      const calls = port.onMessage.addListener.mock.calls
      const portMessageListener = calls[calls.length - 1][0]

      const msg = { name: "llama2" }
      portMessageListener(msg)

      expect(handleModelPull).toHaveBeenCalled()
    })

    it("should route SHOW_MODEL_DETAILS", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS, payload: "model" },
        extensionSender,
        vi.fn()
      )
      expect(handleShowModelDetails).toHaveBeenCalled()
    })

    it.each([
      MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS,
      MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL,
      MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL,
      MESSAGE_KEYS.PROVIDER.DELETE_MODEL
    ])("responds to invalid %s payloads", (type) => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()

      expect(
        onMessage({ type, payload: null }, extensionSender, sendResponse)
      ).toBe(true)
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: { status: 400, message: "Invalid message payload" }
      })
    })

    it("should route SCRAPE_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL, query: "q" },
        extensionSender,
        vi.fn()
      )
      expect(handleScrapeModel).toHaveBeenCalled()
    })

    it("should route SCRAPE_MODEL_VARIANTS", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL_VARIANTS, name: "m" },
        extensionSender,
        vi.fn()
      )
      expect(handleScrapeModelVariants).toHaveBeenCalled()
    })

    it("should route UPDATE_BASE_URL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.UPDATE_BASE_URL, payload: "url" },
        extensionSender,
        vi.fn()
      )
      expect(handleUpdateBaseUrl).toHaveBeenCalled()
    })

    it("should route GET_LOADED_MODELS", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.GET_LOADED_MODELS },
        extensionSender,
        vi.fn()
      )
      expect(handleGetLoadedModels).toHaveBeenCalled()
    })

    it("should route UNLOAD_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL, payload: "m" },
        extensionSender,
        vi.fn()
      )
      expect(handleUnloadModel).toHaveBeenCalled()
    })

    it("should route WARMUP_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.WARMUP_MODEL, payload: { model: "m" } },
        extensionSender,
        vi.fn()
      )
      expect(handleWarmupModel).toHaveBeenCalled()
    })

    it("should route DELETE_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.DELETE_MODEL, payload: "m" },
        extensionSender,
        vi.fn()
      )
      expect(handleDeleteModel).toHaveBeenCalled()
    })

    it("should route GET_PROVIDER_VERSION", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.GET_PROVIDER_VERSION },
        extensionSender,
        vi.fn()
      )
      expect(handleGetProviderVersion).toHaveBeenCalled()
    })

    it("should route CHECK_EMBEDDING_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage(
        { type: MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL, payload: "m" },
        extensionSender,
        vi.fn()
      )
      expect(checkEmbeddingModelExists).toHaveBeenCalled()
    })
  })
})
