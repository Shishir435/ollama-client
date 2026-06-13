import { afterEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/providers/types"
import {
  clearModelToolCapabilityCache,
  resolveModelTools
} from "../resolve-model-tools"

vi.mock("@/lib/providers/model-capability-overrides", () => ({
  getModelCapabilityOverride: vi.fn(async () => null)
}))

const definitions = [
  {
    name: "current_tab",
    description: "Read tab",
    parameters: { type: "object" as const, properties: {} }
  }
]

vi.mock("@/lib/tools", () => ({
  getToolRegistry: () => ({
    listDefinitions: vi.fn(async () => definitions)
  })
}))

const providerWithDetails = (
  getModelDetails: LLMProvider["getModelDetails"]
): LLMProvider => ({
  id: "ollama",
  config: {
    id: "ollama",
    type: "ollama" as never,
    name: "Ollama",
    enabled: true,
    baseUrl: "http://localhost:11434"
  },
  capabilities: {} as LLMProvider["capabilities"],
  streamChat: vi.fn(),
  getModels: vi.fn(async () => []),
  getModelDetails
})

describe("resolveModelTools", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    clearModelToolCapabilityCache()
  })

  it("re-reads cached model capability tags after the short TTL expires", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const getModelDetails = vi
      .fn()
      .mockResolvedValueOnce({ capabilities: ["completion"] })
      .mockResolvedValueOnce({ capabilities: ["completion", "tools"] })
    const provider = providerWithDetails(getModelDetails)

    await expect(
      resolveModelTools("qwen", "ollama", provider)
    ).resolves.toBeUndefined()
    await expect(
      resolveModelTools("qwen", "ollama", provider)
    ).resolves.toBeUndefined()
    expect(getModelDetails).toHaveBeenCalledTimes(1)

    vi.setSystemTime(61_000)

    await expect(resolveModelTools("qwen", "ollama", provider)).resolves.toBe(
      definitions
    )
    expect(getModelDetails).toHaveBeenCalledTimes(2)
  })
})
