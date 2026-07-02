import { afterEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition } from "@/lib/tools"
import {
  clearModelToolCapabilityCache,
  resolveModelTools
} from "../resolve-model-tools"

vi.mock("@/lib/providers/model-capability-overrides", () => ({
  getModelCapabilityOverride: vi.fn(async () => null)
}))

const baseDefinitions: ToolDefinition[] = [
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

// Mutable so a test can swap in a vision-only tool; reset in afterEach.
let definitions: ToolDefinition[] = baseDefinitions

const captureScreenshotTool: ToolDefinition = {
  name: "capture_screenshot",
  description: "Screenshot the tab",
  parameters: { type: "object", properties: {} },
  requires: ["vision"]
}

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
// Per-model raw override; only the `nonNativeToolFallback` flag is read directly
// (the family settings come pre-merged via getEffectiveToolFamilySettings).
let modelOverride: { nonNativeToolFallback?: boolean } | null = null
// resolve-model-tools reads the per-model effective settings, which already
// fold the global family settings in; mocking it covers both layers.
vi.mock("@/lib/tools/tool-model-overrides", () => ({
  getEffectiveToolFamilySettings: () => Promise.resolve(toolSettings),
  getToolModelOverride: () => Promise.resolve(modelOverride)
}))

const toolModel = (): LLMProvider =>
  providerWithDetails(vi.fn(async () => ({ capabilities: ["tools"] })))

const visionToolModel = (): LLMProvider =>
  providerWithDetails(
    vi.fn(async () => ({ capabilities: ["tools", "vision"] }))
  )

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
    definitions = baseDefinitions
    modelOverride = null
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
    ).resolves.toEqual({ tools: definitions, mode: "native" })
    expect(getModelDetails).toHaveBeenCalledTimes(2)
  })

  it("offers all tools when every family is enabled (default)", async () => {
    await expect(
      resolveModelTools("qwen", "ollama", toolModel())
    ).resolves.toEqual({ tools: definitions, mode: "native" })
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
    const resolved = await resolveModelTools("qwen", "ollama", toolModel())
    expect(resolved?.tools.map((t) => t.name)).toEqual(["rag_search"])
  })

  it("hides vision-only tools from a non-vision model", async () => {
    definitions = [...baseDefinitions, captureScreenshotTool]
    const resolved = await resolveModelTools("qwen", "ollama", toolModel())
    expect(resolved?.tools.map((t) => t.name)).not.toContain(
      "capture_screenshot"
    )
    expect(resolved?.tools.map((t) => t.name)).toEqual([
      "current_tab",
      "rag_search",
      "web_search"
    ])
  })

  it("offers vision-only tools to a vision-capable model", async () => {
    definitions = [...baseDefinitions, captureScreenshotTool]
    const resolved = await resolveModelTools(
      "qwen-vl",
      "ollama",
      visionToolModel()
    )
    expect(resolved?.tools.map((t) => t.name)).toContain("capture_screenshot")
  })

  it("returns no tools for a non-tool-calling model without the fallback opt-in", async () => {
    const nonToolModel = providerWithDetails(
      vi.fn(async () => ({ capabilities: ["completion"] }))
    )
    await expect(
      resolveModelTools("plain", "ollama", nonToolModel)
    ).resolves.toBeUndefined()
  })

  it("offers tools in non-native mode when the model opts into the fallback", async () => {
    modelOverride = { nonNativeToolFallback: true }
    const nonToolModel = providerWithDetails(
      vi.fn(async () => ({ capabilities: ["completion"] }))
    )
    await expect(
      resolveModelTools("plain", "ollama", nonToolModel)
    ).resolves.toEqual({ tools: definitions, mode: "non-native" })
  })

  it("still honors family governance in non-native mode", async () => {
    modelOverride = { nonNativeToolFallback: true }
    toolSettings = { ...allOn, enabled: false }
    const nonToolModel = providerWithDetails(
      vi.fn(async () => ({ capabilities: ["completion"] }))
    )
    await expect(
      resolveModelTools("plain", "ollama", nonToolModel)
    ).resolves.toBeUndefined()
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
