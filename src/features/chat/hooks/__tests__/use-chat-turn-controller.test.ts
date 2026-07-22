import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadStreamStore } from "@/features/chat/stores/load-stream-store"
import type { ChatMessage } from "@/types"
import { useChatTurnController } from "../use-chat-turn-controller"

const ctx = vi.hoisted(() => ({
  buildContext: vi.fn()
}))

vi.mock("@/features/chat/hooks/use-build-context", () => ({
  useBuildContext: () => ({ buildContext: ctx.buildContext })
}))

const baseConfig = {
  selectedModel: "llama3",
  selectedModelRef: { providerId: "ollama", modelId: "llama3" },
  selectionConflictModel: null,
  memoryEnabled: true,
  maxTabContextChars: 4000,
  maxRagContextChars: 4000,
  groundedOnlyMode: false
}

describe("useChatTurnController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadStreamStore.setState({ isLoading: false, isStreaming: false })
    ctx.buildContext.mockResolvedValue({
      contentWithRAG: "question\n\ncontext",
      ragSources: null,
      pageContextAdded: false,
      promptContextStats: {
        promptInputLength: 8,
        promptAugmentedLength: 18,
        tabContextLength: 0,
        ragContextLength: 10,
        tabContextTruncated: false,
        groundedOnlyMode: false,
        insufficientContext: false,
        usedContextChunks: [],
        activityEvents: []
      }
    })
  })

  it("persists the user turn, builds context, and starts response generation", async () => {
    const addMessage = vi.fn().mockResolvedValue(1)
    const autoRenameSession = vi.fn().mockResolvedValue(undefined)
    const generateResponse = vi.fn().mockResolvedValue(undefined)
    const setNextResponseMetrics = vi.fn()

    const { result } = renderHook(() =>
      useChatTurnController({
        config: baseConfig as any,
        input: "question",
        setInput: vi.fn(),
        selectedTabIds: [],
        contextText: "",
        tabDocuments: [],
        messages: [] as ChatMessage[],
        setIsLoading: vi.fn(),
        setIsStreaming: vi.fn(),
        ensureSessionId: vi.fn().mockResolvedValue("session-1"),
        autoRenameSession,
        addMessage,
        setNextResponseMetrics,
        clearNextResponseMetrics: vi.fn(),
        generateResponse,
        toast: vi.fn()
      })
    )

    let accepted = false
    await act(async () => {
      accepted = await result.current.sendMessage()
    })

    expect(accepted).toBe(true)
    expect(addMessage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ role: "user", content: "question" })
    )
    expect(ctx.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({ rawInput: "question" }),
      expect.objectContaining({ onActivityEvent: expect.any(Function) })
    )
    expect(setNextResponseMetrics).toHaveBeenCalled()
    expect(generateResponse).toHaveBeenCalledWith(
      undefined,
      "session-1",
      [
        expect.objectContaining({
          role: "user",
          content: "question\n\ncontext"
        })
      ],
      { contextPrepared: true }
    )
  })

  it("continues the turn when automatic title rename fails", async () => {
    const generateResponse = vi.fn().mockResolvedValue(undefined)
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useChatTurnController({
        config: baseConfig as any,
        input: "question",
        setInput: vi.fn(),
        selectedTabIds: [],
        contextText: "",
        tabDocuments: [],
        messages: [],
        setIsLoading: vi.fn(),
        setIsStreaming: vi.fn(),
        ensureSessionId: vi.fn().mockResolvedValue("session-1"),
        autoRenameSession: vi
          .fn()
          .mockRejectedValue(new Error("rename failed")),
        addMessage: vi.fn().mockResolvedValue(1),
        setNextResponseMetrics: vi.fn(),
        clearNextResponseMetrics: vi.fn(),
        generateResponse,
        toast
      })
    )

    await act(async () => {
      await result.current.sendMessage()
    })

    expect(generateResponse).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't send message" })
    )
  })

  it("reports session creation failures without attempting a write", async () => {
    const addMessage = vi.fn()
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useChatTurnController({
        config: baseConfig as any,
        input: "question",
        setInput: vi.fn(),
        selectedTabIds: [],
        contextText: "",
        tabDocuments: [],
        messages: [],
        setIsLoading: vi.fn(),
        setIsStreaming: vi.fn(),
        ensureSessionId: vi.fn().mockRejectedValue(new Error("session failed")),
        autoRenameSession: vi.fn(),
        addMessage,
        setNextResponseMetrics: vi.fn(),
        clearNextResponseMetrics: vi.fn(),
        generateResponse: vi.fn(),
        toast
      })
    )

    let accepted = true
    await act(async () => {
      accepted = await result.current.sendMessage()
    })

    expect(accepted).toBe(false)
    expect(addMessage).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't start chat" })
    )
  })

  it("does not accept a queued turn while another turn is active", async () => {
    loadStreamStore.setState({ isLoading: true, isStreaming: false })
    const addMessage = vi.fn()
    const { result } = renderHook(() =>
      useChatTurnController({
        config: baseConfig as any,
        input: "question",
        setInput: vi.fn(),
        selectedTabIds: [],
        contextText: "",
        tabDocuments: [],
        messages: [],
        setIsLoading: vi.fn(),
        setIsStreaming: vi.fn(),
        ensureSessionId: vi.fn().mockResolvedValue("session-1"),
        autoRenameSession: vi.fn(),
        addMessage,
        setNextResponseMetrics: vi.fn(),
        clearNextResponseMetrics: vi.fn(),
        generateResponse: vi.fn(),
        toast: vi.fn()
      })
    )

    let accepted = true
    await act(async () => {
      accepted = await result.current.sendMessage()
    })

    expect(accepted).toBe(false)
    expect(addMessage).not.toHaveBeenCalled()
  })
})
