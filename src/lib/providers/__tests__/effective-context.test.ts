import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { autoContextCap } from "@/lib/model-context"
import {
  clearReportedContextCache,
  resolveProviderNumCtx
} from "../effective-context"
import type { LLMProvider } from "../types"

const provider = (
  type: string,
  getModelDetails?: LLMProvider["getModelDetails"]
) =>
  ({
    id: type,
    capabilities: { modelDetails: Boolean(getModelDetails) },
    config: { id: type, type, baseUrl: "http://localhost:1" },
    getModelDetails
  }) as unknown as LLMProvider

const reporting = (window: number) =>
  vi.fn(async () => ({ model_info: { "llama.context_length": window } }))

describe("resolveProviderNumCtx", () => {
  beforeEach(() => clearReportedContextCache())
  afterEach(() => vi.useRealTimers())

  it("holds Auto to the cap on Ollama, which allocates per request", async () => {
    await expect(
      resolveProviderNumCtx(provider("ollama", reporting(131_072)), "m", 0)
    ).resolves.toBe(16_384)
  })

  it("keeps the earlier default window for Auto on other runners", async () => {
    await expect(
      resolveProviderNumCtx(provider("lmstudio"), "m", 0)
    ).resolves.toBe(65_536)
    await expect(
      resolveProviderNumCtx(provider("lmstudio"), "m", 0, { hint: 8192 })
    ).resolves.toBe(8192)
  })

  it("gives the settings page the same Auto ceiling requests use", () => {
    expect(autoContextCap("ollama")).toBe(16_384)
    expect(autoContextCap("custom:ollama:abc")).toBe(16_384)
    expect(autoContextCap("lm studio")).toBe(65_536)
  })

  it("respects an explicit window on any runner", async () => {
    await expect(
      resolveProviderNumCtx(provider("lmstudio"), "m", 4096)
    ).resolves.toBe(4096)
  })

  it("gives up a details lookup that stalls and does not cache the miss", async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const stalls = vi.fn(
      (_model: string, signal?: AbortSignal) =>
        new Promise<never>(() => {
          seen = signal
        })
    )
    const pending = resolveProviderNumCtx(
      provider("ollama", stalls as never),
      "m",
      0,
      { hint: 8192 }
    )
    await vi.advanceTimersByTimeAsync(3000)

    await expect(pending).resolves.toBe(8192)
    expect(seen?.aborted).toBe(true)
    const again = resolveProviderNumCtx(
      provider("ollama", stalls as never),
      "m",
      0
    )
    await vi.advanceTimersByTimeAsync(3000)
    await again
    expect(stalls).toHaveBeenCalledTimes(2)
  })
})
