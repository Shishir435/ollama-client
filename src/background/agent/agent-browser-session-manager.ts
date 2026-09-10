import type { AgentNativeInputStep } from "@/lib/browser-agent/native-input"
import type { AgentRawCapture } from "@/lib/browser-agent/screenshot-capture"
import type { AgentCaptureLayout } from "@/lib/browser-agent/screenshot-geometry"
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

/**
 * The typed surface native input reaches the debugger through. Steps are the
 * planner's own vocabulary — a mouse move, a key down, text to insert — and
 * are translated to protocol messages here, so nothing above this file names
 * a CDP method or holds a target. A frame's offset is read from the tracked
 * tree the same way, and nothing else about the page is exposed.
 */
export interface AgentNativeInputChannel {
  dispatch(step: AgentNativeInputStep): Promise<void>
  /**
   * Where an extension frame's viewport origin sits in the root viewport, in
   * CSS pixels, or nothing when the frame cannot be placed exactly. The root
   * frame is at the origin.
   */
  frameOffset(
    frameId: number,
    frames: readonly AgentExtensionFrame[]
  ): Promise<{ x: number; y: number } | undefined>
  /** The root layout viewport's centre, for input that targets no element. */
  viewportCentre(): Promise<{ x: number; y: number } | undefined>
  /**
   * A JPEG of the visual viewport, or of a CSS clip at the given image scale,
   * with the layout metrics it was taken under. `undefined` when the tab
   * cannot be pictured.
   */
  captureScreenshot(clip?: {
    rect: { x: number; y: number; width: number; height: number }
    scale: number
  }): Promise<AgentRawCapture | undefined>
  /**
   * Opens the file-chooser window for one action. Every chooser the page
   * raises before this is discarded, so a dialog opened between actions — or
   * during a `select` or `check` that never reads it — cannot be charged to a
   * later, unrelated action. Called once immediately before the action acts.
   */
  beginFileChooserWindow(): void
  /**
   * Whether the page asked the browser for a file chooser since
   * `beginFileChooserWindow`. The dialog itself was held back — the run cannot
   * answer it and the user must — so the step that opened it is left for the
   * user. Reading clears the window.
   */
  consumeFileChooser(): boolean
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
  /**
   * The native input channel for the run's attached tab, or nothing when the
   * run does not hold that tab's debugger. Asked immediately before an action
   * and used for that action alone.
   */
  nativeInput(runId: string, tabId: number): AgentNativeInputChannel | undefined
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
  /** Sessions whose `DOM` domain has been enabled for box-model reads. */
  domEnabled: Set<string>
  /**
   * An HTML5 drag the browser started from a held pointer move, intercepted
   * so it can be driven by protocol: the drag data travels with every later
   * move and the drop. `intercepting` is set while the browser is being asked
   * whether a held move starts one; `waiter` receives the answer.
   */
  drag?: { data: unknown }
  intercepting: boolean
  dragWaiter?: (data: unknown) => void
  /** File choosers the page opened and the debugger held back, not yet charged. */
  fileChoosers: number
}

/**
 * How long a held pointer move is given to turn into an HTML5 drag before the
 * move is taken as a plain pointer move. The browser answers within the same
 * input task when it does start one; the wait is for the event to arrive.
 */
const DRAG_INTERCEPT_WAIT_MS = 150

/** CDP `Input` mouse button and event names for the planner's steps. */
const MOUSE_EVENT_TYPES = {
  mouseMoved: "mouseMoved",
  mousePressed: "mousePressed",
  mouseReleased: "mouseReleased"
} as const

const isBoxModel = (
  value: unknown
): value is { model: { content: number[] } } =>
  typeof value === "object" &&
  value !== null &&
  "model" in value &&
  Array.isArray((value as { model?: { content?: unknown } }).model?.content)

const isFrameOwner = (value: unknown): value is { backendNodeId: number } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { backendNodeId?: unknown }).backendNodeId === "number"

const isLayoutMetrics = (
  value: unknown
): value is {
  cssLayoutViewport: { clientWidth: number; clientHeight: number }
} => {
  const viewport = (value as { cssLayoutViewport?: unknown } | null)
    ?.cssLayoutViewport as { clientWidth?: unknown; clientHeight?: unknown }
  return (
    typeof viewport?.clientWidth === "number" &&
    typeof viewport.clientHeight === "number"
  )
}

