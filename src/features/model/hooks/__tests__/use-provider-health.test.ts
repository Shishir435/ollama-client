import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderWithConfig: vi.fn()
  }
}))

import { ProviderFactory } from "@/lib/providers/factory"
import type { ProviderConfig } from "@/lib/providers/types"
import { ProviderId, ProviderType } from "@/lib/providers/types"

import { useProviderHealth } from "../use-provider-health"

const mockedGetProvider = vi.mocked(ProviderFactory.getProviderWithConfig)

const mkProvider = (
  id: ProviderId,
  enabled: boolean,
  name = id.toString()
): ProviderConfig => ({
  id,
  type: ProviderType.OPENAI,
  name,
  enabled,
  baseUrl: "http://localhost:1234/v1"
})

const fakeProviderReturning = (modelCount: number) => ({
  getModels: vi.fn(async () =>
    Array.from({ length: modelCount }, (_, i) => ({ id: `m${i}` }))
  )
})

const fakeProviderThrowing = (err: Error) => ({
  getModels: vi.fn(async () => {
    throw err
  })
})

beforeEach(() => {
  mockedGetProvider.mockReset()
})

// ---------------------------------------------------------------------------
// Real-timer tests: drive the async initial-check by letting promises settle
// naturally. Mixing fake timers with @testing-library/react `waitFor` polling
// hangs because waitFor uses real setInterval to poll its predicate.
// ---------------------------------------------------------------------------

describe("useProviderHealth — initial check (real timers)", () => {
  it("returns an empty map on first render before async checks resolve", () => {
    mockedGetProvider.mockResolvedValue(fakeProviderReturning(1) as never)
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )
    expect(result.current).toEqual({})
  })

  it("marks an enabled provider with models as healthy after the initial check", async () => {
    mockedGetProvider.mockResolvedValue(fakeProviderReturning(3) as never)
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
    })

    expect(result.current[ProviderId.OLLAMA].success).toBe(true)
    expect(result.current[ProviderId.OLLAMA].lastChecked).toEqual(
      expect.any(Number)
    )
  })

  it("treats empty model lists as unhealthy", async () => {
    mockedGetProvider.mockResolvedValue(fakeProviderReturning(0) as never)
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
    })
    expect(result.current[ProviderId.OLLAMA].success).toBe(false)
  })

  it("treats getModels rejection as unhealthy without throwing", async () => {
    mockedGetProvider.mockResolvedValue(
      fakeProviderThrowing(new Error("connect EHOSTUNREACH")) as never
    )
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
    })
    expect(result.current[ProviderId.OLLAMA].success).toBe(false)
  })

  it("skips disabled providers — they never get a health entry", async () => {
    mockedGetProvider.mockResolvedValue(fakeProviderReturning(2) as never)
    const { result } = renderHook(() =>
      useProviderHealth([
        mkProvider(ProviderId.OLLAMA, false),
        mkProvider(ProviderId.LM_STUDIO, true)
      ])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.LM_STUDIO]).toBeDefined()
    })

    expect(result.current[ProviderId.OLLAMA]).toBeUndefined()
    expect(result.current[ProviderId.LM_STUDIO].success).toBe(true)
  })

  it("checks each enabled provider in the list independently", async () => {
    mockedGetProvider.mockImplementation((async (config: ProviderConfig) =>
      fakeProviderReturning(config.id === ProviderId.OLLAMA ? 1 : 0)) as never)

    const { result } = renderHook(() =>
      useProviderHealth([
        mkProvider(ProviderId.OLLAMA, true),
        mkProvider(ProviderId.LM_STUDIO, true)
      ])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
      expect(result.current[ProviderId.LM_STUDIO]).toBeDefined()
    })

    expect(result.current[ProviderId.OLLAMA].success).toBe(true)
    expect(result.current[ProviderId.LM_STUDIO].success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fake-timer tests: only verify timer-driven behavior (periodic poll, cleanup).
// Each test waits for the initial check to finish via a Promise then takes
// over the clock.
// ---------------------------------------------------------------------------

describe("useProviderHealth — interval + cleanup (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("re-checks every 10s on the interval", async () => {
    mockedGetProvider.mockResolvedValue(fakeProviderReturning(1) as never)
    renderHook(() => useProviderHealth([mkProvider(ProviderId.OLLAMA, true)]))

    // Let the initial check + its microtasks settle. With fake timers, we
    // run pending microtasks via vi.runOnlyPendingTimersAsync (which also
    // resolves promises queued on the timer queue).
    await vi.runOnlyPendingTimersAsync()
    const initialCalls = mockedGetProvider.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)

    // Advance one full polling interval.
    await vi.advanceTimersByTimeAsync(10_000)

    expect(mockedGetProvider.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it("clears the interval on unmount", async () => {
    mockedGetProvider.mockResolvedValue(fakeProviderReturning(1) as never)
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")

    const { unmount } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await vi.runOnlyPendingTimersAsync()
    unmount()

    // The hook's cleanup function MUST have called clearInterval. We
    // don't count subsequent provider-check calls because
    // `runOnlyPendingTimersAsync` triggers intervals as a side effect
    // of flushing, which makes count-based assertions noisy.
    expect(clearIntervalSpy).toHaveBeenCalled()
    clearIntervalSpy.mockRestore()
  })
})
