import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock(
  "@/lib/repositories/model-preferences",
  () => import("@/test/model-preferences-fake")
)

import {
  readModelPreferencesSnapshot,
  resetModelPreferences,
  seedModelPreferences
} from "@/test/model-preferences-fake"
import {
  clearModelCapabilityOverride,
  getAllModelCapabilityOverrides,
  getModelCapabilityOverride,
  modelCapabilityOverrideKey,
  setModelCapabilityOverride
} from "../model-capability-overrides"

describe("model capability overrides", () => {
  beforeEach(() => {
    resetModelPreferences()
  })

  it("round-trips an override for a single model", async () => {
    await setModelCapabilityOverride("vllm", "my-model", { vision: true })

    expect(await getModelCapabilityOverride("vllm", "my-model")).toEqual({
      vision: true
    })
  })

  it("keys overrides by provider and model so the same name can differ", async () => {
    await setModelCapabilityOverride("vllm", "llava", { vision: true })
    await setModelCapabilityOverride("localai", "llava", { vision: false })

    expect(await getModelCapabilityOverride("vllm", "llava")).toEqual({
      vision: true
    })
    expect(await getModelCapabilityOverride("localai", "llava")).toEqual({
      vision: false
    })
  })

  it("returns null when no override exists", async () => {
    expect(await getModelCapabilityOverride("vllm", "absent")).toBeNull()
  })

  it("drops undefined fields and removes a fully-empty override", async () => {
    await setModelCapabilityOverride("vllm", "m", {
      vision: true,
      toolCalling: undefined
    })
    expect(await getModelCapabilityOverride("vllm", "m")).toEqual({
      vision: true
    })

    await setModelCapabilityOverride("vllm", "m", { vision: undefined })
    expect(await getModelCapabilityOverride("vllm", "m")).toBeNull()
  })

  it("removes the stored row when an override is cleared", async () => {
    seedModelPreferences("capabilities", { "vllm::m": { vision: true } })
    await clearModelCapabilityOverride("vllm", "m")

    expect(readModelPreferencesSnapshot("capabilities")).toEqual({})
  })

  it("clears an override", async () => {
    await setModelCapabilityOverride("vllm", "m", { vision: true })
    await clearModelCapabilityOverride("vllm", "m")

    expect(await getModelCapabilityOverride("vllm", "m")).toBeNull()
  })

  it("exposes the full override map", async () => {
    await setModelCapabilityOverride("vllm", "a", { vision: true })
    await setModelCapabilityOverride("localai", "b", { toolCalling: true })

    expect(await getAllModelCapabilityOverrides()).toEqual({
      [modelCapabilityOverrideKey("vllm", "a")]: { vision: true },
      [modelCapabilityOverrideKey("localai", "b")]: { toolCalling: true }
    })
  })

  it("does not drop a write when two overrides are saved concurrently", async () => {
    // Without serialization both reads see the same empty map and the second
    // write clobbers the first. The write queue must preserve both.
    await Promise.all([
      setModelCapabilityOverride("vllm", "a", { vision: true }),
      setModelCapabilityOverride("localai", "b", { toolCalling: true })
    ])

    expect(await getModelCapabilityOverride("vllm", "a")).toEqual({
      vision: true
    })
    expect(await getModelCapabilityOverride("localai", "b")).toEqual({
      toolCalling: true
    })
  })
})
