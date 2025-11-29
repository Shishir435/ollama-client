import { beforeEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants"

// Mock browser API
const listeners = {
  onConnect: [] as any[],
  onMessage: [] as any[],
  onInstalled: [] as any[],
  onStartup: [] as any[]
}

const mockBrowser = {
  runtime: {
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
    getURL: vi.fn()
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

vi.mock("@/lib/browser-api", () => ({
  browser: mockBrowser,
  isChromiumBased: vi.fn().mockReturnValue(true)
}))

// Mock Handlers
vi.mock("@/background/handlers/handle-chat-with-model", () => ({ handleChatWithModel: vi.fn() }))
vi.mock("@/background/handlers/handle-context-menu", () => ({ initializeContextMenu: vi.fn() }))
vi.mock("@/background/handlers/handle-delete-model", () => ({ handleDeleteModel: vi.fn() }))
vi.mock("@/background/handlers/handle-embed-chunks", () => ({ 
  handleEmbedFileChunks: vi.fn().mockResolvedValue(undefined),
  handleEmbedFileChunksPort: vi.fn() 
}))
vi.mock("@/background/handlers/handle-embedding-download", () => ({ 
  checkEmbeddingModelExists: vi.fn().mockResolvedValue(true),
  downloadEmbeddingModelSilently: vi.fn().mockResolvedValue({ success: true })
}))
vi.mock("@/background/handlers/handle-get-loaded-model", () => ({ handleGetLoadedModels: vi.fn() }))
vi.mock("@/background/handlers/handle-get-models", () => ({ handleGetModels: vi.fn() }))
vi.mock("@/background/handlers/handle-get-ollama-version", () => ({ handleGetOllamaVersion: vi.fn() }))
vi.mock("@/background/handlers/handle-model-pull", () => ({ handleModelPull: vi.fn() }))
vi.mock("@/background/handlers/handle-scrape-model", () => ({ handleScrapeModel: vi.fn() }))
vi.mock("@/background/handlers/handle-scrape-model-variants", () => ({ handleScrapeModelVariants: vi.fn() }))
vi.mock("@/background/handlers/handle-show-model-details", () => ({ handleShowModelDetails: vi.fn() }))
vi.mock("@/background/handlers/handle-unload-model", () => ({ handleUnloadModel: vi.fn() }))
vi.mock("@/background/handlers/handle-update-base-url", () => ({ handleUpdateBaseUrl: vi.fn() }))
vi.mock("@/background/lib/dnr", () => ({ updateDNRRules: vi.fn() }))
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(false)
  }
}))

// Import handlers to verify calls
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { handleModelPull } from "@/background/handlers/handle-model-pull"
import { handleShowModelDetails } from "@/background/handlers/handle-show-model-details"
import { handleScrapeModel } from "@/background/handlers/handle-scrape-model"
import { handleScrapeModelVariants } from "@/background/handlers/handle-scrape-model-variants"
import { handleUpdateBaseUrl } from "@/background/handlers/handle-update-base-url"
import { handleGetLoadedModels } from "@/background/handlers/handle-get-loaded-model"
import { handleUnloadModel } from "@/background/handlers/handle-unload-model"
import { handleDeleteModel } from "@/background/handlers/handle-delete-model"
import { handleGetOllamaVersion } from "@/background/handlers/handle-get-ollama-version"
import { checkEmbeddingModelExists } from "@/background/handlers/handle-embedding-download"
import { handleEmbedFileChunks } from "@/background/handlers/handle-embed-chunks"

describe("Background Script Entry Point", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    
    // Re-import to trigger top-level code if not already loaded
    if (listeners.onConnect.length === 0) {
      await import("../index")
    }
  })

  describe("Message Routing", () => {
    it("should route GET_MODELS", () => {
      const onMessage = listeners.onMessage[0]
      const sendResponse = vi.fn()
      
      onMessage({ type: MESSAGE_KEYS.OLLAMA.GET_MODELS }, {}, sendResponse)
      
      expect(handleGetModels).toHaveBeenCalledWith(sendResponse)
    })

    it("should route CHAT_WITH_MODEL via port", () => {
      const onConnect = listeners.onConnect[0]
      const port = {
        name: "test-port",
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() }
      }
      
      onConnect(port)
      
      // Get the message listener registered on the port
      const portMessageListener = port.onMessage.addListener.mock.calls[0][0]
      
      const msg = { type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL }
      portMessageListener(msg)
      
      expect(handleChatWithModel).toHaveBeenCalled()
    })

    it("should route PULL_MODEL via named port", () => {
      const onConnect = listeners.onConnect[0]
      const port = {
        name: MESSAGE_KEYS.OLLAMA.PULL_MODEL,
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() }
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
      onMessage({ type: MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS, payload: "model" }, {}, vi.fn())
      expect(handleShowModelDetails).toHaveBeenCalled()
    })

    it("should route SCRAPE_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL, query: "q" }, {}, vi.fn())
      expect(handleScrapeModel).toHaveBeenCalled()
    })

    it("should route SCRAPE_MODEL_VARIANTS", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS, name: "m" }, {}, vi.fn())
      expect(handleScrapeModelVariants).toHaveBeenCalled()
    })

    it("should route UPDATE_BASE_URL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.UPDATE_BASE_URL, payload: "url" }, {}, vi.fn())
      expect(handleUpdateBaseUrl).toHaveBeenCalled()
    })

    it("should route GET_LOADED_MODELS", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.GET_LOADED_MODELS }, {}, vi.fn())
      expect(handleGetLoadedModels).toHaveBeenCalled()
    })

    it("should route UNLOAD_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.UNLOAD_MODEL, payload: "m" }, {}, vi.fn())
      expect(handleUnloadModel).toHaveBeenCalled()
    })

    it("should route DELETE_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.DELETE_MODEL, payload: "m" }, {}, vi.fn())
      expect(handleDeleteModel).toHaveBeenCalled()
    })

    it("should route GET_OLLAMA_VERSION", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.GET_OLLAMA_VERSION }, {}, vi.fn())
      expect(handleGetOllamaVersion).toHaveBeenCalled()
    })

    it("should route CHECK_EMBEDDING_MODEL", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.CHECK_EMBEDDING_MODEL, payload: "m" }, {}, vi.fn())
      expect(checkEmbeddingModelExists).toHaveBeenCalled()
    })

    it("should route EMBED_FILE_CHUNKS", () => {
      const onMessage = listeners.onMessage[0]
      onMessage({ type: MESSAGE_KEYS.OLLAMA.EMBED_FILE_CHUNKS }, {}, vi.fn())
      expect(handleEmbedFileChunks).toHaveBeenCalled()
    })
  })
})
