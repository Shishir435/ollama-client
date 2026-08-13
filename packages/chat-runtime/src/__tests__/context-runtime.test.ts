import { describe, expect, it, vi } from "vitest"
import {
  type ContextResultEvidence,
  ContextRuntime,
  createContextReceipt
} from "../context-runtime"

interface TestResult extends ContextResultEvidence {
  content: string
}

const result: TestResult = {
  content: "grounded answer",
  promptContextStats: {
    promptInputLength: 5,
    promptAugmentedLength: 20,
    tabContextLength: 4,
    ragContextLength: 11,
    tabContextTruncated: true,
    groundedOnlyMode: true,
    insufficientContext: false,
    usedContextChunks: [
      {
        id: "file-1",
        title: "Notes",
        excerpt: "Relevant notes",
        score: 0.9,
        source: "file",
        chunkIndex: 2
      },
      {
        id: "external-1",
        title: "External",
        titleKey: "chat.sources.external",
        excerpt: "External context",
        score: 0.7,
        source: "future-source"
      }
    ]
  }
}

const command = {
  turnId: "turn-1",
  mode: "new" as const,
  model: "llama3",
  providerId: "ollama",
  options: { rawInput: "hello" }
}

describe("ContextRuntime", () => {
  it("projects receipt evidence without invoking an environment adapter", () => {
    expect(
      createContextReceipt(command, result.promptContextStats, 42)
    ).toMatchObject({
      turnId: "turn-1",
      createdAt: 42,
      query: "hello",
      model: { id: "llama3", providerId: "ollama" },
      sources: [
        { id: "file-1", source: "file" },
        { id: "external-1", source: "unknown" }
      ]
    })
  })

  it("builds context and durable evidence as one operation", async () => {
    const builder = { build: vi.fn().mockResolvedValue(result) }
    const runtime = new ContextRuntime(builder, { now: () => 42 })

    const output = await runtime.build(command)

    expect(builder.build).toHaveBeenCalledWith(command.options)
    expect(output.result).toBe(result)
    expect(output.receipt).toEqual({
      version: 1,
      turnId: "turn-1",
      mode: "new",
      createdAt: 42,
      query: "hello",
      model: { id: "llama3", providerId: "ollama" },
      prompt: {
        inputLength: 5,
        augmentedLength: 20,
        tabContextLength: 4,
        ragContextLength: 11,
        tabContextTruncated: true,
        groundedOnlyMode: true,
        insufficientContext: false
      },
      sources: [
        {
          id: "file-1",
          title: "Notes",
          excerpt: "Relevant notes",
          score: 0.9,
          source: "file",
          chunkIndex: 2
        },
        {
          id: "external-1",
          title: "External",
          titleKey: "chat.sources.external",
          excerpt: "External context",
          score: 0.7,
          source: "unknown"
        }
      ]
    })
  })

  it("omits an absent provider id", async () => {
    const runtime = new ContextRuntime(
      { build: vi.fn().mockResolvedValue(result) },
      { now: () => 42 }
    )

    const output = await runtime.build({ ...command, providerId: undefined })

    expect(output.receipt.model).toEqual({ id: "llama3" })
  })

  it("does not mint evidence when context building fails", async () => {
    const error = new Error("retrieval failed")
    const clock = { now: vi.fn(() => 42) }
    const runtime = new ContextRuntime(
      { build: vi.fn().mockRejectedValue(error) },
      clock
    )

    await expect(runtime.build(command)).rejects.toBe(error)
    expect(clock.now).not.toHaveBeenCalled()
  })
})
