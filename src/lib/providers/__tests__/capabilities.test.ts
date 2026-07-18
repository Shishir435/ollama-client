import { describe, expect, it } from "vitest"
import {
  getModelCapabilities,
  getModelCapabilityStates,
  getProviderCapabilities,
  PROVIDER_CAPABILITIES
} from "@/lib/providers/capabilities"
import { ProviderId } from "@/lib/providers/types"

describe("provider capabilities", () => {
  it("keeps current provider capability facts in one shared source", () => {
    expect(PROVIDER_CAPABILITIES[ProviderId.OLLAMA]).toMatchObject({
      modelDetails: true,
      modelPull: true,
      modelUnload: true,
      modelDelete: true,
      providerVersion: true,
      toolCalling: true
    })

    expect(PROVIDER_CAPABILITIES[ProviderId.LM_STUDIO]).toMatchObject({
      modelPull: true,
      modelUnload: true,
      providerVersion: false,
      toolCalling: true
    })

    expect(PROVIDER_CAPABILITIES[ProviderId.LLAMA_CPP]).toMatchObject({
      modelPull: false,
      modelUnload: false,
      modelDelete: false,
      toolCalling: false
    })
  })

  it("returns defensive copies for UI consumers", () => {
    const capabilities = getProviderCapabilities(ProviderId.OLLAMA)

    expect(capabilities).toEqual(PROVIDER_CAPABILITIES[ProviderId.OLLAMA])
    expect(capabilities).not.toBe(PROVIDER_CAPABILITIES[ProviderId.OLLAMA])
  })

  it("returns null for unknown providers", () => {
    expect(getProviderCapabilities("missing-provider")).toBeNull()
  })
})

