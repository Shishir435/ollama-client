import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { AGENT_SYSTEM_PROMPT, BROWSER_TOOLS, JSON_AGENT_SYSTEM_PROMPT } from "@/lib/agent/tools"
import type {
  AgentAction,
  AgentActionResult,
  AgentStep,
  AgentStreamMessage,
  AgentTaskMessage,
  InteractiveElement
} from "@/lib/agent/types"
import type { ChromePort } from "@/types"

const MAX_STEPS = 15
const ACTION_DELAY_MS = 600
const MODEL_WAIT_HEARTBEAT_MS = 10_000

interface AgentBrowserSession {
  rootTabId: number
  activeTabId: number
  openedTabIds: number[]
}

interface WorkspaceTabInfo {
  tabId: number
  tabIndex: number
  title: string
  url: string
  isRoot: boolean
  isActive: boolean
}

const isAutomatableUrl = (url?: string | null): boolean => {
  if (!url) return false

  return !/^(about:|chrome:|chrome-extension:|devtools:|edge:|edge-extension:|moz-extension:|view-source:)/i.test(
    url
  )
}

const isAutomatableTab = (
  tab: { id?: number; url?: string | null } | undefined
): tab is { id: number; url?: string | null; lastAccessed?: number } => {
  return typeof tab?.id === "number" && isAutomatableUrl(tab.url)
}

