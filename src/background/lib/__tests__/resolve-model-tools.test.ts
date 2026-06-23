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
  },
  {
    name: "rag_search",
    description: "Search memory",
    parameters: { type: "object" as const, properties: {} }
  },
  {
    name: "web_search",
    description: "Search web",
    parameters: { type: "object" as const, properties: {} }
  }
]

vi.mock("@/lib/tools", () => ({
  getToolRegistry: () => ({
    listDefinitions: vi.fn(async () => definitions)
  })
}))

const allOn = {
  enabled: true,
  families: {
    browser: true,
    knowledge: true,
    history: true,
    web: true,
    automation: true
  }
}
let toolSettings: typeof allOn = allOn
vi.mock("@/lib/tools/tool-settings", () => ({
  getToolFamilySettings: () => Promise.resolve(toolSettings)
}))

const toolModel = (): LLMProvider =>
  providerWithDetails(vi.fn(async () => ({ capabilities: ["tools"] })))

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
    toolSettings = allOn
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

    await expect(
      resolveModelTools("qwen", "ollama", provider)
    ).resolves.toEqual(definitions)
    expect(getModelDetails).toHaveBeenCalledTimes(2)
  })

  it("offers all tools when every family is enabled (default)", async () => {
    await expect(
      resolveModelTools("qwen", "ollama", toolModel())
    ).resolves.toEqual(definitions)
  })

  it("offers no tools when the master switch is off", async () => {
    toolSettings = { ...allOn, enabled: false }
    await expect(
      resolveModelTools("qwen", "ollama", toolModel())
    ).resolves.toBeUndefined()
  })

  it("drops tools whose family is disabled", async () => {
    toolSettings = {
      enabled: true,
      families: { ...allOn.families, browser: false, web: false }
    }
    const tools = await resolveModelTools("qwen", "ollama", toolModel())
    expect(tools?.map((t) => t.name)).toEqual(["rag_search"])
  })

  it("returns undefined when all families are disabled", async () => {
    toolSettings = {
      enabled: true,
      families: {
        browser: false,
        knowledge: false,
        history: false,
        web: false,
        automation: false
      }
    }
    await expect(
      resolveModelTools("qwen", "ollama", toolModel())
    ).resolves.toBeUndefined()
  })
})
