import { describe, expect, it } from "vitest"
import {
  getAgentModelWarning,
  getModelParameterSizeBillions,
  getModelSuitability
} from "./model-utils"

describe("model-utils", () => {
  it("parses parameter size from model metadata", () => {
    expect(
      getModelParameterSizeBillions({
        name: "qwen2.5:7b",
        details: {
          parent_model: "",
          format: "gguf",
          family: "qwen2",
          families: ["qwen2"],
          parameter_size: "7B",
          quantization_level: "Q4_K_M"
        }
      })
    ).toBe(7)
  })

  it("flags small chat models for agent usage", () => {
    expect(
      getAgentModelWarning({
        name: "qwen2.5:3b",
        details: {
          parent_model: "",
          format: "gguf",
          family: "qwen2",
          families: ["qwen2"],
          parameter_size: "3B",
          quantization_level: "Q4_K_M"
        }
      })
    ).toMatch(/Small model|too weak/i)
  })

  it("does not flag stronger chat models", () => {
    expect(
      getAgentModelWarning({
        name: "qwen2.5:14b",
        details: {
          parent_model: "",
          format: "gguf",
          family: "qwen2",
          families: ["qwen2"],
          parameter_size: "14B",
          quantization_level: "Q4_K_M"
        }
      })
    ).toBeNull()
  })

  it("marks non-vision models explicitly for Vision Mode", () => {
    const suitability = getModelSuitability({
      name: "qwen2.5:14b",
      details: {
        parent_model: "",
        format: "gguf",
        family: "qwen2",
        families: ["qwen2"],
        parameter_size: "14B",
        quantization_level: "Q4_K_M"
      }
    })

    expect(suitability.lacksVisionSupport).toBe(true)
    expect(suitability.summary).toMatch(/No Vision Mode support/i)
  })

  it("does not mark vl models as lacking vision", () => {
    const suitability = getModelSuitability({
      name: "qwen3-vl:8b",
      details: {
        parent_model: "",
        format: "gguf",
        family: "qwen2",
        families: ["clip", "qwen2"],
        parameter_size: "8B",
        quantization_level: "Q4_K_M"
      }
    })

    expect(suitability.lacksVisionSupport).toBe(false)
  })
})
