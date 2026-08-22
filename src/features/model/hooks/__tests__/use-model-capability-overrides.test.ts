import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ProviderModel } from "@/types"
import { useModelCapabilityOverrides } from "../use-model-capability-overrides"

vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [{}, vi.fn()]
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
})
