import type { ContextReceipt } from "@ollama-client/contracts/turns"
import { describe, expect, it, vi } from "vitest"
import {
  type TurnContextOwner,
  type TurnGenerationOwner,
  type TurnRunStore,
  TurnRuntime
} from "../turn-runtime"

type TestContext = { rawInput: string }
type TestMessage = { role: "user"; content: string }
type TestOutput = { prompt: string }

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

const command = {
  id: "turn-1",
  sessionId: "session-1",
  mode: "new" as const,
  model: "llama3",
  persistedContext: { rawInput: "hello" },
  contextOptions: { rawInput: "hello" },
  userMessage: { role: "user" as const, content: "hello" }
}

const makeRuntime = (
  store: TurnRunStore<TestContext, TestMessage>,
  context: TurnContextOwner<TestContext, TestOutput>,
  generation: TurnGenerationOwner<TestContext, TestMessage, TestOutput>
) =>
  new TurnRuntime<TestContext, TestMessage, TestContext, TestOutput>(
    store,
    context,
    generation,
    {
      toFailure: (error) => ({
        status: 0,
        message: error instanceof Error ? error.message : "Turn failed"
      })
    },
    { now: () => 10 }
  )

describe("TurnRuntime", () => {
  it("owns the durable lifecycle in order", async () => {
    const order: string[] = []
    const store: TurnRunStore<TestContext, TestMessage> = {
      create: vi.fn(async () => {
        order.push("create")
      }),
      update: vi.fn(async (_id, update) => {
        order.push(`update:${update.status}`)
      })
    }
    const context: TurnContextOwner<TestContext, TestOutput> = {
      build: vi.fn(async () => {
        order.push("context")
        return { prompt: "hello", receipt }
      })
    }
    const generation: TurnGenerationOwner<
      TestContext,
      TestMessage,
      TestOutput
    > = {
      start: vi.fn(async () => {
        order.push("generation")
        return { userMessageId: 1, assistantMessageId: 2 }
      })
    }

    await makeRuntime(store, context, generation).start(command)

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
        createdAt: 10,
        request: {
          version: 1,
          context: command.persistedContext,
          userMessage: command.userMessage
        }
      })
    )
  })

  it("maps and persists failures before rethrowing", async () => {
    const store: TurnRunStore<TestContext, TestMessage> = {
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined)
    }
    const context: TurnContextOwner<TestContext, TestOutput> = {
      build: vi.fn().mockRejectedValue(new Error("context unavailable"))
    }
    const generation: TurnGenerationOwner<
      TestContext,
      TestMessage,
      TestOutput
    > = { start: vi.fn() }

    await expect(
      makeRuntime(store, context, generation).start(command)
    ).rejects.toThrow("context unavailable")
    expect(store.update).toHaveBeenLastCalledWith("turn-1", {
      status: "failed",
      failure: { status: 0, message: "context unavailable" }
    })
    expect(generation.start).not.toHaveBeenCalled()
  })

  it("resumes without creating a second durable intent", async () => {
    const store: TurnRunStore<TestContext, TestMessage> = {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined)
    }
    const context: TurnContextOwner<TestContext, TestOutput> = {
      build: vi.fn().mockResolvedValue({ prompt: "hello", receipt })
    }
    const generation: TurnGenerationOwner<
      TestContext,
      TestMessage,
      TestOutput
    > = { start: vi.fn().mockResolvedValue({ outcome: "cancelled" }) }
    const runtime = makeRuntime(store, context, generation)

    await runtime.resume({
      turn: {
        ...command,
        request: {
          version: 1,
          context: command.persistedContext,
          userMessage: command.userMessage
        },
        createdAt: 10,
        updatedAt: 12,
        status: "generating"
      },
      contextOptions: command.contextOptions
    })

    expect(store.create).not.toHaveBeenCalled()
    expect(store.update).toHaveBeenLastCalledWith("turn-1", {
      status: "cancelled",
      failure: null
    })
  })
})
