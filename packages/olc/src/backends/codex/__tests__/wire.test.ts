import { describe, expect, it } from "vitest"
import { mapCodexModel, normalizeCodexTools, toDynamicTools } from "../wire.js"

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
      supported_parameters: ["tools", "reasoning"],
      capabilities: {
        function_calling: true,
        vision: true,
        reasoning: true
      },
      reasoning: {
        supported_efforts: ["low", "medium"],
        default_effort: "medium"
      }
    })
  })

  it("does not advertise client tools when the bridge is disabled", () => {
    const mapped = mapCodexModel({ id: "codex-mini" }, false)
    expect(mapped.supported_parameters).not.toContain("tools")
    expect(mapped.capabilities.function_calling).toBe(false)
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
