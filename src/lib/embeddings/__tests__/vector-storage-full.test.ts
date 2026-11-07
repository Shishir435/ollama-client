import { describe, expect, it } from "vitest"
import {
  VectorStorageFullError,
  vectorStorageFullLimit
} from "../vector-storage-full"

describe("vector storage full", () => {
  it("carries the limit in a message a failure record can hold", () => {
    const error = new VectorStorageFullError(100)
    expect(error.message).toBe("vector_storage_full:100")
    expect(vectorStorageFullLimit(error.message)).toBe(100)
  })

  it("recognises the code inside a longer failure and ignores other failures", () => {
    expect(
      vectorStorageFullLimit("Failed to embed: vector_storage_full:0.5")
    ).toBe(0.5)
    expect(vectorStorageFullLimit("Failed: vector_storage_full:250")).toBe(250)
    expect(vectorStorageFullLimit("Embedding provider is offline")).toBe(
      undefined
    )
  })
})
