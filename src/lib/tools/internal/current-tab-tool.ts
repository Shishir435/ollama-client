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
    "Read the main readable text of the user's currently active browser tab (including the transcript when it is a YouTube video). It returns only what the page shows now, button and link labels included, and it clicks, opens and reveals nothing: a label such as 'Open dialog' is a control on the page, not something that happened. Use when the user refers to 'this page', 'the current tab', or 'this video'. Set force=true when the user asks to refresh, refetch, rescrape, reload, or get the latest tab content.",
  displayNameKey: "chat.reasoning.trace.tab",
  category: "browser",
  iconKey: "panels-top-left",
  risk: "low",
  resultProvenance: "web-untrusted",
  cacheable: true,
  requires: ["tabs"],
  runtime: { parallelizable: false },
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

/**
 * The tab the side panel showed when the message was sent, when the turn
 * carried one.
 *
 * "Active" was answered from `lastFocusedWindow`, which is whichever window
 * the user touched last: with two windows open, a question typed in one
 * window's panel read the other window's page. The panel's own tab is the
 * one the user means; the window query remains for a turn without it.
 */
const panelTab = async (tabId: number | undefined) => {
  if (tabId === undefined) return undefined
  try {
    return await browser.tabs.get(tabId)
  } catch {
    return undefined
  }
}

export const runCurrentTab = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> => {
  try {
    // From a background service worker / side panel there is no "current
    // window", so `currentWindow` can come back empty. `lastFocusedWindow`
    // resolves to the user's focused browser window (where the active tab the
    // user is looking at lives); fall back through currentWindow then any
    // active tab.
    const tab =
      (await panelTab(ctx.browserTabId)) ??
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
    // The content script flags disabled/excluded/parse-failure with
    // success:false and an explanatory `html`; surface it as an error rather
    // than handing the placeholder sentence to the model as page content.
    if (response?.success === false) {
      return {
        content: response.html || "The active tab could not be read.",
        isError: true
      }
    }
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
