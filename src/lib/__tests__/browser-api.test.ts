import { afterEach, describe, expect, it, vi } from "vitest"
import { supportsTabGroups } from "@/lib/browser-api"

const originalChrome = globalThis.chrome

afterEach(() => {
  globalThis.chrome = originalChrome
})

describe("browser capability detection", () => {
  it("offers tab groups on Chromium before permission exposes the namespace", () => {
    globalThis.chrome = {
      declarativeNetRequest: {
        updateDynamicRules: vi.fn()
      }
    } as unknown as typeof chrome

    expect(supportsTabGroups()).toBe(true)
  })
})
