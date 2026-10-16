import { describe, expect, it } from "vitest"
import {
  getModelCapabilities,
  getModelCapabilityStates,
  type ModelCapabilityInput
} from "@/lib/providers/capabilities"
import { ProviderId } from "@/lib/providers/types"
import { isImageOnlyModel } from "../image-only-model"

const decide = (input: ModelCapabilityInput): boolean =>
  isImageOnlyModel(getModelCapabilities(input), getModelCapabilityStates(input))

describe("isImageOnlyModel", () => {
  it("sends an id-only OpenAI-compatible model the user marked as image output to the image operation", () => {
    expect(
      decide({
        providerId: "custom:openai:images",
        override: { imageOutput: true }
      })
    ).toBe(true)
  })

  it("keeps an LM Studio vision LLM on chat when its image-output override was set by mistake", () => {
    expect(
      decide({
        providerId: ProviderId.LM_STUDIO,
        lmStudioModelType: "vlm",
        capabilityTags: ["tool_use"],
        override: { imageOutput: true }
      })
    ).toBe(false)
    expect(
      decide({
        providerId: ProviderId.LM_STUDIO,
        lmStudioModelType: "llm",
        override: { imageOutput: true }
      })
    ).toBe(false)
  })

  it("sends an Ollama model reporting only image to the image operation", () => {
    expect(
      decide({ providerId: ProviderId.OLLAMA, ollamaCapabilities: ["image"] })
    ).toBe(true)
  })

  it("keeps an Ollama model reporting completion and image on chat", () => {
    expect(
      decide({
        providerId: ProviderId.OLLAMA,
        ollamaCapabilities: ["completion", "image"]
      })
    ).toBe(false)
  })

  it("keeps a model on chat when the user also asserted text output", () => {
    expect(
      decide({
        providerId: "custom:openai:images",
        override: { imageOutput: true, text: true }
      })
    ).toBe(false)
  })

  it("keeps a catalog model reporting text and image output on chat", () => {
    expect(
      decide({
        providerId: "custom:openai:router",
        outputModalities: ["text", "image"],
        override: { imageOutput: true }
      })
    ).toBe(false)
  })
})
