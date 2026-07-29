import { describe, expect, it, vi } from "vitest"
import type { ContextService } from "@/application/context/context-service"
import type { ContextReceipt } from "../turn-contract"
import {
  type TurnGenerationOwner,
  type TurnRunStore,
  TurnService
} from "../turn-service"

const receipt: ContextReceipt = {
  version: 1,
  turnId: "turn-1",
  mode: "new",
  createdAt: 11,
  query: "hello",
  model: { id: "llama3" },
  prompt: {
    inputLength: 5,
    augmentedLength: 5,
    tabContextLength: 0,
    ragContextLength: 0,
    tabContextTruncated: false,
    groundedOnlyMode: false,
    insufficientContext: false
  },
  sources: []
}

const contextResult = {
  contentWithRAG: "hello",
  ragSources: null,
  pageContextAdded: false,
  promptContextStats: {
    promptInputLength: 5,
    promptAugmentedLength: 5,
    tabContextLength: 0,
    ragContextLength: 0,
    tabContextTruncated: false,
    groundedOnlyMode: false,
    insufficientContext: false,
    usedContextChunks: [],
    activityEvents: []
  }
}

const command = {
  id: "turn-1",
  sessionId: "session-1",
  mode: "new" as const,
  model: "llama3",
  contextOptions: {
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
    selectedModelRef: null,
    toast: vi.fn()
  },
  createdAt: 10
}

describe("TurnService", () => {
  it("persists submitted intent before context or generation starts", async () => {
    const order: string[] = []
    const store: TurnRunStore = {
      create: vi.fn(async () => {
        order.push("create")
      }),
      update: vi.fn(async (_id, update) => {
        order.push(`update:${update.status}`)
      })
    }
    const context = {
      build: vi.fn(async () => {
        order.push("context")
        return { result: contextResult, receipt }
      })
    } as unknown as ContextService
    const generation: TurnGenerationOwner = {
      start: vi.fn(async () => {
        order.push("generation")
        return { userMessageId: 1, assistantMessageId: 2 }
      })
    }

    await new TurnService(store, context, generation).start(command)

    expect(order).toEqual([
      "create",
      "update:building-context",
      "context",
      "update:generating",
      "generation",
      "update:completed"
    ])
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "turn-1",
        request: command.contextOptions
      })
    )
    expect(store.update).toHaveBeenLastCalledWith("turn-1", {
      status: "completed",
      userMessageId: 1,
      assistantMessageId: 2
    })
  })

  it("persists explicit failure after durable submission", async () => {
    const store: TurnRunStore = {
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined)
    }
    const context = {
      build: vi.fn().mockRejectedValue(new Error("context unavailable"))
    } as unknown as ContextService
    const generation: TurnGenerationOwner = {
      start: vi.fn()
    }

    await expect(
      new TurnService(store, context, generation).start(command)
    ).rejects.toThrow("context unavailable")

    expect(store.create).toHaveBeenCalledTimes(1)
    expect(store.update).toHaveBeenLastCalledWith("turn-1", {
      status: "failed",
      failure: "context unavailable"
    })
    expect(generation.start).not.toHaveBeenCalled()
  })
})