const isViewportRecord = (value: unknown): value is Record<string, number> =>
  typeof value === "object" &&
  value !== null &&
  ["pageX", "pageY", "clientWidth", "clientHeight"].every(
    (key) => typeof (value as Record<string, unknown>)[key] === "number"
  )

/** Both viewports, or nothing when the metrics are not the shape expected. */
const captureLayoutOf = (value: unknown): AgentCaptureLayout | undefined => {
  const record = value as {
    cssLayoutViewport?: unknown
    cssVisualViewport?: unknown
  } | null
  const layout = record?.cssLayoutViewport
  const visual = record?.cssVisualViewport
  if (!isViewportRecord(layout) || !isViewportRecord(visual)) return undefined
  return {
    cssLayoutViewport: {
      pageX: layout.pageX,
      pageY: layout.pageY,
      clientWidth: layout.clientWidth,
      clientHeight: layout.clientHeight
    },
    cssVisualViewport: {
      pageX: visual.pageX,
      pageY: visual.pageY,
      clientWidth: visual.clientWidth,
      clientHeight: visual.clientHeight,
      scale: typeof visual.scale === "number" ? visual.scale : 1
    }
  }
}

const isScreenshot = (value: unknown): value is { data: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { data?: unknown }).data === "string" &&
  (value as { data: string }).data.length > 0

const SCREENSHOT_JPEG_QUALITY = 80

/**
 * A key with text is a `keyDown`, which Chromium turns into a character; one
 * without is a `rawKeyDown`, which produces no character even for a printable
 * key — how a modifier chord avoids also typing its letter.
 */
