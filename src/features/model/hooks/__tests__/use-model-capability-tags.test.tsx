import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { ProviderModel } from "@/types"

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@/features/model/lib/fetch-model-info", () => ({
  fetchModelInfo: mocks.fetch
}))
vi.mock("@/lib/providers/capabilities", () => ({
  getProviderCapabilities: () => ({ modelDetails: true })
}))

import { useModelCapabilityTags } from "../use-model-capability-tags"

describe("model menu detail observation", () => {
  it("does not cancel a detail request another consumer still observes", async () => {
    mocks.fetch.mockReset()
    let signal: AbortSignal | undefined
    mocks.fetch.mockImplementation(
      (_model: string, _provider: string, requestSignal: AbortSignal) => {
        signal = requestSignal
        return new Promise((_resolve, reject) =>
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true }
          )
        )
      }
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const models = [{ name: "shared", providerId: "ollama" }] as ProviderModel[]
    const first = renderHook(
      ({ open }) => useModelCapabilityTags(models, open),
      { initialProps: { open: true }, wrapper }
    )
    const second = renderHook(() => useModelCapabilityTags(models, true), {
      wrapper
    })
    await waitFor(() => expect(signal).toBeDefined())
    first.rerender({ open: false })
    expect(signal?.aborted).toBe(false)
    first.unmount()
    expect(signal?.aborted).toBe(false)
    second.unmount()
    expect(signal?.aborted).toBe(true)
    client.clear()
  })

  it("keeps reported capabilities cached for the sheet after the menu closes", async () => {
    mocks.fetch
      .mockReset()
      .mockResolvedValue({ capabilities: ["vision", "tools", "thinking"] })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const models = [{ name: "test", providerId: "ollama" }] as ProviderModel[]
    const { result, rerender, unmount } = renderHook(
      ({ open }) => useModelCapabilityTags(models, open),
      { initialProps: { open: true }, wrapper }
    )
    await waitFor(() =>
      expect(result.current["ollama::test"]).toEqual([
        "vision",
        "tools",
        "thinking"
      ])
    )
    rerender({ open: false })
    expect(result.current["ollama::test"]).toEqual([
      "vision",
      "tools",
      "thinking"
    ])
    expect(mocks.fetch).toHaveBeenCalledOnce()
    unmount()
    client.clear()
  })

  it("keeps the selected sheet's request while cancelling other menu requests", async () => {
    mocks.fetch.mockReset()
    const signals = new Map<string, AbortSignal>()
    mocks.fetch.mockImplementation(
      (model: string, _provider: string, signal: AbortSignal) => {
        signals.set(model, signal)
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          })
        )
      }
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const models = ["selected", "other"].map((name) => ({
      name,
      providerId: "ollama"
    })) as ProviderModel[]
    const { rerender, unmount } = renderHook(
      ({
        open,
        sheet
      }: {
        open: boolean
        sheet: { model: string; providerId: string } | null
      }) => useModelCapabilityTags(models, open, sheet),
      {
        initialProps: { open: true, sheet: null } as {
          open: boolean
          sheet: { model: string; providerId: string } | null
        },
        wrapper
      }
    )
    await waitFor(() => expect(signals.size).toBe(2))
    await act(async () =>
      rerender({
        open: false,
        sheet: { model: "selected", providerId: "ollama" }
      })
    )
    expect(signals.get("selected")?.aborted).toBe(false)
    expect(signals.get("other")?.aborted).toBe(true)
    unmount()
    expect(signals.get("selected")?.aborted).toBe(true)
    client.clear()
  })

  it("cancels active detail observation when the menu closes", async () => {
    mocks.fetch.mockReset()
    let requestSignal: AbortSignal | undefined
    mocks.fetch.mockImplementation(
      (_model: string, _provider: string, signal: AbortSignal) => {
        requestSignal = signal
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          })
        )
      }
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } }
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const models = [{ name: "test", providerId: "ollama" }] as ProviderModel[]
    const { rerender, unmount } = renderHook(
      ({ open }) => useModelCapabilityTags(models, open),
      { initialProps: { open: true }, wrapper }
    )
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
    rerender({ open: false })
    expect(requestSignal?.aborted).toBe(true)
    unmount()
    client.clear()
  })
})
