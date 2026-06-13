import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeResponse } from "@/types"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/** Built content-script file (see manifest `content_scripts`). */
const CONTENT_SCRIPT_FILE = "content-scripts/content.js"

type PageContentResponse = ChromeResponse & { html?: string; title?: string }

const requestPageContent = (tabId: number): Promise<PageContentResponse> =>
  browser.tabs.sendMessage(tabId, {
    type: MESSAGE_KEYS.BROWSER.GET_PAGE_CONTENT
  }) as Promise<PageContentResponse>

/**
 * `current_tab` — read the readable text of the user's active tab. Reuses the
 * content script's existing extraction (Defuddle → Readability → basic, plus
 * YouTube/Udemy transcript handling), so user tab-access consent and
 * excluded-URL rules are honored by the content script.
 *
 * The content script is matched on `<all_urls>` but is only present on tabs
 * that loaded *after* the extension did — a tab opened earlier (common right
 * after an extension reload) has no receiver, so `sendMessage` fails with
 * "Receiving end does not exist." We recover by injecting the content script
 * on demand and retrying once.
 */
export const currentTabDefinition: ToolDefinition = {
  name: "current_tab",
  description:
    "Read the main readable text of the user's currently active browser tab (including the transcript when it is a YouTube video). Use when the user refers to 'this page', 'the current tab', 'this video', or the site they are looking at.",
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
    const tabId = tab.id

    let response: PageContentResponse
    try {
      response = await requestPageContent(tabId)
    } catch (firstError) {
      // No content script in this tab yet — inject it and retry once.
      logger.debug(
        "current_tab: no receiver, injecting content script",
        "currentTabTool",
        { error: firstError }
      )
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          files: [CONTENT_SCRIPT_FILE]
        })
      } catch (injectError) {
        const message =
          injectError instanceof Error
            ? injectError.message
            : String(injectError)
        return {
          content: `Can't read this tab (${message}). Browsers block extensions on internal pages like chrome:// and the web store.`,
          isError: true
        }
      }
      response = await requestPageContent(tabId)
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
      content: `Could not read the active tab (${message}).`,
      isError: true
    }
  }
}
