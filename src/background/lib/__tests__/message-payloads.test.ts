import { describe, expect, it } from "vitest"
import {
  parseModelRef,
  parseProviderIdPayload,
  parseStringPayload,
  parseWarmupPayload
} from "@/background/lib/message-payloads"

describe("parseModelRef", () => {
  it("normalizes a bare string to { model }", () => {
    expect(parseModelRef("llama3")).toEqual({ model: "llama3" })
  })

  it("keeps model + providerId from an object", () => {
    expect(parseModelRef({ model: "llama3", providerId: "ollama" })).toEqual({
      model: "llama3",
      providerId: "ollama"
    })
  })

  it("drops a non-string providerId", () => {
    expect(parseModelRef({ model: "m", providerId: 5 })).toEqual({ model: "m" })
  })

  it("trims the model name in both string and object paths", () => {
    expect(parseModelRef("  m  ")).toEqual({ model: "m" })
    expect(parseModelRef({ model: "  m  " })).toEqual({ model: "m" })
  })

  it("returns null for empty, missing, or non-model payloads", () => {
    expect(parseModelRef("")).toBeNull()
    expect(parseModelRef("   ")).toBeNull()
    expect(parseModelRef({})).toBeNull()
    expect(parseModelRef({ model: "" })).toBeNull()
    expect(parseModelRef({ model: 1 })).toBeNull()
    expect(parseModelRef(undefined)).toBeNull()
    expect(parseModelRef(null)).toBeNull()
  })
})

describe("parseWarmupPayload", () => {
  it("carries through previousModel/previousProviderId (unload-on-switch)", () => {
    expect(
      parseWarmupPayload({
        model: "b",
        providerId: "ollama",
        previousModel: "a",
        previousProviderId: "ollama"
      })
    ).toEqual({
      model: "b",
      providerId: "ollama",
      previousModel: "a",
      previousProviderId: "ollama"
    })
  })

  it("works for a bare string (no previous model)", () => {
    expect(parseWarmupPayload("b")).toEqual({
      model: "b",
      previousModel: undefined,
      previousProviderId: undefined
    })
  })

  it("drops non-string previous* fields", () => {
    expect(
      parseWarmupPayload({
        model: "b",
        previousModel: 1,
        previousProviderId: {}
      })
    ).toEqual({
      model: "b",
      previousModel: undefined,
      previousProviderId: undefined
    })
  })

  it("returns null when no usable model is present", () => {
    expect(parseWarmupPayload({})).toBeNull()
    expect(parseWarmupPayload({ model: "" })).toBeNull()
    expect(parseWarmupPayload(undefined)).toBeNull()
    expect(parseWarmupPayload({ previousModel: "a" })).toBeNull()
  })
})

describe("parseStringPayload", () => {
  it("returns non-empty strings, trimmed", () => {
    expect(parseStringPayload("http://localhost:11434")).toBe(
      "http://localhost:11434"
    )
    expect(parseStringPayload("  spaced  ")).toBe("spaced")
  })
  it("returns null for empty or non-strings", () => {
    expect(parseStringPayload("  ")).toBeNull()
    expect(parseStringPayload(42)).toBeNull()
    expect(parseStringPayload(undefined)).toBeNull()
  })
})

describe("parseProviderIdPayload", () => {
  it("extracts a string providerId", () => {
    expect(parseProviderIdPayload({ providerId: "ollama" })).toEqual({
      providerId: "ollama"
    })
  })
  it("returns {} when absent or wrong type", () => {
    expect(parseProviderIdPayload(undefined)).toEqual({})
    expect(parseProviderIdPayload({})).toEqual({})
    expect(parseProviderIdPayload({ providerId: 3 })).toEqual({})
  })
})
