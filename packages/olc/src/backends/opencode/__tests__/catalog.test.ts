import { describe, expect, it } from "vitest"
import { collectModels, mapModel, normalizeProviders } from "../catalog.js"

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
