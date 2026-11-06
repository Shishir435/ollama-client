import { MODEL_DISCOVERY_FAILURE } from "@ollama-client/contracts/provider-rpc"
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useConnectionHealth } from "../use-connection-health"

const { providerModels, embeddingStatus } = vi.hoisted(() => ({
  providerModels: vi.fn(),
  embeddingStatus: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))
vi.mock("../use-provider-models", () => ({ useProviderModels: providerModels }))
vi.mock("../use-embedding-status", () => ({
  useEmbeddingStatus: embeddingStatus
}))

const listed = (discovered: string[], declared: string[] = []) => ({
  status: "listed" as const,
  failureCode: null,
  modelNames: new Set([...discovered, ...declared]),
  discoveredNames: new Set(discovered)
})

const base = (overrides: Record<string, unknown> = {}) => ({
  selectedModel: "m",
  selectedModelRef: { providerId: "p", modelId: "m" },
  providerCatalogs: {
    p: { providerId: "p", providerName: "P", state: listed(["m"]) }
  },
  providersKnown: true,
  status: "ready",
  refreshProvider: vi.fn(),
  ...overrides
})

describe("useConnectionHealth", () => {
  beforeEach(() => {
    embeddingStatus.mockReturnValue({
      loading: false,
      availability: "available",
      statusText: "ok",
      nativeState: null
    })
  })

  it("is ready when the server listed a model the user also declared", () => {
    providerModels.mockReturnValue(
      base({
        providerCatalogs: {
          p: { providerId: "p", providerName: "P", state: listed(["m"], ["m"]) }
        }
      })
    )
    const { result } = renderHook(() => useConnectionHealth())
    expect(result.current.providerTone).toBe("success")
  })

  it("stays unverified for a declared-only id", () => {
    providerModels.mockReturnValue(
      base({
        providerCatalogs: {
          p: { providerId: "p", providerName: "P", state: listed([], ["m"]) }
        }
      })
    )
    const { result } = renderHook(() => useConnectionHealth())
    expect(result.current.providerLabel).toBe(
      "model.provider_status.unverified"
    )
    expect(result.current.providerTone).toBe("neutral")
  })

  it("offers the selected provider's retry when its catalog timed out", () => {
    const refreshProvider = vi.fn()
    providerModels.mockReturnValue(
      base({
        refreshProvider,
        providerCatalogs: {
          p: {
            providerId: "p",
            providerName: "P",
            state: { status: "unverified" }
          }
        }
      })
    )
    const { result } = renderHook(() => useConnectionHealth())
    expect(result.current.catalogUnverified).toBe(true)
    result.current.retryProvider?.()
    expect(refreshProvider).toHaveBeenCalledWith("p")
  })

  it("does not keep checking once discovery settled with no mapped selection", () => {
    providerModels.mockReturnValue(
      base({ selectedModelRef: null, status: "empty", providerCatalogs: {} })
    )
    const { result } = renderHook(() => useConnectionHealth())
    expect(result.current.providerLabel).toBe("model.provider_status.empty")
  })

  it("still checks while discovery is running for an unmapped selection", () => {
    providerModels.mockReturnValue(
      base({ selectedModelRef: null, status: "loading" })
    )
    const { result } = renderHook(() => useConnectionHealth())
    expect(result.current.providerLabel).toBe("model.provider_status.checking")
  })

  it("reports an unreachable provider from the current state", () => {
    providerModels.mockReturnValue(
      base({
        providerCatalogs: {
          p: {
            providerId: "p",
            providerName: "P",
            state: { status: "request_failed" }
          }
        }
      })
    )
    const { result } = renderHook(() => useConnectionHealth())
    expect(result.current.providerTone).toBe("danger")
    expect(MODEL_DISCOVERY_FAILURE.REQUEST_FAILED).toBe("request_failed")
  })
})
