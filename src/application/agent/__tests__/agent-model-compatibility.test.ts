import { describe, expect, it } from "vitest"
import { TOOL_CALLING_PROBE_VERSION } from "@/lib/providers/capability-probe"
import type { LLMProvider } from "@/lib/providers/types"
import { ProviderType } from "@/lib/providers/types"
import {
  assertAgentModelCompatibility,
  deriveAgentModelCompatibility,
  resolveAgentModelCompatibility
} from "../agent-model-compatibility"

describe("deriveAgentModelCompatibility", () => {
  it("supports model-reported native tool calling", () => {
    expect(
      deriveAgentModelCompatibility({
        toolCalling: {
          status: "supported",
          source: "model-metadata",
          confidence: "high"
        }
      })
    ).toEqual({ status: "supported", mode: "native", reason: "metadata" })
  })

  it("supports a current successful round-trip probe", () => {
    expect(
      deriveAgentModelCompatibility({
        toolCalling: {
          status: "supported",
          source: "probed",
          confidence: "medium"
        },
        probe: {
          toolCalling: true,
          toolCallingMode: "native-user-results",
          toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION,
          probedAt: 1
        }
      })
    ).toEqual({
      status: "supported",
      mode: "native-user-results",
      reason: "verified_probe"
    })
  })

  it("keeps a user override visibly experimental", () => {
    expect(
      deriveAgentModelCompatibility({
        toolCalling: {
          status: "supported",
          source: "user-override",
          confidence: "high"
        }
      })
    ).toEqual({
      status: "experimental",
      mode: "native",
      reason: "user_override"
    })
  })

  it.each([
    {
      toolCalling: {
        status: "unknown" as const,
        source: "provider-default" as const,
        confidence: "low" as const
      },
      reason: "unknown"
    },
    {
      toolCalling: {
        status: "supported" as const,
        source: "provider-default" as const,
        confidence: "low" as const
      },
      reason: "unverified"
    },
    {
      toolCalling: {
        status: "unsupported" as const,
        source: "probed" as const,
        confidence: "medium" as const
      },
      reason: "reported_unsupported"
    }
  ])("fails closed for $reason evidence", ({ toolCalling, reason }) => {
    expect(deriveAgentModelCompatibility({ toolCalling })).toEqual({
      status: "unsupported",
      reason
    })
  })

  it("rejects stale or incomplete probe evidence", () => {
    expect(
      deriveAgentModelCompatibility({
        toolCalling: {
          status: "supported",
          source: "probed",
          confidence: "medium"
        },
        probe: {
          toolCalling: true,
          toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION - 1,
          probedAt: 1
        }
      })
    ).toEqual({ status: "unsupported", reason: "unverified" })
  })

  it("requires an explicit opt-in for experimental compatibility", () => {
    const compatibility = {
      status: "experimental" as const,
      mode: "native" as const,
      reason: "user_override" as const
    }
    expect(() => assertAgentModelCompatibility(compatibility)).toThrow(
      "requires an explicit override"
    )
    expect(() =>
      assertAgentModelCompatibility(compatibility, true)
    ).not.toThrow()
  })

  it("derives fresh privileged evidence instead of trusting a UI verdict", async () => {
    const provider: LLMProvider = {
      id: "custom:openai:test",
      config: {
        id: "custom:openai:test",
        type: ProviderType.OPENAI,
        enabled: true,
        name: "Test"
      },
      capabilities: {
        chat: true,
        embeddings: false,
        modelDiscovery: true,
        modelDetails: false,
        modelPull: false,
        modelUnload: false,
        modelDelete: false,
        providerVersion: false,
        toolCalling: true
      },
      streamChat: async () => undefined,
      getModels: async () => []
    }

    await expect(
      resolveAgentModelCompatibility(provider.id, "model", undefined, {
        resolveProvider: async () => provider,
        discoverModels: async () => ({
          catalog: "present",
          models: [
            {
              name: "model",
              model: "model",
              modified_at: "",
              size: 0,
              digest: "",
              details: {
                parent_model: "",
                format: "",
                family: "",
                families: [],
                parameter_size: "",
                quantization_level: ""
              },
              capabilityHints: { supportedParameters: ["tools"] }
            }
          ]
        }),
        getProbe: async () => null,
        getOverride: async () => null
      })
    ).resolves.toEqual({
      status: "supported",
      mode: "native",
      reason: "metadata"
    })
  })
})
