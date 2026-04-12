import { browser } from "@/lib/browser-api"
import type { ChromePort } from "@/types"
import type { AgentBrowserSession } from "./browser-automation"
import {
  activateTab,
  downloadDirectUrl,
  executeInTab,
  getWorkspaceTabs,
  isAutomatableUrl,
  resolveLinkUrl,
  wait
} from "./browser-automation"
import type {
  AgentAction,
  AgentActionResult,
  AgentStreamMessage
} from "./types"

const ACTION_DELAY_MS = 600
const MODEL_WAIT_HEARTBEAT_MS = 10_000

export class ActionExecutor {
  public pendingContextReason: string | null = null

  constructor(
    private readonly session: AgentBrowserSession,
    private readonly port: ChromePort
  ) {}

  private postStep(msg: AgentStreamMessage) {
    try {
      this.port.postMessage(
        msg as unknown as Parameters<typeof this.port.postMessage>[0]
      )
    } catch {
      // ignore
    }
  }

  private async getWorkspaceTabByArgs(args: Record<string, unknown>) {
    const workspaceTabs = await getWorkspaceTabs(this.session)
    const requestedIndex = Number(args.tab_index)
    if (Number.isFinite(requestedIndex)) {
      return (
        workspaceTabs.find((tab) => tab.tabIndex === requestedIndex) || null
      )
    }

    const requestedTabId = Number(args.tab_id)
    if (Number.isFinite(requestedTabId)) {
      return workspaceTabs.find((tab) => tab.tabId === requestedTabId) || null
    }

    return null
  }

