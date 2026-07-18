import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getProviders: vi.fn(),
  getProvider: vi.fn(),
  getProviderWithConfig: vi.fn()
}))

vi.mock("../manager", () => ({
  ProviderManager: {
    getProviders: mocks.getProviders
  }
}))

vi.mock("../factory", () => ({
  ProviderFactory: {
    getProvider: mocks.getProvider,
    getProviderWithConfig: mocks.getProviderWithConfig
  }
}))

import { ProviderRpcService } from "../provider-rpc-service"
import { type ProviderConfig, ProviderType } from "../types"

const configs: ProviderConfig[] = [
  {
    id: "ollama",
    type: ProviderType.OLLAMA,
    enabled: true,
    baseUrl: "http://localhost:11434",
    apiKey: "private-key",
    name: "Ollama",
    customModels: ["manual-model"]
  },
  {
    id: "custom:openai:remote",
    type: ProviderType.OPENAI,
    enabled: true,
    baseUrl: "https://example.test/v1",
    name: "Remote"
  }
]

const model = (name: string) => ({
  name,
  model: name,
  modified_at: "2026-07-18T00:00:00.000Z",
  size: 1,
  digest: `digest-${name}`,
  details: {
    parent_model: "",
    format: "gguf",
    family: "llama",
    families: ["llama"],
    parameter_size: "7B",
    quantization_level: "Q4"
  }
})

beforeEach(() => {
  mocks.getProviders.mockResolvedValue(configs)
  mocks.getProvider.mockImplementation(async (id: string) => ({
    id,
    getModels: async () => [model(`${id}-model`)]
  }))
  mocks.getProviderWithConfig.mockImplementation(async (config) => ({
    id: config.id,
    getModels: async () => [model("draft-model")]
  }))
})

describe("ProviderRpcService", () => {
  it("lists public provider config without returning credentials", async () => {
    const result = await ProviderRpcService.list()

    expect(result.providers[0]).toMatchObject({
      id: "ollama",
      hasApiKey: true
    })
    expect(result.providers[0]).not.toHaveProperty("apiKey")
    expect(JSON.stringify(result)).not.toContain("private-key")
  })

  it("tests an unsaved draft without returning its credential", async () => {
    const result = await ProviderRpcService.testConnection({
      target: "draft",
      config: configs[0]
    })

    expect(mocks.getProviderWithConfig).toHaveBeenCalledWith(configs[0])
    expect(result).toMatchObject({
      providerId: "ollama",
      reachable: true,
      modelCount: 1
    })
    expect(result).not.toHaveProperty("apiKey")
  })

  it("merges custom models and reports partial failures without query side effects", async () => {
    mocks.getProvider.mockImplementation(async (id: string) => {
      if (id === "custom:openai:remote") throw new Error("offline")
      return { id, getModels: async () => [model("discovered")] }
    })

    const result = await ProviderRpcService.listModels({ enabledOnly: true })

    expect(result.models.map(({ name }) => name)).toEqual([
      "discovered",
      "manual-model"
    ])
    expect(result.failures).toEqual([
      { providerId: "custom:openai:remote", code: "request_failed" }
    ])
  })

  it("fails when every selected provider is unavailable", async () => {
    mocks.getProvider.mockRejectedValue(new Error("offline"))

    await expect(
      ProviderRpcService.listModels({ enabledOnly: true })
    ).rejects.toMatchObject({
      userMessage: "Failed to fetch models from the configured providers",
      retryable: true
    })
  })
})
