import { beforeEach, describe, expect, it, vi } from "vitest"
import { hasPermission } from "@/lib/permissions"
import type { ToolDefinition } from "@/lib/tools"
import { filterToolsForTurn } from "../tool-exposure-policy"

vi.mock("@/lib/permissions", () => ({
  hasPermission: vi.fn()
}))

const definition = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} }
})

const tools = [
  definition("current_tab"),
  definition("get_recent_history"),
  definition("search_bookmarks"),
  definition("list_recently_closed"),
  definition("list_synced_sessions")
]

describe("filterToolsForTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPermission).mockResolvedValue(true)
  })

  it("does not expose sensitive browser data for an unrelated request", async () => {
    const filtered = await filterToolsForTurn(tools, "hello")

    expect(filtered.map((tool) => tool.name)).toEqual(["current_tab"])
  })

  it("exposes only the sensitive tool requested by the user", async () => {
    const history = await filterToolsForTurn(
      tools,
      "What websites did I recently visit?"
    )
    const bookmarks = await filterToolsForTurn(
      tools,
      "Search my bookmarks for TypeScript"
    )

    expect(history.map((tool) => tool.name)).toEqual([
      "current_tab",
      "get_recent_history"
    ])
    expect(bookmarks.map((tool) => tool.name)).toEqual([
      "current_tab",
      "search_bookmarks"
    ])
  })

  it("does not mistake a general history question for browser-history intent", async () => {
    const filtered = await filterToolsForTurn(
      tools,
      "Explain the history of Rome"
    )

    expect(filtered.map((tool) => tool.name)).toEqual(["current_tab"])
  })

  it("removes an intended tool when its browser permission is missing", async () => {
    vi.mocked(hasPermission).mockImplementation(
      async (permission) => permission !== "history"
    )

    const filtered = await filterToolsForTurn(
      tools,
      "Show my recent browser history"
    )

    expect(filtered.map((tool) => tool.name)).not.toContain(
      "get_recent_history"
    )
  })

  it("recognizes recently closed and synced-session requests separately", async () => {
    const closed = await filterToolsForTurn(
      tools,
      "Reopen the tab I recently closed"
    )
    const synced = await filterToolsForTurn(
      tools,
      "Show tabs from my other device"
    )

    expect(closed.map((tool) => tool.name)).toContain("list_recently_closed")
    expect(closed.map((tool) => tool.name)).not.toContain(
      "list_synced_sessions"
    )
    expect(synced.map((tool) => tool.name)).toContain("list_synced_sessions")
    expect(synced.map((tool) => tool.name)).not.toContain(
      "list_recently_closed"
    )
  })
})
