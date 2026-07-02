import { beforeEach, describe, expect, it, vi } from "vitest"

const storageBacking = vi.hoisted(() => new Map<string, unknown>())

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => storageBacking.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    storageBacking.set(key, value)
  })
}))

import type { LLMProvider } from "@/lib/providers/types"
import type { ChatStreamMessage } from "@/types"
import {
  clearCapabilityProbesForProvider,
  getCapabilityProbe,
  probeToolCalling,
  setCapabilityProbe
} from "../capability-probe"

const providerWith = (chunks: ChatStreamMessage[]): LLMProvider => ({
  id: "test",
  config: {} as LLMProvider["config"],
  capabilities: {} as LLMProvider["capabilities"],
  streamChat: vi.fn(async (_req, onChunk) => {
    for (const chunk of chunks) onChunk(chunk)
  }),
  getModels: async () => []
})

describe("probeToolCalling", () => {
  it("reports toolCalling true when the model emits a tool call", async () => {
    const provider = providerWith([
      {
        toolCalls: [
          { id: "ping_0", name: "ping", arguments: { value: "pong" } }
        ]
      },
      { done: true }
    ])

    const result = await probeToolCalling(provider, "m")
    expect(result.toolCalling).toBe(true)
  })

  it("reports toolCalling false when the model answers in text", async () => {
    const provider = providerWith([
      { delta: "I cannot call tools." },
      { done: true }
    ])

    const result = await probeToolCalling(provider, "m")
    expect(result.toolCalling).toBe(false)
  })

  it("throws when the request errors without a tool call", async () => {
    const provider = providerWith([
      { error: { status: 404, message: "model not found" }, done: true }
    ])

    await expect(probeToolCalling(provider, "m")).rejects.toThrow(
      /model not found/
    )
  })

  it("offers exactly one tool in the probe request", async () => {
    const provider = providerWith([{ done: true }])
    await probeToolCalling(provider, "m")

    const request = vi.mocked(provider.streamChat).mock.calls[0]?.[0]
    expect(request?.tools).toHaveLength(1)
    expect(request?.tools?.[0]?.name).toBe("ping")
    expect(request?.think).toBe(false)
  })
})

describe("probe storage", () => {
  beforeEach(() => {
    storageBacking.clear()
  })

  it("round-trips a probe result", async () => {
    await setCapabilityProbe("vllm", "llama3", {
      toolCalling: true,
      probedAt: 123
    })

    expect(await getCapabilityProbe("vllm", "llama3")).toEqual({
      toolCalling: true,
      probedAt: 123
    })
    expect(await getCapabilityProbe("vllm", "other")).toBeNull()
  })

  it("clears every probe for a provider, keeping others", async () => {
    await setCapabilityProbe("vllm", "llama3", {
      toolCalling: true,
      probedAt: 1
    })
    await setCapabilityProbe("vllm", "qwen3", {
      toolCalling: false,
      probedAt: 2
    })
    await setCapabilityProbe("lm studio", "llama3", {
      toolCalling: true,
      probedAt: 3
    })

    await clearCapabilityProbesForProvider("vllm")

    expect(await getCapabilityProbe("vllm", "llama3")).toBeNull()
    expect(await getCapabilityProbe("vllm", "qwen3")).toBeNull()
    expect(await getCapabilityProbe("lm studio", "llama3")).toEqual({
      toolCalling: true,
      probedAt: 3
    })
  })
})
