import {
  RPC_CANCEL_MESSAGE_TYPE,
  RPC_REQUEST_MESSAGE_TYPE
} from "@ollama-client/contracts/rpc"
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
    getManifest: vi.fn(() => ({ version: "0.12.4" })),
    setUninstallURL: vi.fn().mockResolvedValue(undefined),
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`)
  },
  i18n: {
    getUILanguage: vi.fn(() => "en-US")
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
vi.mock("@/background/handlers/handle-embedding-download", () => ({
  checkEmbeddingModelExists: vi.fn().mockResolvedValue(true),
  downloadEmbeddingModelSilently: vi.fn().mockResolvedValue({ success: true })
}))
vi.mock("@/background/handlers/handle-get-models", () => ({
  handleGetModels: vi.fn()
}))
vi.mock("@/background/handlers/handle-start-turn", () => ({
  handleStartTurn: vi.fn()
}))
vi.mock("@/background/lib/abort-controller-registry", () => ({
  abortAndClearController: vi.fn()
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
import { handleGetModels } from "@/background/handlers/handle-get-models"
import { handleStartTurn } from "@/background/handlers/handle-start-turn"
import { abortAndClearController } from "@/background/lib/abort-controller-registry"
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
      expect(mockBrowser.runtime.setUninstallURL).toHaveBeenCalledWith(
        "https://www.ollamaclient.in/goodbye?v=0.12.4&l=en-US"
      )
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
          { type: MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE, payload: {} },
          contentScriptSender,
          sendResponse
        )
      ).toBe(true)

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

      const msg = {
        version: 1,
        type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
        payload: { model: "llama2", messages: [] }
      }
      portMessageListener(msg)

      expect(handleChatWithModel).toHaveBeenCalled()
    })

    it("does not abort a durable turn when its observing panel closes", () => {
      const onConnect = listeners.onConnect[0]
      const port = {
        name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE,
        sender: extensionSender,
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        disconnect: vi.fn()
      }

      onConnect(port)
      const portMessageListener = port.onMessage.addListener.mock.calls[0][0]
      const disconnectListener = port.onDisconnect.addListener.mock.calls[0][0]
      portMessageListener({
        version: 1,
        type: MESSAGE_KEYS.PROVIDER.START_TURN,
        payload: {
          start: {
            submission: {
              id: "turn-1",
              sessionId: "session-1",
              mode: "new",
              model: "llama2",
              request: {
                version: 1,
                context: {
                  rawInput: "hello",
                  messages: [],
                  hasTabContext: false,
                  contextText: "",
                  tabDocuments: [],
                  memoryEnabled: false,
                  maxTabContextChars: 1,
                  maxRagContextChars: 1,
                  groundedOnlyMode: false,
                  selectedModel: "llama2",
                  selectedModelRef: null
                },
                userMessage: { role: "user", content: "hello" }
              },
              createdAt: 1
            },
            userMessageId: 1
          },
          assistantMessageId: 2
        }
      })
      disconnectListener()

      expect(handleStartTurn).toHaveBeenCalled()
      expect(abortAndClearController).not.toHaveBeenCalledWith("turn-1")
    })

    it("no longer answers the retired provider message keys", () => {
      // Every one of these moved to the typed RPC boundary. Falling through
      // (undefined, not `true`) is what lets another listener answer and is the
      // observable difference from "handled by a stale case arm".
      const onMessage = listeners.onMessage[0]

      for (const type of [
        "show-model-details",
        "provider-update-base-url",
        "ollama-update-base-url",
        "get-loaded-models",
        "get-loaded-model",
        "unload-model",
        "warmup-model",
        "delete-model",
        "get-provider-version",
        "get-ollama-version",
        "scrape-model-library",
        "scrape-ollama-model",
        "check-embedding-model",
        "prepare-embedding-model",
        "get-ollama-models"
      ]) {
        const sendResponse = vi.fn()
        expect(
          onMessage({ type, payload: "m" }, extensionSender, sendResponse)
        ).toBeUndefined()
        expect(sendResponse).not.toHaveBeenCalled()
      }
    })
  })
})
