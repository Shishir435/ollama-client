import type { ToolContext, ToolDefinition, ToolResult } from "../types"
import {
  accessDeniedMessage,
  classifyTabAccess,
  getAllTabs,
  listReadableTabs,
  type OpenTab,
  readTabContent
} from "./tab-utils"

/**
 * `read_tab` — read the content of a SPECIFIC open tab the user is not
 * necessarily focused on, by tab id (from `list_tabs`) or a title/URL query.
 * This is what lets the model answer about any open tab without the user
 * adding it through the tab-context UI. For the active tab, `current_tab` is
 * simpler.
 *
 * Matches against *all* tabs (not just readable ones) so it can explain why an
 * internal page (chrome://) or an excluded site can't be read, rather than
 * pretending the tab doesn't exist.
 */
export const readTabDefinition: ToolDefinition = {
  name: "read_tab",
  description:
    "Read the readable text of a specific open browser tab, identified by its id (from list_tabs) or by a substring of its title or URL. Use to answer about a tab other than the active one. Set force=true when the user asks to refresh, refetch, rescrape, reload, or get the latest tab content.",
  parameters: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "The tab id from list_tabs. Preferred when known."
      },
      query: {
        type: "string",
        description:
          "A substring of the target tab's title or URL, when the id is unknown."
      },
      force: {
        type: "boolean",
        description:
          "Bypass cached tab content and scrape this tab again. Use when the user asks to refresh, refetch, rescrape, reload, or get latest content."
      }
    }
  }
}

const matchTabs = (tabs: OpenTab[], query: string): OpenTab[] => {
  const q = query.toLowerCase()
  return tabs.filter(
    (tab) =>
      tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)
  )
}

const parseTabId = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value !== "string" || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

export const runReadTab = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const tabs = await getAllTabs()
  if (tabs.length === 0) {
    return { content: "No tabs are open." }
  }

  let target: OpenTab | undefined
  let ambiguous: OpenTab[] = []
  const tabId = parseTabId(args.tabId)

  if (tabId !== undefined) {
    target = tabs.find((tab) => tab.id === tabId)
    if (!target) {
      const readableTabs = await listReadableTabs()
      const available = readableTabs
        .map((tab) => `id=${tab.id}: ${tab.title}`)
        .join("; ")
      return {
        content: available
          ? `Tab id ${tabId} is no longer open. Call list_tabs and choose one of the current readable tabs: ${available}`
          : `Tab id ${tabId} is no longer open, and no readable tabs are currently available. Call list_tabs before trying again.`,
        isError: true
      }
    }
  } else if (typeof args.query === "string" && args.query.trim()) {
    const matches = matchTabs(tabs, args.query.trim())
    if (matches.length === 0) {
      const available = tabs.map((t) => `id=${t.id}: ${t.title}`).join("; ")
      return {
        content: `No open tab matches "${args.query}". Open tabs: ${available}`,
        isError: true
      }
    }
    target = matches[0]
    ambiguous = matches.slice(1)
  } else {
    return {
      content:
        "read_tab needs a 'tabId' or a 'query'. To read the active tab, use current_tab.",
      isError: true
    }
  }

  const access = await classifyTabAccess(target.url)
  if (access !== "ok") {
    return {
      content: accessDeniedMessage(access, `"${target.title}"`),
      isError: true
    }
  }

  try {
    const response = await readTabContent(target.id, {
      force: args.force === true
    })
    const text = response?.html?.trim()
    if (!text) {
      return {
        content: `Tab "${target.title}" returned no readable content (tab access may be disabled).`
      }
    }
    const note =
      ambiguous.length > 0
        ? `\n\n(Note: ${ambiguous.length} other open tab(s) also matched; read the one titled "${target.title}".)`
        : ""
    return {
      content: `${text}${note}`,
      sources: [{ title: response.title || target.title, url: target.url }]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: `Could not read tab "${target.title}" (${message}).`,
      isError: true
    }
  }
}
