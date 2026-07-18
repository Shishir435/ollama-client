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
  probeReasoning,
  probeToolCalling,
  probeVision,
  setCapabilityProbe,
  TOOL_CALLING_PROBE_VERSION
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
    expect(result.toolCallingMode).toBe("native")
    expect(provider.streamChat).toHaveBeenCalledTimes(2)
  })

  it("uses user-role results when the standard tool role is rejected", async () => {
    const provider = providerWith([])
    vi.mocked(provider.streamChat)
      .mockImplementationOnce(async (_request, onChunk) => {
        onChunk({
          toolCalls: [
            { id: "ping_0", name: "ping", arguments: { value: "pong" } }
          ]
        })
        onChunk({ done: true })
      })
      .mockRejectedValueOnce(
        new Error("Conversation roles must alternate user/assistant")
      )
      .mockImplementationOnce(async (_request, onChunk) => {
        onChunk({ delta: "pong received" })
        onChunk({ done: true })
      })

    const result = await probeToolCalling(provider, "m")

    expect(result).toMatchObject({
      toolCalling: true,
      toolCallingMode: "native-user-results"
    })
    const standardFollowUp = vi.mocked(provider.streamChat).mock.calls[1]?.[0]
    expect(standardFollowUp?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool"
    ])
    const compatibleFollowUp = vi.mocked(provider.streamChat).mock.calls[2]?.[0]
    expect(compatibleFollowUp?.messages.map((message) => message.role)).toEqual(
      ["user", "assistant", "user"]
    )
    expect(compatibleFollowUp?.messages[1]?.toolCalls).toHaveLength(1)
    expect(compatibleFollowUp?.tool_choice).toBe("none")
  })

  it("reports false when both tool-result transports fail", async () => {
    const provider = providerWith([])
    vi.mocked(provider.streamChat)
      .mockImplementationOnce(async (_request, onChunk) => {
        onChunk({
          toolCalls: [
            { id: "ping_0", name: "ping", arguments: { value: "pong" } }
          ]
        })
        onChunk({ done: true })
      })
      .mockRejectedValueOnce(new Error("tool role rejected"))
      .mockRejectedValueOnce(new Error("user result rejected"))

    await expect(probeToolCalling(provider, "m")).resolves.toMatchObject({
      toolCalling: false
    })
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

describe("probeReasoning", () => {
  it("reports reasoning true when the model emits a thinking delta", async () => {
    const provider = providerWith([
      { thinkingDelta: "let me think..." },
      { delta: "4" },
      { done: true }
    ])

    const result = await probeReasoning(provider, "m")
    expect(result.reasoning).toBe(true)
  })

  it("reports reasoning false when the model answers without thinking", async () => {
    const provider = providerWith([{ delta: "4" }, { done: true }])

    const result = await probeReasoning(provider, "m")
    expect(result.reasoning).toBe(false)
  })

  it("treats a 'does not support thinking' error as a clean false", async () => {
    const provider = providerWith([
      {
        error: { status: 400, message: "model does not support thinking" },
        done: true
      }
    ])

    const result = await probeReasoning(provider, "m")
    expect(result.reasoning).toBe(false)
  })

  it("surfaces other request errors instead of recording false", async () => {
    const provider = providerWith([
      { error: { status: 404, message: "model not found" }, done: true }
    ])

    await expect(probeReasoning(provider, "m")).rejects.toThrow(
      /model not found/
    )
  })

  it("sends think:true in the probe request", async () => {
    const provider = providerWith([{ done: true }])
    await probeReasoning(provider, "m")

    const request = vi.mocked(provider.streamChat).mock.calls[0]?.[0]
    expect(request?.think).toBe(true)
  })
})

describe("probeVision", () => {
  it("reports vision true when the model reads the image color", async () => {
    const provider = providerWith([
      { delta: "The dominant color is red." },
      { done: true }
    ])

    const result = await probeVision(provider, "m")
    expect(result.vision).toBe(true)
  })

  it("stays inconclusive (no verdict) when the answer misses the color", async () => {
    const provider = providerWith([{ delta: "I can't tell." }, { done: true }])

    const result = await probeVision(provider, "m")
    // No `vision` key → the resolver keeps metadata rather than a wrong false.
    expect(result.vision).toBeUndefined()
  })

  it("reports vision false when the server rejects image input", async () => {
    const provider = providerWith([
      {
        error: { status: 400, message: "this model does not support images" },
        done: true
      }
    ])

    const result = await probeVision(provider, "m")
    expect(result.vision).toBe(false)
  })

  it("sends the probe image with the request", async () => {
    const provider = providerWith([{ delta: "red" }, { done: true }])
    await probeVision(provider, "m")

    const request = vi.mocked(provider.streamChat).mock.calls[0]?.[0]
    expect(request?.messages[0]?.images).toHaveLength(1)
    expect(request?.messages[0]?.images?.[0]?.base64).toBeTruthy()
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
      toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION,
      probedAt: 123
    })
    expect(await getCapabilityProbe("vllm", "other")).toBeNull()
  })

  it("merges partial probe results instead of replacing them", async () => {
    await setCapabilityProbe("vllm", "llama3", {
      toolCalling: true,
      probedAt: 1
    })
    await setCapabilityProbe("vllm", "llama3", {
      reasoning: false,
      probedAt: 2
    })

    expect(await getCapabilityProbe("vllm", "llama3")).toEqual({
      toolCalling: true,
      toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION,
      reasoning: false,
      probedAt: 2
    })
  })

  it("does not drop a concurrent write to a different model", async () => {
    // Two contexts probing different models at the same instant — serialized
    // writes must preserve both, not have the later write clobber the earlier.
    await Promise.all([
      setCapabilityProbe("vllm", "llama3", { toolCalling: true, probedAt: 1 }),
      setCapabilityProbe("vllm", "qwen3", { reasoning: true, probedAt: 2 })
    ])

    expect(await getCapabilityProbe("vllm", "llama3")).toEqual({
      toolCalling: true,
      toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION,
      probedAt: 1
    })
    expect(await getCapabilityProbe("vllm", "qwen3")).toEqual({
      reasoning: true,
      probedAt: 2
    })
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
      toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION,
      probedAt: 3
    })
  })

  it("ignores legacy tool evidence that did not test the result turn", async () => {
    storageBacking.set("provider-model-capability-probes", {
      "llamacpp::gemma": {
        toolCalling: true,
        reasoning: false,
        probedAt: 1
      }
    })

    expect(await getCapabilityProbe("llamacpp", "gemma")).toEqual({
      reasoning: false,
      probedAt: 1
    })
  })
})
