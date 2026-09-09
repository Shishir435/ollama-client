import { browser } from "@/lib/browser-api"
import { classifyAgentTabAccess } from "@/lib/browser-tab-access"

const CDP_PROTOCOL_VERSION = "1.3"

/**
 * A debugger target as `chrome.debugger` addresses it. The tab names the root
 * session; a `sessionId` names a child session an out-of-process frame was
 * auto-attached under, which flattened mode delivers through the same events.
 */
interface Debuggee {
  tabId?: number
  sessionId?: string
}

interface DebuggerDetachEvent {
  addListener(listener: (source: Debuggee, reason: string) => void): void
  removeListener(listener: (source: Debuggee, reason: string) => void): void
}

type DebuggerEventListener = (
  source: Debuggee,
  method: string,
  params?: unknown
) => void

interface DebuggerEvent {
  addListener(listener: DebuggerEventListener): void
  removeListener(listener: DebuggerEventListener): void
}

interface DebuggerApi {
  attach(target: Debuggee, version: string, callback: () => void): void
  detach(target: Debuggee, callback: () => void): void
  sendCommand(
    target: Debuggee,
    method: string,
    params: object | undefined,
    callback: (result?: unknown) => void
  ): void
  onDetach: DebuggerDetachEvent
  onEvent?: DebuggerEvent
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
  /** Whether frame identity can be mapped onto debugger sessions here. */
  frameTracking: boolean
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

/**
 * One frame as the debugger knows it. `sessionId` is absent for frames the
 * tab's own session renders and set for an out-of-process frame that lives in
 * its own child session; a command aimed at that frame has to name it.
 */
export interface AgentCdpFrame {
  cdpFrameId: string
  parentCdpFrameId?: string
  url: string
  sessionId?: string
  targetId?: string
}

/** An extension frame as `webNavigation` reports it; the root has no parent. */
export interface AgentExtensionFrame {
  frameId: number
  parentFrameId?: number
  url: string
}

/**
 * The explicit join between an extension frame and a debugger frame. A
 * mapping is only ever exact: the root frame is the tree's root, and a child
 * is the one frame under its parent's mapping with its URL. Two siblings with
 * one URL are reported as such rather than guessed between, because a
 * command sent to the wrong frame is an effect the user never approved.
 */
export type AgentFrameMapping =
  | { mapped: true; frame: AgentCdpFrame }
  | {
      mapped: false
      reason:
        | "tracking_unavailable"
        | "not_attached"
        | "unknown_frame"
        | "parent_unmapped"
        | "no_matching_frame"
        | "ambiguous_siblings"
    }

export interface AgentCdpFrameTree {
  status: "tracking" | "unavailable"
  frames: readonly AgentCdpFrame[]
}

export interface AgentBrowserSessionManager {
  readonly capabilities: AgentBrowserCapabilities
  attach(runId: string, tabId: number): Promise<void>
  detach(runId: string): Promise<void>
  isAttached(runId: string): boolean
  attachedTabId(runId: string): number | undefined
  /** The debugger's frame tree for the run's tab, root first. */
  frames(runId: string): AgentCdpFrameTree
  /**
   * Joins one extension frame onto the debugger's tree, walking the frame's
   * ancestors through `frames` — the tab's full extension frame list — so a
   * grandchild is found under its mapped parent rather than guessed at.
   */
  mapFrame(
    runId: string,
    frameId: number,
    frames: readonly AgentExtensionFrame[]
  ): AgentFrameMapping
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
  tracking: "pending" | "tracking" | "unavailable"
  frames: Map<string, AgentCdpFrame>
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

interface CdpFrameTreeNode {
  frame: { id: string; parentId?: string; url: string }
  childFrames?: CdpFrameTreeNode[]
}

const isFrameTree = (
  value: unknown
): value is { frameTree: CdpFrameTreeNode } =>
  typeof value === "object" &&
  value !== null &&
  "frameTree" in value &&
  typeof (value as { frameTree: unknown }).frameTree === "object"

const flattenFrameTree = (
  node: CdpFrameTreeNode,
  session: { sessionId?: string; targetId?: string },
  into: AgentCdpFrame[] = []
): AgentCdpFrame[] => {
  into.push({
    cdpFrameId: node.frame.id,
    ...(node.frame.parentId ? { parentCdpFrameId: node.frame.parentId } : {}),
    url: node.frame.url,
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    ...(session.targetId ? { targetId: session.targetId } : {})
  })
  for (const child of node.childFrames ?? []) {
    flattenFrameTree(child, session, into)
  }
  return into
}

const sameUrl = (first: string, second: string): boolean => {
  try {
    return new URL(first).href === new URL(second).href
  } catch {
    return first === second
  }
}

/**
 * Owns every Chromium debugger attachment for Agent.
 *
 * Raw CDP targets never leave this adapter. A run owns at most one attached
 * tab, and a tab belongs to at most one run. Firefox gets a no-op DOM backend
 * with explicit capabilities instead of a fake debugger implementation.
 *
 * Once attached, the manager tracks the tab's frame tree: the frames the tab's
 * own renderer holds through `Page` events, and out-of-process frames through
 * the child sessions flattened auto-attach delivers. The tree is what
 * `mapFrame` joins extension frame identity onto, and a tab whose tree could
 * not be enabled stays attached with tracking reported as unavailable, so a
 * later backend asking for a frame gets a refusal rather than a guess.
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
  const frameTracking = Boolean(cdp?.onEvent)

  const capabilities: AgentBrowserCapabilities = cdp
    ? { backend: "cdp", cdpControl: true, domControl: true, frameTracking }
    : {
        backend: "dom",
        cdpControl: false,
        domControl: true,
        frameTracking: false
      }

  const emit = (event: AgentBrowserSessionInterruption) => {
    for (const listener of [...listeners]) listener(event)
  }

  const forget = (attachment: Attachment) => {
    attachment.released = true
    attachment.frames.clear()
    if (attachments.get(attachment.runId) === attachment) {
      attachments.delete(attachment.runId)
    }
    if (tabOwners.get(attachment.tabId) === attachment.runId) {
      tabOwners.delete(attachment.tabId)
    }
  }

  const send = (
    target: Debuggee,
    method: string,
    params?: object
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!cdp) {
        reject(new Error("Agent debugger is unavailable"))
        return
      }
      cdp.sendCommand(target, method, params, (result) => {
        const message = readLastError()
        if (message) {
          reject(new Error(`Agent debugger ${method} failed: ${message}`))
          return
        }
        resolve(result)
      })
    })

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

  /**
   * Reads one session's frame tree into the attachment. The root session's
   * tree is the tab; a child session's tree is the out-of-process frame it
   * renders, whose root is already a node in the parent's tree — the child's
   * record replaces that placeholder so the frame carries its session.
   */
  const readFrameTree = async (
    attachment: Attachment,
    session: { sessionId?: string; targetId?: string }
  ): Promise<void> => {
    const target: Debuggee = session.sessionId
      ? { ...attachment.target, sessionId: session.sessionId }
      : attachment.target
    const tree = await send(target, "Page.getFrameTree")
    if (attachments.get(attachment.runId) !== attachment) return
    if (!isFrameTree(tree)) throw new Error("Agent frame tree is malformed")
    for (const frame of flattenFrameTree(tree.frameTree, session)) {
      const known = attachment.frames.get(frame.cdpFrameId)
      attachment.frames.set(frame.cdpFrameId, {
        ...frame,
        ...(frame.parentCdpFrameId || !known?.parentCdpFrameId
          ? {}
          : { parentCdpFrameId: known.parentCdpFrameId })
      })
    }
  }

