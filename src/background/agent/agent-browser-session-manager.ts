import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"

const CDP_PROTOCOL_VERSION = "1.3"

interface Debuggee {
  tabId?: number
}

interface DebuggerDetachEvent {
  addListener(listener: (source: Debuggee, reason: string) => void): void
  removeListener(listener: (source: Debuggee, reason: string) => void): void
}

interface DebuggerApi {
  attach(target: Debuggee, version: string, callback: () => void): void
  detach(target: Debuggee, callback: () => void): void
  onDetach: DebuggerDetachEvent
}

interface TabLifecycleApi {
  onRemoved: {
    addListener(listener: (tabId: number) => void): void
    removeListener(listener: (tabId: number) => void): void
  }
  onUpdated: {
    addListener(
      listener: (tabId: number, change: { url?: string }) => void
    ): void
    removeListener(
      listener: (tabId: number, change: { url?: string }) => void
    ): void
  }
}

export interface AgentBrowserCapabilities {
  backend: "cdp" | "dom"
  cdpControl: boolean
  domControl: true
}

export type AgentBrowserSessionInterruptionReason =
  | "debugger_disconnected"
  | "tab_closed"
  | "navigation_blocked"

export interface AgentBrowserSessionInterruption {
  runId: string
  tabId: number
  reason: AgentBrowserSessionInterruptionReason
}

export interface AgentBrowserSessionManager {
  readonly capabilities: AgentBrowserCapabilities
  attach(runId: string, tabId: number): Promise<void>
  detach(runId: string): Promise<void>
  isAttached(runId: string): boolean
  subscribe(
    listener: (event: AgentBrowserSessionInterruption) => void
  ): () => void
  dispose(): Promise<void>
}

interface Attachment {
  runId: string
  tabId: number
  target: Debuggee
  released: boolean
  attached: boolean
  navigationSequence: number
  rawAttach: Promise<void>
  ready: Promise<void>
}

const debuggerApi = (): DebuggerApi | undefined =>
  (
    globalThis.chrome as unknown as {
      debugger?: DebuggerApi
    }
  )?.debugger

const lastRuntimeError = (): string | undefined => {
  try {
    return globalThis.chrome?.runtime?.lastError?.message
  } catch {
    return undefined
  }
}

const callDebugger = (
  invoke: (callback: () => void) => void,
  operation: "attach" | "detach",
  readLastError: () => string | undefined
): Promise<void> =>
  new Promise((resolve, reject) => {
    invoke(() => {
      const message = readLastError()
      if (message) {
        reject(new Error(`Agent debugger ${operation} failed: ${message}`))
        return
      }
      resolve()
    })
  })

const cancelledAttach = (): DOMException =>
  new DOMException("Agent debugger attachment cancelled", "AbortError")

/**
 * Owns every Chromium debugger attachment for Agent.
 *
 * Raw CDP targets never leave this adapter. A run owns at most one attached
 * tab, and a tab belongs to at most one run. Firefox gets a no-op DOM backend
 * with explicit capabilities instead of a fake debugger implementation.
 */
