import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useStorage } from "@plasmohq/storage/hook"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderId } from "@/lib/providers/types"
import { queryKeys } from "@/lib/query-keys"
import { extensionRpcClient } from "@/protocol/extension-client"
import { useProviderModels } from "../use-provider-models"

const { mockModelList, mockOllamaProvider, mockProviderConfig } = vi.hoisted(
  () => {
    const models = [
      {
        name: "llama3:latest",
        model: "llama3:latest",
        size: 0,
        details: { family: "llama" }
      },
      {
        name: "mistral:latest",
        model: "mistral:latest",
        size: 0,
        details: { family: "mistral" }
      }
    ]
    const ollamaProvider = {
      id: "ollama",
      config: {
        id: "ollama",
        type: "ollama",
        enabled: true,
        baseUrl: "http://localhost:11434",
        name: "Ollama"
      },
      capabilities: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: true,
        modelPull: true,
        modelUnload: true,
        modelDelete: true,
        providerVersion: true,
        toolCalling: false
      },
      getModels: vi.fn().mockResolvedValue(models),
      streamChat: vi.fn()
    }
    return {
      mockModelList: models,
      mockOllamaProvider: ollamaProvider,
      mockProviderConfig: [ollamaProvider.config] // Stable reference
    }
  }
)

// Mock useStorage from Plasmo
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn((config, initialValue) => {
    // Return stable references to prevent infinite loops in useEffect
    if (config.key === "llm_providers_config_v1") {
      return [
        mockProviderConfig,
        vi.fn().mockResolvedValue(undefined),
        { isLoading: false }
      ]
    }
    return [
      initialValue,
      vi.fn().mockResolvedValue(undefined),
      { isLoading: false }
    ]
  })
}))

// Mock dependencies
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
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
    getProviderConfig: vi.fn().mockResolvedValue(mockOllamaProvider.config)
  }
}))

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn()
  }
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn()
    }
  }
}))

// Prevent the shared singleton from leaking state between tests.
vi.mock("@/lib/query-client", () => ({
  queryClient: new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
}))

// Mock fetch globally
global.fetch = vi.fn()

