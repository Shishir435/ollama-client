import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type {
  AgentAction,
  AgentActionResult,
  InteractiveElement
} from "./types"

export interface AgentBrowserSession {
  rootTabId: number
  activeTabId: number
  openedTabIds: number[]
}

export interface WorkspaceTabInfo {
  tabId: number
  tabIndex: number
  title: string
  url: string
  isRoot: boolean
  isActive: boolean
}

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const isAutomatableUrl = (url?: string | null): boolean => {
  if (!url) return false
  return !/^(about:|chrome:|chrome-extension:|devtools:|edge:|edge-extension:|moz-extension:|view-source:)/i.test(
    url
  )
}

export const isAutomatableTab = (
  tab: { id?: number; url?: string | null } | undefined
): tab is { id: number; url?: string | null; lastAccessed?: number } => {
  return typeof tab?.id === "number" && isAutomatableUrl(tab.url)
}

export const isDownloadableUrl = (url: string): boolean => {
  return /^(https?:|blob:|data:)/i.test(url)
}

export const broadcastToAllFrames = async (
  tabId: number,
  message: any
): Promise<any[]> => {
  try {
    const frames = (await browser.webNavigation.getAllFrames({ tabId })).sort(
      (a, b) => a.frameId - b.frameId
    )
    const results = await Promise.all(
      frames.map((f) =>
        browser.tabs
          .sendMessage(tabId, message, { frameId: f.frameId })
          .catch(() => null)
      )
    )
    return results.filter(Boolean)
  } catch (e) {
    try {
      const single = await browser.tabs.sendMessage(tabId, message)
      return single ? [single] : []
    } catch {
      return []
    }
  }
}

export const ensureContentScript = async (tabId: number): Promise<boolean> => {
  try {
    await Promise.race([
      browser.tabs.sendMessage(tabId, { type: "__agent_ping" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("ping timeout")), 2000)
      )
    ])
    return true
  } catch {
    // try inject
  }

  try {
    const chromeBrowser = browser as unknown as typeof chrome
    if (chromeBrowser.scripting?.executeScript) {
      await chromeBrowser.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"]
      })
      await new Promise((r) => setTimeout(r, 500))
      return true
    }
  } catch (err) {
    console.warn("[Agent] Failed to inject content script:", err)
  }

  return false
}

export const getPageContext = async (
  tabId: number
): Promise<{
  accessibilityTree: string
  elements: InteractiveElement[]
  pageText: string
  pageUrl: string
}> => {
  let elements: InteractiveElement[] = []
  let pageText = ""
  let pageUrl = ""
  let accessibilityTree = ""

  try {
    const tabs = await browser.tabs.get(tabId)
    pageUrl = tabs.url || ""
  } catch {
    /* ignore */
  }

  try {
    const responses = await broadcastToAllFrames(tabId, {
      type: MESSAGE_KEYS.AGENT.READ_PAGE,
      options: { filter: "all", maxDepth: 10, maxChars: 12000 }
    })
    const trees = responses
      .filter((r: any) => r.data?.pageContent)
      .map((r: any) => r.data.pageContent as string)
      .filter(Boolean)
    if (trees.length > 0) {
      accessibilityTree = trees.join("\n")
    } else {
      const retryResponses = await broadcastToAllFrames(tabId, {
        type: MESSAGE_KEYS.AGENT.READ_PAGE,
        options: { filter: "interactive", maxDepth: 8, maxChars: 12000 }
      })
      const retryTrees = retryResponses
        .filter((r: any) => r.data?.pageContent)
        .map((r: any) => r.data.pageContent as string)
        .filter(Boolean)
      if (retryTrees.length > 0) {
        accessibilityTree = retryTrees.join("\n")
      }
    }
  } catch {
    /* ignore */
  }

  if (!accessibilityTree) {
    try {
      const responses = await broadcastToAllFrames(tabId, {
        type: MESSAGE_KEYS.AGENT.GET_ELEMENTS
      })
      elements = responses.flatMap(
        (resp: any) => (resp.data as InteractiveElement[]) || []
      )
    } catch {
      /* ignore */
    }
  }

  try {
    const resp = (await Promise.race([
      browser.tabs.sendMessage(tabId, {
        type: MESSAGE_KEYS.AGENT.GET_PAGE_TEXT
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000)
      )
    ])) as AgentActionResult | null
    if (resp?.message) {
      pageText = resp.message.slice(0, 2000)
    }
  } catch {
    /* ignore */
  }

  return { accessibilityTree, elements, pageText, pageUrl }
}

