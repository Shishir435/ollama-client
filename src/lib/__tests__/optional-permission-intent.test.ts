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
})
