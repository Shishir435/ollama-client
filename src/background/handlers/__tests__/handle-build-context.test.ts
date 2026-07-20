import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BuildContextMessage } from "@/types"

import { handleBuildContext } from "../handle-build-context"
import { createMockIsPortClosed, createMockPort } from "./test-utils"

const { mockBuildRagContext, mockResolveModelTools } = vi.hoisted(() => ({
  mockBuildRagContext: vi.fn(),
  mockResolveModelTools: vi.fn()
}))

vi.mock("@/features/chat/hooks/build-rag-context", () => ({
  buildRagContext: mockBuildRagContext
}))

vi.mock("@/background/lib/resolve-model-tools", () => ({
  resolveModelTools: mockResolveModelTools
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn().mockResolvedValue({ config: {} })
  }
}))

const makeMessage = (): BuildContextMessage => ({
  type: "build-context",
  payload: {
    requestId: "req-1",
    rawInput: "what is this",
    messages: [],
    hasTabContext: false,
    contextText: "",
    tabDocuments: [],
    memoryEnabled: true,
    maxTabContextChars: 4000,
    maxRagContextChars: 4000,
    groundedOnlyMode: false,
    selectedModel: "llama3",
    selectedModelRef: { providerId: "ollama", modelId: "llama3" }
  }
})

const result = {
  contentWithRAG: "what is this\n\ncontext",
  ragSources: null,
  pageContextAdded: false,
  promptContextStats: {
    promptInputLength: 12,
    promptAugmentedLength: 20,
    tabContextLength: 0,
    ragContextLength: 8,
    tabContextTruncated: false,
    groundedOnlyMode: false,
    insufficientContext: false,
    usedContextChunks: [],
    activityEvents: []
  }
}

describe("handleBuildContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no retrieval tools → context is auto-injected.
    mockResolveModelTools.mockResolvedValue(undefined)
  })

  it("passes retrievalToolsActive to buildRagContext when the model has rag_search", async () => {
    mockResolveModelTools.mockResolvedValue({
      tools: [{ name: "rag_search" }, { name: "web_search" }],
      mode: "native"
    })
    mockBuildRagContext.mockResolvedValue(result)

    const port = createMockPort("ctx-port")
    await handleBuildContext(makeMessage(), port, createMockIsPortClosed(false))

    expect(mockBuildRagContext).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalToolsActive: true })
    )
  })

  it("leaves retrievalToolsActive false when no retrieval tool is offered", async () => {
    mockResolveModelTools.mockResolvedValue({
      tools: [{ name: "web_search" }],
      mode: "native"
    })
    mockBuildRagContext.mockResolvedValue(result)

    const port = createMockPort("ctx-port")
    await handleBuildContext(makeMessage(), port, createMockIsPortClosed(false))

    expect(mockBuildRagContext).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalToolsActive: false })
    )
  })

  it("streams progress and posts a single terminal result", async () => {
    mockBuildRagContext.mockImplementation(async (opts) => {
      opts.onActivityEvent?.([
        {
          id: "a",
          kind: "searching_memory",
          label: "Searching",
          status: "running",
          startedAt: 1
        }
      ])
      return result
    })

    const port = createMockPort("ctx-port")
    await handleBuildContext(makeMessage(), port, createMockIsPortClosed(false))

    const posts = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    )
    expect(posts).toContainEqual(
      expect.objectContaining({ type: "context_progress", requestId: "req-1" })
    )
    expect(posts).toContainEqual(
      expect.objectContaining({
        type: "context_result",
        requestId: "req-1",
        result
      })
    )
    expect(posts.filter((p) => p.type === "context_result")).toHaveLength(1)
  })

  it("posts context_error when context building throws", async () => {
    mockBuildRagContext.mockRejectedValue(new Error("boom"))

    const port = createMockPort("ctx-port")
    await handleBuildContext(makeMessage(), port, createMockIsPortClosed(false))

    const posts = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0]
    )
    expect(posts).toContainEqual(
      expect.objectContaining({
        type: "context_error",
        requestId: "req-1",
        error: "boom"
      })
    )
    expect(posts.some((p) => p.type === "context_result")).toBe(false)
  })

  it("does not post to a closed port", async () => {
    mockBuildRagContext.mockResolvedValue(result)

    const port = createMockPort("ctx-port")
    await handleBuildContext(makeMessage(), port, createMockIsPortClosed(true))

    expect(port.postMessage).not.toHaveBeenCalled()
  })
})
