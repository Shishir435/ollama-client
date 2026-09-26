import { describe, expect, it } from "vitest"
import {
  canonicalizeIntentText,
  matchesOptionalPermissionIntent,
  matchesToolPermissionIntent
} from "../optional-permission-intent"

describe("optional permission intent", () => {
  it.each([
    ["bookmarks", "Search my bookmarks for TypeScript"],
    ["history", "Show my recent browsing history"],
    ["downloads", "Save this answer as a markdown file"],
    ["downloads", "Save it as markdown"],
    ["downloads", "Download that for me"],
    ["tabGroups", "Summarize my tab group"],
    ["sessions", "Show my recently closed tabs"],
    ["reminders", "Remind me in ten minutes"]
  ] as const)("recognizes %s access", (capabilityId, text) => {
    expect(matchesOptionalPermissionIntent(capabilityId, text)).toBe(true)
  })

  it.each([
    "can you open ducduck go and search for “try”",
    "open duckduckgo.com",
    "go to https://news.ycombinator.com",
    "search for rust tutorials on YouTube",
    "click the sign in button",
    "fill in this form with my details"
  ])("recognizes a browser task: %s", (text) => {
    expect(matchesOptionalPermissionIntent("browserAgent", text)).toBe(true)
  })

  /** Open and click are ordinary words in a question about code or files. */
  it.each([
    "how do I open a file in Python?",
    "why doesn't my click handler fire?",
    "summarize this page",
    "what is duckduckgo?",
    "open questions for the design review"
  ])("leaves an ordinary question alone: %s", (text) => {
    expect(matchesOptionalPermissionIntent("browserAgent", text)).toBe(false)
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
    ["downloads", "Fill in the profile form and save it."],
    ["downloads", "Fix the typo in the report, then save it"],
    ["tabGroups", "What are browser tab groups?"],
    ["sessions", "Explain Chrome's recently closed feature"],
    ["reminders", "Compare popular reminder applications"]
  ] as const)("ignores general %s discussion", (capabilityId, text) => {
    expect(matchesOptionalPermissionIntent(capabilityId, text)).toBe(false)
  })
})

describe("misspelled intent keywords", () => {
  it.each([
    ["bookmarks", "lis down my 5 bookamrks"],
    ["bookmarks", "show my bookmakrs"],
    ["history", "what is in my browsing histroy"],
    ["downloads", "save this file to my downlaods"],
    ["reminders", "set a remidner for 5pm"],
    ["sessions", "show my recently closed tabs"]
  ] as const)("still reads the %s intent", (capabilityId, text) => {
    expect(matchesOptionalPermissionIntent(capabilityId, text)).toBe(true)
  })

  it("offers the bookmark tool for a misspelled request", () => {
    expect(
      matchesToolPermissionIntent("search_bookmarks", "lis down my 5 bookamrks")
    ).toBe(true)
    expect(
      matchesToolPermissionIntent("get_recent_history", "open my histroy")
    ).toBe(true)
  })

  it("corrects only near misses of the keywords that carry the intent", () => {
    expect(canonicalizeIntentText("bookamrks")).toBe("bookmarks")
    expect(canonicalizeIntentText("histroy")).toBe("history")
    expect(canonicalizeIntentText("bookkeeper")).toBe("bookkeeper")
    expect(canonicalizeIntentText("historian")).toBe("historian")
    expect(canonicalizeIntentText("sessions")).toBe("sessions")
    expect(canonicalizeIntentText("tabs")).toBe("tabs")
  })

  it("does not turn unrelated talk into a data request", () => {
    expect(
      matchesOptionalPermissionIntent("bookmarks", "explain bookbinding")
    ).toBe(false)
    expect(
      matchesOptionalPermissionIntent(
        "history",
        "who wrote this historical novel"
      )
    ).toBe(false)
  })
})
