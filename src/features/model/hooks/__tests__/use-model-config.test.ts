import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import * as modelConfigs from "@/lib/repositories/model-configs"
import {
  readModelPreferencesSnapshot,
  resetModelPreferences,
  seedModelPreferences,
  updateModelPreference
} from "@/test/model-preferences-fake"
import { useModelConfig } from "../use-model-config"

vi.mock(
  "@/lib/repositories/model-preferences",
  () => import("@/test/model-preferences-fake")
)

const renderConfig = async (model: string, providerId?: string) => {
  const hook = renderHook(() => useModelConfig(model, providerId))
  await act(async () => {})
  return hook
}

describe("useModelConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetModelPreferences()
  })

  it("returns the defaults when nothing is stored", async () => {
    const { result } = await renderConfig("llama3:latest")

    expect(result.current[0]).toEqual(DEFAULT_MODEL_CONFIG)
  })

  it("merges the stored row over the defaults", async () => {
    seedModelPreferences("config", {
      "llama3:latest": { temperature: 0.9, top_p: 0.95 }
    })

    const { result } = await renderConfig("llama3:latest")

    const [config] = result.current
    expect(config.temperature).toBe(0.9)
    expect(config.top_p).toBe(0.95)
    expect(config.top_k).toBe(DEFAULT_MODEL_CONFIG.top_k)
    expect(config.num_ctx).toBe(DEFAULT_MODEL_CONFIG.num_ctx)
  })

  it("upgrades the legacy default context size", async () => {
    seedModelPreferences("config", { "llama3:latest": { num_ctx: 6144 } })

    const { result } = await renderConfig("llama3:latest")

    expect(result.current[0].num_ctx).toBe(DEFAULT_MODEL_CONFIG.num_ctx)
  })

  it("preserves a custom context size", async () => {
    seedModelPreferences("config", { "llama3:latest": { num_ctx: 32768 } })

    const { result } = await renderConfig("llama3:latest")

    expect(result.current[0].num_ctx).toBe(32768)
  })

  it("shows a change at once and writes it through updateModelConfig", async () => {
    const write = vi.spyOn(modelConfigs, "updateModelConfig")
    const { result } = await renderConfig("llama3:latest")

    act(() => {
      result.current[1]({ temperature: 0.8 })
    })

    expect(result.current[0].temperature).toBe(0.8)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith("llama3:latest", undefined, {
      temperature: 0.8
    })
    await waitFor(() =>
      expect(readModelPreferencesSnapshot("config")).toMatchObject({
        "llama3:latest": { temperature: 0.8 }
      })
    )
  })

  it("keeps the existing fields when updating another", async () => {
    seedModelPreferences("config", {
      "llama3:latest": { temperature: 0.7, top_k: 50 }
    })
    const { result } = await renderConfig("llama3:latest")

    act(() => {
      result.current[1]({ top_p: 0.95 })
    })

    await waitFor(() =>
      expect(readModelPreferencesSnapshot("config")["llama3:latest"]).toEqual({
        temperature: 0.7,
        top_k: 50,
        top_p: 0.95
      })
    )
    expect(result.current[0]).toMatchObject({
      temperature: 0.7,
      top_k: 50,
      top_p: 0.95
    })
  })

  it("writes system prompt updates", async () => {
    const { result } = await renderConfig("llama3:latest")

    act(() => {
      result.current[1]({ system: "You are a code assistant" })
    })

    await waitFor(() =>
      expect(readModelPreferencesSnapshot("config")).toMatchObject({
        "llama3:latest": { system: "You are a code assistant" }
      })
    )
  })

  it("handles several models independently", async () => {
    seedModelPreferences("config", {
      "llama3:latest": { temperature: 0.8 },
      "mistral:latest": { temperature: 0.6 }
    })

    const { result: first } = await renderConfig("llama3:latest")
    const { result: second } = await renderConfig("mistral:latest")

    expect(first.current[0].temperature).toBe(0.8)
    expect(second.current[0].temperature).toBe(0.6)
  })

  it("isolates same-named models by provider", async () => {
    seedModelPreferences("config", {
      "provider-a::shared": { reasoning_effort: "low" },
      "provider-b::shared": { reasoning_effort: "high" }
    })

    const { result: providerA } = await renderConfig("shared", "provider-a")
    const { result: providerB } = await renderConfig("shared", "provider-b")

    expect(providerA.current[0].reasoning_effort).toBe("low")
    expect(providerB.current[0].reasoning_effort).toBe("high")

    act(() => {
      providerA.current[1]({ reasoning_effort: "medium" })
    })

    await waitFor(() =>
      expect(readModelPreferencesSnapshot("config")).toMatchObject({
        "provider-a::shared": { reasoning_effort: "medium" },
        "provider-b::shared": { reasoning_effort: "high" }
      })
    )
  })

  it("re-reads when another context changes the config", async () => {
    const { result } = await renderConfig("llama3:latest")
    expect(result.current[0].temperature).toBe(DEFAULT_MODEL_CONFIG.temperature)

    await act(async () => {
      await updateModelPreference("config", "llama3:latest", () => ({
        temperature: 0.1
      }))
    })

    await waitFor(() => expect(result.current[0].temperature).toBe(0.1))
  })

  it("ignores change notifications for other kinds", async () => {
    const read = vi.spyOn(modelConfigs, "getStoredModelConfigFor")
    await renderConfig("llama3:latest")
    const initial = read.mock.calls.length

    await act(async () => {
      await updateModelPreference("tools", "ollama::x", () => ({
        enabled: false
      }))
    })

    expect(read).toHaveBeenCalledTimes(initial)
  })

  it("rolls back to the stored value when the write fails", async () => {
    seedModelPreferences("config", { "llama3:latest": { temperature: 0.7 } })
    vi.spyOn(modelConfigs, "updateModelConfig").mockRejectedValueOnce(
      new Error("disk full")
    )
    const { result } = await renderConfig("llama3:latest")

    act(() => {
      result.current[1]({ temperature: 0.2 })
    })

    await waitFor(() => expect(result.current[0].temperature).toBe(0.7))
  })
})
