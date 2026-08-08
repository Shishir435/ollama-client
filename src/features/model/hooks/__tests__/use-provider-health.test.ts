import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn()
  }
}))

import type { ProviderConfig } from "@/lib/providers/types"
import { ProviderId, ProviderType } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"

import { useProviderHealth } from "../use-provider-health"

const mockedCall = vi.mocked(extensionRpcClient.call)

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

beforeEach(() => {
  mockedCall.mockReset()
})

// ---------------------------------------------------------------------------
// Real-timer tests: drive the async initial-check by letting promises settle
// naturally. Mixing fake timers with @testing-library/react `waitFor` polling
// hangs because waitFor uses real setInterval to poll its predicate.
// ---------------------------------------------------------------------------

describe("useProviderHealth — initial check (real timers)", () => {
  it("returns an empty map on first render before async checks resolve", () => {
    mockedCall.mockResolvedValue({ modelCount: 1 } as never)
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )
    expect(result.current).toEqual({})
  })

  it("marks an enabled provider with models as healthy after the initial check", async () => {
    mockedCall.mockResolvedValue({ modelCount: 3 } as never)
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
    mockedCall.mockResolvedValue({ modelCount: 0 } as never)
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
    })
    expect(result.current[ProviderId.OLLAMA].success).toBe(false)
  })

  it("treats getModels rejection as unhealthy without throwing", async () => {
    mockedCall.mockRejectedValue(new Error("connect EHOSTUNREACH"))
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
    })
    expect(result.current[ProviderId.OLLAMA].success).toBe(false)
  })

  it("carries whether the provider publishes a catalog", async () => {
    mockedCall.mockResolvedValue({
      modelCount: 2,
      modelListSupported: false
    } as never)
    const { result } = renderHook(() =>
      useProviderHealth([mkProvider(ProviderId.OLLAMA, true)])
    )

    await waitFor(() => {
      expect(result.current[ProviderId.OLLAMA]).toBeDefined()
    })

    // Usable on declared ids, but nothing here reached a live model list, so
    // the UI must be able to say that rather than claiming a connection.
    expect(result.current[ProviderId.OLLAMA]).toMatchObject({
      success: true,
      modelListSupported: false
    })
  })

  it("skips disabled providers — they never get a health entry", async () => {
    mockedCall.mockResolvedValue({ modelCount: 2 } as never)
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
    mockedCall.mockImplementation((async (
      _method: unknown,
      request: { providerId?: string }
    ) => ({
      modelCount: request.providerId === ProviderId.OLLAMA ? 1 : 0
    })) as never)

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

  it("re-checks once a minute, not every few seconds", async () => {
    mockedCall.mockResolvedValue({ modelCount: 1 } as never)
    // One stable array: a fresh literal per render re-runs the effect on every
    // state update, which would make the call count say nothing about timing.
    const providers = [mkProvider(ProviderId.OLLAMA, true)]
    renderHook(() => useProviderHealth(providers))

    // Settle the initial check without firing the interval, which
    // `runOnlyPendingTimersAsync` would do as a side effect.
    await vi.advanceTimersByTimeAsync(0)
    const initialCalls = mockedCall.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)

    // Half an interval buys nothing: a poll against somebody's metered hosted
    // endpoint is not free, and config edits re-check immediately anyway.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockedCall.mock.calls.length).toBe(initialCalls)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockedCall.mock.calls.length).toBeGreaterThan(initialCalls)
  })

  it("clears the interval on unmount", async () => {
    mockedCall.mockResolvedValue({ modelCount: 1 } as never)
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
