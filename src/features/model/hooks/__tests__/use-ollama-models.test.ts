import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useOllamaModels } from "../use-ollama-models"
import { ProviderId, ProviderType } from "@/lib/providers/types"

const { mockProvider, mockOllamaProvider, mockProviderConfig } = vi.hoisted(() => {
  const ollamaProvider = {
    id: "ollama",
    config: { id: "ollama", type: "ollama", enabled: true, baseUrl: "http://localhost:11434", name: "Ollama" },
    getModels: vi.fn().mockResolvedValue(["llama3:latest", "mistral:latest"]),
    streamChat: vi.fn()
  }
  return {
    mockOllamaProvider: ollamaProvider,
    mockProvider: ollamaProvider,
    mockProviderConfig: [ollamaProvider.config] // Stable reference
  }
})

// Mock useStorage from Plasmo
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn((config, initialValue) => {
    // Return stable references to prevent infinite loops in useEffect
    if (config.key === "llm_providers_config_v1" || config.key?.includes("provider")) {
        return [mockProviderConfig, vi.fn().mockResolvedValue(undefined)]
    }
    return [initialValue, vi.fn().mockResolvedValue(undefined)]
  })
}))

// Mock dependencies
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn().mockReturnValue(() => {})
  }
}))

vi.mock("@/lib/providers/factory", () => ({
  ProviderFactory: {
    getProvider: vi.fn().mockResolvedValue(mockOllamaProvider)
  }
}))

vi.mock("@/lib/providers/manager", () => ({
  ProviderManager: {
    getProviders: vi.fn().mockResolvedValue([mockOllamaProvider.config]),
    getProviderConfig: vi.fn().mockResolvedValue(mockOllamaProvider.config),
    saveModelMappings: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

// Mock fetch globally
global.fetch = vi.fn()

describe("useOllamaModels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetch).mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.includes("/api/version")) {
        return {
          ok: true,
          json: async () => ({ version: "0.1.23" })
        } as Response
      }
      if (urlStr.includes("/api/delete")) {
        return { ok: true } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
  })

  describe("fetchModels", () => {
    it("should fetch models successfully", async () => {
      const { result } = renderHook(() => useOllamaModels())

      // Wait for loading to finish
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      }, { timeout: 5000 })

      expect(result.current.models).toHaveLength(2)
      expect(result.current.models?.[0].name).toBe("llama3:latest")
      expect(result.current.status).toBe("ready")
    })

    it("should handle empty models list", async () => {
      vi.mocked(mockOllamaProvider.getModels).mockResolvedValueOnce([])

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.models).toEqual([])
      expect(result.current.status).toBe("empty")
    })

    it("should handle fetch errors", async () => {
      vi.mocked(mockOllamaProvider.getModels).mockRejectedValueOnce(new Error("API Error"))

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.status).toBe("empty")
    })
  })

  describe("deleteModel", () => {
    it("should delete model successfully", async () => {
      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      await result.current.deleteModel("llama3:latest")

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/delete"),
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ name: "llama3:latest" })
        })
      )
    })
  })

  describe("fetchOllamaVersion", () => {
    it("should fetch version successfully", async () => {
      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.version).toBe("0.1.23")
      })
    })

    it("should handle version fetch errors", async () => {
      vi.mocked(fetch).mockImplementation(async (url) => {
        if (url.toString().includes("/api/version")) {
          return { ok: false } as Response
        }
        return { ok: true, json: async () => ({}) } as Response
      })

      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.versionError).toBeTruthy()
      })
    })
  })

  describe("refresh", () => {
    it("should refetch models when refresh is called", async () => {
      const { result } = renderHook(() => useOllamaModels())

      await waitFor(() => {
        expect(result.current.status).toBe("ready")
      })

      vi.mocked(mockOllamaProvider.getModels).mockResolvedValueOnce(["new-model"])
      
      await result.current.refresh()

      await waitFor(() => {
        expect(result.current.models?.[0].name).toBe("new-model")
      })
    })
  })
})
