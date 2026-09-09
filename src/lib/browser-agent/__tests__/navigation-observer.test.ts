import { describe, expect, it, vi } from "vitest"

import type {
  AgentNavigationDetails,
  AgentNavigationEvent
} from "../navigation-observer"
import { createAgentNavigationObserver } from "../navigation-observer"

const event = () => {
  const listeners = new Set<(details: AgentNavigationDetails) => void>()
  const value: AgentNavigationEvent = {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener)
  }
  return {
    value,
    emit: (details: AgentNavigationDetails) => {
      for (const listener of listeners) listener(details)
    }
  }
}

describe("Agent navigation observer", () => {
  it("invalidates on a child frame commit and keeps the root document", () => {
    const committed = event()
    const historyUpdated = event()
    const invalidate = vi.fn()
    const observer = createAgentNavigationObserver({
      committed: committed.value,
      historyUpdated: historyUpdated.value,
      onInvalidate: invalidate
    })
    committed.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-1",
      url: "https://example.com/"
    })
    committed.emit({
      tabId: 7,
      frameId: 4,
      documentId: "subframe",
      url: "https://example.com/frame"
    })
    expect(observer.current(7)).toMatchObject({
      frameId: 4,
      generation: 2,
      frames: [
        { frameId: 0, documentId: "document-1" },
        { frameId: 4, documentId: "subframe" }
      ]
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it("drops every child document when the root commits", () => {
    const committed = event()
    const historyUpdated = event()
    const observer = createAgentNavigationObserver({
      committed: committed.value,
      historyUpdated: historyUpdated.value
    })
    committed.emit({
      tabId: 7,
      frameId: 4,
      documentId: "subframe",
      url: "https://example.com/frame"
    })
    committed.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-2",
      url: "https://example.com/next"
    })
    expect(observer.current(7)?.frames).toEqual([
      { frameId: 0, documentId: "document-2", url: "https://example.com/next" }
    ])
  })

  it("invalidates snapshots for main-frame commits and SPA navigation", () => {
    const committed = event()
    const historyUpdated = event()
    const invalidate = vi.fn()
    const observer = createAgentNavigationObserver({
      committed: committed.value,
      historyUpdated: historyUpdated.value,
      onInvalidate: invalidate
    })
    committed.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-1",
      url: "https://example.com/"
    })
    historyUpdated.emit({
      tabId: 7,
      frameId: 0,
      documentId: "document-1",
      url: "https://example.com/results"
    })
    expect(observer.current(7)).toMatchObject({ generation: 2 })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
