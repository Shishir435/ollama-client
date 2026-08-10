import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  contextBuild: vi.fn(),
  handleChat: vi.fn(),
  resolveRetrievalToolsActive: vi.fn(),
  appendMessage: vi.fn(),
  getMessage: vi.fn(),
  getSession: vi.fn(),
  updateMessage: vi.fn(),
  createTurnRun: vi.fn(),
  getIncompleteTurnRuns: vi.fn(),
  getTurnRun: vi.fn(),
  updateTurnRun: vi.fn(),
  markTurnCancelling: vi.fn(),
  finalizeInterruptedCancellations: vi.fn()
}))

vi.mock("@/application/context/context-service", () => ({
  ContextService: class {
    build = mocks.contextBuild
  }
}))

vi.mock("@/background/handlers/handle-chat-with-model", () => ({
  handleChatWithModel: mocks.handleChat
}))

vi.mock("@/background/handlers/handle-build-context", () => ({
  resolveRetrievalToolsActive: mocks.resolveRetrievalToolsActive
}))

vi.mock("@/lib/repositories/chat-history", () => ({
  appendMessage: mocks.appendMessage,
  getMessage: mocks.getMessage,
  getSession: mocks.getSession,
  updateMessage: mocks.updateMessage
}))

vi.mock("@/lib/repositories/turn-runs", () => ({
  createTurnRun: mocks.createTurnRun,
  getIncompleteTurnRuns: mocks.getIncompleteTurnRuns,
  getTurnRun: mocks.getTurnRun,
  updateTurnRun: mocks.updateTurnRun,
  markTurnCancelling: mocks.markTurnCancelling,
  finalizeInterruptedCancellations: mocks.finalizeInterruptedCancellations
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

import type {
  DurableTurnRun,
  TurnSubmission
} from "@/application/turns/turn-contract"
import {
  reconnectDurableTurn,
  resumeIncompleteTurnRuns,
  startDurableTurn
} from "@/background/durable-turn-runtime"

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const contextResult = {
  contentWithRAG: "hello\n\ncontext",
  ragSources: null,
  pageContextAdded: false,
  promptContextStats: {
    promptInputLength: 5,
    promptAugmentedLength: 14,
    tabContextLength: 0,
    ragContextLength: 9,
    tabContextTruncated: false,
    groundedOnlyMode: false,
    insufficientContext: false,
    usedContextChunks: [],
    activityEvents: []
  }
}

const submission: TurnSubmission = {
  id: "turn-1",
  sessionId: "session-1",
  mode: "new",
  model: "llama3",
  providerId: "ollama",
  request: {
    version: 1,
    context: {
      rawInput: "hello",
      messages: [],
      hasTabContext: false,
      contextText: "",
      tabDocuments: [],
      memoryEnabled: false,
      maxTabContextChars: 1000,
      maxRagContextChars: 1000,
      groundedOnlyMode: false,
      selectedModel: "llama3",
      selectedModelRef: { providerId: "ollama", modelId: "llama3" }
    },
    userMessage: { role: "user", content: "hello" }
  },
  createdAt: 10
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.order.length = 0
  mocks.resolveRetrievalToolsActive.mockResolvedValue(false)
  mocks.createTurnRun.mockImplementation(async () => {
    mocks.order.push("create")
  })
  mocks.updateTurnRun.mockImplementation(async (_id, update) => {
    mocks.order.push(`status:${update.status ?? "message-id"}`)
    return true
  })
  mocks.markTurnCancelling.mockResolvedValue(true)
  mocks.finalizeInterruptedCancellations.mockResolvedValue([])
  mocks.contextBuild.mockImplementation(async () => {
    mocks.order.push("context")
    return {
      result: contextResult,
      receipt: {
        version: 1,
        turnId: "turn-1",
        mode: "new",
        createdAt: 11,
        query: "hello",
        model: { id: "llama3", providerId: "ollama" },
        prompt: {
          inputLength: 5,
          augmentedLength: 14,
          tabContextLength: 0,
          ragContextLength: 9,
          tabContextTruncated: false,
          groundedOnlyMode: false,
          insufficientContext: false
        },
        sources: []
      }
    }
  })
  mocks.updateMessage.mockResolvedValue(1)
  mocks.getMessage.mockResolvedValue(null)
  mocks.handleChat.mockImplementation(async (_message, port) => {
    mocks.order.push("generation")
    port.postMessage({ delta: "answer" })
    port.postMessage({ done: true })
  })
})

describe("durable turn runtime", () => {
  it("owns context and generation after the sidepanel submits", async () => {
    await startDurableTurn(submission, 1, 2, {})

    expect(mocks.order).toEqual([
      "create",
      "status:building_context",
      "context",
      "status:generating",
      "generation",
      "status:completed"
    ])
    expect(mocks.createTurnRun.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resolveRetrievalToolsActive.mock.invocationCallOrder[0]
    )
    expect(mocks.handleChat).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          requestId: "turn-1",
          messages: [
            expect.objectContaining({
              role: "user",
              content: "hello\n\ncontext"
            })
          ]
        })
      }),
      expect.anything(),
      expect.any(Function)
    )
    expect(mocks.updateMessage).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({ content: "answer", done: true })
    )
  })

  it("resumes persisted in-flight turns on background startup", async () => {
    mocks.getIncompleteTurnRuns.mockResolvedValue([
      {
        ...submission,
        status: "generating",
        userMessageId: 1,
        assistantMessageId: 2,
        updatedAt: 12
      } satisfies DurableTurnRun
    ])

    await resumeIncompleteTurnRuns()

    expect(mocks.createTurnRun).not.toHaveBeenCalled()
    expect(mocks.contextBuild).toHaveBeenCalledOnce()
    expect(mocks.handleChat).toHaveBeenCalledOnce()
    expect(mocks.updateTurnRun).toHaveBeenLastCalledWith(
      "turn-1",
      expect.objectContaining({ status: "completed" })
    )
  })

  it("persists explicit cancellation when generation is aborted", async () => {
    mocks.handleChat.mockImplementationOnce(async (_message, port) => {
      port.postMessage({ delta: "partial" })
      port.postMessage({ done: true, aborted: true })
    })

    await startDurableTurn(submission, 1, 2, {})

    expect(mocks.updateTurnRun).toHaveBeenLastCalledWith(
      "turn-1",
      expect.objectContaining({ status: "cancelled", failure: null })
    )
    expect(mocks.updateMessage).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ content: "partial", done: true })
    )
  })

  it("fails durably and finalizes the assistant when context building fails", async () => {
    mocks.contextBuild.mockRejectedValueOnce(new Error("context unavailable"))

    await expect(startDurableTurn(submission, 1, 2, {})).rejects.toThrow(
      "context unavailable"
    )

    expect(mocks.updateTurnRun).toHaveBeenLastCalledWith("turn-1", {
      status: "failed",
      failure: expect.objectContaining({
        status: 0,
        message: "context unavailable",
        context: "turn-run"
      })
    })
    expect(mocks.updateMessage).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({
        content: "Turn failed before completion.",
        done: true
      })
    )
  })

  it("reattaches an observer with a persisted snapshot", async () => {
    mocks.getTurnRun.mockResolvedValue({
      ...submission,
      status: "generating",
      assistantMessageId: 2,
      updatedAt: 12
    } satisfies DurableTurnRun)
    mocks.getMessage.mockResolvedValue({
      id: 2,
      role: "assistant",
      content: "partial",
      done: false
    })
    const port = { postMessage: vi.fn() } as any

    await reconnectDurableTurn("turn-1", 3, {
      port,
      isPortClosed: () => false
    })

    expect(port.postMessage).toHaveBeenCalledWith({
      version: 1,
      type: "stream_snapshot",
      requestId: "turn-1",
      seq: -1,
      sequenceReset: true,
      status: "generating",
      assistant: expect.objectContaining({ content: "partial" })
    })
  })

  it("buffers live chunks until a coherent snapshot is sent", async () => {
    const assistantRead = deferred<any>()
    const generationStarted = deferred<void>()
    const finishGeneration = deferred<void>()
    mocks.getTurnRun.mockResolvedValue({
      ...submission,
      status: "generating",
      assistantMessageId: 2,
      updatedAt: 12
    } satisfies DurableTurnRun)
    mocks.getMessage.mockReturnValueOnce(assistantRead.promise)
    mocks.handleChat.mockImplementationOnce(async (_message, port) => {
      port.postMessage({ seq: 0, delta: "new" })
      generationStarted.resolve()
      await finishGeneration.promise
      port.postMessage({ seq: 1, done: true })
    })
    const port = { postMessage: vi.fn() } as any

    const reconnecting = reconnectDurableTurn("turn-1", 3, {
      port,
      isPortClosed: () => false
    })
    await vi.waitFor(() => expect(mocks.getMessage).toHaveBeenCalledOnce())

    const generating = startDurableTurn(submission, 1, 2, {})
    await generationStarted.promise
    assistantRead.resolve({
      id: 2,
      role: "assistant",
      content: "old",
      done: false
    })
    await reconnecting

    expect(port.postMessage.mock.calls[0][0]).toEqual({
      version: 1,
      type: "stream_snapshot",
      requestId: "turn-1",
      seq: 0,
      sequenceReset: true,
      status: "generating",
      assistant: expect.objectContaining({ content: "new" }),
      thinkingState: { inThinking: false, pending: "" }
    })
    expect(port.postMessage).toHaveBeenCalledTimes(1)

    finishGeneration.resolve()
    await generating
    expect(port.postMessage.mock.calls[1][0]).toMatchObject({
      type: "chat_chunk",
      seq: 1,
      done: true
    })
  })

  it("retains the terminal snapshot until its persistence finishes", async () => {
    const assistantRead = deferred<any>()
    const deltaEmitted = deferred<void>()
    const emitTerminal = deferred<void>()
    const terminalEmitted = deferred<void>()
    const terminalWrite = deferred<number>()
    mocks.getTurnRun.mockResolvedValue({
      ...submission,
      status: "generating",
      assistantMessageId: 2,
      updatedAt: 12
    } satisfies DurableTurnRun)
    mocks.getMessage.mockReturnValueOnce(assistantRead.promise)
    mocks.updateMessage.mockImplementation(async (_id, update) => {
      if (update.content === "new" && update.done) {
        return terminalWrite.promise
      }
      return 1
    })
    mocks.handleChat.mockImplementationOnce(async (_message, port) => {
      port.postMessage({ seq: 0, delta: "new" })
      deltaEmitted.resolve()
      await emitTerminal.promise
      port.postMessage({ seq: 1, done: true })
      terminalEmitted.resolve()
    })

    const generating = startDurableTurn(submission, 1, 2, {})
    await deltaEmitted.promise
    const port = { postMessage: vi.fn() } as any
    const reconnecting = reconnectDurableTurn("turn-1", 0, {
      port,
      isPortClosed: () => false
    })
    await vi.waitFor(() => expect(mocks.getMessage).toHaveBeenCalledOnce())

    emitTerminal.resolve()
    await terminalEmitted.promise
    assistantRead.resolve({
      id: 2,
      role: "assistant",
      content: "old",
      done: false
    })
    await reconnecting

    expect(port.postMessage).toHaveBeenCalledTimes(1)
    expect(port.postMessage.mock.calls[0][0]).toEqual({
      version: 1,
      type: "stream_snapshot",
      requestId: "turn-1",
      seq: 1,
      sequenceReset: false,
      status: "generating",
      assistant: expect.objectContaining({ content: "new", done: true }),
      thinkingState: { inThinking: false, pending: "" }
    })

    terminalWrite.resolve(1)
    await generating
  })

  it("keeps the terminal snapshot while a reconnect reads stale persistence", async () => {
    const assistantRead = deferred<any>()
    mocks.getTurnRun.mockResolvedValue({
      ...submission,
      status: "generating",
      assistantMessageId: 2,
      updatedAt: 12
    } satisfies DurableTurnRun)
    mocks.getMessage.mockReturnValueOnce(assistantRead.promise)
    mocks.handleChat.mockImplementationOnce(async (_message, port) => {
      port.postMessage({ seq: 0, delta: "new" })
      port.postMessage({ seq: 1, done: true })
    })
    const port = { postMessage: vi.fn() } as any

    const reconnecting = reconnectDurableTurn("turn-1", 0, {
      port,
      isPortClosed: () => false
    })
    await vi.waitFor(() => expect(mocks.getMessage).toHaveBeenCalledOnce())

    await startDurableTurn(submission, 1, 2, {})
    assistantRead.resolve({
      id: 2,
      role: "assistant",
      content: "old",
      done: false
    })
    await reconnecting

    expect(port.postMessage).toHaveBeenCalledTimes(1)
    expect(port.postMessage.mock.calls[0][0]).toEqual({
      version: 1,
      type: "stream_snapshot",
      requestId: "turn-1",
      seq: 1,
      sequenceReset: false,
      status: "generating",
      assistant: expect.objectContaining({ content: "new", done: true }),
      thinkingState: { inThinking: false, pending: "" }
    })
  })

  it("detaches a closed observer before later chunks", async () => {
    const releaseGeneration = deferred<void>()
    mocks.handleChat.mockImplementationOnce(async (_message, port) => {
      await releaseGeneration.promise
      port.postMessage({ delta: "answer" })
      port.postMessage({ done: true })
    })
    const disconnectListeners: Array<() => void> = []
    const port = {
      postMessage: vi.fn(),
      onDisconnect: {
        addListener: vi.fn((listener: () => void) => {
          disconnectListeners.push(listener)
        }),
        removeListener: vi.fn((listener: () => void) => {
          const index = disconnectListeners.indexOf(listener)
          if (index >= 0) disconnectListeners.splice(index, 1)
        })
      }
    } as any

    const generating = startDurableTurn(submission, 1, 2, {
      port,
      isPortClosed: () => false
    })
    await vi.waitFor(() => expect(mocks.handleChat).toHaveBeenCalledOnce())
    disconnectListeners[0]?.()
    releaseGeneration.resolve()
    await generating

    expect(port.postMessage).not.toHaveBeenCalled()
  })
})

