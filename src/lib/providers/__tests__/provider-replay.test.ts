import { describe, expect, it } from "vitest"

import type { ProviderReplayArtifact } from "@/types/chat"
import {
  createProviderReplayArtifact,
  getProviderReplayBlocks,
  parseStoredReplayArtifact,
  serializeReplayArtifact
} from "../provider-replay"

describe("provider replay artifacts", () => {
  it("round-trips Anthropic opaque blocks without changing their values", () => {
    const blocks = [
      { type: "thinking", thinking: "summary", signature: "opaque-sig" },
      { type: "redacted_thinking", data: "opaque-data" },
      { type: "tool_use", id: "tool-1", name: "weather", input: {} }
    ]
    const artifact = createProviderReplayArtifact(
      "anthropic",
      "anthropic-1",
      "claude-test",
      blocks
    )

    const stored = serializeReplayArtifact(artifact)
    expect(parseStoredReplayArtifact(stored)).toEqual(artifact)
    expect(
      getProviderReplayBlocks(artifact, {
        wire: "anthropic",
        providerId: "anthropic-1",
        model: "claude-test"
      })
    ).toEqual(blocks)
  })

  it("accepts the documented OpenRouter reasoning detail variants", () => {
    const blocks = [
      {
        type: "reasoning.summary",
        summary: "summary",
        id: "summary-1",
        format: "anthropic-claude-v1",
        index: 0
      },
      {
        type: "reasoning.encrypted",
        data: "ciphertext",
        id: "encrypted-1",
        format: "anthropic-claude-v1",
        index: 1
      },
      {
        type: "reasoning.text",
        text: "visible reasoning",
        signature: null,
        id: "text-1",
        format: "anthropic-claude-v1",
        index: 2
      }
    ]

    expect(
      createProviderReplayArtifact("openai", "openrouter", "model", blocks)
        .blocks
    ).toEqual(blocks)
  })

  it("ignores a valid artifact owned by another provider or model", () => {
    const artifact = createProviderReplayArtifact(
      "openai",
      "openrouter-a",
      "model-a",
      [{ type: "reasoning.text", text: "x", signature: null }]
    )

    expect(
      getProviderReplayBlocks(artifact, {
        wire: "openai",
        providerId: "openrouter-b",
        model: "model-a"
      })
    ).toBeUndefined()
    expect(
      getProviderReplayBlocks(artifact, {
        wire: "openai",
        providerId: "openrouter-a",
        model: "model-b"
      })
    ).toBeUndefined()
  })

  it("fails locally for malformed or oversized matching artifacts", () => {
    const malformed = {
      version: 1,
      wire: "anthropic",
      providerId: "anthropic-1",
      model: "claude-test",
      blocks: [{ type: "thinking", thinking: "missing signature" }]
    } as ProviderReplayArtifact

    expect(() =>
      getProviderReplayBlocks(malformed, {
        wire: "anthropic",
        providerId: "anthropic-1",
        model: "claude-test"
      })
    ).toThrow(/continuation data is invalid/i)
    expect(parseStoredReplayArtifact(JSON.stringify(malformed))).toBeUndefined()

    expect(() =>
      createProviderReplayArtifact("openai", "openrouter", "model", [
        {
          type: "reasoning.encrypted",
          data: "x".repeat(1024 * 1024)
        }
      ])
    ).toThrow(/continuation data is invalid/i)
  })
})
