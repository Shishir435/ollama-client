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
    "Read the main readable text of the user's currently active browser tab (including the transcript when it is a YouTube video). Use when the user refers to 'this page', 'the current tab', or 'this video'.",
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

    const access = await classifyTabAccess(tab.url)
    if (access !== "ok") {
      return { content: accessDeniedMessage(access, "the active tab") }
    }

    const response = await readTabContent(tab.id)
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
      content: `Could not read the active tab (${message}). Browsers block extensions on internal pages like chrome:// and the web store.`,
      isError: true
    }
  }
}
