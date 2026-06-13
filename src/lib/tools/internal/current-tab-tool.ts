import { browser } from "@/lib/browser-api"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"
import {
  accessDeniedMessage,
  classifyTabAccess,
  readTabContent
} from "./tab-utils"

/**
 * `current_tab` — read the readable text of the user's *active* tab (including
 * the transcript for YouTube videos). For reading a different open tab, see
 * `read_tab` / `list_tabs`.
 */
export const currentTabDefinition: ToolDefinition = {
  name: "current_tab",
  description:
    "Read the main readable text of the user's currently active browser tab (including the transcript when it is a YouTube video). Use when the user refers to 'this page', 'the current tab', or 'this video'. Set force=true when the user asks to refresh, refetch, rescrape, reload, or get the latest tab content.",
  parameters: {
    type: "object",
    properties: {
      force: {
        type: "boolean",
        description:
          "Bypass cached tab content and scrape the active tab again. Use when the user asks to refresh, refetch, rescrape, reload, or get latest content."
      }
    }
  }
}

export const runCurrentTab = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  try {
    // From a background service worker / side panel there is no "current
    // window", so `currentWindow` can come back empty. `lastFocusedWindow`
    // resolves to the user's focused browser window (where the active tab the
    // user is looking at lives); fall back through currentWindow then any
    // active tab.
    const tab =
      (
        await browser.tabs.query({ active: true, lastFocusedWindow: true })
      )[0] ??
      (await browser.tabs.query({ active: true, currentWindow: true }))[0] ??
      (await browser.tabs.query({ active: true }))[0]
    if (!tab?.id) {
      return { content: "No active tab is available.", isError: true }
    }

    const access = await classifyTabAccess(tab.url)
    if (access !== "ok") {
      return {
        content: accessDeniedMessage(access, "the active tab"),
        isError: true
      }
    }

    const response = await readTabContent(tab.id, {
      force: args.force === true
    })
    const text = response?.html?.trim()
    if (!text) {
      return {
        content:
          "The active tab returned no readable content. Tab access may be disabled in settings, or this page is excluded."
      }
    }

    const title = response?.title || tab.title || "Untitled"
    return { content: text, sources: [{ title, url: tab.url }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: `Could not read the active tab (${message}). Browsers block extensions on internal pages and extension galleries (chrome://, Chrome Web Store, etc.).`,
      isError: true
    }
  }
}
