import { describe, expect, it } from "vitest"

describe("runtime-core package boundary", () => {
  it("runs without application or browser test shims", () => {
    expect("chrome" in globalThis).toBe(false)
    expect("indexedDB" in globalThis).toBe(false)
    expect("document" in globalThis).toBe(false)
  })
})
