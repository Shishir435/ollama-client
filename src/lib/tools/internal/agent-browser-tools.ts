import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type {
  AgentElementTarget,
  AgentPageActionRequest,
  PageSnapshot
} from "@/types/agent"
import type { ChromeResponse } from "@/types/messaging"
import type { ToolContext, ToolDefinition, ToolResult } from "../types"
import {
  accessDeniedMessage,
  classifyTabAccess,
  requestContentMessageWithRecovery
} from "./tab-utils"

const activeTab = async () =>
  (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0] ??
  (await browser.tabs.query({ active: true, currentWindow: true }))[0] ??
  (await browser.tabs.query({ active: true }))[0]

const resolveTab = async (value: unknown) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return browser.tabs.get(value)
  }
  return activeTab()
}

const responseData = <T>(response: ChromeResponse): T => {
  if (!response.success) {
    throw new Error(response.error?.message || "Page operation failed.")
  }
  return response.data as T
}

const sendToPage = async <T>(
  tabId: number,
  type: string,
  payload?: Record<string, unknown>
): Promise<T> =>
  responseData<T>(
    await requestContentMessageWithRecovery(tabId, { type, payload })
  )

const safeHttpUrl = (value: unknown): URL => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A URL is required.")
  }
  const parsed = new URL(value.trim())
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed.")
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs containing credentials are not allowed.")
  }
  return parsed
}

const readableTabOrError = async (tabId: number, url?: string) => {
  const access = await classifyTabAccess(url)
  if (access !== "ok") throw new Error(accessDeniedMessage(access, "the tab"))
  return tabId
}

const requireAgentOrigin = (ctx: ToolContext, url?: string): string => {
  if (!url) throw new Error("The target tab has no readable URL.")
  const origin = new URL(url).origin
  if (ctx.agent && !ctx.agent.allowedOrigins.includes(origin)) {
    throw new Error(
      `Agent origin boundary blocked ${origin}. Navigate there with explicit approval first.`
    )
  }
  return origin
}

const allowAgentOrigin = (ctx: ToolContext, origin: string): void => {
  if (ctx.agent && !ctx.agent.allowedOrigins.includes(origin)) {
    ctx.agent.allowedOrigins.push(origin)
  }
}

const targetFrom = (args: Record<string, unknown>): AgentElementTarget => {
  if (
    typeof args.snapshotId !== "string" ||
    typeof args.elementId !== "number" ||
    !Number.isInteger(args.elementId)
  ) {
    throw new Error("snapshotId and integer elementId are required.")
  }
  return { snapshotId: args.snapshotId, elementId: args.elementId }
}

const formatSnapshot = (snapshot: PageSnapshot, tabId: number): string => {
  const rows = snapshot.elements.map((element) => {
    const state = [
      element.type ? `type=${element.type}` : "",
      element.disabled ? "disabled" : "",
      element.checked !== undefined ? `checked=${element.checked}` : "",
      element.value ? `value=${JSON.stringify(element.value)}` : "",
      element.inViewport ? "viewport" : "offscreen"
    ]
      .filter(Boolean)
      .join(", ")
    return `[${element.elementId}] ${element.role} ${JSON.stringify(element.name)}${state ? ` (${state})` : ""}`
  })
  const notes = [
    snapshot.truncated
      ? `${snapshot.truncated} additional interactive elements were truncated.`
      : "",
    snapshot.unsupportedCrossOriginFrames
      ? `${snapshot.unsupportedCrossOriginFrames} cross-origin frame(s) could not be inspected.`
      : ""
  ].filter(Boolean)
  return [
    `Page snapshot ${snapshot.snapshotId} on tab ${tabId}`,
    `Title: ${snapshot.title || "Untitled"}`,
    `URL: ${snapshot.url}`,
    ...rows,
    ...notes
  ].join("\n")
}

export const snapshotPageDefinition: ToolDefinition = {
  name: "snapshot_page",
  description:
    "Observe interactive controls on a browser tab. Returns a snapshot id and numbered controls. Always take a new snapshot before a page action, and pass its snapshotId plus elementId to the action.",
  displayNameKey: "chat.reasoning.trace.snapshot_page",
  category: "browser",
  iconKey: "scan-search",
  risk: "low",
  cacheable: false,
  requires: ["tabs"],
  runtime: { parallelizable: false, timeoutMs: 15_000 },
  parameters: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "Target tab id. Omit only for the visible active tab."
      }
    }
  }
}

export const runSnapshotPage = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> => {
  try {
    const tab = await resolveTab(args.tabId)
    if (!tab?.id) throw new Error("No target tab is available.")
    requireAgentOrigin(ctx, tab.url)
    await readableTabOrError(tab.id, tab.url)
    const snapshot = await sendToPage<PageSnapshot>(
      tab.id,
      MESSAGE_KEYS.BROWSER.SNAPSHOT_PAGE
    )
    return {
      content: formatSnapshot(snapshot, tab.id),
      sources: [{ title: snapshot.title || "Page snapshot", url: snapshot.url }]
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true
    }
  }
}