describe("durable turn cancellation", () => {
  it("commits the stop before anything acts on it", async () => {
    const { requestDurableTurnStop } = await import(
      "@/background/durable-turn-runtime"
    )

    await expect(requestDurableTurnStop("turn-1")).resolves.toBe(true)
    expect(mocks.markTurnCancelling).toHaveBeenCalledWith("turn-1")
  })

  it("answers false for a key that names no live turn", async () => {
    // Selection-action scope keys travel the same stop path.
    mocks.markTurnCancelling.mockResolvedValue(false)
    const { requestDurableTurnStop } = await import(
      "@/background/durable-turn-runtime"
    )

    await expect(
      requestDurableTurnStop("provider-stream-response#3")
    ).resolves.toBe(false)
  })

  it("never blocks the abort on a persistence failure", async () => {
    // Losing the intent costs one reissued turn on the next boot; refusing to
    // stop is worse.
    mocks.markTurnCancelling.mockRejectedValue(new Error("db gone"))
    const { requestDurableTurnStop } = await import(
      "@/background/durable-turn-runtime"
    )

    await expect(requestDurableTurnStop("turn-1")).resolves.toBe(false)
  })

  it("settles interrupted cancellations before resuming anything", async () => {
    const order: string[] = []
    mocks.finalizeInterruptedCancellations.mockImplementation(async () => {
      order.push("finalize")
      return []
    })
    mocks.getIncompleteTurnRuns.mockImplementation(async () => {
      order.push("read-resumable")
      return []
    })
    const { resumeIncompleteTurnRuns } = await import(
      "@/background/durable-turn-runtime"
    )

    await resumeIncompleteTurnRuns()

    expect(order).toEqual(["finalize", "read-resumable"])
  })
})