export const createAgentBrowserSessionManager = (input?: {
  debugger?: DebuggerApi | null
  tabs?: TabLifecycleApi
  classifyAccess?: typeof classifyAgentTabAccess
  readLastError?: () => string | undefined
}): AgentBrowserSessionManager => {
  const cdp = input?.debugger === undefined ? debuggerApi() : input.debugger
  const tabs = input?.tabs ?? (browser.tabs as unknown as TabLifecycleApi)
  const classifyAccess = input?.classifyAccess ?? classifyAgentTabAccess
  const readLastError = input?.readLastError ?? lastRuntimeError
  const attachments = new Map<string, Attachment>()
  const tabOwners = new Map<number, string>()
  const listeners = new Set<(event: AgentBrowserSessionInterruption) => void>()

  const capabilities: AgentBrowserCapabilities = cdp
    ? { backend: "cdp", cdpControl: true, domControl: true }
    : { backend: "dom", cdpControl: false, domControl: true }

  const emit = (event: AgentBrowserSessionInterruption) => {
    for (const listener of [...listeners]) listener(event)
  }

  const forget = (attachment: Attachment) => {
    attachment.released = true
    if (attachments.get(attachment.runId) === attachment) {
      attachments.delete(attachment.runId)
    }
    if (tabOwners.get(attachment.tabId) === attachment.runId) {
      tabOwners.delete(attachment.tabId)
    }
  }

  const rawDetach = async (attachment: Attachment): Promise<void> => {
    if (!cdp) return
    try {
      await attachment.rawAttach
    } catch {
      return
    }
    await callDebugger(
      (callback) => cdp.detach(attachment.target, callback),
      "detach",
      readLastError
    )
  }

  const release = async (attachment: Attachment): Promise<void> => {
    forget(attachment)
    await rawDetach(attachment)
  }

  const onDebuggerDetach = (source: Debuggee) => {
    if (typeof source.tabId !== "number") return
    const runId = tabOwners.get(source.tabId)
    if (!runId) return
    const attachment = attachments.get(runId)
    if (!attachment || attachment.tabId !== source.tabId) return
    forget(attachment)
    emit({
      runId,
      tabId: source.tabId,
      reason: "debugger_disconnected"
    })
  }

  const onTabRemoved = (tabId: number) => {
    const runId = tabOwners.get(tabId)
    if (!runId) return
    const attachment = attachments.get(runId)
    if (!attachment) return
    forget(attachment)
    emit({ runId, tabId, reason: "tab_closed" })
  }

  /**
   * A page whose access cannot be decided is a page the run may not keep.
   * The classifier reads the user's exclusion settings, and a read that fails
   * says nothing about the address — so the answer is the one that releases
   * the debugger, not the one that keeps driving a page nobody authorized.
   */
  const classifyNavigation = async (
    url: string
  ): Promise<Awaited<ReturnType<typeof classifyAccess>>> => {
    try {
      return await classifyAccess(url)
    } catch {
      return "restricted"
    }
  }

  const onTabUpdated = (tabId: number, change: { url?: string }) => {
    if (!change.url) return
    const runId = tabOwners.get(tabId)
    if (!runId) return
    const attachment = attachments.get(runId)
    if (!attachment) return
    attachment.navigationSequence += 1
    const navigationSequence = attachment.navigationSequence
    void classifyNavigation(change.url).then(async (access) => {
      if (
        access === "ok" ||
        attachments.get(runId) !== attachment ||
        attachment.navigationSequence !== navigationSequence
      ) {
        return
      }
      forget(attachment)
      emit({ runId, tabId, reason: "navigation_blocked" })
      await rawDetach(attachment).catch(() => undefined)
    })
  }

  cdp?.onDetach.addListener(onDebuggerDetach)
  tabs.onRemoved.addListener(onTabRemoved)
  tabs.onUpdated.addListener(onTabUpdated)

  return {
    capabilities,
    async attach(runId, tabId) {
      const existing = attachments.get(runId)
      if (existing) {
        if (existing.tabId !== tabId) {
          throw new Error("Agent run is already attached to another tab")
        }
        await existing.ready
        return
      }
      if (tabOwners.has(tabId)) {
        throw new Error("Agent tab is already attached to another run")
      }

      const target = { tabId }
      const attachment: Attachment = {
        runId,
        tabId,
        target,
        released: false,
        attached: false,
        navigationSequence: 0,
        rawAttach: Promise.resolve(),
        ready: Promise.resolve()
      }
      attachment.rawAttach = cdp
        ? callDebugger(
            (callback) => cdp.attach(target, CDP_PROTOCOL_VERSION, callback),
            "attach",
            readLastError
          )
        : Promise.resolve()
      attachment.ready = attachment.rawAttach
        .then(() => {
          if (attachment.released) throw cancelledAttach()
          attachment.attached = true
        })
        .catch((error) => {
          forget(attachment)
          throw error
        })
      attachments.set(runId, attachment)
      tabOwners.set(tabId, runId)
      await attachment.ready
    },
    async detach(runId) {
      const attachment = attachments.get(runId)
      if (!attachment) return
      await release(attachment)
    },
    isAttached(runId) {
      return attachments.get(runId)?.attached === true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose() {
      cdp?.onDetach.removeListener(onDebuggerDetach)
      tabs.onRemoved.removeListener(onTabRemoved)
      tabs.onUpdated.removeListener(onTabUpdated)
      const pending = [...attachments.values()].map((attachment) =>
        release(attachment).catch(() => undefined)
      )
      listeners.clear()
      await Promise.all(pending)
    }
  }
}
