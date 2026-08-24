import { describe, expect, it } from "vitest"
import {
  mapCodexImageGenerationModel,
  mapCodexModel,
  normalizeCodexTools,
  resolveCodexReasoningEffort,
  toDynamicTools
} from "../wire.js"

describe("Codex wire mappings", () => {
  it("publishes model modalities and canonical reasoning efforts", () => {
    expect(
      mapCodexModel({
        id: "gpt-5-codex",
        displayName: "GPT-5 Codex",
        inputModalities: ["text", "image"],
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "unsupported" }
        ]
      })
    ).toMatchObject({
      id: "codex/gpt-5-codex",
      owned_by: "codex",
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
      supported_parameters: ["tools", "reasoning"],
      capabilities: {
        function_calling: true,
        vision: true,
        reasoning: true,
        image_generation: false
      },
      reasoning: {
        supported_efforts: ["low", "medium"],
        default_effort: "medium"
      }
    })
  })

  it("publishes provider image generation as a dedicated model", () => {
    expect(mapCodexImageGenerationModel()).toMatchObject({
      id: "codex/image-generation",
      input_modalities: ["text"],
      output_modalities: ["image"],
      capabilities: {
        function_calling: false,
        vision: false,
        reasoning: false,
        image_generation: true
      }
    })
  })

  it("does not advertise client tools when the bridge is disabled", () => {
    const mapped = mapCodexModel({ id: "codex-mini" }, false)
    expect(mapped.supported_parameters).not.toContain("tools")
    expect(mapped.capabilities.function_calling).toBe(false)
  })

  it("resolves only an exact model-advertised effort", () => {
    const models = [
      {
        id: "gpt-5-codex",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" }
        ]
      }
    ]
    expect(
      resolveCodexReasoningEffort(models, "gpt-5-codex", "medium")
    ).toEqual({ effort: "medium" })
    expect(resolveCodexReasoningEffort(models, "gpt-5-codex", "high")).toEqual({
      error:
        "Model 'codex/gpt-5-codex' does not support reasoning effort 'high'. Supported efforts: low, medium."
    })
  })

  it("turns unique OpenAI function tools into App Server dynamic tools", () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "search_notes",
          description: "Search notes",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } }
          }
        }
      },
      {
        type: "function",
        function: { name: "search_notes", description: "duplicate" }
      },
      { type: "function", function: { name: "" } }
    ]

    expect(normalizeCodexTools(tools)).toHaveLength(1)
    expect(toDynamicTools(tools)).toEqual([
      {
        type: "function",
        name: "search_notes",
        description: "Search notes",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } }
        }
      }
    ])
  })
})
