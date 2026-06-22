import {
  getTabGroupsAvailability,
  listBrowserTabGroups
} from "@/lib/browser-tab-groups"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"
import { readTabContent } from "./tab-utils"

const clampLimit = (value: unknown, fallback = 12): number => {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(1, Math.min(25, Math.floor(numberValue)))
}

const unavailableResult = (
  availability: Awaited<ReturnType<typeof getTabGroupsAvailability>>
): ToolResult | undefined => {
  if (availability === "available") return undefined
  if (availability === "unsupported") {
    return {
      content:
        "Tab groups are not supported in this browser. Use list_tabs/read_tab instead.",
      isError: true
    }
  }
  return {
    content:
      "Tab group access is disabled. Enable Tab groups in Settings > Permissions.",
    isError: true
  }
}

export const listTabGroupsDefinition: ToolDefinition = {
  name: "list_tab_groups",
  description:
    "List the user's browser tab groups with readable tab ids and URLs. Use when the user asks about a tab group or wants to summarize/compare a group.",
  displayNameKey: "chat.reasoning.trace.tabGroups",
  category: "browser",
  iconKey: "layers",
  risk: "low",
  cacheable: false,
  requires: ["tabs"],
  runtime: { timeoutMs: 10_000, maxResultChars: 8000 },
  parameters: { type: "object", properties: {} }
}

export const readTabGroupDefinition: ToolDefinition = {
  name: "read_tab_group",
  description:
    "Read readable text from tabs in a browser tab group, identified by group id or title. Use for group summaries, comparisons, or questions about a whole tab group. Skips unreadable, excluded, or never-read tabs.",
  displayNameKey: "chat.reasoning.trace.tabGroup",
  category: "browser",
  iconKey: "layers",
  risk: "low",
  cacheable: true,
  requires: ["tabs"],
  runtime: { timeoutMs: 30_000, maxResultChars: 20_000, parallelizable: false },
  parameters: {
    type: "object",
    properties: {
      groupId: {
        type: "number",
        description: "The group id from list_tab_groups. Preferred when known."
      },
      query: {
        type: "string",
        description:
          "A substring of the target tab group's title, when groupId is unknown."
      },
      limit: {
        type: "number",
        description: "Maximum number of group tabs to read. Default 12, max 25."
      },
      force: {
        type: "boolean",
        description:
          "Bypass cached tab content and scrape group tabs again when user asks for latest/refreshed content."
      }
    }
  }
}

export const runListTabGroups = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const unavailable = unavailableResult(await getTabGroupsAvailability())
  if (unavailable) return unavailable

  const groups = await listBrowserTabGroups()
  if (groups.length === 0) {
    return { content: "No browser tab groups are open." }
  }

  const lines = groups.map((group) => {
    const tabs = group.tabs
      .map((tab) => `id=${tab.id}: ${tab.title} — ${tab.url}`)
      .join("; ")
    const skipped = group.skipped > 0 ? `; skipped=${group.skipped}` : ""
    return `- groupId=${group.id}: ${group.title} (${group.tabs.length} readable${skipped})${tabs ? ` — ${tabs}` : ""}`
  })

  return {
    content: `Tab groups:\n${lines.join("\n")}`,
    sources: groups.flatMap((group) =>
      group.tabs.map((tab) => ({ title: tab.title, url: tab.url }))
    )
  }
}

const matchGroup = (
  groups: Awaited<ReturnType<typeof listBrowserTabGroups>>,
  args: Record<string, unknown>
) => {
  const groupId =
    typeof args.groupId === "number" && Number.isInteger(args.groupId)
      ? args.groupId
      : typeof args.groupId === "string" && args.groupId.trim()
        ? Number(args.groupId)
        : undefined
  if (groupId !== undefined && Number.isInteger(groupId)) {
    return {
      target: groups.find((group) => group.id === groupId),
      ambiguous: []
    }
  }

  const query = typeof args.query === "string" ? args.query.trim() : ""
  if (!query) return { target: undefined, ambiguous: [] }
  const q = query.toLowerCase()
  const matches = groups.filter((group) =>
    group.title.toLowerCase().includes(q)
  )
  return { target: matches[0], ambiguous: matches.slice(1) }
}

export const runReadTabGroup = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const unavailable = unavailableResult(await getTabGroupsAvailability())
  if (unavailable) return unavailable

  const groups = await listBrowserTabGroups()
  if (groups.length === 0) return { content: "No browser tab groups are open." }

  const { target, ambiguous } = matchGroup(groups, args)
  if (!target) {
    const available = groups
      .map((group) => `groupId=${group.id}: ${group.title}`)
      .join("; ")
    return {
      content: `read_tab_group needs a valid groupId or title query. Open groups: ${available}`,
      isError: true
    }
  }

  const tabs = target.tabs.slice(0, clampLimit(args.limit))
  if (tabs.length === 0) {
    return {
      content: `Tab group "${target.title}" has no readable tabs. ${target.skipped} tab(s) were skipped because they are unreadable or excluded.`,
      isError: true
    }
  }

  const chunks: string[] = []
  const sources: ToolResult["sources"] = []
  for (const tab of tabs) {
    try {
      const response = await readTabContent(tab.id, {
        force: args.force === true
      })
      const text = response?.html?.trim()
      if (!text || response?.success === false) {
        chunks.push(`## ${tab.title}\nCould not read this tab.`)
        continue
      }
      chunks.push(`## ${response.title || tab.title}\n${text}`)
      sources?.push({ title: response.title || tab.title, url: tab.url })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      chunks.push(`## ${tab.title}\nCould not read this tab (${message}).`)
    }
  }

  const skipped =
    target.skipped > 0
      ? `\n\nSkipped ${target.skipped} unreadable/excluded tab(s).`
      : ""
  const capped =
    target.tabs.length > tabs.length
      ? `\n\nRead first ${tabs.length} of ${target.tabs.length} readable tabs.`
      : ""
  const note =
    ambiguous.length > 0
      ? `\n\n(Note: ${ambiguous.length} other group(s) also matched; read "${target.title}".)`
      : ""

  return {
    content: `Tab group: ${target.title}\n\n${chunks.join("\n\n")}${skipped}${capped}${note}`,
    sources
  }
}
