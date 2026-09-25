import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatWithModelMessage } from "@/types"
import { handleChatWithModel } from "../handle-chat-with-model"
import {
  clearHandlerMocks,
  createMockIsPortClosed,
  createMockPort,
  setupHandlerMocks
} from "./test-utils"

const { mockProvider, mockStreamChatWithTools } = vi.hoisted(() => ({
  mockStreamChatWithTools: vi.fn().mockResolvedValue(undefined),
  mockProvider: {
    id: "ollama",
    config: {
      id: "ollama",
      type: "ollama",
      enabled: true,
      baseUrl: "http://localhost:11434",
      name: "Ollama"
    },
    streamChat: vi.fn(),
    getModelDetails: vi.fn().mockResolvedValue(null),
    getModels: vi.fn().mockResolvedValue([])
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoSyncStorage: { get: vi.fn(), set: vi.fn() },
  getPlasmoStoredValue: vi.fn().mockResolvedValue(undefined),
  setPlasmoStoredValue: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("@/background/lib/abort-controller-registry", () => ({
  setAbortController: vi.fn(),
  clearAbortController: vi.fn()
}))
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn().mockResolvedValue(mockProvider)
  }
}))
vi.mock("@/background/lib/resolve-model-tools", () => ({
  resolveModelCapabilities: vi
    .fn()
    .mockResolvedValue({ capabilities: {}, probed: null }),
  resolveModelTools: vi.fn()
}))
vi.mock("@/background/lib/stream-chat-with-tools", () => ({
  streamChatWithTools: mockStreamChatWithTools
}))
vi.mock("@/background/lib/active-tab-context", () => ({
  resolveActiveTabContext: vi.fn()
}))
vi.mock("@/lib/repositories/tool-loop-runs", () => ({
  getToolLoopRun: vi.fn().mockResolvedValue(null),
  saveToolLoopRun: vi.fn(),
  deleteToolLoopRun: vi.fn().mockResolvedValue(undefined)
}))

import { resolveActiveTabContext } from "@/background/lib/active-tab-context"
import { resolveModelTools } from "@/background/lib/resolve-model-tools"

const tool = (name: string) => ({
  name,
  description: name,
  parameters: { type: "object" as const, properties: {} }
})

const message = (browserTabId?: number): ChatWithModelMessage => ({
  type: "CHAT_WITH_MODEL",
  payload: {
    model: "codex/gpt",
    messages: [{ role: "user", content: "what are we doing in this pr?" }],
    ...(browserTabId === undefined ? {} : { browserTabId })
  }
})

const sentRequest = () =>
  mockStreamChatWithTools.mock.calls[0][0].request as {
    messages: { role: string; content: string }[]
    tools?: { name: string }[]
  }

describe("handleChatWithModel browser context", () => {
  beforeEach(() => {
    clearHandlerMocks()
    setupHandlerMocks()
    vi.clearAllMocks()
  })

  it("tells the model it is in the browser and names the panel's tab", async () => {
    vi.mocked(resolveModelTools).mockResolvedValue({
      tools: [tool("current_tab")],
      mode: "native"
    } as never)
    vi.mocked(resolveActiveTabContext).mockResolvedValue({
      title: "Start runs from chat #421",
      url: "https://github.com/o/r/pull/421"
    })

    await handleChatWithModel(
      message(9),
      createMockPort("chat"),
      createMockIsPortClosed(false)
    )

    expect(resolveActiveTabContext).toHaveBeenCalledWith(9)
    const system = sentRequest().messages[0]
    expect(system.role).toBe("system")
    expect(system.content).toContain("inside the user's web browser")
    expect(system.content).toContain(
      '"Start runs from chat #421" at https://github.com/o/r/pull/421'
    )
    expect(system.content).toContain("You have tools available: current_tab")
  })

  it("offers tools to a model whose results return as user messages", async () => {
    vi.mocked(resolveModelTools).mockResolvedValue({
      tools: [tool("current_tab")],
      mode: "native-user-results"
    } as never)
    vi.mocked(resolveActiveTabContext).mockResolvedValue(undefined)

    await handleChatWithModel(
      message(),
      createMockPort("chat"),
      createMockIsPortClosed(false)
    )

    expect(sentRequest().tools?.map((entry) => entry.name)).toEqual([
      "current_tab"
    ])
    expect(sentRequest().messages[0].content).toContain(
      "inside the user's web browser"
    )
  })

  it("adds no browser context when no tab tool is offered", async () => {
    vi.mocked(resolveModelTools).mockResolvedValue({
      tools: [tool("web_search")],
      mode: "native"
    } as never)
    vi.mocked(resolveActiveTabContext).mockResolvedValue({
      title: "Page",
      url: "https://a.test/"
    })

    await handleChatWithModel(
      message(3),
      createMockPort("chat"),
      createMockIsPortClosed(false)
    )

    expect(resolveActiveTabContext).not.toHaveBeenCalled()
    expect(sentRequest().messages[0].content).not.toContain(
      "inside the user's web browser"
    )
  })
})
