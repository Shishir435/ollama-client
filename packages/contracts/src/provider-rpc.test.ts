import { describe, expect, it } from "vitest"
import {
  ProvidersListModelsResultSchema,
  ProvidersListResultSchema,
  ProvidersUpsertRequestSchema
} from "./provider-rpc"

describe("provider RPC contracts", () => {
  it("accepts complete provider commands and rejects unknown input", () => {
    const request = {
      target: "existing",
      config: {
        id: "custom:openai:test",
        type: "openai",
        enabled: true,
        baseUrl: "https://example.test/v1",
        apiKey: "secret",
        name: "Example",
        customModels: ["model-a"],
        serviceProfile: "openrouter",
        compatibility: {
          maxTokensField: "max_completion_tokens",
          sendStreamOptions: "always"
        }
      }
    } as const

    expect(ProvidersUpsertRequestSchema.parse(request)).toEqual(request)
    expect(
      ProvidersUpsertRequestSchema.safeParse({ ...request, unknown: true })
        .success
    ).toBe(false)
  })

  it("keeps credentials out of public provider results", () => {
    const provider = {
      id: "openai",
      type: "openai",
      enabled: true,
      name: "OpenAI",
      hasApiKey: true
    }

    expect(ProvidersListResultSchema.parse({ providers: [provider] })).toEqual({
      providers: [provider]
    })
    expect(
      ProvidersListResultSchema.safeParse({
        providers: [{ ...provider, apiKey: "must-not-cross-rpc" }]
      }).success
    ).toBe(false)
  })

  it("normalizes provider model results at the RPC boundary", () => {
    expect(
      ProvidersListModelsResultSchema.parse({
        models: [
          {
            name: "llama3",
            model: null,
            family: "llama",
            capabilityHints: {
              modelType: "llm",
              modalities: ["text"]
            }
          }
        ],
        failures: []
      })
    ).toEqual({
      models: [
        {
          name: "llama3",
          model: "llama3",
          modified_at: "",
          size: 0,
          digest: "",
          details: {
            parent_model: "",
            format: "",
            family: "llama",
            families: ["llama"],
            parameter_size: "",
            quantization_level: ""
          },
          capabilityHints: {
            modelType: "llm",
            modalities: ["text"]
          }
        }
      ],
      failures: []
    })
  })
})
