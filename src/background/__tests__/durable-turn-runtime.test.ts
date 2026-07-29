import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  contextBuild: vi.fn(),
  handleChat: vi.fn(),
  resolveRetrievalToolsActive: vi.fn(),
  appendMessage: vi.fn(),
  getSession: vi.fn(),
  updateMessage: vi.fn(),
  createTurnRun: vi.fn(),
  getIncompleteTurnRuns: vi.fn(),
  updateTurnRun: vi.fn()
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
  getSession: mocks.getSession,
  updateMessage: mocks.updateMessage
}))

vi.mock("@/lib/repositories/turn-runs", () => ({
  createTurnRun: mocks.createTurnRun,
  getIncompleteTurnRuns: mocks.getIncompleteTurnRuns,
  updateTurnRun: mocks.updateTurnRun
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() }
}))

import type {
  DurableTurnRun,
  TurnSubmission
} from "@/application/turns/turn-contract"
import {
  resumeIncompleteTurnRuns,
  startDurableTurn
} from "@/background/durable-turn-runtime"

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
  })
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
      "status:building-context",
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
      failure: "context unavailable"
    })
    expect(mocks.updateMessage).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({
        content: "Turn failed before completion.",
        done: true
      })
    )
  })
})
