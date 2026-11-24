import { describe, expect, it } from "vitest"
import {
  isAutoContext,
  reportedContextLengthFromModelInfo,
  resolveEffectiveContext
} from "../model-context"

describe("resolveEffectiveContext", () => {
  it("asks Auto for the model's reported window, held to 16384", () => {
    expect(resolveEffectiveContext({ configured: 0, reported: 4096 })).toBe(
      4096
    )
    expect(resolveEffectiveContext({ configured: 0, reported: 16384 })).toBe(
      16384
    )
    expect(resolveEffectiveContext({ configured: 0, reported: 131072 })).toBe(
      16384
    )
  })

  it("asks Auto for the cap alone when the model reports nothing", () => {
    expect(resolveEffectiveContext({ configured: 0 })).toBe(16384)
    expect(resolveEffectiveContext({ configured: undefined })).toBe(16384)
    expect(resolveEffectiveContext({ configured: 0, reported: 0 })).toBe(16384)
    expect(
      resolveEffectiveContext({ configured: -1, reported: Number.NaN })
    ).toBe(16384)
  })

  it("respects an explicit window, even above the Auto cap", () => {
    expect(resolveEffectiveContext({ configured: 32768 })).toBe(32768)
    expect(
      resolveEffectiveContext({ configured: 32768, reported: 131072 })
    ).toBe(32768)
  })

  it("caps an explicit window to what the model reports", () => {
    expect(resolveEffectiveContext({ configured: 65536, reported: 8192 })).toBe(
      8192
    )
    expect(resolveEffectiveContext({ configured: 2048, reported: 8192 })).toBe(
      2048
    )
  })
})

describe("isAutoContext", () => {
  it("reads zero, negative and missing values as Auto", () => {
    expect(isAutoContext(0)).toBe(true)
    expect(isAutoContext(-1)).toBe(true)
    expect(isAutoContext(undefined)).toBe(true)
    expect(isAutoContext(128)).toBe(false)
  })
})

describe("reportedContextLengthFromModelInfo", () => {
  it("finds the architecture-prefixed key", () => {
    expect(
      reportedContextLengthFromModelInfo({
        "general.architecture": "qwen3",
        "qwen3.context_length": 40960
      })
    ).toBe(40960)
  })

  it("ignores values that are not positive integers", () => {
    expect(
      reportedContextLengthFromModelInfo({ "llama.context_length": -4 })
    ).toBeUndefined()
    expect(
      reportedContextLengthFromModelInfo({ "llama.context_length": "lots" })
    ).toBeUndefined()
    expect(reportedContextLengthFromModelInfo(undefined)).toBeUndefined()
  })
})
