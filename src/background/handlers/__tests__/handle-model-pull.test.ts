import { beforeEach, describe, expect, it, vi } from "vitest"
import { handlePullStream } from "@/background/handlers/handle-pull-stream"
import {
  abortAndClearController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { safePostMessage } from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import type { ModelPullMessage } from "@/types"
import { handleModelPull } from "../handle-model-pull"
import {
  createMockPort,
  createMockResponse,
  createMockStreamResponse
} from "./test-utils"

// Mock dependencies
vi.mock("@/background/handlers/handle-pull-stream", () => ({
  handlePullStream: vi.fn()
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  abortAndClearController: vi.fn(),
  clearAbortController: vi.fn(),
  setAbortController: vi.fn()
}))

vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn().mockResolvedValue("http://localhost:11434"),
  getPullAbortControllerKey: vi.fn().mockReturnValue("key"),
  safePostMessage: vi.fn()
}))
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn()
  }
}))

global.fetch = vi.fn()

describe("Handle Model Pull", () => {
  const mockPort = createMockPort()
  const isPortClosed = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: "ollama",
      config: {
        baseUrl: "http://localhost:11434"
      },
      capabilities: {
        modelPull: true
      }
    } as any)
  })

  it("should initiate pull successfully", async () => {
    const msg = { payload: "llama2" } satisfies ModelPullMessage

    vi.mocked(fetch).mockResolvedValue(
      createMockStreamResponse(["stream-data"])
    )

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/pull",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "llama2" })
      })
    )
    expect(setAbortController).toHaveBeenCalled()
    expect(handlePullStream).toHaveBeenCalled()
  })

  it("uses the resolved LM Studio URL for a bare model name", async () => {
    vi.mocked(ProviderFactory.getProviderForModel).mockResolvedValue({
      id: ProviderId.LM_STUDIO,
      config: {
        id: ProviderId.LM_STUDIO,
        type: "openai",
        name: "LM Studio",
        enabled: true,
        baseUrl: "http://lm-box:1234/v1"
      },
      capabilities: { modelPull: true }
    } as any)
    vi.mocked(fetch).mockResolvedValue(createMockResponse({}))

    await handleModelPull(
      { payload: "shared-model" } satisfies ModelPullMessage,
      mockPort,
      isPortClosed
    )

    expect(fetch).toHaveBeenCalledWith(
      "http://lm-box:1234/api/v1/models/download",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "shared-model" })
      })
    )
  })

  it("should handle cancellation", async () => {
    const msg = { payload: "llama2", cancel: true } satisfies ModelPullMessage

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(abortAndClearController).toHaveBeenCalledWith("llama2")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("should handle fetch errors", async () => {
    const msg = { payload: "llama2" } satisfies ModelPullMessage

    vi.mocked(fetch).mockResolvedValue(
      createMockResponse(null, {
        ok: false,
        status: 404,
        statusText: "Not Found"
      })
    )

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: { status: 404, message: "Not Found" }
    })
    expect(handlePullStream).not.toHaveBeenCalled()
  })

  it("should handle missing body", async () => {
    const msg = { payload: "llama2" } satisfies ModelPullMessage

    vi.mocked(fetch).mockResolvedValue(createMockResponse(null, { ok: true }))

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: "No response body received"
    })
  })

  it("should handle network errors", async () => {
    const msg = { payload: "llama2" } satisfies ModelPullMessage

    vi.mocked(fetch).mockRejectedValue(new Error("Network Error"))

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: { status: 0, message: "Network Error" }
    })
  })

  it("should handle abort errors specially", async () => {
    const msg = { payload: "llama2" } satisfies ModelPullMessage
    const abortError = new Error("Aborted")
    abortError.name = "AbortError"

    vi.mocked(fetch).mockRejectedValue(abortError)

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: "Download cancelled"
    })
  })
})
