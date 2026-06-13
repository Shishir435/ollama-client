import type { ToolContext, ToolDefinition, ToolResult } from "../types"
import { listReadableTabs, type OpenTab, readTabContent } from "./tab-utils"

/**
 * `read_tab` — read the content of a SPECIFIC open tab the user is not
 * necessarily focused on, by tab id (from `list_tabs`) or a title/URL query.
 * This is what lets the model answer about any open tab without the user
 * adding it through the tab-context UI. For the active tab, `current_tab` is
 * simpler.
 */
export const readTabDefinition: ToolDefinition = {
  name: "read_tab",
  description:
    "Read the readable text of a specific open browser tab, identified by its id (from list_tabs) or by a substring of its title or URL. Use to answer about a tab other than the active one.",
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

export const runReadTab = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const tabs = await listReadableTabs()
  if (tabs.length === 0) {
    return { content: "No readable tabs are open." }
  }

  let target: OpenTab | undefined
  let ambiguous: OpenTab[] = []

  if (typeof args.tabId === "number") {
    target = tabs.find((tab) => tab.id === args.tabId)
    if (!target) {
      return {
        content: `No open readable tab has id ${args.tabId}. Call list_tabs for current ids.`,
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

  try {
    const response = await readTabContent(target.id)
    const text = response?.html?.trim()
    if (!text) {
      return {
        content: `Tab "${target.title}" returned no readable content (it may be excluded or tab access is disabled).`
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
