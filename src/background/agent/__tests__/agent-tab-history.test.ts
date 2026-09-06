import { describe, expect, it } from "vitest"

import { createAgentTabHistory } from "../agent-tab-history"

describe("Agent tab history", () => {
  it("reports no destination for navigation it never watched", () => {
    const history = createAgentTabHistory()
    expect(history.resolveDestination(7, "back")).toBeUndefined()
    history.record(7, "https://example.com/one")
    expect(history.resolveDestination(7, "back")).toBeUndefined()
    expect(history.resolveDestination(7, "forward")).toBeUndefined()
  })

  it("resolves back and forward from recorded commits", () => {
    const history = createAgentTabHistory()
    history.record(7, "https://example.com/one")
    history.record(7, "https://example.com/two")

    expect(history.resolveDestination(7, "back")).toBe(
      "https://example.com/one"
    )
    expect(history.resolveDestination(7, "forward")).toBeUndefined()

    history.record(7, "https://example.com/one")
    expect(history.resolveDestination(7, "forward")).toBe(
      "https://example.com/two"
    )
    expect(history.resolveDestination(7, "back")).toBeUndefined()
  })

  it("ignores a repeated commit of the current entry", () => {
    const history = createAgentTabHistory()
    history.record(7, "https://example.com/one")
    history.record(7, "https://example.com/two")
    history.record(7, "https://example.com/two")

    expect(history.resolveDestination(7, "back")).toBe(
      "https://example.com/one"
    )
  })

  it("drops the forward tail once the run navigates somewhere new", () => {
    const history = createAgentTabHistory()
    history.record(7, "https://example.com/one")
    history.record(7, "https://example.com/two")
    history.record(7, "https://example.com/one")
    history.record(7, "https://example.com/three")

    expect(history.resolveDestination(7, "forward")).toBeUndefined()
    expect(history.resolveDestination(7, "back")).toBe(
      "https://example.com/one"
    )
  })

  it("keeps tabs separate and forgets one on request", () => {
    const history = createAgentTabHistory()
    history.record(7, "https://example.com/one")
    history.record(7, "https://example.com/two")
    history.record(8, "https://other.example/one")

    expect(history.resolveDestination(8, "back")).toBeUndefined()
    history.forget(7)
    expect(history.resolveDestination(7, "back")).toBeUndefined()
    history.record(8, "https://other.example/two")
    expect(history.resolveDestination(8, "back")).toBe(
      "https://other.example/one"
    )
  })
})
