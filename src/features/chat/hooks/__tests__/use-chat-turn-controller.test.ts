import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadStreamStore } from "@/features/chat/stores/load-stream-store"
import type { ChatMessage } from "@/types"
import { useChatTurnController } from "../use-chat-turn-controller"

const permissionMocks = vi.hoisted(() => ({
  findOptionalPermissionNotice: vi.fn()
}))

vi.mock("@/features/chat/lib/optional-permission-notice", () => ({
  findOptionalPermissionNotice: permissionMocks.findOptionalPermissionNotice
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
  const claimResponseStream = vi.fn(() => Symbol("stream-claim"))
  const releaseResponseStreamClaim = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    permissionMocks.findOptionalPermissionNotice.mockResolvedValue(undefined)
    loadStreamStore.setState({ isLoading: false, isStreaming: false })
  })

  it("persists an inline notice instead of submitting a doomed turn", async () => {
    permissionMocks.findOptionalPermissionNotice.mockResolvedValue({
      capabilityId: "bookmarks",
      focusId: "permission-bookmarks",
      labelKey: "settings.permissions.items.bookmarks.label",
      missingPermissions: ["bookmarks"]
    })
    const addMessage = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    const generateResponse = vi.fn()
    const toast = vi.fn()
    const setInput = vi.fn()
    const { result } = renderHook(() =>
      useChatTurnController({
        config: baseConfig as any,
        input: "Search my bookmarks",
        setInput,
        selectedTabIds: [],
        contextText: "",
        tabDocuments: [],
        messages: [],
        setIsLoading: vi.fn(),
        setIsStreaming: vi.fn(),
        ensureSessionId: vi.fn().mockResolvedValue("session-1"),
        autoRenameSession: vi.fn().mockResolvedValue(undefined),
        addMessage,
        generateResponse,
        claimResponseStream,
        releaseResponseStreamClaim,
        toast
      })
    )

    let accepted = true
    await act(async () => {
      accepted = await result.current.sendMessage()
    })

    expect(accepted).toBe(true)
    expect(claimResponseStream).toHaveBeenCalledOnce()
    expect(addMessage).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.objectContaining({ role: "user", content: "Search my bookmarks" })
    )
    expect(addMessage).toHaveBeenNthCalledWith(
      2,
      "session-1",
      expect.objectContaining({
        role: "assistant",
        done: true,
        metrics: {
          permissionNotice: expect.objectContaining({
            capabilityId: "bookmarks",
            missingPermissions: ["bookmarks"]
          })
        }
      })
    )
    expect(generateResponse).not.toHaveBeenCalled()
    expect(releaseResponseStreamClaim).toHaveBeenCalledWith(expect.any(Symbol))
    expect(setInput).toHaveBeenCalledWith("")
    expect(toast).not.toHaveBeenCalled()
  })

  it("persists the user message and submits one background-owned turn", async () => {
    const addMessage = vi.fn().mockResolvedValue(1)
    const autoRenameSession = vi.fn().mockResolvedValue(undefined)
    const generateResponse = vi.fn().mockResolvedValue(true)

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
        generateResponse,
        claimResponseStream,
        releaseResponseStreamClaim,
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
    expect(generateResponse).toHaveBeenCalledWith(
      undefined,
      "session-1",
      [
        expect.objectContaining({
          role: "user",
          content: "question"
        })
      ],
      expect.objectContaining({
        durableTurn: {
          submission: expect.objectContaining({
            id: expect.any(String),
            sessionId: "session-1",
            request: expect.objectContaining({
              context: expect.objectContaining({ rawInput: "question" }),
              userMessage: expect.objectContaining({ content: "question" })
            })
          }),
          userMessageId: 1
        },
        streamClaim: expect.any(Symbol)
      })
    )
  })

  it("continues the turn when automatic title rename fails", async () => {
    const generateResponse = vi.fn().mockResolvedValue(true)
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
        generateResponse,
        claimResponseStream,
        releaseResponseStreamClaim,
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
        generateResponse: vi.fn(),
        claimResponseStream,
        releaseResponseStreamClaim,
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
      expect.objectContaining({ title: "chat.errors.chat_create_failed_title" })
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
        generateResponse: vi.fn(),
        claimResponseStream,
        releaseResponseStreamClaim,
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

  it("claims the response stream before persisting the user message", async () => {
    let activeClaim: symbol | null = null
    const claim = vi.fn(() => {
      if (activeClaim) return null
      activeClaim = Symbol("stream-claim")
      return activeClaim
    })
    let resolveMessage!: (id: number) => void
    const addMessage = vi.fn(
      () => new Promise<number>((resolve) => (resolveMessage = resolve))
    )
    const generateResponse = vi.fn().mockResolvedValue(true)
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
        autoRenameSession: vi.fn().mockResolvedValue(undefined),
        addMessage,
        generateResponse,
        claimResponseStream: claim,
        releaseResponseStreamClaim: vi.fn((ownedClaim) => {
          if (activeClaim === ownedClaim) activeClaim = null
        }),
        toast: vi.fn()
      })
    )

    let sendPromise!: Promise<boolean>
    await act(async () => {
      sendPromise = result.current.sendMessage()
      await vi.waitFor(() => expect(addMessage).toHaveBeenCalledOnce())
    })

    expect(claim()).toBeNull()

    await act(async () => {
      resolveMessage(1)
      expect(await sendPromise).toBe(true)
    })
    expect(generateResponse).toHaveBeenCalledWith(
      undefined,
      "session-1",
      expect.any(Array),
      expect.objectContaining({ streamClaim: activeClaim })
    )
  })

  it("does not report success when response submission is rejected", async () => {
    const releaseClaim = vi.fn()
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
        autoRenameSession: vi.fn().mockResolvedValue(undefined),
        addMessage: vi.fn().mockResolvedValue(1),
        generateResponse: vi.fn().mockResolvedValue(false),
        claimResponseStream,
        releaseResponseStreamClaim: releaseClaim,
        toast: vi.fn()
      })
    )

    let accepted = true
    await act(async () => {
      accepted = await result.current.sendMessage()
    })

    expect(accepted).toBe(false)
    expect(releaseClaim).toHaveBeenCalledWith(expect.any(Symbol))
  })
})
