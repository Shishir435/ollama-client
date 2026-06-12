import { describe, expect, it } from "vitest"
import {
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
      toolCalling: false
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
      toolCalling: true
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
