import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useOllamaModels } from "../use-ollama-models"

// Mock browser API
vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

describe("useOllamaModels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("fetchModels", () => {
    it("should fetch models successfully", async () => {
      const mockModels = [
        { name: "llama3:latest", size: 4000000000 },
        { name: "mistral:latest", size: 3500000000 }
      ]

      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
        success: true,
        data: { models: mockModels }
      })

      const { result } = renderHook(() => useOllamaModels())

      // Initially loading
      expect(result.current.loading).toBe(true)
      expect(result.current.status).toBe("loading")

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.models).toEqual(mockModels)
      expect(result.current.error).toBe(null)
      expect(result.current.status).toBe("ready")
    })

    it("should handle empty models list", async () => {
      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
        success: true,
        data: { models: [] }
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.models).toEqual([])
      expect(result.current.status).toBe("empty")
    })

    it("should handle fetch errors", async () => {
      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
        success: false,
        error: { message: "Connection failed" }
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.models).toBe(null)
      expect(result.current.error).toBe(
        "Failed to fetch models. Ensure Ollama is running or check the base URL."
      )
      expect(result.current.status).toBe("error")
    })

    it("should handle network exceptions", async () => {
      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockRejectedValue(
        new Error("Network error")
      )

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.models).toBe(null)
      expect(result.current.error).toBeTruthy()
      expect(result.current.status).toBe("error")
    })
  })

  describe("deleteModel", () => {
    it("should delete model successfully", async () => {
      const mockModels = [
        { name: "llama3:latest", size: 4000000000 },
        { name: "mistral:latest", size: 3500000000 }
      ]

      const { browser } = await import("@/lib/browser-api")
      
      // First call for fetchModels
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { models: mockModels }
      })
      // Second call for version
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { version: "0.1.0" }
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.models).toEqual(mockModels)
      })

      // Delete model success
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true
      })

      await result.current.deleteModel("llama3:latest")

      await waitFor(() => {
        expect(result.current.models).toHaveLength(1)
      })

      expect(result.current.models?.[0].name).toBe("mistral:latest")
    })

    it("should handle delete errors gracefully", async () => {
      const mockModels = [{ name: "llama3:latest", size: 4000000000 }]

      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { models: mockModels }
      })
        vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { version: "0.1.0" }
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.models).toEqual(mockModels)
      })

      // Delete fails
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: false,
        error: { message: "Model not found" }
      })

      await result.current.deleteModel("llama3:latest")

      // Models should remain unchanged
      expect(result.current.models).toEqual(mockModels)
    })
  })

  describe("fetchOllamaVersion", () => {
    it("should fetch version successfully", async () => {
      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { models: [] }
      })
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { version: "0.1.23" }
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.version).toBe("0.1.23")
      })

      expect(result.current.versionError).toBe(null)
    })

    it("should handle version fetch errors", async () => {
      const { browser } = await import("@/lib/browser-api")
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { models: [] }
      })
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: false
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.versionError).toBeTruthy()
      })

      expect(result.current.version).toBe(null)
    })
  })

  describe("refresh", () => {
    it("should refetch models when refresh is called", async () => {
      const { browser } = await import("@/lib/browser-api")
      
      const initialModels = [{ name: "llama3:latest", size: 4000000000 }]
      const updatedModels = [
        { name: "llama3:latest", size: 4000000000 },
        { name: "mistral:latest", size: 3500000000 }
      ]

      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { models: initialModels }
      })
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { version: "0.1.0" }
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.models).toEqual(initialModels)
      })

      // Refresh
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
        success: true,
        data: { models: updatedModels }
      })

      await result.current.refresh()

      await waitFor(() => {
        expect(result.current.models).toEqual(updatedModels)
      })
    })
  })
})
