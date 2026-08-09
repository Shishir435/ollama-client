import { describe, expect, it } from "vitest"
import {
  EmbeddingsPrepareModelResultSchema,
  ModelsGetDetailsResultSchema,
  ModelsListLoadedResultSchema,
  ModelsSearchLibraryRequestSchema
} from "../model-rpc"

describe("model RPC contracts", () => {
  it("normalizes optional model detail fields", () => {
    expect(
      ModelsGetDetailsResultSchema.parse({
        providerId: "ollama",
        supportsDetails: true,
        details: { details: { format: "gguf" } }
      })
    ).toEqual({
      providerId: "ollama",
      supportsDetails: true,
      details: {
        details: {
          parent_model: "",
          format: "gguf",
          family: "",
          families: [],
          parameter_size: "",
          quantization_level: ""
        }
      }
    })
  })

  it("rejects malformed loaded-model and library inputs", () => {
    expect(
      ModelsListLoadedResultSchema.safeParse({
        models: [
          {
            name: "llama3",
            sizeBytes: -1,
            family: "llama",
            parameterSize: "8B",
            quantizationLevel: "Q4"
          }
        ]
      }).success
    ).toBe(false)
    expect(
      ModelsSearchLibraryRequestSchema.safeParse({
        query: "x".repeat(201)
      }).success
    ).toBe(false)
  })

  it("bounds embedding preparation errors", () => {
    expect(
      EmbeddingsPrepareModelResultSchema.safeParse({
        ready: false,
        prepared: false,
        error: "x".repeat(2001)
      }).success
    ).toBe(false)
  })
})
