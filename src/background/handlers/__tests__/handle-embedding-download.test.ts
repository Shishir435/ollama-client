import { describe, expect, it, vi, beforeEach } from "vitest"
import { checkEmbeddingModelExists, downloadEmbeddingModelSilently } from "../handle-embedding-download"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { STORAGE_KEYS } from "@/lib/constants"

// Mock dependencies
vi.mock("@/background/lib/utils", () => ({
  getBaseUrl: vi.fn().mockResolvedValue("http://localhost:11434")
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    set: vi.fn(),
    get: vi.fn()
  }
}))

global.fetch = vi.fn()

describe("Handle Embedding Download", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("checkEmbeddingModelExists", () => {
    it("should return true if model exists", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }]
        })
      } as any)

      const exists = await checkEmbeddingModelExists("nomic-embed-text")
      expect(exists).toBe(true)
    })

    it("should return true if model exists with tag match", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }]
        })
      } as any)

      const exists = await checkEmbeddingModelExists("nomic-embed-text:latest")
      expect(exists).toBe(true)
    })

    it("should return false if model not found", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "llama2:latest" }]
        })
      } as any)

      const exists = await checkEmbeddingModelExists("nomic-embed-text")
      expect(exists).toBe(false)
    })

    it("should return false on API error", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        statusText: "Server Error"
      } as any)

      const exists = await checkEmbeddingModelExists("nomic-embed-text")
      expect(exists).toBe(false)
    })

    it("should return false on network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network Error"))

      const exists = await checkEmbeddingModelExists("nomic-embed-text")
      expect(exists).toBe(false)
    })
  })

  describe("downloadEmbeddingModelSilently", () => {
    it("should skip download if model exists", async () => {
      // Mock checkEmbeddingModelExists behavior by mocking fetch response
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }]
        })
      } as any)

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(true)
      expect(plasmoGlobalStorage.set).toHaveBeenCalledWith(
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
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] })
        } as any)
        .mockResolvedValueOnce({
          ok: true
        } as any)

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
      expect(plasmoGlobalStorage.set).toHaveBeenCalledWith(
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
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] })
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Error details"
        } as any)

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(false)
      expect(result.error).toContain("HTTP 500")
    })

    it("should handle network error during download", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ models: [] })
        } as any)
        .mockRejectedValueOnce(new Error("Network Error"))

      const result = await downloadEmbeddingModelSilently("nomic-embed-text")

      expect(result.success).toBe(false)
      expect(result.error).toBe("Network Error")
    })
  })
})