const keyEventParams = (
  step: Extract<AgentNativeInputStep, { kind: "key" }>
): object => ({
  type: step.type === "keyUp" ? "keyUp" : step.text ? "keyDown" : "rawKeyDown",
  key: step.key,
  modifiers: step.modifiers,
  ...(step.code ? { code: step.code } : {}),
  ...(step.keyCode !== undefined
    ? {
        windowsVirtualKeyCode: step.keyCode,
        nativeVirtualKeyCode: step.keyCode
      }
    : {}),
  ...(step.text ? { text: step.text, unmodifiedText: step.text } : {}),
  ...(step.location !== undefined ? { location: step.location } : {}),
  ...(step.commands?.length ? { commands: [...step.commands] } : {})
})

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
      /**
       * A file chooser the page opens while the run drives the tab is held
       * back and reported rather than shown: the run cannot choose a file and
       * a dialog left open would block the page under it. Detaching the
       * debugger — which every takeover does — lets the user's own click open
       * the chooser normally.
       */
      await send(attachment.target, "Page.setInterceptFileChooserDialog", {
        enabled: true
      }).catch(() => undefined)
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
    if (!attachment) return
    if (method === "Input.dragIntercepted") {
      const data = (params as { data?: unknown } | undefined)?.data
      if (attachment.intercepting && data !== undefined) {
        attachment.drag = { data }
        attachment.dragWaiter?.(data)
      }
      return
    }
    if (method === "Page.fileChooserOpened") {
      attachment.fileChoosers += 1
      return
    }
    if (attachment.tracking !== "tracking") return
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

  const sessionTarget = (attachment: Attachment, sessionId?: string) =>
    sessionId ? { ...attachment.target, sessionId } : attachment.target

  const ensureDom = async (attachment: Attachment, sessionId?: string) => {
    const key = sessionId ?? ""
    if (attachment.domEnabled.has(key)) return
    await send(sessionTarget(attachment, sessionId), "DOM.enable")
    attachment.domEnabled.add(key)
  }

  /**
   * The top of a frame's session: the frame itself when its parent renders in
   * another session, else the same for its parent. A box model read in a
   * session is reported in that session's top frame's viewport, so a frame's
   * offset is its owner's box plus the offset of the top of the session that
   * owner renders in — one hop per session, not one per frame.
   */
  const sessionTop = (
    attachment: Attachment,
    frame: AgentCdpFrame
  ): AgentCdpFrame => {
    let current = frame
    for (;;) {
      const parent = current.parentCdpFrameId
        ? attachment.frames.get(current.parentCdpFrameId)
        : undefined
      if (!parent || parent.sessionId !== current.sessionId) return current
      current = parent
    }
  }

  const ownerOffset = async (
    attachment: Attachment,
    frame: AgentCdpFrame,
    parent: AgentCdpFrame
  ): Promise<{ x: number; y: number } | undefined> => {
    await ensureDom(attachment, parent.sessionId)
    const target = sessionTarget(attachment, parent.sessionId)
    const owner = await send(target, "DOM.getFrameOwner", {
      frameId: frame.cdpFrameId
    })
    if (!isFrameOwner(owner)) return undefined
    const box = await send(target, "DOM.getBoxModel", {
      backendNodeId: owner.backendNodeId
    })
    if (!isBoxModel(box) || box.model.content.length < 2) return undefined
    const [x, y] = box.model.content
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
  }

  const frameOffsetOf = async (
    attachment: Attachment,
    mapping: AgentFrameMapping
  ): Promise<{ x: number; y: number } | undefined> => {
    if (!mapping.mapped) return undefined
    const offset = { x: 0, y: 0 }
    let current = mapping.frame
    /* Bounded by the tree's own size: a cycle is a tree the browser never reports. */
    for (let depth = 0; depth <= attachment.frames.size; depth += 1) {
      if (!current.parentCdpFrameId) return offset
      const parent = attachment.frames.get(current.parentCdpFrameId)
      if (!parent) return undefined
      const owner = await ownerOffset(attachment, current, parent)
      if (!owner) return undefined
      offset.x += owner.x
      offset.y += owner.y
      current = sessionTop(attachment, parent)
    }
    return undefined
  }

  const heldMouse = (
    type: "mouseMoved" | "mouseReleased",
    x: number,
    y: number
  ) =>
    ({
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseMoved" ? 1 : 0,
      clickCount: 1,
      modifiers: 0
    }) as const

  /**
   * The first held move asks the browser whether it starts an HTML5 drag:
   * interception is switched on around the move, and an `Input.dragIntercepted`
   * arriving within the wait means the page's `dragstart` ran and the browser
   * now expects the drag to be driven by protocol. Without one, the move was a
   * plain pointer move — what a pointer-based library reads — and later moves
   * stay plain.
   */
  const dragMove = async (
    attachment: Attachment,
    step: Extract<AgentNativeInputStep, { kind: "drag" }>
  ): Promise<void> => {
    if (attachment.drag) {
      await send(attachment.target, "Input.dispatchDragEvent", {
        type: "dragOver",
        x: step.x,
        y: step.y,
        data: attachment.drag.data
      })
      return
    }
    if (attachment.intercepting) {
      await send(
        attachment.target,
        "Input.dispatchMouseEvent",
        heldMouse("mouseMoved", step.x, step.y)
      )
      return
    }
    attachment.intercepting = true
    const intercepted = new Promise<unknown | undefined>((resolve) => {
      attachment.dragWaiter = resolve
      setTimeout(() => resolve(undefined), DRAG_INTERCEPT_WAIT_MS)
    })
    try {
      await send(attachment.target, "Input.setInterceptDrags", {
        enabled: true
      })
      await send(
        attachment.target,
        "Input.dispatchMouseEvent",
        heldMouse("mouseMoved", step.x, step.y)
      )
      const data = await intercepted
      await send(attachment.target, "Input.setInterceptDrags", {
        enabled: false
      }).catch(() => undefined)
      if (data !== undefined) {
        attachment.drag = { data }
        await send(attachment.target, "Input.dispatchDragEvent", {
          type: "dragEnter",
          x: step.x,
          y: step.y,
          data
        })
      }
    } finally {
      attachment.dragWaiter = undefined
    }
  }

  /** A drop releases into the drag if one started, else the button; a cancel never drops. */
  const dragEnd = async (
    attachment: Attachment,
    step: Extract<AgentNativeInputStep, { kind: "drag" }>
  ): Promise<void> => {
    const drag = attachment.drag
    attachment.drag = undefined
    attachment.intercepting = false
    if (drag) {
      await send(attachment.target, "Input.dispatchDragEvent", {
        type: step.type === "drop" ? "drop" : "dragCancel",
        x: step.x,
        y: step.y,
        data: drag.data
      })
      return
    }
    await send(
      attachment.target,
      "Input.dispatchMouseEvent",
      heldMouse("mouseReleased", step.x, step.y)
    )
  }

  const dispatchStep = async (
    attachment: Attachment,
    step: AgentNativeInputStep
  ): Promise<void> => {
    switch (step.kind) {
      case "drag":
        if (step.type === "move") await dragMove(attachment, step)
        else await dragEnd(attachment, step)
        return
      case "mouse":
        await send(attachment.target, "Input.dispatchMouseEvent", {
          type: MOUSE_EVENT_TYPES[step.type],
          x: step.x,
          y: step.y,
          button: step.button,
          clickCount: step.clickCount,
          modifiers: step.modifiers,
          ...(step.type === "mousePressed" ? { buttons: 1 } : {})
        })
        return
      case "wheel":
        await send(attachment.target, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: step.x,
          y: step.y,
          deltaX: step.deltaX,
          deltaY: step.deltaY
        })
        return
      case "insertText":
        await send(attachment.target, "Input.insertText", { text: step.text })
        return
      case "key":
        await send(
          attachment.target,
          "Input.dispatchKeyEvent",
          keyEventParams(step)
        )
        return
    }
  }

  const channelFor = (attachment: Attachment): AgentNativeInputChannel => ({
    dispatch: (step) => {
      if (attachments.get(attachment.runId) !== attachment) {
        return Promise.reject(new Error("Agent debugger is no longer attached"))
      }
      return dispatchStep(attachment, step)
    },
    async frameOffset(frameId, frames) {
      if (attachments.get(attachment.runId) !== attachment) return undefined
      if (frameId === 0) return { x: 0, y: 0 }
      if (attachment.tracking !== "tracking") return undefined
      return frameOffsetOf(
        attachment,
        mapExtensionFrame(attachment, frameId, frames)
      )
    },
    async viewportCentre() {
      if (attachments.get(attachment.runId) !== attachment) return undefined
      const metrics = await send(attachment.target, "Page.getLayoutMetrics")
      if (!isLayoutMetrics(metrics)) return undefined
      return {
        x: metrics.cssLayoutViewport.clientWidth / 2,
        y: metrics.cssLayoutViewport.clientHeight / 2
      }
    },
    async captureScreenshot(clip) {
      if (attachments.get(attachment.runId) !== attachment) return undefined
      const layout = captureLayoutOf(
        await send(attachment.target, "Page.getLayoutMetrics")
      )
      if (!layout) return undefined
      /**
       * A clip's `scale` is the image scale the pipeline wants per CSS pixel;
       * the protocol's own scale multiplies the device ratio, which the
       * pipeline measured from the unclipped capture and folded in here.
       */
      const shot = await send(attachment.target, "Page.captureScreenshot", {
        format: "jpeg",
        quality: SCREENSHOT_JPEG_QUALITY,
        captureBeyondViewport: false,
        ...(clip
          ? {
              clip: {
                x: clip.rect.x,
                y: clip.rect.y,
                width: clip.rect.width,
                height: clip.rect.height,
                scale: clip.scale
              }
            }
          : {})
      })
      if (!isScreenshot(shot)) return undefined
      return { data: shot.data, mimeType: "image/jpeg", layout }
    },
    beginFileChooserWindow() {
      if (attachments.get(attachment.runId) !== attachment) return
      attachment.fileChoosers = 0
    },
    consumeFileChooser() {
      if (attachments.get(attachment.runId) !== attachment) return false
      const opened = attachment.fileChoosers > 0
      attachment.fileChoosers = 0
      return opened
    }
  })

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
        frames: new Map(),
        domEnabled: new Set(),
        intercepting: false,
        fileChoosers: 0
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
    nativeInput(runId, tabId) {
      if (!cdp) return undefined
      const attachment = attachments.get(runId)
      if (!attachment?.attached || attachment.tabId !== tabId) return undefined
      return channelFor(attachment)
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
