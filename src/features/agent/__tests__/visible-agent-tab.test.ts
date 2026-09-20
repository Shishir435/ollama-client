import { describe, expect, it } from "vitest"

import { visibleAgentTab } from "../lib/presentation"

const runTab = { id: 1, title: "Controlled", url: "https://a.example/" }
const candidate = { id: 2, title: "Current", url: "https://b.example/" }

describe("visibleAgentTab", () => {
  it("shows the controlled tab while a run is unresolved", () => {
    for (const status of [
      "observing",
      "executing",
      "paused",
      "awaiting_takeover"
    ] as const) {
      expect(visibleAgentTab({ status }, runTab, candidate), status).toBe(
        runTab
      )
    }
  })

  it("goes back to the page in front of the user once the run has settled", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(visibleAgentTab({ status }, runTab, candidate), status).toBe(
        candidate
      )
      /* A settled run whose tab is gone must not disable Start on a live page. */
      expect(visibleAgentTab({ status }, undefined, candidate), status).toBe(
        candidate
      )
    }
    expect(visibleAgentTab(null, runTab, candidate)).toBe(candidate)
  })
})