const createWrapper = (
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
) => {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

/**
 * The hook asks the background which providers exist, then asks for each
 * provider's models separately, so a single blanket mock would answer both
 * with the same shape.
 */
const mockRpc = (
  modelsResult: unknown,
  providers: unknown[] = [{ ...mockOllamaProvider.config, hasApiKey: false }]
) => {
  vi.mocked(extensionRpcClient.call).mockImplementation((async (
    method: RpcMethod
  ) =>
    method === RpcMethod.ProvidersList ? { providers } : modelsResult) as never)
}

describe("useProviderModels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useStorage).mockImplementation(((
      config: any,
      initialValue: any
    ) => {
      if (config.key === "llm_providers_config_v1") {
        return [
          mockProviderConfig,
          vi.fn().mockResolvedValue(undefined),
          { isLoading: false }
        ]
      }
      return [
        initialValue,
        vi.fn().mockResolvedValue(undefined),
        { isLoading: false }
      ]
    }) as any)
    vi.mocked(ProviderFactory.getProvider).mockResolvedValue(
      mockOllamaProvider as any
    )
    vi.mocked(ProviderManager.getProviders).mockResolvedValue([
      mockOllamaProvider.config as any
    ])
    vi.mocked(ProviderManager.getProviderConfig).mockResolvedValue(
      mockOllamaProvider.config as any
    )
    mockRpc({ models: mockModelList, failures: [] })
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
      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      // Wait for loading to finish
      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false)
        },
        { timeout: 5000 }
      )

      expect(result.current.models).toHaveLength(2)
      expect(result.current.models?.[0].name).toBe("llama3:latest")
      expect(result.current.status).toBe("ready")
      expect(result.current.selectedProviderCapabilities).toEqual(
        getProviderCapabilities(ProviderId.OLLAMA)
      )
    })

    it("returns a large remote catalog without writing model mappings", async () => {
      const remoteModels = Array.from({ length: 455 }, (_, index) => ({
        name: `remote/model-${index}`,
        model: `remote/model-${index}`,
        size: 0,
        providerId: "custom:openai:remote",
        details: { family: "remote" }
      }))
      mockRpc({
        models: [
          { ...mockModelList[0], providerId: ProviderId.OLLAMA },
          ...remoteModels
        ],
        failures: []
      })

      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.status).toBe("ready")
      expect(result.current.models).toHaveLength(456)
      expect(result.current.models.at(-1)?.name).toBe("remote/model-454")
    })

    it("reports only the providers that contributed nothing", async () => {
      mockRpc({
        models: [{ ...mockModelList[0], providerId: ProviderId.OLLAMA }],
        failures: [
          {
            providerId: "custom:openai:silent",
            providerName: "Silent",
            code: "request_failed"
          },
          {
            providerId: "custom:openai:manual",
            providerName: "Manual",
            code: "discovery_unavailable"
          }
        ]
      })

      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // The provider whose declared ids carried the list has models on screen,
      // so there is nothing to warn about.
      expect(result.current.unavailableProviders).toEqual([
        {
          providerId: "custom:openai:silent",
          providerName: "Silent",
          code: "request_failed"
        }
      ])
    })

    it("should handle empty models list", async () => {
      mockRpc({
        models: [],
        failures: []
      })

      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.models).toEqual([])
      expect(result.current.status).toBe("empty")
    })

    it("re-discovers only the provider whose configuration changed", async () => {
      let providers: Record<string, unknown>[] = [
        { ...mockOllamaProvider.config, hasApiKey: false },
        {
          id: "custom:openai:router",
          type: "openai",
          enabled: true,
          name: "Router",
          baseUrl: "https://router.example/v1",
          customModels: ["a"],
          hasApiKey: true
        }
      ]
      const listModelsFor: string[] = []
      vi.mocked(extensionRpcClient.call).mockImplementation((async (
        method: RpcMethod,
        request: { providerId?: string }
      ) => {
        if (method === RpcMethod.ProvidersList) return { providers }
        listModelsFor.push(String(request.providerId))
        return { models: [], failures: [] }
      }) as never)

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
      })
      const { rerender } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper(queryClient)
      })

      await waitFor(() => {
        expect(listModelsFor).toEqual(["ollama", "custom:openai:router"])
      })

      // The router gains a declared model id; Ollama's configuration is
      // untouched, so its key still matches and it must answer from cache.
      // A fresh array: mutating the one react-query already holds would make
      // the "new" data deep-equal to the old and change nothing.
      providers = [providers[0], { ...providers[1], customModels: ["a", "b"] }]
      await queryClient.invalidateQueries({
        queryKey: queryKeys.model.providerConfigs()
      })
      rerender()

      await waitFor(() => {
        expect(listModelsFor).toEqual([
          "ollama",
          "custom:openai:router",
          "custom:openai:router"
        ])
      })
    })

    it("should handle fetch errors", async () => {
      vi.mocked(extensionRpcClient.call).mockRejectedValueOnce(
        new Error("API Error")
      )

      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.status).toBe("error")
    })

    it("marks legacy selected model as a conflict when multiple providers expose it", async () => {
      const setSelectionConflictModel = vi.fn().mockResolvedValue(undefined)
      const setSelectedModel = vi.fn().mockResolvedValue(undefined)
      const setSelectedModelRef = vi.fn().mockResolvedValue(undefined)
      const providers = [
        {
          id: "ollama",
          type: "ollama",
          enabled: true,
          baseUrl: "http://localhost:11434",
          name: "Ollama"
        },
        {
          id: "lm studio",
          type: "openai",
          enabled: true,
          baseUrl: "http://localhost:1234",
          name: "LM Studio"
        }
      ] as any[]
      const providerById = new Map(
        providers.map((config) => [
          config.id,
          {
            ...mockOllamaProvider,
            id: config.id,
            config,
            getModels: vi.fn().mockResolvedValue([
              {
                name: "shared-model",
                model: "shared-model",
                size: 0,
                details: { family: "llama" }
              }
            ])
          }
        ])
      )

      mockRpc({
        models: [...providerById.values()].flatMap((provider) =>
          provider.config.id === "ollama"
            ? [
                {
                  name: "shared-model",
                  model: "shared-model",
                  size: 0,
                  providerId: "ollama",
                  details: { family: "llama" }
                }
              ]
            : [
                {
                  name: "shared-model",
                  model: "shared-model",
                  size: 0,
                  providerId: "lm studio",
                  details: { family: "llama" }
                }
              ]
        ),
        failures: []
      })
      vi.mocked(useStorage).mockImplementation(((
        config: any,
        initialValue: any
      ) => {
        if (config.key === "llm_providers_config_v1") {
          return [
            providers,
            vi.fn().mockResolvedValue(undefined),
            {
              isLoading: false
            }
          ]
        }
        if (config.key === "provider-selected-model") {
          return ["shared-model", setSelectedModel, { isLoading: false }]
        }
        if (config.key === "provider-selected-model-ref") {
          return [null, setSelectedModelRef, { isLoading: false }]
        }
        if (config.key === "provider-selection-conflict-model") {
          return [null, setSelectionConflictModel, { isLoading: false }]
        }
        return [
          initialValue,
          vi.fn().mockResolvedValue(undefined),
          { isLoading: false }
        ]
      }) as any)

      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.models).toHaveLength(2)
      })
      await waitFor(() => {
        expect(setSelectionConflictModel).toHaveBeenCalledWith("shared-model")
      })

      expect(setSelectedModel).not.toHaveBeenCalled()
      expect(setSelectedModelRef).not.toHaveBeenCalled()
    })
  })

  describe("deleteModel", () => {
    it("should delete model successfully", async () => {
      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

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

  describe("fetchProviderVersion", () => {
    it("should fetch version successfully", async () => {
      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

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

      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper()
      })

      await waitFor(() => {
        expect(result.current.versionError).toBeTruthy()
      })
    })
  })

  describe("refresh", () => {
    it("should refetch models when refresh is called", async () => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false }
        }
      })
      const modelInfoKey = ["model", "info", "llama3:latest", "ollama"] as const
      queryClient.setQueryData(modelInfoKey, {
        capabilities: ["completion", "tools"]
      })
      const { result } = renderHook(() => useProviderModels(), {
        wrapper: createWrapper(queryClient)
      })

      await waitFor(() => {
        expect(result.current.status).toBe("ready")
      })

      mockRpc({
        models: [
          {
            name: "new-model",
            model: "new-model",
            size: 0,
            details: { family: "llama" }
          }
        ],
        failures: []
      })

      await result.current.refresh()

      await waitFor(() => {
        expect(result.current.models?.[0].name).toBe("new-model")
      })
      expect(queryClient.getQueryState(modelInfoKey)?.isInvalidated).toBe(true)
    })
  })
})
