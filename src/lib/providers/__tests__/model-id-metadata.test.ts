import { describe, expect, it } from "vitest"

import { parameterSizeFromModelId } from "../model-id-metadata"

describe("parameterSizeFromModelId", () => {
  it("reads the size LM Studio ids carry by convention", () => {
    expect(parameterSizeFromModelId("google/gemma-4-12b")).toBe("12B")
    expect(parameterSizeFromModelId("google/gemma-3-4b")).toBe("4B")
    expect(parameterSizeFromModelId("qwen/qwen3-4b-thinking-2507")).toBe("4B")
    expect(parameterSizeFromModelId("deepseek-r1-distill-qwen-7b")).toBe("7B")
  })

  it("keeps a decimal size intact", () => {
    // Splitting on the dot too would read this as 6B — off by a factor of ten.
    expect(parameterSizeFromModelId("qwen3-embedding-0.6b")).toBe("0.6B")
    expect(parameterSizeFromModelId("model-1.5b-instruct")).toBe("1.5B")
  })

  it("does not mistake a context window for a size", () => {
    expect(parameterSizeFromModelId("phi-3.5-mini-4k-instruct")).toBe("")
    expect(parameterSizeFromModelId("model-128k")).toBe("")
  })

  it("does not mistake a version or date for a size", () => {
    expect(parameterSizeFromModelId("qwen3.5")).toBe("")
    expect(parameterSizeFromModelId("model-2507")).toBe("")
  })

  it("refuses a mixture-of-experts notation rather than reporting a factor", () => {
    // 8x7b is neither 8B nor 7B, and the real total is not derivable here.
    expect(parameterSizeFromModelId("mistralai/mixtral-8x7b")).toBe("")
  })

  it("refuses when two tokens disagree", () => {
    expect(parameterSizeFromModelId("some-1b-8b-merge")).toBe("")
  })

  it("accepts the same size stated twice", () => {
    expect(parameterSizeFromModelId("org/llama-8b/llama-8b-q4")).toBe("8B")
  })

  it("returns empty for an id with no size at all", () => {
    expect(parameterSizeFromModelId("")).toBe("")
    expect(parameterSizeFromModelId("text-embedding-ada-002")).toBe("")
  })

  it("ignores case", () => {
    expect(parameterSizeFromModelId("Meta-Llama-3-70B-Instruct")).toBe("70B")
  })
})
