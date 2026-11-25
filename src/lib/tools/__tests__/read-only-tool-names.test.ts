import { describe, expect, it } from "vitest"
import { BUILT_IN_TOOL_NAMES } from "../built-in-tool-names"
import { READ_ONLY_TOOL_NAMES } from "../read-only-tool-names"

describe("read-only tool allowlist", () => {
  it("names only built-in tools, so a rename cannot exempt another source", () => {
    for (const name of READ_ONLY_TOOL_NAMES) {
      expect(BUILT_IN_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it("leaves out the built-ins that change state outside the chat", () => {
    for (const name of [
      "save_artifact",
      "schedule_reminder",
      "cancel_reminder",
      "restore_session",
      "browser_task"
    ]) {
      expect(BUILT_IN_TOOL_NAMES.has(name)).toBe(true)
      expect(READ_ONLY_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})