  const startTracking = async (attachment: Attachment): Promise<void> => {
    if (!frameTracking) {
      attachment.tracking = "unavailable"
      return
    }
    try {
      await send(attachment.target, "Page.enable")
      await send(attachment.target, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true
      })
      await readFrameTree(attachment, {})
      if (attachments.get(attachment.runId) === attachment) {
        attachment.tracking = "tracking"
      }
    } catch {
      if (attachments.get(attachment.runId) === attachment) {
        attachment.tracking = "unavailable"
        attachment.frames.clear()
      }
    }
  }

  const attachmentFor = (source: Debuggee): Attachment | undefined => {
    if (typeof source.tabId !== "number") return undefined
    const runId = tabOwners.get(source.tabId)
    if (!runId) return undefined
    const attachment = attachments.get(runId)
    return attachment?.tabId === source.tabId ? attachment : undefined
  }

  type FrameEvent = Record<string, unknown>
  type FrameEventHandler = (
    attachment: Attachment,
    source: Debuggee,
    event: FrameEvent
  ) => void

  const withSession = (source: Debuggee) =>
    source.sessionId ? { sessionId: source.sessionId } : {}

  const onFrameAttached: FrameEventHandler = (attachment, source, event) => {
    const { frameId, parentFrameId } = event
    if (typeof frameId !== "string" || typeof parentFrameId !== "string") return
    const known = attachment.frames.get(frameId)
    attachment.frames.set(frameId, {
      ...known,
      cdpFrameId: frameId,
      parentCdpFrameId: parentFrameId,
      url: known?.url ?? "about:blank",
      ...withSession(source)
    })
  }

