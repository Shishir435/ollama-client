import { describe, expect, it } from "vitest"
import { matchesOptionalPermissionIntent } from "../optional-permission-intent"

describe("optional permission intent", () => {
  it.each([
    ["bookmarks", "Search my bookmarks for TypeScript"],
    ["history", "Show my recent browsing history"],
    ["downloads", "Save this answer as a markdown file"],
    ["tabGroups", "Summarize my tab group"],
    ["sessions", "Show my recently closed tabs"],
    ["reminders", "Remind me in ten minutes"]
  ] as const)("recognizes %s access", (capabilityId, text) => {
    expect(matchesOptionalPermissionIntent(capabilityId, text)).toBe(true)
  })

  it("shares precise history and session intent with tool exposure", () => {
    expect(matchesOptionalPermissionIntent("history", "History of Rome")).toBe(
      false
    )
    expect(
      matchesOptionalPermissionIntent("sessions", "Tabs on my other device")
    ).toBe(true)
  })

  it.each([
    ["history", "Explain the major events in world history"],
    ["history", "Summarize the recent history of artificial intelligence"],
    ["bookmarks", "What are browser bookmarks?"],
    ["bookmarks", "Explain the HTML bookmark concept"],
    ["downloads", "How do websites download files?"],
    ["downloads", "Explain how JSON export works"],
    ["tabGroups", "What are browser tab groups?"],
    ["sessions", "Explain Chrome's recently closed feature"],
    ["reminders", "Compare popular reminder applications"]
  ] as const)("ignores general %s discussion", (capabilityId, text) => {
    expect(matchesOptionalPermissionIntent(capabilityId, text)).toBe(false)
  })
})
