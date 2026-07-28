import { Bot, Brain, Code, Settings, Sparkles, Zap } from "lucide-react"
import { describe, expect, it } from "vitest"

import { formatParameterSize, getModelIcon } from "../model-utils"

describe("formatParameterSize", () => {
  it("caps the decimals at one and drops a trailing zero", () => {
    expect(formatParameterSize("8.2B")).toBe("8.2B")
    expect(formatParameterSize("8B")).toBe("8B")
    expect(formatParameterSize("11.94B")).toBe("11.9B")
    expect(formatParameterSize("7.0B")).toBe("7B")
  })

  it("promotes a value that rounds up into the next unit", () => {
    // Ollama reports gemma3:1b as 999.89M, which sat next to plain "8B" rows.
    expect(formatParameterSize("999.89M")).toBe("1B")
    expect(formatParameterSize("1000M")).toBe("1B")
  })

  it("keeps a value that does not round up in its own unit", () => {
    expect(formatParameterSize("350M")).toBe("350M")
    expect(formatParameterSize("949.4M")).toBe("949.4M")
    expect(formatParameterSize("32k")).toBe("32K")
  })

  it("accepts a bare parameter count", () => {
    expect(formatParameterSize("7000000000")).toBe("7B")
    expect(formatParameterSize("560")).toBe("560")
  })

  it("tolerates surrounding whitespace and mixed-case suffixes", () => {
    expect(formatParameterSize("  8.2b  ")).toBe("8.2B")
  })

  it("passes through input it cannot parse", () => {
    expect(formatParameterSize("")).toBe("")
    expect(formatParameterSize("unknown")).toBe("unknown")
    expect(formatParameterSize("8B (q4)")).toBe("8B (q4)")
    expect(formatParameterSize("0B")).toBe("0B")
  })
})

describe("getModelIcon", () => {
  it("reaches the code icon for codellama", () => {
    // "codellama" contains "llama", so testing the shorter pattern first made
    // this branch unreachable.
    expect(getModelIcon("codellama:13b")).toBe(Code)
    expect(getModelIcon("starcoder2:3b")).toBe(Code)
  })

  it("matches a family only at a token boundary", () => {
    // "dolphin" contains "phi", so substring matching handed this model the phi
    // icon the moment the pattern list was reordered.
    expect(getModelIcon("dolphin-llama3:latest")).toBe(Bot)
    expect(getModelIcon("llama3.2:3b")).toBe(Bot)
    expect(getModelIcon("phi4:14b")).toBe(Settings)
  })

  it("picks embedding models by what they are, not who made them", () => {
    expect(getModelIcon("nomic-embed-text")).toBe(Brain)
    expect(getModelIcon("mxbai-embed-large")).toBe(Brain)
    // Would otherwise match the qwen family pattern.
    expect(getModelIcon("qwen3-embedding:0.6b")).toBe(Brain)
  })

  it("maps the remaining families", () => {
    expect(getModelIcon("gemma4:12b")).toBe(Sparkles)
    expect(getModelIcon("qwen3:8b")).toBe(Sparkles)
    expect(getModelIcon("qwq:32b")).toBe(Sparkles)
    expect(getModelIcon("mistral:7b")).toBe(Zap)
    expect(getModelIcon("mixtral:8x7b")).toBe(Zap)
    expect(getModelIcon("phi4:14b")).toBe(Settings)
    expect(getModelIcon("deepseek-r1:8b")).toBe(Brain)
  })

  it("falls back to the bot icon for an unknown family", () => {
    expect(getModelIcon("some-unreleased-model:1b")).toBe(Bot)
  })
})
