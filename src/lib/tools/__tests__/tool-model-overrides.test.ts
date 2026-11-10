import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock(
  "@/lib/repositories/model-preferences",
  () => import("@/test/model-preferences-fake")
)

const globalSettings = {
  enabled: true,
  families: {
    browser: true,
    knowledge: true,
    history: true,
    web: true,
    automation: true
  }
}
let currentGlobal = globalSettings
vi.mock("../tool-settings", () => ({
  getToolFamilySettings: () => Promise.resolve(currentGlobal)
}))

import {
  readModelPreferencesSnapshot,
  resetModelPreferences
} from "@/test/model-preferences-fake"
import {
  clearToolModelOverride,
  getEffectiveToolFamilySettings,
  getToolModelOverride,
  patchToolModelOverride,
  setToolModelOverride,
  toolModelOverrideKey
} from "../tool-model-overrides"

beforeEach(() => {
  resetModelPreferences()
  currentGlobal = globalSettings
})

describe("tool-model-overrides", () => {
  it("returns global settings when a model has no override", async () => {
    const effective = await getEffectiveToolFamilySettings("ollama", "qwen")
    expect(effective).toEqual(globalSettings)
  })

  it("layers a partial override over global, per field", async () => {
    await setToolModelOverride("ollama", "qwen", {
      families: { browser: false }
    })
    const effective = await getEffectiveToolFamilySettings("ollama", "qwen")
    expect(effective.enabled).toBe(true) // from global
    expect(effective.families.browser).toBe(false) // from override
    expect(effective.families.web).toBe(true) // from global
  })

  it("lets a per-model master switch override global", async () => {
    await setToolModelOverride("ollama", "qwen", { enabled: false })
    const effective = await getEffectiveToolFamilySettings("ollama", "qwen")
    expect(effective.enabled).toBe(false)
    // families still fall back to global
    expect(effective.families.knowledge).toBe(true)
  })

  it("scopes overrides per provider+model key", async () => {
    await setToolModelOverride("ollama", "qwen", { enabled: false })
    const other = await getEffectiveToolFamilySettings("lmstudio", "qwen")
    expect(other.enabled).toBe(true)
    expect(toolModelOverrideKey("ollama", "qwen")).toBe("ollama::qwen")
  })

  it("prunes an all-undefined override to no stored entry", async () => {
    await setToolModelOverride("ollama", "qwen", { families: {} })
    expect(await getToolModelOverride("ollama", "qwen")).toBeNull()
    expect(readModelPreferencesSnapshot("tools")).toEqual({})
  })

  it("clears an override and falls back to global", async () => {
    await setToolModelOverride("ollama", "qwen", { enabled: false })
    await clearToolModelOverride("ollama", "qwen")
    expect(await getToolModelOverride("ollama", "qwen")).toBeNull()
    const effective = await getEffectiveToolFamilySettings("ollama", "qwen")
    expect(effective.enabled).toBe(true)
  })

  it("composes concurrent patches to different families without clobbering", async () => {
    // The race the UI fix targets: two quick toggles before a reload resolves.
    await Promise.all([
      patchToolModelOverride("ollama", "qwen", {
        families: { browser: false }
      }),
      patchToolModelOverride("ollama", "qwen", { families: { web: false } })
    ])
    const override = await getToolModelOverride("ollama", "qwen")
    expect(override?.families?.browser).toBe(false)
    expect(override?.families?.web).toBe(false)
  })

  it("patch merges a field over the stored override, leaving others intact", async () => {
    await setToolModelOverride("ollama", "qwen", { enabled: false })
    await patchToolModelOverride("ollama", "qwen", {
      families: { knowledge: false }
    })
    const override = await getToolModelOverride("ollama", "qwen")
    expect(override?.enabled).toBe(false)
    expect(override?.families?.knowledge).toBe(false)
  })

  it("serializes concurrent writes to different models without dropping either", async () => {
    await Promise.all([
      setToolModelOverride("ollama", "a", { enabled: false }),
      setToolModelOverride("ollama", "b", { enabled: false })
    ])
    const map = readModelPreferencesSnapshot("tools")
    expect(map["ollama::a"]).toBeDefined()
    expect(map["ollama::b"]).toBeDefined()
  })
})
