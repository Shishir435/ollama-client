import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
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
  it("cancels active detail observation when the menu closes", async () => {
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