export const openTabDefinition: ToolDefinition = {
  name: "open_tab",
  description:
    "Open one http/https URL in a new foreground tab. Returns the new tab id. Requires user approval.",
  displayNameKey: "chat.reasoning.trace.open_tab",
  category: "browser",
  iconKey: "square-arrow-out-up-right",
  risk: "medium",
  cacheable: false,
  requires: ["tabs"],
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http/https URL." }
    },
    required: ["url"]
  }
}

export const runOpenTab = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> => {
  try {
    const url = safeHttpUrl(args.url)
    const access = await classifyTabAccess(url.href)
    if (access !== "ok") throw new Error(accessDeniedMessage(access, url.host))
    const tab = await browser.tabs.create({ url: url.href, active: true })
    if (ctx.agent && tab.id !== undefined) {
      ctx.agent.targetTabId = tab.id
      allowAgentOrigin(ctx, url.origin)
    }
    return {
      content: `Opened ${url.href} in tab ${tab.id ?? "unknown"}. Take a snapshot after it loads.`,
      sources: [{ title: url.host, url: url.href }]
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true
    }
  }
}

export const navigateDefinition: ToolDefinition = {
  name: "navigate",
  description:
    "Navigate a specific browser tab to an absolute http/https URL. Requires user approval. Take a new snapshot after navigation.",
  displayNameKey: "chat.reasoning.trace.navigate",
  category: "browser",
  iconKey: "navigation",
  risk: "medium",
  cacheable: false,
  requires: ["tabs"],
  parameters: {
    type: "object",
    properties: {
      tabId: { type: "number", description: "Target tab id." },
      url: { type: "string", description: "Absolute http/https URL." }
    },
    required: ["tabId", "url"]
  }
}

export const runNavigate = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> => {
  try {
    const tab = await resolveTab(args.tabId)
    if (!tab?.id) throw new Error("Target tab does not exist.")
    requireAgentOrigin(ctx, tab.url)
    const url = safeHttpUrl(args.url)
    const access = await classifyTabAccess(url.href)
    if (access !== "ok") throw new Error(accessDeniedMessage(access, url.host))
    await browser.tabs.update(tab.id, { url: url.href, active: true })
    allowAgentOrigin(ctx, url.origin)
    return {
      content: `Navigating tab ${tab.id} to ${url.href}. Wait for the page, then take a new snapshot.`,
      sources: [{ title: url.host, url: url.href }]
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true
    }
  }
}

export const scrollDefinition: ToolDefinition = {
  name: "scroll",
  description:
    "Scroll a specific browser tab by about one viewport. Take a new snapshot afterward.",
  displayNameKey: "chat.reasoning.trace.scroll",
  category: "browser",
  iconKey: "move-vertical",
  risk: "low",
  cacheable: false,
  requires: ["tabs"],
  runtime: { parallelizable: false },
  parameters: {
    type: "object",
    properties: {
      tabId: { type: "number" },
      direction: { type: "string", enum: ["up", "down"] }
    },
    required: ["tabId", "direction"]
  }
}

export const runScroll = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> => {
  try {
    const tab = await resolveTab(args.tabId)
    if (!tab?.id) throw new Error("Target tab does not exist.")
    requireAgentOrigin(ctx, tab.url)
    await readableTabOrError(tab.id, tab.url)
    const message = await sendToPage<string>(
      tab.id,
      MESSAGE_KEYS.BROWSER.AGENT_SCROLL,
      { direction: args.direction }
    )
    return { content: `${message} Take a new snapshot.` }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true
    }
  }
}

export const findInPageDefinition: ToolDefinition = {
  name: "find_in_page",
  description:
    "Find visible text in a browser tab and scroll its first match into view.",
  displayNameKey: "chat.reasoning.trace.find_in_page",
  category: "browser",
  iconKey: "search",
  risk: "low",
  cacheable: false,
  requires: ["tabs"],
  runtime: { parallelizable: false },
  parameters: {
    type: "object",
    properties: {
      tabId: { type: "number" },
      text: { type: "string" }
    },
    required: ["tabId", "text"]
  }
}

export const runFindInPage = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> => {
  try {
    const tab = await resolveTab(args.tabId)
    if (!tab?.id) throw new Error("Target tab does not exist.")
    requireAgentOrigin(ctx, tab.url)
    await readableTabOrError(tab.id, tab.url)
    return {
      content: await sendToPage<string>(
        tab.id,
        MESSAGE_KEYS.BROWSER.AGENT_FIND_TEXT,
        { text: args.text }
      )
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true
    }
  }
}

