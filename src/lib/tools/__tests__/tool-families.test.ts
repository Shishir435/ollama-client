import { describe, expect, it } from "vitest"
import { getToolFamily, TOOL_FAMILIES } from "../tool-families"
import type { ToolDefinition } from "../types"

const def = (over: Partial<ToolDefinition>): ToolDefinition => ({
  name: "x",
  description: "",
  parameters: { type: "object", properties: {} },
  ...over
})

describe("getToolFamily", () => {
  it("maps known built-in tools to their governance family", () => {
    expect(getToolFamily(def({ name: "current_tab" }))).toBe("browser")
    expect(getToolFamily(def({ name: "selected_text" }))).toBe("browser")
    expect(getToolFamily(def({ name: "rag_search" }))).toBe("knowledge")
    expect(getToolFamily(def({ name: "file_search" }))).toBe("knowledge")
    expect(getToolFamily(def({ name: "recent_history" }))).toBe("history")
    expect(getToolFamily(def({ name: "search_bookmarks" }))).toBe("history")
    expect(getToolFamily(def({ name: "web_search" }))).toBe("web")
    expect(getToolFamily(def({ name: "schedule_reminder" }))).toBe("automation")
  })

  it("puts history/bookmark tools in `history`, not `browser`, despite their category", () => {
    expect(
      getToolFamily(def({ name: "recent_history", category: "browser" }))
    ).toBe("history")
  })

  it("falls back to category for unknown tool names", () => {
    expect(getToolFamily(def({ name: "mcp_thing", category: "files" }))).toBe(
      "knowledge"
    )
    expect(getToolFamily(def({ name: "mcp_thing", category: "web" }))).toBe(
      "web"
    )
  })

  it("defaults to automation when neither name nor category resolves", () => {
    expect(getToolFamily(def({ name: "mystery" }))).toBe("automation")
  })

  it("every family in the map is a known TOOL_FAMILIES member", () => {
    for (const name of ["current_tab", "rag_search", "recent_history"]) {
      expect(TOOL_FAMILIES).toContain(getToolFamily(def({ name })))
    }
  })
})