  const onFrameNavigated: FrameEventHandler = (attachment, source, event) => {
    const frame = event.frame as
      | { id?: unknown; parentId?: unknown; url?: unknown }
      | undefined
    if (typeof frame?.id !== "string" || typeof frame.url !== "string") return
    attachment.frames.set(frame.id, {
      ...attachment.frames.get(frame.id),
      cdpFrameId: frame.id,
      url: frame.url,
      ...(typeof frame.parentId === "string"
        ? { parentCdpFrameId: frame.parentId }
        : {}),
      ...withSession(source)
    })
  }

  /** Drops a frame and every frame beneath it. */
  const removeFrameSubtree = (attachment: Attachment, rootId: string) => {
    const doomed = new Set([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const frame of attachment.frames.values()) {
        if (
          frame.parentCdpFrameId &&
          doomed.has(frame.parentCdpFrameId) &&
          !doomed.has(frame.cdpFrameId)
        ) {
          doomed.add(frame.cdpFrameId)
          grew = true
        }
      }
    }
    for (const id of doomed) attachment.frames.delete(id)
  }

  const onFrameDetached: FrameEventHandler = (attachment, _source, event) => {
    if (typeof event.frameId !== "string") return
    /*
     * A frame swapping renderers detaches from one session and attaches
     * under another; only a true removal drops it and its subtree.
     */
    if (event.reason === "swap") return
    removeFrameSubtree(attachment, event.frameId)
  }

  const onAttachedToTarget: FrameEventHandler = (
    attachment,
    _source,
    event
  ) => {
    const sessionId = event.sessionId
    const info = event.targetInfo as
      | { targetId?: unknown; type?: unknown }
      | undefined
    if (typeof sessionId !== "string" || info?.type !== "iframe") return
    const targetId =
      typeof info.targetId === "string" ? info.targetId : undefined
    const child: Debuggee = { ...attachment.target, sessionId }
    void send(child, "Page.enable")
      .then(() => readFrameTree(attachment, { sessionId, targetId }))
      .catch(() => undefined)
  }

  const onDetachedFromTarget: FrameEventHandler = (
    attachment,
    _source,
    event
  ) => {
    if (typeof event.sessionId !== "string") return
    for (const frame of [...attachment.frames.values()]) {
      if (frame.sessionId === event.sessionId) {
        attachment.frames.delete(frame.cdpFrameId)
      }
    }
  }

  const frameEventHandlers: Record<string, FrameEventHandler> = {
    "Page.frameAttached": onFrameAttached,
    "Page.frameNavigated": onFrameNavigated,
    "Page.frameDetached": onFrameDetached,
    "Target.attachedToTarget": onAttachedToTarget,
    "Target.detachedFromTarget": onDetachedFromTarget
  }

