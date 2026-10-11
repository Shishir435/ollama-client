import type { AgentCommand } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { agentCommandKeepingUserTab } from "../user-tab"

const navigate = (url: string): AgentCommand => ({
  type: "navigate",
  url,
  snapshotId: "snapshot-1",
  generation: 1
})

const onUserTab = { controlledTabId: 7, scopedTabIds: [7] }
const github = { origin: "https://github.com" }

describe("agentCommandKeepingUserTab", () => {
  /**
   * Given the same goal twice, gpt-6-luna opened DuckDuckGo in a new tab
   * once and navigated the user's own tab away from their page the next.
   */
  it("opens another site in a new tab instead of leaving the user's page", () => {
    expect(
      agentCommandKeepingUserTab(
        navigate("https://duckduckgo.com/?q=test"),
        onUserTab,
        github
      )
    ).toMatchObject({ type: "open_tab", url: "https://duckduckgo.com/?q=test" })
  })

  it.each([
    [
      "a same-origin move",
      navigate("https://github.com:443/issues"),
      onUserTab
    ],
    [
      "a tab the run opened itself",
      navigate("https://duckduckgo.com/"),
      { controlledTabId: 9, scopedTabIds: [7, 9] }
    ]
  ])("leaves %s as a navigation", (_label, command, state) => {
    expect(agentCommandKeepingUserTab(command, state, github)).toEqual(command)
  })

  it("does not touch commands that are not navigations", () => {
    const opened: AgentCommand = {
      type: "open_tab",
      url: "https://duckduckgo.com/",
      snapshotId: "snapshot-1",
      generation: 1
    }
    expect(agentCommandKeepingUserTab(opened, onUserTab, github)).toBe(opened)
  })
})
