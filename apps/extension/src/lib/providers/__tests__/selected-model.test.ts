import { describe, expect, it } from "vitest"
import {
  isSelectedModelRef,
  resolveModelRefFromModels
} from "@/lib/providers/selected-model"
import type { ProviderModel } from "@/types"

const makeModel = (name: string, providerId: string): ProviderModel => ({
  name,
  model: name,
  modified_at: new Date().toISOString(),
  size: 0,
  digest: "",
  providerId,
  details: {
    parent_model: "",
    format: "",
    family: "",
    families: [],
    parameter_size: "",
    quantization_level: ""
  }
})

describe("selected-model utilities", () => {
  it("resolves a unique model reference", () => {
    const models = [makeModel("llama3", "ollama"), makeModel("phi4", "vllm")]
    const result = resolveModelRefFromModels("llama3", models)

    expect(result.ambiguous).toBe(false)
    expect(result.ref).toEqual({
      providerId: "ollama",
      modelId: "llama3"
    })
  })

  it("marks duplicate model names as ambiguous", () => {
    const models = [makeModel("llama3", "ollama"), makeModel("llama3", "vllm")]
    const result = resolveModelRefFromModels("llama3", models)

    expect(result.ambiguous).toBe(true)
    expect(result.ref).toBeNull()
  })

  it("validates selected model reference shape", () => {
    expect(
      isSelectedModelRef({ providerId: "ollama", modelId: "llama3" })
    ).toBe(true)
    expect(isSelectedModelRef({ providerId: "ollama" })).toBe(false)
    expect(isSelectedModelRef(null)).toBe(false)
  })
})