describe("getModelCapabilities", () => {
  it("reads Ollama /api/show capability tags with high confidence", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.OLLAMA,
      ollamaCapabilities: ["completion", "vision", "tools", "thinking"],
      contextLength: 131072
    })

    expect(caps).toMatchObject({
      text: true,
      vision: true,
      toolCalling: true,
      reasoning: true,
      embeddings: false,
      contextLength: 131072,
      source: "model-metadata",
      confidence: "high"
    })
  })

  it("treats an embedding-only Ollama model as non-chat", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.OLLAMA,
      ollamaCapabilities: ["embedding"]
    })

    expect(caps.embeddings).toBe(true)
    expect(caps.text).toBe(false)
    expect(caps.vision).toBe(false)
  })

  it("never enables an unknown capability on a guess", () => {
    // No model metadata: vision/tools/reasoning must resolve to false, not true.
    const caps = getModelCapabilities({ providerId: ProviderId.OLLAMA })

    expect(caps.vision).toBe(false)
    expect(caps.toolCalling).toBe(false)
    expect(caps.reasoning).toBe(false)
    expect(caps.source).toBe("provider-default")
    expect(caps.confidence).toBe("low")
  })

  it("falls back to provider-level defaults for non-Ollama providers", () => {
    const caps = getModelCapabilities({ providerId: ProviderId.LM_STUDIO })

    // LM Studio's provider default advertises tool calling.
    expect(caps.toolCalling).toBe(true)
    expect(caps.text).toBe(true)
    expect(caps.vision).toBe(false)
    expect(caps.source).toBe("provider-default")
  })

  it("resolves safely for an unknown provider id", () => {
    const caps = getModelCapabilities({ providerId: "mystery" })

    expect(caps.text).toBe(true)
    expect(caps.vision).toBe(false)
    expect(caps.embeddings).toBe(false)
    expect(caps.toolCalling).toBe(false)
    expect(caps.confidence).toBe("low")
  })

  it("detects vision from an LM Studio vlm model type (medium confidence)", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.LM_STUDIO,
      lmStudioModelType: "vlm",
      contextLength: 8192
    })

    expect(caps.vision).toBe(true)
    expect(caps.text).toBe(true)
    expect(caps.embeddings).toBe(false)
    expect(caps.contextLength).toBe(8192)
    expect(caps.source).toBe("model-metadata")
    expect(caps.confidence).toBe("medium")
  })

  it("detects an LM Studio embeddings model type as non-chat", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.LM_STUDIO,
      lmStudioModelType: "embeddings"
    })

    expect(caps.embeddings).toBe(true)
    expect(caps.text).toBe(false)
    expect(caps.vision).toBe(false)
  })

  it("lets a user override turn on a capability the provider cannot report", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.VLLM,
      override: { vision: true }
    })

    expect(caps.vision).toBe(true)
    expect(caps.source).toBe("user-override")
    expect(caps.confidence).toBe("high")
  })

  it("applies an override per-field, keeping detection for unset fields", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.OLLAMA,
      ollamaCapabilities: ["completion", "tools"],
      override: { vision: true }
    })

    // Overridden field wins, detected fields are preserved.
    expect(caps.vision).toBe(true)
    expect(caps.toolCalling).toBe(true)
    expect(caps.text).toBe(true)
    expect(caps.source).toBe("user-override")
  })

  it("ignores an empty override and keeps the detected source", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.OLLAMA,
      ollamaCapabilities: ["completion"],
      override: {}
    })

    expect(caps.source).toBe("model-metadata")
    expect(caps.confidence).toBe("high")
  })

  it("applies a probe result over detection (probed, medium confidence)", () => {
    // A negative probe remains authoritative over provider defaults.
    const caps = getModelCapabilities({
      providerId: ProviderId.LLAMA_CPP,
      probed: { toolCalling: false }
    })

    expect(caps.toolCalling).toBe(false)
    expect(caps.source).toBe("probed")
    expect(caps.confidence).toBe("medium")
  })

  it("keeps llama.cpp tools off without model-level evidence", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.LLAMA_CPP,
      contextLength: 32768
    })

    expect(caps.toolCalling).toBe(false)
    expect(caps.source).toBe("provider-default")
    expect(caps.confidence).toBe("low")
  })

  it("applies a reasoning probe over detection", () => {
    const caps = getModelCapabilities({
      providerId: "custom:openai:abc123",
      probed: { reasoning: true }
    })

    expect(caps.reasoning).toBe(true)
    expect(caps.source).toBe("probed")
    expect(caps.confidence).toBe("medium")
  })

  it("keeps the user override above a reasoning probe", () => {
    const caps = getModelCapabilities({
      providerId: "custom:openai:abc123",
      probed: { reasoning: true },
      override: { reasoning: false }
    })

    expect(caps.reasoning).toBe(false)
    expect(caps.source).toBe("user-override")
  })

  it("applies a vision probe over detection", () => {
    const caps = getModelCapabilities({
      providerId: "custom:openai:abc123",
      probed: { vision: true }
    })

    expect(caps.vision).toBe(true)
    expect(caps.source).toBe("probed")
    expect(caps.confidence).toBe("medium")
  })

  it("lets a probe turn tool calling on for a provider-default model", () => {
    const caps = getModelCapabilities({
      providerId: "custom:openai:abc123",
      probed: { toolCalling: true }
    })

    expect(caps.toolCalling).toBe(true)
    expect(caps.source).toBe("probed")
  })

  it("keeps the user override above the probe", () => {
    const caps = getModelCapabilities({
      providerId: ProviderId.LLAMA_CPP,
      probed: { toolCalling: false },
      override: { toolCalling: true }
    })

    expect(caps.toolCalling).toBe(true)
    expect(caps.source).toBe("user-override")
    expect(caps.confidence).toBe("high")
  })

  it("resolves custom provider ids by wire protocol", () => {
    expect(getProviderCapabilities("custom:ollama:x")).toMatchObject({
      modelDetails: true,
      toolCalling: true
    })
    expect(getProviderCapabilities("custom:openai:x")).toMatchObject({
      modelDetails: false,
      toolCalling: true
    })
    expect(getProviderCapabilities("custom:anthropic:x")).toMatchObject({
      embeddings: false,
      modelDiscovery: true,
      toolCalling: true
    })
  })

  it("keeps unknown separate from unsupported in the new capability contract", () => {
    const states = getModelCapabilityStates({
      providerId: "unknown-provider"
    })

    expect(states.vision.status).toBe("unknown")
    expect(states.reasoning.status).toBe("unknown")
  })

  it("uses hosted catalog metadata as high-confidence capability evidence", () => {
    const input = {
      providerId: "custom:openai:openrouter",
      modalities: ["text", "image"],
      supportedParameters: ["tools", "reasoning"]
    }
    const caps = getModelCapabilities(input)
    const states = getModelCapabilityStates(input)

    expect(caps).toMatchObject({
      text: true,
      vision: true,
      toolCalling: true,
      reasoning: true,
      source: "model-metadata",
      confidence: "high"
    })
    expect(states.toolCalling).toEqual({
      status: "supported",
      source: "model-metadata",
      confidence: "high"
    })
  })

  it("treats empty catalog arrays as missing evidence", () => {
    const input = {
      providerId: "custom:openai:openrouter",
      modalities: [] as string[],
      supportedParameters: [] as string[]
    }
    const caps = getModelCapabilities(input)
    const states = getModelCapabilityStates(input)

    expect(caps.source).toBe("provider-default")
    expect(caps.confidence).toBe("low")
    expect(states.vision.status).toBe("unknown")
    expect(states.reasoning.status).toBe("unknown")
    expect(states.toolCalling).toEqual({
      status: "supported",
      source: "provider-default",
      confidence: "low"
    })
  })
})
