import { describe, expect, it } from "vitest"

import { formatParameterSize } from "../model-utils"

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