describe("interrupted cancellation recovery", () => {
  it("finishes the assistant of a turn it settles", async () => {
    mocks.finalizeInterruptedCancellations.mockResolvedValue([
      { id: "turn-1", assistantMessageId: 7 },
      { id: "turn-2", assistantMessageId: undefined }
    ])
    mocks.getIncompleteTurnRuns.mockResolvedValue([])
    const { resumeIncompleteTurnRuns } = await import(
      "@/background/durable-turn-runtime"
    )

    await resumeIncompleteTurnRuns()

    // Otherwise the stopped response stays done = 0 and the stale-message
    // sweep offers a retry for something the user cancelled.
    expect(mocks.updateMessage).toHaveBeenCalledWith(7, { done: true })
    expect(mocks.updateMessage).toHaveBeenCalledTimes(1)
  })

  it("still resumes live turns when finishing an assistant fails", async () => {
    mocks.finalizeInterruptedCancellations.mockResolvedValue([
      { id: "turn-1", assistantMessageId: 7 }
    ])
    mocks.updateMessage.mockRejectedValueOnce(new Error("db gone"))
    mocks.getIncompleteTurnRuns.mockResolvedValue([])
    const { resumeIncompleteTurnRuns } = await import(
      "@/background/durable-turn-runtime"
    )

    await expect(resumeIncompleteTurnRuns()).resolves.toBeUndefined()
  })
})
