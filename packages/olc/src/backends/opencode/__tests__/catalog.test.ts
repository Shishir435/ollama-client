import { describe, expect, it } from "vitest"
import {
  collectModels,
  collectV2Models,
  mapModel,
  mergeReasoningMetadata,
  normalizeProviders,
  resolveReasoningVariant
} from "../catalog.js"

const opencodeModel = {
  id: "laguna-s-2.1-free",
  name: "Laguna S 2.1 Free",
  status: "active",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, image: false, audio: false, video: false, pdf: false }
  },
  variants: {
    low: { reasoningEffort: "low" },
    high: { reasoningEffort: "high" },
    max: { reasoningEffort: "max" },
    fast: { serviceTier: "priority" }
  },
  limit: { context: 256_000, output: 32_000 }
}

describe("mapModel", () => {
  it("publishes OpenCode's capability facts in the fields clients read", () => {
    expect(
      mapModel("opencode", "laguna-s-2.1-free", opencodeModel)
    ).toMatchObject({
      id: "opencode/laguna-s-2.1-free",
      owned_by: "opencode",
      name: "Laguna S 2.1 Free",
      context_length: 256_000,
      max_tokens: 32_000,
      input_modalities: ["text"],
      supported_parameters: ["tools", "reasoning", "temperature"],
      capabilities: {
        function_calling: true,
        vision: false,
        reasoning: true
      },
      reasoning: {
        supported_efforts: ["low", "high", "max"]
      },
      status: "active"
    })
  })

  it("reports vision from the model's input modalities", () => {
    const mapped = mapModel("opencode", "mimo", {
      capabilities: {
        toolcall: false,
        input: { text: true, image: true }
      }
    })

    expect(mapped.input_modalities).toEqual(["text", "image"])
    expect(mapped.capabilities).toEqual({
      function_calling: false,
      vision: true,
      reasoning: false
    })
    expect(mapped.supported_parameters).toEqual([])
  })

  it("omits limits OpenCode did not report rather than inventing them", () => {
    const mapped = mapModel("custom", "unknown-model", {})
    expect(mapped).not.toHaveProperty("context_length")
    expect(mapped).not.toHaveProperty("max_tokens")
    expect(mapped).not.toHaveProperty("status")
    expect(mapped.name).toBe("unknown-model")
    expect(mapped.input_modalities).toEqual(["text"])
  })
})

describe("normalizeProviders", () => {
  it("accepts both the array and the keyed-object catalog shapes", () => {
    expect(normalizeProviders([{ id: "a" }])).toEqual([{ id: "a" }])
    expect(normalizeProviders({ a: { name: "A" } })).toEqual([
      { name: "A", id: "a" }
    ])
    expect(normalizeProviders(null)).toEqual([])
  })
})

describe("collectModels", () => {
  it("flattens every provider's models and skips providers without any", () => {
    const models = collectModels([
      { id: "opencode", models: { "laguna-s-2.1-free": opencodeModel } },
      { id: "empty" },
      { models: { orphan: {} } }
    ])

    expect(models.map((model: { id: string }) => model.id)).toEqual([
      "opencode/laguna-s-2.1-free"
    ])
  })

  it("reports an empty catalog as empty", () => {
    expect(collectModels(undefined)).toEqual([])
  })
})

describe("OpenCode v2 reasoning variants", () => {
  const models = collectV2Models([
    {
      id: "gpt-5.6-sol",
      providerID: "openai",
      name: "GPT-5.6 Sol",
      capabilities: { tools: true, input: ["text", "image"] },
      request: { variant: "medium" },
      variants: [
        { id: "low", headers: {}, body: {} },
        { id: "medium", headers: {}, body: {} },
        { id: "high", headers: {}, body: {} },
        { id: "xhigh", headers: {}, body: {} },
        { id: "max", headers: {}, body: {} },
        { id: "priority", headers: {}, body: {} }
      ],
      limit: { context: 1_000_000, output: 128_000 },
      status: "active"
    }
  ])

  it("publishes only canonical effort variants and their default", () => {
    expect(models[0]).toMatchObject({
      id: "openai/gpt-5.6-sol",
      supported_parameters: ["tools", "reasoning"],
      reasoning: {
        supported_efforts: ["low", "medium", "high", "xhigh", "max"],
        default_effort: "medium"
      },
      capabilities: { reasoning: true, vision: true }
    })
  })

  it("restores exact variants omitted by v2 from the legacy catalog", () => {
    const v2 = collectV2Models([
      {
        id: "x-preview-f-free",
        providerID: "opencode",
        name: "Ox Alpha Free",
        capabilities: { tools: true, input: ["text", "image"] },
        request: { headers: {}, body: {} },
        variants: [],
        limit: { context: 1_000_000, output: 131_072 },
        status: "active"
      }
    ])
    const legacy = collectModels([
      {
        id: "opencode",
        models: {
          "x-preview-f-free": {
            id: "x-preview-f-free",
            capabilities: { reasoning: true, toolcall: true },
            variants: {
              low: { reasoningEffort: "low" },
              high: { reasoningEffort: "high" },
              max: { reasoningEffort: "max" }
            }
          }
        }
      }
    ])

    expect(mergeReasoningMetadata(v2, legacy)[0]).toMatchObject({
      supported_parameters: ["tools", "reasoning"],
      capabilities: { reasoning: true },
      reasoning: { supported_efforts: ["low", "high", "max"] }
    })
  })

  it("resolves only an exact model-advertised effort", () => {
    expect(
      resolveReasoningVariant(
        models,
        { providerId: "openai", modelId: "gpt-5.6-sol" },
        "high"
      )
    ).toEqual({ variant: "high" })
    expect(
      resolveReasoningVariant(
        models,
        { providerId: "openai", modelId: "gpt-5.6-sol" },
        "minimal"
      )
    ).toEqual({
      error:
        "Model 'openai/gpt-5.6-sol' does not support reasoning effort 'minimal'. Supported efforts: low, medium, high, xhigh, max."
    })
  })
})