export const executeInTab = async (
  tabId: number,
  action: AgentAction
): Promise<AgentActionResult> => {
  try {
    const results = await broadcastToAllFrames(tabId, {
      type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
      payload: action
    })

    const successResult = results.find((r) => r.success)
    if (successResult) return successResult

    const errorResult = results.find(
      (r) => !r.success && r.message && r.message !== "Element not found"
    )
    if (errorResult) return errorResult

    return {
      success: false,
      message: "Action failed or element not found in any frame."
    }
  } catch (err) {
    return {
      success: false,
      message: `Content script error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

export const resolveTargetTabId = async (
  preferredTabId?: number | null
): Promise<number | null> => {
  if (typeof preferredTabId === "number") {
    try {
      const preferredTab = await browser.tabs.get(preferredTabId)
      if (isAutomatableTab(preferredTab)) return preferredTab.id
    } catch {
      // Fall through
    }
  }

  const activeTabs = await browser.tabs.query({ active: true })
  const bestActiveTab = activeTabs
    .filter(isAutomatableTab)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]

  if (bestActiveTab?.id) return bestActiveTab.id

  const allTabs = await browser.tabs.query({})
  const bestRecentTab = allTabs
    .filter(isAutomatableTab)
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]

  return bestRecentTab?.id ?? null
}

export const getWorkspaceTabs = async (
  session: AgentBrowserSession
): Promise<WorkspaceTabInfo[]> => {
  const uniqueTabIds = Array.from(
    new Set([session.rootTabId, ...session.openedTabIds])
  )

  const tabs = await Promise.all(
    uniqueTabIds.map(async (tabId) => {
      try {
        const tab = await browser.tabs.get(tabId)
        if (!isAutomatableTab(tab)) return null
        return {
          tabId,
          title: tab.title || tab.url || `Tab ${tabId}`,
          url: tab.url || ""
        }
      } catch {
        return null
      }
    })
  )

  return tabs
    .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))
    .map((tab, index) => ({
      ...tab,
      tabIndex: index,
      isRoot: tab.tabId === session.rootTabId,
      isActive: tab.tabId === session.activeTabId
    }))
}

export const activateTab = async (
  session: AgentBrowserSession,
  tabId: number
) => {
  const tab = await browser.tabs.get(tabId)
  if (tab.windowId !== undefined) {
    await browser.tabs.update(tabId, { active: true })
    await browser.windows.update(tab.windowId, { focused: true })
  } else {
    await browser.tabs.update(tabId, { active: true })
  }
  session.activeTabId = tabId
  await ensureContentScript(tabId)
}

export const getCurrentTab = async (session: AgentBrowserSession) => {
  return browser.tabs.get(session.activeTabId)
}

export const resolveLinkUrl = async (
  session: AgentBrowserSession,
  elementId: number | string
): Promise<string | null> => {
  const responses = await broadcastToAllFrames(session.activeTabId, {
    type: MESSAGE_KEYS.AGENT.GET_ELEMENTS
  })
  const elements = responses.flatMap(
    (resp: { data?: InteractiveElement[] }) => resp.data || []
  )
  const match = elements.find(
    (element) => String(element.id) === String(elementId)
  )
  return match?.href || null
}

export const downloadDirectUrl = async (
  url: string,
  filename?: string
): Promise<AgentActionResult> => {
  if (!url) return { success: false, message: "No URL provided." }
  if (!isDownloadableUrl(url)) {
    return { success: false, message: `URL is not downloadable: ${url}` }
  }

  try {
    const downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: false
    })
    return {
      success: true,
      message: `Started download from ${url}`,
      data: { downloadId, url, filename }
    }
  } catch (err) {
    return {
      success: false,
      message: `Download failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

export const captureVisionContext = async (
  targetTabId: number
): Promise<string | null> => {
  try {
    await broadcastToAllFrames(targetTabId, {
      type: MESSAGE_KEYS.AGENT.DRAW_MARKS
    })
    await new Promise((r) => setTimeout(r, 100))
    const dataUri = await browser.tabs.captureVisibleTab(undefined, {
      format: "png"
    } as any)
    await broadcastToAllFrames(targetTabId, {
      type: MESSAGE_KEYS.AGENT.REMOVE_MARKS
    })
    return dataUri ? dataUri.split(",")[1] : null
  } catch (e) {
    try {
      await broadcastToAllFrames(targetTabId, {
        type: MESSAGE_KEYS.AGENT.REMOVE_MARKS
      })
    } catch {}
    return null
  }
}