  const onDebuggerEvent: DebuggerEventListener = (source, method, params) => {
    const attachment = attachmentFor(source)
    if (!attachment || attachment.tracking !== "tracking") return
    frameEventHandlers[method]?.(
      attachment,
      source,
      (params ?? {}) as FrameEvent
    )
  }

  const onDebuggerDetach = (source: Debuggee) => {
    /* A child session leaving is a frame going away, not the tab. */
    if (source.sessionId) return
    const attachment = attachmentFor(source)
    if (!attachment || typeof source.tabId !== "number") return
    forget(attachment)
    emit({
      runId: attachment.runId,
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

  const rootFrame = (attachment: Attachment): AgentCdpFrame | undefined =>
    [...attachment.frames.values()].find((frame) => !frame.parentCdpFrameId)

  const mapExtensionFrame = (
    attachment: Attachment,
    frameId: number,
    frames: readonly AgentExtensionFrame[],
    depth = 0
  ): AgentFrameMapping => {
    if (frameId === 0) {
      const root = rootFrame(attachment)
      return root
        ? { mapped: true, frame: root }
        : { mapped: false, reason: "no_matching_frame" }
    }
    const frame = frames.find((candidate) => candidate.frameId === frameId)
    if (!frame) return { mapped: false, reason: "unknown_frame" }
    /* A parent-less non-root frame, or a cycle, is a tree the browser never reports. */
    if (frame.parentFrameId === undefined || depth > frames.length) {
      return { mapped: false, reason: "parent_unmapped" }
    }
    const parent = mapExtensionFrame(
      attachment,
      frame.parentFrameId,
      frames,
      depth + 1
    )
    if (!parent.mapped) return { mapped: false, reason: "parent_unmapped" }
    const siblings = [...attachment.frames.values()].filter(
      (candidate) =>
        candidate.parentCdpFrameId === parent.frame.cdpFrameId &&
        sameUrl(candidate.url, frame.url)
    )
    if (siblings.length === 1) return { mapped: true, frame: siblings[0] }
    return {
      mapped: false,
      reason: siblings.length === 0 ? "no_matching_frame" : "ambiguous_siblings"
    }
  }

  cdp?.onDetach.addListener(onDebuggerDetach)
  cdp?.onEvent?.addListener(onDebuggerEvent)
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
        ready: Promise.resolve(),
        tracking: "pending",
        frames: new Map()
      }
      attachment.rawAttach = cdp
        ? callDebugger(
            (callback) => cdp.attach(target, CDP_PROTOCOL_VERSION, callback),
            "attach",
            readLastError
          )
        : Promise.resolve()
      attachment.ready = attachment.rawAttach
        .then(async () => {
          if (attachment.released) throw cancelledAttach()
          attachment.attached = true
          if (cdp) await startTracking(attachment)
          if (attachment.released) throw cancelledAttach()
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
    attachedTabId(runId) {
      const attachment = attachments.get(runId)
      return attachment?.attached ? attachment.tabId : undefined
    },
    frames(runId) {
      const attachment = attachments.get(runId)
      if (!attachment || attachment.tracking !== "tracking") {
        return { status: "unavailable", frames: [] }
      }
      const root = rootFrame(attachment)
      const rest = [...attachment.frames.values()].filter(
        (frame) => frame !== root
      )
      return { status: "tracking", frames: root ? [root, ...rest] : rest }
    },
    mapFrame(runId, frameId, frames) {
      const attachment = attachments.get(runId)
      if (!attachment?.attached)
        return { mapped: false, reason: "not_attached" }
      if (attachment.tracking !== "tracking") {
        return { mapped: false, reason: "tracking_unavailable" }
      }
      return mapExtensionFrame(attachment, frameId, frames)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispose() {
      cdp?.onDetach.removeListener(onDebuggerDetach)
      cdp?.onEvent?.removeListener(onDebuggerEvent)
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
