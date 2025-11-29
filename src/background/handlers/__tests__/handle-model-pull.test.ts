import { describe, expect, it, vi, beforeEach } from "vitest"
import { handleModelPull } from "../handle-model-pull"
import { handlePullStream } from "@/background/handlers/handle-pull-stream"
import {
  abortAndClearController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { getBaseUrl, safePostMessage } from "@/background/lib/utils"

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

global.fetch = vi.fn()

describe("Handle Model Pull", () => {
  const mockPort = { name: "test-port" } as any
  const isPortClosed = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initiate pull successfully", async () => {
    const msg = { payload: "llama2" } as any
    
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: "stream"
    } as any)

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

  it("should handle cancellation", async () => {
    const msg = { payload: "llama2", cancel: true } as any

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(abortAndClearController).toHaveBeenCalledWith("llama2")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("should handle fetch errors", async () => {
    const msg = { payload: "llama2" } as any
    
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found"
    } as any)

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: { status: 404, message: "Not Found" }
    })
    expect(handlePullStream).not.toHaveBeenCalled()
  })

  it("should handle missing body", async () => {
    const msg = { payload: "llama2" } as any
    
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: null
    } as any)

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: "No response body received"
    })
  })

  it("should handle network errors", async () => {
    const msg = { payload: "llama2" } as any
    
    vi.mocked(fetch).mockRejectedValue(new Error("Network Error"))

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: { status: 0, message: "Network Error" }
    })
  })

  it("should handle abort errors specially", async () => {
    const msg = { payload: "llama2" } as any
    const abortError = new Error("Aborted")
    abortError.name = "AbortError"
    
    vi.mocked(fetch).mockRejectedValue(abortError)

    await handleModelPull(msg, mockPort, isPortClosed)

    expect(safePostMessage).toHaveBeenCalledWith(mockPort, {
      error: "Download cancelled"
    })
  })
})