const actionDefinition = (
  name: "click" | "type" | "select",
  description: string
): ToolDefinition => ({
  name,
  description,
  displayNameKey: `chat.reasoning.trace.${name}`,
  category: "browser",
  iconKey:
    name === "click"
      ? "mouse-pointer-click"
      : name === "type"
        ? "text-cursor-input"
        : "list-check",
  risk: "critical",
  cacheable: false,
  requires: ["tabs"],
  runtime: { parallelizable: false, timeoutMs: 15_000 },
  parameters: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "Target tab id from snapshot_page."
      },
      snapshotId: {
        type: "string",
        description: "Exact snapshot id from the latest snapshot_page."
      },
      elementId: {
        type: "number",
        description: "Numbered element id from that snapshot."
      },
      ...(name === "type"
        ? { text: { type: "string", description: "Replacement text." } }
        : {}),
      ...(name === "select"
        ? {
            value: {
              type: "string",
              description: "Exact option value or visible label."
            }
          }
        : {})
    },
    required: [
      "tabId",
      "snapshotId",
      "elementId",
      ...(name === "type" ? ["text"] : []),
      ...(name === "select" ? ["value"] : [])
    ]
  }
})

export const clickDefinition = actionDefinition(
  "click",
  "Click one numbered control from the latest page snapshot. Always requires per-call approval."
)
export const typeDefinition = actionDefinition(
  "type",
  "Replace text in one input from the latest page snapshot. Password, hidden, file, and contenteditable controls are refused. Always requires per-call approval."
)
export const selectDefinition = actionDefinition(
  "select",
  "Select an exact option in one select control from the latest page snapshot. Always requires per-call approval."
)

const runAction =
  (action: "click" | "type" | "select") =>
  async (
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> => {
    try {
      const tab = await resolveTab(args.tabId)
      if (!tab?.id || tab.id !== args.tabId) {
        throw new Error("The snapshot's target tab is unavailable.")
      }
      requireAgentOrigin(ctx, tab.url)
      await readableTabOrError(tab.id, tab.url)
      const request: AgentPageActionRequest = {
        action,
        ...targetFrom(args),
        text: typeof args.text === "string" ? args.text : undefined,
        value: typeof args.value === "string" ? args.value : undefined
      }
      const result = await sendToPage<{ message: string; url: string }>(
        tab.id,
        MESSAGE_KEYS.BROWSER.AGENT_PAGE_ACTION,
        request as unknown as Record<string, unknown>
      )
      return {
        content: `${result.message} Page changed; take a new snapshot.`,
        sources: [{ title: new URL(result.url).host, url: result.url }]
      }
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true
      }
    }
  }

export const runClick = runAction("click")
export const runType = runAction("type")
export const runSelect = runAction("select")

export const preflightAgentPageAction = async (call: {
  name: string
  arguments: Record<string, unknown>
}): Promise<{ preview: string; origin: string } | undefined> => {
  if (!["click", "type", "select"].includes(call.name)) return undefined
  const tab = await resolveTab(call.arguments.tabId)
  if (!tab?.id || tab.id !== call.arguments.tabId) {
    throw new Error("The snapshot's target tab is unavailable.")
  }
  const target = await sendToPage<{ name: string; role: string; url: string }>(
    tab.id,
    MESSAGE_KEYS.BROWSER.AGENT_HIGHLIGHT,
    {
      ...targetFrom(call.arguments)
    }
  )
  const origin = new URL(target.url).origin
  const verb =
    call.name === "click"
      ? "Click"
      : call.name === "type"
        ? "Type in"
        : "Select"
  return {
    preview: `${verb} “${target.name || target.role}” on ${new URL(target.url).host}`,
    origin
  }
}

export const originForNonElementAgentToolCall = async (call: {
  name: string
  arguments: Record<string, unknown>
}): Promise<string | undefined> => {
  if (call.name === "open_tab" || call.name === "navigate") {
    return safeHttpUrl(call.arguments.url).origin
  }
  if (["snapshot_page", "scroll", "find_in_page"].includes(call.name)) {
    const tab = await resolveTab(call.arguments.tabId)
    return tab?.url ? new URL(tab.url).origin : undefined
  }
  return undefined
}

export const isAgentBrowserTool = (name: string): boolean =>
  [
    "snapshot_page",
    "open_tab",
    "navigate",
    "scroll",
    "find_in_page",
    "click",
    "type",
    "select"
  ].includes(name)

export const isAgentPageActionTool = (name: string): boolean =>
  ["open_tab", "navigate", "scroll", "click", "type", "select"].includes(name)

export const isAgentNavigationTool = (name: string): boolean =>
  name === "open_tab" || name === "navigate"

export const isAgentElementActionTool = (name: string): boolean =>
  name === "click" || name === "type" || name === "select"

export const clearAgentPageActionHighlight = async (call: {
  name: string
  arguments: Record<string, unknown>
}): Promise<void> => {
  if (!["click", "type", "select"].includes(call.name)) return
  const tab = await resolveTab(call.arguments.tabId)
  if (!tab?.id) return
  await sendToPage(tab.id, MESSAGE_KEYS.BROWSER.AGENT_CLEAR_HIGHLIGHT).catch(
    () => undefined
  )
}
