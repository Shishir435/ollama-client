import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  plasmoGlobalStorage,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import {
  checkEmbeddingModelExists,
  downloadEmbeddingModelSilently
} from "../handle-embedding-download"
import { createMockResponse } from "./test-utils"

vi.mock("@/background/lib/notify", () => ({
  notifyJobComplete: vi.fn()
}))

// Mock dependencies
vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn().mockResolvedValue("http://localhost:11434")
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    set: vi.fn(),
    get: vi.fn()
  },
  setPlasmoStoredValue: vi.fn()
}))

// Mock ProviderFactory - returns a provider that doesn't find the model
// This forces the fallback to Ollama direct check
const mockGetModels = vi.fn()
vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProviderForModel: vi.fn().mockResolvedValue({
      getModels: mockGetModels,
      config: {
        id: "ollama",
        type: "ollama",
        baseUrl: "http://localhost:11434"
      }
    }),
    getProvider: vi.fn().mockResolvedValue({
      getModels: mockGetModels,
      config: {
        id: "ollama",
        type: "ollama",
        baseUrl: "http://localhost:11434"
      }
    })
  }
}))

global.fetch = vi.fn()

describe("Handle Embedding Download", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // By default, provider doesn't find the model
    mockGetModels.mockResolvedValue([])
  })

  describe("checkEmbeddingModelExists", () => {
    it("should return true if model exists", async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({
          models: [{ name: "nomic-embed-text:latest" }]
        })
      )

      const result = await checkEmbeddingModelExists("nomic-embed-text")
      expect(result.exists).toBe(true)
    })

    it("should return true if model exists with tag match", async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({
          models: [{ name: "nomic-embed-text:latest" }]
        })
      )

      const result = await checkEmbeddingModelExists("nomic-embed-text:latest")
      expect(result.exists).toBe(true)
    })

    it("should return false if model not found", async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({
          models: [{ name: "llama2:latest" }]
        })
      )

      const result = await checkEmbeddingModelExists("nomic-embed-text")
      expect(result.exists).toBe(false)
    })

    it("should return false on API error", async () => {
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse(null, { ok: false, statusText: "Server Error" })
      )

      const result = await checkEmbeddingModelExists("nomic-embed-text")
      expect(result.exists).toBe(false)
    })

    it("should return false on network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network Error"))

      const result = await checkEmbeddingModelExists("nomic-embed-text")
      expect(result.exists).toBe(false)
    })

    it("aborts an in-flight model check with the caller signal", async () => {
      const controller = new AbortController()
      let fetchSignal: AbortSignal | undefined
      vi.mocked(fetch).mockImplementation(
        async (_input, init) =>
          new Promise((_resolve, reject) => {
            fetchSignal = init?.signal as AbortSignal
            fetchSignal.addEventListener("abort", () => {
              reject(new DOMException("Cancelled", "AbortError"))
            })
          })
      )

      const pending = checkEmbeddingModelExists(
        "nomic-embed-text",
        undefined,
        controller.signal
      )
      await vi.waitFor(() => expect(fetchSignal).toBeDefined())
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
      expect(fetchSignal?.aborted).toBe(true)
    })
  })

  describe("downloadEmbeddingModelSilently", () => {
    it("should skip download if model exists", async () => {
      // Mock checkEmbeddingModelExists behavior by mocking fetch response
      vi.mocked(fetch).mockResolvedValue(
        createMockResponse({
          models: [{ name: "nomic-embed-text:latest" }]
        })
      )

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(true)
      expect(setPlasmoStoredValue).toHaveBeenCalledWith(
        STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
        true
      )
      // Should not call pull API
      expect(fetch).toHaveBeenCalledTimes(1) // Only tags check
    })

    it("should download model if not exists", async () => {
      // First call (check): not found
      // Second call (pull): success
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockResponse({ models: [] }))
        .mockResolvedValueOnce(createMockResponse(null))

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(fetch).toHaveBeenLastCalledWith(
        "http://localhost:11434/api/pull",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "nomic-embed-text", stream: false })
        })
      )
      expect(setPlasmoStoredValue).toHaveBeenCalledWith(
        STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
        true
      )
      expect(plasmoGlobalStorage.set).toHaveBeenCalledWith(
        STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
        "nomic-embed-text"
      )
    })

    it("should handle download failure", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockResponse({ models: [] }))
        .mockResolvedValueOnce(
          createMockResponse("Error details", {
            ok: false,
            status: 500,
            statusText: "Internal Server Error"
          })
        )

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(false)
      expect(result.error).toContain("HTTP 500")
    })

    it("should handle network error during download", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockResponse({ models: [] }))
        .mockRejectedValueOnce(new Error("Network Error"))

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Network Error")
    })

    it("aborts an in-flight model download with the caller signal", async () => {
      const controller = new AbortController()
      let pullSignal: AbortSignal | undefined
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockResponse({ models: [] }))
        .mockImplementationOnce(
          async (_input, init) =>
            new Promise((_resolve, reject) => {
              pullSignal = init?.signal as AbortSignal
              pullSignal.addEventListener("abort", () => {
                reject(new DOMException("Cancelled", "AbortError"))
              })
            })
        )

      const pending = downloadEmbeddingModelSilently(
        "nomic-embed-text",
        controller.signal
      )
      await vi.waitFor(() => expect(pullSignal).toBeDefined())
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
      expect(pullSignal?.aborted).toBe(true)
      expect(setPlasmoStoredValue).not.toHaveBeenCalled()
    })

    it("finishes the state commit before reporting cancellation", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(createMockResponse({ models: [] }))
        .mockResolvedValueOnce(createMockResponse(null))

      let finishSelectedModelWrite: (() => void) | undefined
      vi.mocked(plasmoGlobalStorage.set).mockImplementationOnce(
        () =>
          new Promise<null>((resolve) => {
            finishSelectedModelWrite = () => resolve(null)
          })
      )

      const controller = new AbortController()
      const pending = downloadEmbeddingModelSilently(
        "nomic-embed-text",
        controller.signal
      )

      await vi.waitFor(() =>
        expect(plasmoGlobalStorage.set).toHaveBeenCalledWith(
          STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
          "nomic-embed-text"
        )
      )
      controller.abort()
      finishSelectedModelWrite?.()

      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
      expect(setPlasmoStoredValue).toHaveBeenCalledWith(
        STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
        true
      )
      expect(
        vi.mocked(plasmoGlobalStorage.set).mock.invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(setPlasmoStoredValue).mock.invocationCallOrder[0] as number
      )
    })
  })
})