  public async executeAction(
    actionName: string,
    args: Record<string, unknown>
  ): Promise<AgentActionResult> {
    if (actionName === "plan") {
      return {
        success: true,
        message: `Plan noted: ${String(args.text || "").slice(0, 200)}`
      }
    }
    if (actionName === "wait") {
      const ms = Math.min(Number(args.ms) || 500, 5000)
      await wait(ms)
      return { success: true, message: `Waited ${ms}ms` }
    }
    if (actionName === "list_tabs") {
      const workspaceTabs = await getWorkspaceTabs(this.session)
      // Note: formatWorkspaceForLLM was moved to context-manager, we could format it inline or pass generic data
      return {
        success: true,
        message: `Workspace tabs retrieved.`,
        data: workspaceTabs
      }
    }
    if (actionName === "switch_to_tab") {
      const targetTab = await this.getWorkspaceTabByArgs(args)
      if (!targetTab) {
        return {
          success: false,
          message: "Target tab not found in the current workspace."
        }
      }

      await activateTab(this.session, targetTab.tabId)
      this.pendingContextReason = `The active tab is now tab_${targetTab.tabIndex}. Continue using this page.`
      return {
        success: true,
        message: `Switched to tab_${targetTab.tabIndex}: ${targetTab.url}`,
        data: targetTab
      }
    }
    if (actionName === "return_to_root_tab") {
      await activateTab(this.session, this.session.rootTabId)
      this.pendingContextReason =
        "Returned to the root tab where the task started."
      return {
        success: true,
        message: "Returned to the root tab.",
        data: { tabId: this.session.rootTabId }
      }
    }
    if (actionName === "close_tab") {
      const targetTab = await this.getWorkspaceTabByArgs(args)
      if (!targetTab) {
        return {
          success: false,
          message: "Target tab not found in the current workspace."
        }
      }
      if (targetTab.tabId === this.session.rootTabId) {
        return {
          success: false,
          message: "The root tab cannot be closed during the task."
        }
      }

      await browser.tabs.remove(targetTab.tabId)
      this.session.openedTabIds = this.session.openedTabIds.filter(
        (tabId) => tabId !== targetTab.tabId
      )

      if (this.session.activeTabId === targetTab.tabId) {
        await activateTab(this.session, this.session.rootTabId)
        this.pendingContextReason =
          "The previous active tab was closed. Continue from the root tab."
      }

      return {
        success: true,
        message: `Closed tab_${targetTab.tabIndex}: ${targetTab.url}`
      }
    }
    if (actionName === "open_url_in_new_tab") {
      const url = String(args.url || "")
      if (!url) return { success: false, message: "No URL provided." }
      if (!isAutomatableUrl(url))
        return { success: false, message: `URL is not automatable: ${url}` }

      const currentTab = await browser.tabs.get(this.session.activeTabId)
      const background = Boolean(args.background)
      const createdTab = await browser.tabs.create({
        url,
        active: !background,
        windowId: currentTab.windowId,
        index:
          typeof currentTab.index === "number"
            ? currentTab.index + 1
            : undefined
      })
      if (typeof createdTab.id !== "number")
        return { success: false, message: "Failed to create new tab." }

      this.session.openedTabIds = Array.from(
        new Set([...this.session.openedTabIds, createdTab.id])
      )
      if (!background) {
        this.session.activeTabId = createdTab.id
        await wait(1500)
        this.pendingContextReason = `A new tab was opened for ${url}. Continue the task using the updated active tab.`
      }
      return { success: true, message: `Opened URL in new tab.` }
    }
    if (actionName === "open_link_in_new_tab") {
      const elementId = (args.element_id as number | string | undefined) ?? ""
      const url = elementId
        ? await resolveLinkUrl(this.session, elementId)
        : null
      if (!url)
        return {
          success: false,
          message: `Could not resolve a link URL for ${String(elementId)}.`
        }

      const currentTab = await browser.tabs.get(this.session.activeTabId)
      const background = Boolean(args.background)
      const createdTab = await browser.tabs.create({
        url,
        active: !background,
        windowId: currentTab.windowId,
        index:
          typeof currentTab.index === "number"
            ? currentTab.index + 1
            : undefined
      })
      if (typeof createdTab.id !== "number")
        return { success: false, message: "Failed to create new tab." }

      this.session.openedTabIds = Array.from(
        new Set([...this.session.openedTabIds, createdTab.id])
      )
      if (!background) {
        this.session.activeTabId = createdTab.id
        await wait(1500)
        this.pendingContextReason = `A new tab was opened for ${url}. Continue the task using the updated active tab.`
      }
      return { success: true, message: `Opened link in new tab.` }
    }
    if (actionName === "navigate_to") {
      const url = String(args.url || "")
      if (!url) return { success: false, message: "No URL provided." }
      try {
        await browser.tabs.update(this.session.activeTabId, { url })
        await wait(2000)
        this.pendingContextReason = `The active tab navigated to ${url}. Continue using the updated page state.`
        return { success: true, message: `Navigated current tab to: ${url}` }
      } catch (err) {
        return {
          success: false,
          message: `Navigation failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
    }
    if (actionName === "download_url") {
      return downloadDirectUrl(
        String(args.url || ""),
        typeof args.filename === "string" ? args.filename : undefined
      )
    }
    if (actionName === "download_link") {
      const elementId = (args.element_id as number | string | undefined) ?? ""
      const url = elementId
        ? await resolveLinkUrl(this.session, elementId)
        : null
      if (!url) {
        return {
          success: false,
          message: `Could not resolve a link URL for ${String(elementId)}.`
        }
      }
      return downloadDirectUrl(
        url,
        typeof args.filename === "string" ? args.filename : undefined
      )
    }

    const action: AgentAction = {
      type: actionName as AgentAction["type"],
      ...args
    } as AgentAction

    if (
      [
        "control_video",
        "get_video_status",
        "wait_for_video_end",
        "advance_to_next_video"
      ].includes(actionName)
    ) {
      await activateTab(this.session, this.session.activeTabId)
      await wait(150)
    }

    let actionHeartbeatId: ReturnType<typeof setInterval> | null = null
    if (actionName === "wait_for_video_end") {
      this.postStep({
        type: "status",
        status: "running",
        message: "Waiting for the current video to finish...",
        waitContext: "video_playback"
      })
      actionHeartbeatId = setInterval(() => {
        this.postStep({
          type: "status",
          status: "running",
          message: "Waiting for the current video to finish...",
          heartbeat: true,
          waitContext: "video_playback"
        })
      }, MODEL_WAIT_HEARTBEAT_MS)
    }

    let result: AgentActionResult
    try {
      result = await executeInTab(this.session.activeTabId, action)
    } finally {
      if (actionHeartbeatId) {
        clearInterval(actionHeartbeatId)
        this.postStep({
          type: "status",
          status: "running",
          message: "Video wait completed."
        })
      }
    }

    const isPageChangingAction = [
      "click_element",
      "fill_input",
      "select_option",
      "execute_js"
    ].includes(actionName)
    await wait(isPageChangingAction ? ACTION_DELAY_MS : 200)
    return result
  }
}
