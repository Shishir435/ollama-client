import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DurableTurnGenerationError } from "@/application/turns/turn-contract"
import { hasPartialOutput } from "@/features/chat/lib/partial-output"
import type { ChatMessage } from "@/types"

const updateMessage = vi.hoisted(() => vi.fn())

vi.mock("@/lib/repositories/chat-history", () => ({
  appendMessage: vi.fn(),
  getSession: vi.fn(),
  updateMessage,
  updateMessageWithImages: vi.fn()
}))
vi.mock("@/background/handlers/handle-chat-with-model", () => ({
  handleChatWithModel: vi.fn()
}))

import { persistTurnFailure } from "../turn-generation"

const failure: AppFailure = {
  status: 500,
  kind: "provider",
  message: "upstream error",
  userMessage: "The server failed while answering."
}

/** The row as a reopened chat reads it back. */
const persistedRow = (): ChatMessage => ({
  role: "assistant",
  ...updateMessage.mock.calls.at(-1)?.[1]
})

beforeEach(() => {
  updateMessage.mockReset()
  updateMessage.mockResolvedValue(7)
})

describe("recording a failed turn", () => {
  it("keeps the partial answer as the body so a reopened chat can continue it", async () => {
    const partial: ChatMessage = {
      role: "assistant",
      content: "The first three steps are",
      thinking: "list the steps",
      model: "llama3.2",
      done: false
    }

    await persistTurnFailure(
      7,
      "llama3.2",
      new DurableTurnGenerationError(failure, partial)
    )

    const row = persistedRow()
    expect(row.content).toBe("The first three steps are")
    expect(row.thinking).toBe("list the steps")
    expect(row.done).toBe(true)
    expect(row.error?.userMessage).toBe(failure.userMessage)
    expect(hasPartialOutput(row)).toBe(true)
  })

  it("stores the failure as the body when the model wrote nothing", async () => {
    await persistTurnFailure(
      7,
      "llama3.2",
      new DurableTurnGenerationError(failure, {
        role: "assistant",
        content: "  ",
        done: false
      })
    )

    const row = persistedRow()
    expect(row.content).toBe(failure.userMessage)
    expect(hasPartialOutput(row)).toBe(false)
  })

  it("leaves the row's stored tool runs and reasoning alone when the model wrote nothing", async () => {
    await persistTurnFailure(7, "llama3.2", new Error("worker lost"))

    const updates = updateMessage.mock.calls.at(-1)?.[1] ?? {}
    expect(updates).not.toHaveProperty("metrics")
    expect(updates).not.toHaveProperty("thinking")
  })

  it("never keeps a replay artifact from a stream that broke part-way", async () => {
    await persistTurnFailure(
      7,
      "llama3.2",
      new DurableTurnGenerationError(failure, {
        role: "assistant",
        content: "Half an answer",
        replayArtifact: { kind: "opaque" } as never,
        done: false
      })
    )
    expect(updateMessage.mock.calls.at(-1)?.[1].replayArtifact).toBeUndefined()

    await persistTurnFailure(7, "llama3.2", new Error("worker lost"))
    const updates = updateMessage.mock.calls.at(-1)?.[1] ?? {}
    expect(updates).toHaveProperty("replayArtifact", undefined)
  })

  it("records the tool runs of a turn that failed before writing text", async () => {
    const toolRuns = [
      {
        toolId: "save_artifact",
        label: "Save",
        status: "done" as const,
        startedAt: 1
      }
    ]
    await persistTurnFailure(
      7,
      "llama3.2",
      new DurableTurnGenerationError(failure, {
        role: "assistant",
        content: "",
        metrics: { toolRuns },
        done: false
      })
    )

    const row = persistedRow()
    expect(row.content).toBe(failure.userMessage)
    expect(row.metrics?.toolRuns).toEqual(toolRuns)
  })

  it("falls back to generic text for a turn that failed before streaming", async () => {
    await persistTurnFailure(7, "llama3.2", new Error("context build threw"))

    const row = persistedRow()
    expect(row.content).toBe("Turn failed before completion.")
    expect(hasPartialOutput(row)).toBe(false)
  })
})
