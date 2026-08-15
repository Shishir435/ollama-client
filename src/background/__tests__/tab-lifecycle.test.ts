import { beforeEach, describe, expect, it, vi } from "vitest"

const { listeners, mockBrowser } = vi.hoisted(() => {
  const listeners: Array<(tabId: number) => void> = []
  return {
    listeners,
    mockBrowser: {
      tabs: {
        onRemoved: {
          addListener: (fn: (tabId: number) => void) => {
            listeners.push(fn)
          }
        }
      }
    } as { tabs?: { onRemoved: { addListener: (fn: unknown) => void } } }
  }
})

vi.mock("@/lib/browser-api", () => ({ browser: mockBrowser }))
vi.mock("@/lib/tools/internal/tab-utils", () => ({
  clearTabContentCache: vi.fn()
}))

import { clearTabContentCache } from "@/lib/tools/internal/tab-utils"
import { registerTabLifecycle } from "../tab-lifecycle"

describe("registerTabLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.length = 0
  })

  it("evicts a closed tab's cached page content", () => {
    registerTabLifecycle()

    expect(listeners).toHaveLength(1)
    listeners[0](42)

    expect(clearTabContentCache).toHaveBeenCalledWith(42)
  })

  it("does nothing on a runtime without tabs.onRemoved", () => {
    const original = mockBrowser.tabs
    mockBrowser.tabs = undefined

    expect(() => registerTabLifecycle()).not.toThrow()
    expect(listeners).toHaveLength(0)

    mockBrowser.tabs = original
  })
})
