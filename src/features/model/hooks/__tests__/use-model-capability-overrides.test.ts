import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TOOL_CALLING_PROBE_VERSION } from "@/lib/providers/capability-probe"
import type { ProviderModel } from "@/types"
import { useModelCapabilityOverrides } from "../use-model-capability-overrides"

const stored = vi.hoisted(() => ({ probes: {} as Record<string, unknown> }))
vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [stored.probes, vi.fn()]
}))

describe("useModelCapabilityOverrides", () => {
  it("preserves catalog-reported image output metadata", () => {
    const model = {
      name: "codex/image-generation",
      model: "codex/image-generation",
      providerId: "custom:openai:codex",
      details: { family: "openai" },
      capabilityHints: {
        modalities: ["text"],
        outputModalities: ["image"]
      }
    } as ProviderModel

    const { result } = renderHook(() => useModelCapabilityOverrides())

    expect(result.current.resolve(model).imageOutput).toBe(true)
  })

  it("drops a tool result from an older probe version, as the background does", () => {
    stored.probes = {
      "llamacpp::old": {
        toolCalling: true,
        toolCallingProbeVersion: 1,
        reasoning: true
      },
      "llamacpp::new": {
        toolCalling: true,
        toolCallingProbeVersion: TOOL_CALLING_PROBE_VERSION
      }
    }
    const { result } = renderHook(() => useModelCapabilityOverrides())

    expect(result.current.getProbe("llamacpp", "old")).toEqual({
      reasoning: true
    })
    expect(result.current.getProbe("llamacpp", "new")?.toolCalling).toBe(true)
    stored.probes = {}
  })
})
