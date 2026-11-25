import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../use-provider-models", () => ({
  useProviderModels: () => ({
    models: [{ name: "qwen-local", providerId: "lmstudio" }],
    selectedModel: "qwen-local",
    selectedProviderId: "lmstudio"
  })
}))
vi.mock("../use-model-info", () => ({
  useModelInfo: () => ({ modelInfo: null, loading: false })
}))
const probe = vi.hoisted(() => ({ toolCalling: true as boolean | undefined }))
vi.mock("../use-model-capability-overrides", () => ({
  useModelCapabilityOverrides: () => ({
    getOverride: () => undefined,
    getProbe: () => (probe.toolCalling === undefined ? null : probe)
  })
}))

import { useSelectedModelCapabilities } from "../use-selected-model-capabilities"

describe("useSelectedModelCapabilities", () => {
  it("reports tool calling a successful probe found, as requests do", () => {
    probe.toolCalling = true
    const { result } = renderHook(() => useSelectedModelCapabilities())
    expect(result.current.capabilities?.toolCalling).toBe(true)
  })

  it("leaves unknown tool calling false without a probe", () => {
    probe.toolCalling = undefined
    const { result } = renderHook(() => useSelectedModelCapabilities())
    expect(result.current.capabilities?.toolCalling).toBe(false)
  })
})
