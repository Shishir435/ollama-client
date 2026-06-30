import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SelectionActionMessage } from "@/features/selection-actions/types"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { handleSelectionAction } from "../handle-selection-action"
import {
  clearHandlerMocks,
  createMockIsPortClosed,
  createMockPort,
  setupHandlerMocks
} from "./test-utils"

const { mockProvider, mockStreamChat } = vi.hoisted(() => {
  const streamChat = vi.fn().mockImplementation(async (_req, onChunk) => {
    onChunk({ delta: "Clean text", done: false })
    onChunk({ done: true })
  })
  return {
    mockStreamChat: streamChat,
    mockProvider: {
      streamChat,
      getModels: vi.fn()
    }
  }
})

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn(),
    set: vi.fn()
  }
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn()
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn().mockResolvedValue(mockProvider)
  }
}))

const message: SelectionActionMessage = {
  type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
  payload: {
    actionId: "summarize",
    selection: {
      selectedText: "Local text only.",
      pageUrl: "https://example.com",
      pageTitle: "Example",
      selectionType: "plain-text",
      canReplace: false,
      canInsert: false
    }
  }
}

describe("handleSelectionAction", () => {
  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    vi.clearAllMocks()
  })

  it("streams selection action chunks through selected provider", async () => {
    const { ProviderFactory } = await import("@/lib/providers/factory")
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF) {
        return { modelId: "llama3:latest", providerId: "ollama" }
      }
      return undefined
    })

    const port = createMockPort(MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION)
    await handleSelectionAction(message, port, createMockIsPortClosed(false))

    expect(ProviderFactory.getProviderForModel).toHaveBeenCalledWith(
      "llama3:latest",
      "ollama"
    )
    expect(mockStreamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "llama3:latest",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user" })
        ])
      }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(port.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK,
      payload: { delta: "Clean text", thinkingDelta: "" }
    })
    expect(port.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE
    })
  })

  it("passes the configured model system prompt into the selection action", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    vi.mocked(plasmoGlobalStorage.get).mockImplementation(async (key) => {
      if (key === STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF) {
        return { modelId: "llama3:latest", providerId: "ollama" }
      }
      if (key === STORAGE_KEYS.PROVIDER.MODEL_CONFIGS) {
        return {
          "llama3:latest": { system: "Antworte immer auf Deutsch." }
        }
      }
      return undefined
    })

    const port = createMockPort(MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION)
    await handleSelectionAction(message, port, createMockIsPortClosed(false))

    const request = mockStreamChat.mock.calls[0][0]
    expect(request.messages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Antworte immer auf Deutsch.")
      })
    )
  })

  it("returns friendly error when no model is selected", async () => {
    const { plasmoGlobalStorage } = await import("@/lib/plasmo-global-storage")
    vi.mocked(plasmoGlobalStorage.get).mockResolvedValue(undefined)

    const port = createMockPort(MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION)
    await handleSelectionAction(message, port, createMockIsPortClosed(false))

    expect(port.postMessage).toHaveBeenCalledWith({
      type: MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR,
      error: {
        status: 400,
        message: "Select a model before running Selection Actions"
      }
    })
  })
})
