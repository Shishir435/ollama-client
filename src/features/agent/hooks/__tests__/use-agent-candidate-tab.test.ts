import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentCandidateTab } from "../use-agent-candidate-tab"

const tabs: Array<{ url?: string; title?: string }> = []
const activatedListeners = new Set<() => void>()
const query = vi.fn(async () => tabs)
const access = vi.fn(async (url?: string) =>
  url?.startsWith("https://") ? ("ok" as const) : ("restricted" as const)
)

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      query: (...args: unknown[]) => query(...(args as [])),
      onActivated: {
        addListener: (listener: () => void) => activatedListeners.add(listener),
        removeListener: (listener: () => void) =>
          activatedListeners.delete(listener)
      },
      onUpdated: {
        addListener: () => undefined,
        removeListener: () => undefined
      }
    }
  }
}))

vi.mock("@/lib/browser-tab-access", () => ({
  classifyAgentTabAccess: (url?: string) => access(url)
}))

describe("useAgentCandidateTab", () => {
  beforeEach(() => {
    tabs.length = 0
    activatedListeners.clear()
    query.mockClear()
  })

  it("asks the panel's own window, not the last focused one", async () => {
    tabs.push({ url: "https://example.com/start", title: "Example" })

    const { result } = renderHook(() => useAgentCandidateTab())

    await waitFor(() =>
      expect(result.current).toEqual({
        title: "Example",
        url: "https://example.com/start"
      })
    )
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true })
  })

  it("offers no candidate for a page the run could not read", async () => {
    tabs.push({ url: "chrome://settings", title: "Settings" })

    const { result } = renderHook(() => useAgentCandidateTab())

    await waitFor(() => expect(query).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })

  it("follows the user to another tab", async () => {
    tabs.push({ url: "https://example.com/start", title: "Example" })
    const { result } = renderHook(() => useAgentCandidateTab())
    await waitFor(() => expect(result.current?.title).toBe("Example"))

    tabs[0] = { url: "https://other.example/page", title: "Other" }
    act(() => {
      for (const listener of [...activatedListeners]) listener()
    })

    await waitFor(() => expect(result.current?.title).toBe("Other"))
  })
})
