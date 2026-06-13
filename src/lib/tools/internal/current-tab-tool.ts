import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromeResponse } from "@/types"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/**
 * `current_tab` — read the readable text of the user's active tab. Reuses the
 * content script's existing extraction (Defuddle → Readability → basic), the
 * same path the tab-context feature uses, so user tab-access consent and
 * excluded-URL rules are honored by the content script.
 */
export const currentTabDefinition: ToolDefinition = {
  name: "current_tab",
  description:
    "Read the main readable text of the user's currently active browser tab. Use when the user refers to 'this page', 'the current tab', or the site they are looking at.",
  parameters: { type: "object", properties: {} }
}

export const runCurrentTab = async (
  _args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    if (!tab?.id) {
      return { content: "No active tab is available.", isError: true }
    }

    const response = (await browser.tabs.sendMessage(tab.id, {
      type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
    })) as ChromeResponse & { html?: string; title?: string }

    const text = response?.html?.trim()
    if (!text) {
      return {
        content:
          "The active tab returned no readable content. It may be a restricted page (e.g. chrome://) or tab access is disabled in settings."
      }
    }

    const title = response?.title || tab.title || "Untitled"
    return { content: text, sources: [{ title, url: tab.url }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: `Could not read the active tab (${message}). The page may not allow content scripts.`,
      isError: true
    }
  }
}