const isDownloadableUrl = (url: string): boolean => {
  return /^(https?:|blob:|data:)/i.test(url)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Send an agent step update over the port */
const postStep = (port: ChromePort, msg: AgentStreamMessage) => {
  try {
    port.postMessage(msg as unknown as Parameters<typeof port.postMessage>[0])
  } catch {
    // port closed — ignore
  }
}

/** Broadcast a message to all frames in the tab and collect responses */
export const broadcastToAllFrames = async (tabId: number, message: any): Promise<any[]> => {
  try {
    const frames = (await browser.webNavigation.getAllFrames({ tabId })).sort(
      (a, b) => a.frameId - b.frameId
    )
    const results = await Promise.all(
      frames.map((f) => 
        browser.tabs.sendMessage(tabId, message, { frameId: f.frameId }).catch(() => null)
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

/** Ping the content script, injecting it programmatically if not yet loaded */
const ensureContentScript = async (tabId: number): Promise<boolean> => {
  // 1. Try a quick ping first
  try {
    await Promise.race([
      browser.tabs.sendMessage(tabId, { type: "__agent_ping" }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 2000))
    ])
    return true // Already loaded
  } catch {
    // Not loaded — try programmatic injection
  }

  // 2. Inject via chrome.scripting (requires 'scripting' permission)
  try {
    const chromeBrowser = browser as unknown as typeof chrome
    if (chromeBrowser.scripting?.executeScript) {
      await chromeBrowser.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"]
      })
      // Small delay for registration
      await new Promise((r) => setTimeout(r, 500))
      return true
    }
  } catch (err) {
    console.warn("[Agent] Failed to inject content script:", err)
  }

  return false
}

/** Get page context using accessibility tree (primary) or flat elements (fallback) */
const getPageContext = async (
  tabId: number
): Promise<{ accessibilityTree: string; elements: InteractiveElement[]; pageText: string; pageUrl: string }> => {
  let elements: InteractiveElement[] = []
  let pageText = ""
  let pageUrl = ""
  let accessibilityTree = ""

  // Get page URL from tab info
  try {
    const tabs = await browser.tabs.get(tabId)
    pageUrl = tabs.url || ""
  } catch { /* ignore */ }

  // Try accessibility tree first (from all frames)
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
      // If full tree is too large, retry with interactive-only filter
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
  } catch { /* ignore */ }

  // Fallback: get flat interactive elements if tree is empty
  if (!accessibilityTree) {
    try {
      const responses = await broadcastToAllFrames(tabId, { type: MESSAGE_KEYS.AGENT.GET_ELEMENTS })
      elements = responses.flatMap((resp: any) => (resp.data as InteractiveElement[]) || [])
    } catch { /* ignore */ }
  }

  // Get page text from main frame
  try {
    const resp = await Promise.race([
      browser.tabs.sendMessage(tabId, { type: MESSAGE_KEYS.AGENT.GET_PAGE_TEXT }),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
    ]) as AgentActionResult | null
    if (resp?.message) {
      pageText = resp.message.slice(0, 2000)
    }
  } catch { /* ignore */ }

  return { accessibilityTree, elements, pageText, pageUrl }
}

/** Ask ALL content scripts in the tab to perform a DOM action */
const executeInTab = async (
  tabId: number,
  action: AgentAction
): Promise<AgentActionResult> => {
  try {
    const results = await broadcastToAllFrames(tabId, {
      type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
      payload: action
    })
    
    // Find the first successful response, or the first response with a message
    const successResult = results.find(r => r.success)
    if (successResult) return successResult
    
    const errorResult = results.find(r => !r.success && r.message && r.message !== "Element not found")
    if (errorResult) return errorResult

    return { success: false, message: "Action failed or element not found in any frame." }
  } catch (err) {
    return {
      success: false,
      message: `Content script error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/** Resolve the best web tab for automation */
export const resolveTargetTabId = async (
  preferredTabId?: number | null
): Promise<number | null> => {
  if (typeof preferredTabId === "number") {
    try {
      const preferredTab = await browser.tabs.get(preferredTabId)
      if (isAutomatableTab(preferredTab)) return preferredTab.id
    } catch {
      // Fall through to automatic resolution.
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

const getWorkspaceTabs = async (
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

const formatWorkspaceForLLM = (tabs: WorkspaceTabInfo[]): string => {
  if (tabs.length === 0) return "No tracked tabs."

  return tabs
    .map((tab) => {
      const flags = [
        tab.isRoot ? "root" : null,
        tab.isActive ? "active" : null
      ]
        .filter(Boolean)
        .join(", ")

      return `[tab_${tab.tabIndex}] ${tab.title.slice(0, 80)} - ${tab.url.slice(0, 120)}${flags ? ` (${flags})` : ""}`
    })
    .join("\n")
}

/** Format elements list for LLM context */
const formatElementsForLLM = (elements: InteractiveElement[]): string => {
  if (elements.length === 0) return "No interactive elements found on the page."
  const lines = elements.map((el) => {
    let desc = `[${el.id}] ${el.type.toUpperCase()}`
    if (el.text) desc += `: "${el.text.slice(0, 60)}"`
    if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`
    if (el.href) desc += ` → ${el.href.slice(0, 60)}`
    if (el.options && el.options.length > 0) {
      desc += ` [options: ${el.options.slice(0, 5).join(", ")}]`
    }
    if (el.disabled) desc += " (disabled)"
    return desc
  })
  return lines.join("\n")
}

export const handleAgentTask = async (
  port: ChromePort,
  message: AgentTaskMessage
) => {
  try {
    const {
      task,
      model,
      maxSteps = MAX_STEPS,
      visionMode,
      autoRepeat,
      tabId: requestedTabId
    } = message.payload

    let stopped = false
    let completed = false
    let finalMessage: string | undefined
    let finalMode: "tool-calling" | "json-fallback" | undefined

  postStep(port, { type: "status", status: "running" })

  const initialTabId = await resolveTargetTabId(requestedTabId)
  if (!initialTabId) {
    postStep(port, {
      type: "error",
      error: "No active tab found. Please open a web page first."
    })
    return
  }

  const session: AgentBrowserSession = {
    rootTabId: initialTabId,
    activeTabId: initialTabId,
    openedTabIds: []
  }

  // ── Ensure content script is loaded ──────────────────────────────────────
  postStep(port, {
    type: "status",
    status: "running",
    message: "Connecting to page..."
  })

  const contentScriptOk = await ensureContentScript(session.activeTabId)
  if (!contentScriptOk) {
    postStep(port, {
      type: "error",
      error:
        "Cannot connect to the page. " +
        "Please reload the page (press F5) and try again. " +
        "This happens when the extension is reloaded while the tab was already open."
    })
    return
  }

  // ── Vision Context Helper ──────────────────────────────────────────────────
  const captureVisionContext = async (targetTabId: number): Promise<string | null> => {
    try {
      await broadcastToAllFrames(targetTabId, { type: MESSAGE_KEYS.AGENT.DRAW_MARKS })
      await new Promise((r) => setTimeout(r, 100))
      // Capture PNG with UI labels visible for the Set of Marks
      const dataUri = await browser.tabs.captureVisibleTab(undefined, { format: "png" } as any)
      await broadcastToAllFrames(targetTabId, { type: MESSAGE_KEYS.AGENT.REMOVE_MARKS })
      return dataUri ? dataUri.split(",")[1] : null
    } catch (e) {
      console.error("Failed to capture vision context:", e)
      try { await broadcastToAllFrames(targetTabId, { type: MESSAGE_KEYS.AGENT.REMOVE_MARKS }) } catch {}
      return null
    }
  }

  // ── Retrieve Ollama base URL ──────────────────────────────────────────────
  const baseUrl =
    (await plasmoGlobalStorage.get<string>("provider-base-url")) ||
    (await plasmoGlobalStorage.get<string>("ollama-base-url")) ||
    "http://localhost:11434"

  // ── Pre-fetch page context to give the LLM immediate awareness ───────────
  postStep(port, {
    type: "status",
    status: "running",
    message: "Reading page context..."
  })

  // Conversation history for the agent loop
  const messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
    images?: string[] // Optional vision support
    tool_calls?: Array<{ function: { name: string; arguments: string } }>
    tool_call_id?: string
    name?: string
  }> = []

  const jsonMessages: Array<{
    role: "system" | "user" | "assistant"
    content: string
    images?: string[] // Optional vision support
  }> = []

  const buildPageStateContext = async () => {
    const { accessibilityTree, elements, pageText, pageUrl } = await getPageContext(
      session.activeTabId
    )
    const elementsText = formatElementsForLLM(elements)
    const workspaceTabs = await getWorkspaceTabs(session)
    const workspaceText = formatWorkspaceForLLM(workspaceTabs)

    // Build context: prefer accessibility tree, fall back to flat list
    const hasTree = accessibilityTree.length > 0

    return visionMode
      ? [
          `Current active tab: ${pageUrl}`,
          `Root tab id: ${session.rootTabId}`,
          `=== WORKSPACE TABS ===\n${workspaceText}`,
          `Current page: ${pageUrl}`,
          "You are operating in VISION MODE. The user has provided a screenshot of the page.",
          "Interactive elements are marked with a red square containing an ID number.",
          `Use these IDs (e.g. ref_1, ref_2) when calling click_element.`,
          hasTree
            ? `=== PAGE ACCESSIBILITY TREE ===\n${accessibilityTree}`
            : `=== INTERACTIVE ELEMENTS ===\n${elementsText}`
        ].join("\n")
      : [
          `Current active tab: ${pageUrl}`,
          `Root tab id: ${session.rootTabId}`,
          `=== WORKSPACE TABS ===\n${workspaceText}`,
          `Current page: ${pageUrl}`,
          "",
          hasTree
            ? `=== PAGE ACCESSIBILITY TREE ===\nElements have [ref_id] identifiers. Use these IDs with click_element, fill_input, hover_element.\n${accessibilityTree}`
            : `=== INTERACTIVE ELEMENTS ===\n${elementsText}`,
          pageText
            ? `\n=== PAGE CONTENT (first 2000 chars) ===\n${pageText}`
            : ""
        ]
          .filter(Boolean)
          .join("\n")
  }

  const refreshContext = async (
    options: {
      reset?: boolean
      reason?: string
    } = {}
  ) => {
    const initialContext = await buildPageStateContext()

    if (options.reset) {
      messages.length = 0
      messages.push({ role: "system", content: AGENT_SYSTEM_PROMPT })
      messages.push({
        role: "user",
        content: `Task: ${task}\n\nHere is the current page state:\n${initialContext}`
      })

      jsonMessages.length = 0
      jsonMessages.push({ role: "system", content: JSON_AGENT_SYSTEM_PROMPT })
      jsonMessages.push({
        role: "user",
        content: `Task: ${task}\n\nHere is the current page state:\n${initialContext}`
      })
      return
    }

    const reasonPrefix = options.reason ? `${options.reason}\n\n` : ""
    const updateContent = `${reasonPrefix}Here is the updated page state:\n${initialContext}`
    messages.push({
      role: "user",
      content: updateContent
    })
    jsonMessages.push({
      role: "user",
      content: `${updateContent}\n\nRespond with ONLY a JSON object.`
    })
  }

  await refreshContext({ reset: true })

  let currentAbort: AbortController | null = null

  // Stop listener — also aborts any in-flight fetch
  port.onMessage.addListener((msg: import("@/types").ChromeMessage | import("@/types").EmbeddingStatusMessage) => {
    const m = msg as { type?: string }
    if (m?.type === MESSAGE_KEYS.AGENT.STOP) {
      stopped = true
      currentAbort?.abort()
    }
  })

  /**
   * Shared fetch — sends messages to Ollama, with or without tools.
   * Returns the parsed assistant message or throws.
   */
  const callLLM = async (
    msgs: typeof messages,
    withTools: boolean
  ): Promise<{ content: string; tool_calls?: unknown[] }> => {
    currentAbort = new AbortController()
    const timeoutId = setTimeout(() => currentAbort?.abort(), 300_000)
    const requestStartedAt = Date.now()
    const heartbeatId = setInterval(() => {
      postStep(port, {
        type: "status",
        status: "running",
        heartbeat: true,
        message: `Waiting for local model response... ${Math.floor((Date.now() - requestStartedAt) / 1000)}s`
      })
    }, MODEL_WAIT_HEARTBEAT_MS)

    let raw: Response
    try {
      raw = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: msgs,
          ...(withTools ? { tools: BROWSER_TOOLS } : {}),
          stream: false,
          options: {
            num_ctx: 32768
          }
        }),
        signal: currentAbort.signal
      })
    } catch (err) {
      clearInterval(heartbeatId)
      clearTimeout(timeoutId)
      const isTimeout = (err as Error)?.name === "AbortError"
      throw new Error(
        isTimeout
          ? "Request timed out after 300s. Local model is taking too long to process the page context."
          : `Cannot reach Ollama at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    clearInterval(heartbeatId)
    clearTimeout(timeoutId)
    currentAbort = null

    if (!raw.ok) {
      const errText = await raw.text()
      throw new Error(`Ollama error (${raw.status}): ${errText}`)
    }

    const data = await raw.json()
    return data.message ?? { content: "" }
  }

  /**
   * Parse a JSON action from the model's text response (JSON fallback mode).
   * Extracts the first `{...}` block from the content.
   */
  const parseJsonAction = (
    content: string
  ): Record<string, unknown> | null => {
    // Strip markdown fences if present
    const clean = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    const match = clean.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }

  let pendingContextReason: string | null = null

  const getCurrentTab = async () => {
    return browser.tabs.get(session.activeTabId)
  }

  const activateTab = async (tabId: number) => {
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

  const resolveLinkUrl = async (
    elementId: number | string
  ): Promise<string | null> => {
    const responses = await broadcastToAllFrames(session.activeTabId, {
      type: MESSAGE_KEYS.AGENT.GET_ELEMENTS
    })
    const elements = responses.flatMap(
      (resp: { data?: InteractiveElement[] }) => resp.data || []
    )
    const match = elements.find((element) => element.id === elementId)
    return match?.href || null
  }

  const openUrlInNewTab = async (
    url: string,
    background = false
  ): Promise<AgentActionResult> => {
    if (!url) return { success: false, message: "No URL provided." }
    if (!isAutomatableUrl(url)) {
      return { success: false, message: `URL is not automatable: ${url}` }
    }

    try {
      const currentTab = await getCurrentTab()
      const createdTab = await browser.tabs.create({
        url,
        active: !background,
        windowId: currentTab.windowId,
        index:
          typeof currentTab.index === "number" ? currentTab.index + 1 : undefined
      })

      if (typeof createdTab.id !== "number") {
        return { success: false, message: "Failed to create new tab." }
      }

      session.openedTabIds = Array.from(
        new Set([...session.openedTabIds, createdTab.id])
      )

      if (!background) {
        session.activeTabId = createdTab.id
        await wait(1500)
        await ensureContentScript(createdTab.id)
        pendingContextReason = `A new tab was opened for ${url}. Continue the task using the updated active tab.`
      }

      const workspaceTabs = await getWorkspaceTabs(session)
      const openedTab = workspaceTabs.find((tab) => tab.tabId === createdTab.id)

      return {
        success: true,
        message: background
          ? `Opened ${url} in a background tab.`
          : `Opened ${url} in new active tab tab_${openedTab?.tabIndex ?? "?"}.`,
        data: {
          tabId: createdTab.id,
          tabIndex: openedTab?.tabIndex,
          url
        }
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to open new tab: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  const getWorkspaceTabByArgs = async (
    args: Record<string, unknown>
  ): Promise<WorkspaceTabInfo | null> => {
    const workspaceTabs = await getWorkspaceTabs(session)
    const requestedIndex = Number(args.tab_index)
    if (Number.isFinite(requestedIndex)) {
      return workspaceTabs.find((tab) => tab.tabIndex === requestedIndex) || null
    }

    const requestedTabId = Number(args.tab_id)
    if (Number.isFinite(requestedTabId)) {
      return workspaceTabs.find((tab) => tab.tabId === requestedTabId) || null
    }

    return null
  }

  const downloadDirectUrl = async (
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

  /**
   * Execute a parsed action object (works for both tool-calling and JSON mode).
   */
  const executeAction = async (
    actionName: string,
    args: Record<string, unknown>
  ): Promise<AgentActionResult> => {
    // Plan is a no-op tool — just records the model's thinking
    if (actionName === "plan") {
      return { success: true, message: `Plan noted: ${String(args.text || "").slice(0, 200)}` }
    }
    if (actionName === "wait") {
      const ms = Math.min(Number(args.ms) || 500, 5000)
      await new Promise((r) => setTimeout(r, ms))
      return { success: true, message: `Waited ${ms}ms` }
    }
    if (actionName === "list_tabs") {
      const workspaceTabs = await getWorkspaceTabs(session)
      return {
        success: true,
        message: `Workspace tabs:\n${formatWorkspaceForLLM(workspaceTabs)}`,
        data: workspaceTabs
      }
    }
    if (actionName === "switch_to_tab") {
      const targetTab = await getWorkspaceTabByArgs(args)
      if (!targetTab) {
        return { success: false, message: "Target tab not found in the current workspace." }
      }

      await activateTab(targetTab.tabId)
      pendingContextReason = `The active tab is now tab_${targetTab.tabIndex}. Continue using this page.`
      return {
        success: true,
        message: `Switched to tab_${targetTab.tabIndex}: ${targetTab.url}`,
        data: targetTab
      }
    }
    if (actionName === "return_to_root_tab") {
      await activateTab(session.rootTabId)
      pendingContextReason = "Returned to the root tab where the task started."
      return {
        success: true,
        message: "Returned to the root tab.",
        data: { tabId: session.rootTabId }
      }
    }
    if (actionName === "close_tab") {
      const targetTab = await getWorkspaceTabByArgs(args)
      if (!targetTab) {
        return { success: false, message: "Target tab not found in the current workspace." }
      }
      if (targetTab.tabId === session.rootTabId) {
        return { success: false, message: "The root tab cannot be closed during the task." }
      }

      await browser.tabs.remove(targetTab.tabId)
      session.openedTabIds = session.openedTabIds.filter((tabId) => tabId !== targetTab.tabId)

      if (session.activeTabId === targetTab.tabId) {
        await activateTab(session.rootTabId)
        pendingContextReason = "The previous active tab was closed. Continue from the root tab."
      }

      return {
        success: true,
        message: `Closed tab_${targetTab.tabIndex}: ${targetTab.url}`
      }
    }
    if (actionName === "open_url_in_new_tab") {
      return openUrlInNewTab(String(args.url || ""), Boolean(args.background))
    }
    if (actionName === "open_link_in_new_tab") {
      const elementId = (args.element_id as number | string | undefined) ?? ""
      const url = elementId ? await resolveLinkUrl(elementId) : null
      if (!url) {
        return { success: false, message: `Could not resolve a link URL for ${String(elementId) || "the requested element"}.` }
      }
      return openUrlInNewTab(url, Boolean(args.background))
    }
    if (actionName === "navigate_to") {
      const url = String(args.url || "")
      if (!url) return { success: false, message: "No URL provided." }
      try {
        await browser.tabs.update(session.activeTabId, { url })
        await wait(2000)
        await ensureContentScript(session.activeTabId)
        pendingContextReason = `The active tab navigated to ${url}. Continue using the updated page state.`
        return { success: true, message: `Navigated current tab to: ${url}` }
      } catch (err) {
        return { success: false, message: `Navigation failed: ${err instanceof Error ? err.message : String(err)}` }
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
      const url = elementId ? await resolveLinkUrl(elementId) : null
      if (!url) {
        return { success: false, message: `Could not resolve a link URL for ${String(elementId) || "the requested element"}.` }
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

    if (["control_video", "get_video_status", "wait_for_video_end", "advance_to_next_video"].includes(actionName)) {
      await activateTab(session.activeTabId)
      await wait(150)
    }

    let actionHeartbeatId: ReturnType<typeof setInterval> | null = null
    if (actionName === "wait_for_video_end") {
      postStep(port, {
        type: "status",
        status: "running",
        message: "Waiting for the current video to finish...",
        waitContext: "video_playback"
      })
      actionHeartbeatId = setInterval(() => {
        postStep(port, {
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
      result = await executeInTab(session.activeTabId, action)
    } finally {
      if (actionHeartbeatId) {
        clearInterval(actionHeartbeatId)
        postStep(port, {
          type: "status",
          status: "running",
          message: "Video wait completed."
        })
      }
    }
    // Smart delay: longer for clicks (page may change), shorter for reads
    const isPageChangingAction = ["click_element", "fill_input", "select_option", "execute_js"].includes(actionName)
    await new Promise((r) => setTimeout(r, isPageChangingAction ? ACTION_DELAY_MS : 200))
    return result
  }

  // ── Detect tool calling support on first step ─────────────────────────────
  // "json-fallback" is set automatically if the model doesn't emit tool_calls.
  let agentMode: "tool-calling" | "json-fallback" | "detecting" = "detecting"

  let stepNumber = 0
  let repeatCount = 0

  // ── Outer auto-repeat loop ────────────────────────────────────────────────
  do {
    if (repeatCount > 0) {
      // Between repeats: refresh DOM context (page may have navigated to next video)
      postStep(port, {
        type: "status",
        status: "running",
        message: `🔄 Repeat #${repeatCount} — refreshing page context...`
      })
      await new Promise((r) => setTimeout(r, 3000)) // Wait 3s for page transitions
      await refreshContext({ reset: true })
      agentMode = "detecting" // Re-detect tool calling capability
      stepNumber = 0
    }
    repeatCount++

    let taskDone = false

  while (stepNumber < maxSteps && !stopped && !taskDone) {
    stepNumber++

    const step: AgentStep = { stepNumber, timestamp: Date.now() }

    // ── Pre-Step Vision Update ────────────────────────────────────────────────
    let currentImageBase64: string | null = null
    if (visionMode) {
      postStep(port, {
        type: "status",
        status: "running",
        message: "Taking screenshot..."
      })
      currentImageBase64 = await captureVisionContext(session.activeTabId)
    }

    // Prepare fresh messages array with stripped images from previous turns (to save context)
    const currentMessages = messages.map(m => ({ ...m, images: undefined }))
    const currentJsonMessages = jsonMessages.map(m => ({ ...m, images: undefined }))

    // Inject the new screenshot into the last user message of the history
    if (currentImageBase64) {
       // Reverse find the last user message
       for (let i = currentMessages.length - 1; i >= 0; i--) {
         if (currentMessages[i].role === "user") {
           currentMessages[i].images = [currentImageBase64]
           break
         }
       }
       for (let i = currentJsonMessages.length - 1; i >= 0; i--) {
         if (currentJsonMessages[i].role === "user") {
           currentJsonMessages[i].images = [currentImageBase64]
           break
         }
       }
    }

    postStep(port, {
      type: "status",
      status: "running",
      message: `Step ${stepNumber}${agentMode === "json-fallback" ? " (JSON mode)" : ""}...`,
      mode: agentMode === "detecting" ? undefined : agentMode
    })

    // ── Call the LLM ──────────────────────────────────────────────────────────
    let assistantMsg: { content: string; tool_calls?: unknown[] }
    try {
      if (agentMode === "json-fallback") {
        assistantMsg = await callLLM(currentJsonMessages, false)
      } else {
        assistantMsg = await callLLM(currentMessages, true)
      }
    } catch (err) {
      postStep(port, {
        type: "error",
        error: err instanceof Error ? err.message : String(err)
      })
      return
    }

    // ── Auto-detect mode on first response ───────────────────────────────────
    if (agentMode === "detecting") {
      const hasToolCalls = Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length > 0

      if (!hasToolCalls) {
        // Model doesn't support tool calling — switch to JSON mode
        agentMode = "json-fallback"
        postStep(port, {
          type: "status",
          status: "running",
          message: "Model doesn't support tool calling — switching to JSON mode",
          mode: "json-fallback"
        })

        // Reinitialise conversation with JSON system prompt
        await refreshContext()

        // Retry this step in JSON mode (don't count as wasted step)
        stepNumber--
        continue
      } else {
        agentMode = "tool-calling"
        postStep(port, {
          type: "status",
          status: "running",
          message: "Tool calling supported",
          mode: "tool-calling"
        })
      }
    }

    // ── Process response ──────────────────────────────────────────────────────

    if (agentMode === "tool-calling") {
      // Add assistant message to tool-calling history
      messages.push(assistantMsg as typeof messages[number])

      const toolCalls = assistantMsg.tool_calls as Array<{
        id?: string
        function?: { name?: string; arguments?: string | Record<string, unknown> }
      }>

      if (!toolCalls || toolCalls.length === 0) {
        // Model output text without a tool call. Don't close the task immediately.
        // It might be a Chain of Thought or it might be asking the user something.
        // Prompt it to use a tool to continue or finish.
        step.thought = assistantMsg.content || "Thinking without actions..."
        step.result = { success: false, message: "No tool called." }
        
        // Feed the prompt back to force a tool use
        messages.push({
          role: "user",
          content: "You replied with text but did not call any tools. You MUST call a tool to interact with the page, or call 'task_complete' if the task is finished or impossible."
        } as typeof messages[number])

        postStep(port, { type: "step", step, mode: "tool-calling" })
        continue
      }

      const toolCall = toolCalls[0]
      const toolName: string = toolCall.function?.name || ""
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs =
          typeof toolCall.function?.arguments === "string"
            ? JSON.parse(toolCall.function.arguments)
            : (toolCall.function?.arguments as Record<string, unknown>) || {}
      } catch {
        toolArgs = {}
      }

      step.thought = assistantMsg.content
      step.action = { type: toolName as AgentAction["type"], ...toolArgs } as AgentAction

      if (toolName === "task_complete") {
        const result = { success: toolArgs.success as boolean, message: toolArgs.message as string }
        postStep(port, { type: "step", step: { ...step, result } })
        taskDone = true
        completed = true
        finalMessage = result.message
        finalMode = "tool-calling"
        break
      }

      const toolResult = await executeAction(toolName, toolArgs)
      step.result = toolResult

      messages.push({
        role: "tool" as never,
        tool_call_id: toolCall.id || `tool_${stepNumber}`,
        name: toolName,
        content: JSON.stringify(toolResult)
      })

      if (pendingContextReason) {
        await refreshContext({ reason: pendingContextReason })
        pendingContextReason = null
      }

      postStep(port, { type: "step", step, mode: "tool-calling" })

    } else {
      // ── JSON fallback mode ───────────────────────────────────────────────────
      jsonMessages.push({ role: "assistant", content: assistantMsg.content })

      const parsed = parseJsonAction(assistantMsg.content)

      if (!parsed || !parsed.action) {
        // Model gave a text response — re-prompt it to use JSON
        step.thought = assistantMsg.content
        step.result = { success: false, message: "Model did not respond with JSON. Re-prompting..." }
        jsonMessages.push({
          role: "user",
          content: "You must respond with ONLY a JSON object. Try again."
        })
        postStep(port, { type: "step", step, mode: "json-fallback" })
        continue
      }

      const actionName = parsed.action as string
      const actionArgs = parsed as Record<string, unknown>
      step.action = { type: actionName as AgentAction["type"], ...actionArgs } as AgentAction
      step.thought = undefined // JSON mode: no separate thought

      if (actionName === "task_complete") {
        const result = { success: parsed.success as boolean, message: parsed.message as string }
        postStep(port, { type: "step", step: { ...step, result }, mode: "json-fallback" })
        taskDone = true
        completed = true
        finalMessage = result.message
        finalMode = "json-fallback"
        break
      }

      const actionResult = await executeAction(actionName, actionArgs)
      step.result = actionResult

      // Feed result back as user message for next turn
      jsonMessages.push({
        role: "user",
        content: `Action result: ${JSON.stringify(actionResult)}\n\nWhat is your next action? Respond with ONLY a JSON object.`
      })

      if (pendingContextReason) {
        await refreshContext({ reason: pendingContextReason })
        pendingContextReason = null
      }

      postStep(port, { type: "step", step, mode: "json-fallback" })
    }

    if (stopped) break
  } // end inner while

  } while (autoRepeat && !stopped && !completed) // end outer autoRepeat loop

  if (stopped) {
    postStep(port, { type: "done", message: "Agent stopped by user.", totalSteps: stepNumber, status: "stopped" })
  } else if (completed) {
    postStep(port, {
      type: "done",
      message: finalMessage,
      totalSteps: stepNumber,
      status: "done",
      mode: finalMode
    })
  } else if (!autoRepeat) {
    postStep(port, {
      type: "done",
      message: `Reached maximum steps (${maxSteps}). Task may not be fully complete.`,
      totalSteps: stepNumber,
      status: "error"
    })
  }

  } catch (error) {
    console.error("Unhandled agent error:", error)
    postStep(port, {
      type: "error",
      error: `Agent crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`
    })
  }
}
