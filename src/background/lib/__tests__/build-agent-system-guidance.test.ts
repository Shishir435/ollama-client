import { describe, expect, it } from "vitest"
import { buildAgentSystemGuidance } from "../build-agent-system-guidance"

describe("buildAgentSystemGuidance", () => {
  it("directs imperative tasks through target selection and page actions", () => {
    const guidance = buildAgentSystemGuidance(true)

    expect(guidance).toContain("directly interact")
    expect(guidance).toContain("list_tabs, then select_tab")
    expect(guidance).toContain("snapshot_page before click, type, or select")
    expect(guidance).toContain("Never claim browser interaction is unavailable")
    expect(guidance).toContain('"Send", "post", "submit", or "search"')
  })

  it("adds nothing outside agent mode", () => {
    expect(buildAgentSystemGuidance(false)).toBe("")
  })
})
