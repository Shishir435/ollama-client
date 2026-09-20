import { describe, expect, it, vi } from "vitest"

import { createAgentBrowserSessionManager } from "../agent-browser-session-manager"

type Debuggee = { tabId?: number }
type DetachListener = (source: Debuggee, reason: string) => void
type RemovedListener = (tabId: number) => void
type UpdatedListener = (tabId: number, change: { url?: string }) => void

type EventListener = (
  source: Debuggee & { sessionId?: string },
  method: string,
  params?: unknown
) => void

type FrameTreeNode = {
  frame: { id: string; parentId?: string; url: string }
  childFrames?: FrameTreeNode[]
}

const harness = () => {
  const detachListeners = new Set<DetachListener>()
  const removedListeners = new Set<RemovedListener>()
  const updatedListeners = new Set<UpdatedListener>()
  const eventListeners = new Set<EventListener>()
  let runtimeError: string | undefined
  const frameTrees = new Map<string, FrameTreeNode>([
    ["root", { frame: { id: "F0", url: "https://example.com/" } }]
  ])
  const commands: {
    target: Debuggee & { sessionId?: string }
    method: string
    params?: object
  }[] = []

  const debuggerApi = {
    attach: vi.fn((_target: Debuggee, _version: string, callback: () => void) =>
      callback()
    ),
    detach: vi.fn((_target: Debuggee, callback: () => void) => callback()),
    sendCommand: vi.fn(
      (
        target: Debuggee & { sessionId?: string },
        method: string,
        params: object | undefined,
        callback: (result?: unknown) => void
      ) => {
        commands.push({ target, method, params })
        callback(
          method === "Page.getFrameTree"
            ? { frameTree: frameTrees.get(target.sessionId ?? "root") }
            : {}
        )
      }
    ),
    onDetach: {
      addListener: (listener: DetachListener) => detachListeners.add(listener),
      removeListener: (listener: DetachListener) =>
        detachListeners.delete(listener)
    },
    onEvent: {
      addListener: (listener: EventListener) => eventListeners.add(listener),
      removeListener: (listener: EventListener) =>
        eventListeners.delete(listener)
    }
  }
  const tabs = {
    onRemoved: {
      addListener: (listener: RemovedListener) =>
        removedListeners.add(listener),
      removeListener: (listener: RemovedListener) =>
        removedListeners.delete(listener)
    },
    onUpdated: {
      addListener: (listener: UpdatedListener) =>
        updatedListeners.add(listener),
      removeListener: (listener: UpdatedListener) =>
        updatedListeners.delete(listener)
    }
  }

  return {
    debuggerApi,
    tabs,
    commands,
    setFrameTree: (session: string, tree: FrameTreeNode) => {
      frameTrees.set(session, tree)
    },
    fireEvent: (
      source: Debuggee & { sessionId?: string },
      method: string,
      params?: unknown
    ) => {
      for (const listener of eventListeners) listener(source, method, params)
    },
    readLastError: () => runtimeError,
    setRuntimeError: (message?: string) => {
      runtimeError = message
    },
    fireDetach: (tabId: number) => {
      for (const listener of detachListeners)
        listener({ tabId }, "target_closed")
    },
    fireRemoved: (tabId: number) => {
      for (const listener of removedListeners) listener(tabId)
    },
    fireUpdated: (tabId: number, url: string) => {
      for (const listener of updatedListeners) listener(tabId, { url })
    }
  }
}

describe("Agent browser session manager", () => {
  it("reports and operates the Firefox DOM fallback without debugger access", async () => {
    const host = harness()
    const manager = createAgentBrowserSessionManager({
      debugger: null,
      tabs: host.tabs,
      classifyAccess: async () => "ok"
    })

    expect(manager.capabilities).toEqual({
      backend: "dom",
      cdpControl: false,
      domControl: true,
      frameTracking: false
    })
    await manager.attach("run-1", 7)
    expect(manager.isAttached("run-1")).toBe(true)
    host.fireRemoved(7)
    expect(manager.isAttached("run-1")).toBe(false)
    await manager.dispose()
  })

  it("leaves no debugger attachment after repeated start and stop", async () => {
    const host = harness()
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })

    for (let index = 0; index < 3; index += 1) {
      await manager.attach("run-1", 7)
      expect(manager.isAttached("run-1")).toBe(true)
      await manager.detach("run-1")
      expect(manager.isAttached("run-1")).toBe(false)
    }

    expect(host.debuggerApi.attach).toHaveBeenCalledTimes(3)
    expect(host.debuggerApi.detach).toHaveBeenCalledTimes(3)
    await manager.dispose()
  })

  it("cleans up a failed attach so the run can retry", async () => {
    const host = harness()
    host.debuggerApi.attach.mockImplementationOnce(
      (_target: Debuggee, _version: string, callback: () => void) => {
        host.setRuntimeError("another debugger is attached")
        callback()
        host.setRuntimeError()
      }
    )
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })

    await expect(manager.attach("run-1", 7)).rejects.toThrow(
      "another debugger is attached"
    )
    expect(manager.isAttached("run-1")).toBe(false)
    await expect(manager.attach("run-1", 7)).resolves.toBeUndefined()
    await manager.dispose()
  })

  it("cancels an attach in progress and detaches once it settles", async () => {
    const host = harness()
    let finishAttach: () => void = () => undefined
    host.debuggerApi.attach.mockImplementationOnce(
      (_target: Debuggee, _version: string, callback: () => void) => {
        finishAttach = callback
      }
    )
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })

    const attaching = manager.attach("run-1", 7)
    const detaching = manager.detach("run-1")
    finishAttach()

    await expect(attaching).rejects.toMatchObject({ name: "AbortError" })
    await detaching
    expect(host.debuggerApi.detach).toHaveBeenCalledTimes(1)
    expect(manager.isAttached("run-1")).toBe(false)
    await manager.dispose()
  })

  it("reports an external debugger disconnect once and clears ownership", async () => {
    const host = harness()
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })
    const interrupted = vi.fn()
    manager.subscribe(interrupted)
    await manager.attach("run-1", 7)

    host.fireDetach(7)
    host.fireDetach(7)

    expect(interrupted).toHaveBeenCalledTimes(1)
    expect(interrupted).toHaveBeenCalledWith({
      runId: "run-1",
      tabId: 7,
      reason: "debugger_disconnected"
    })
    expect(manager.isAttached("run-1")).toBe(false)
    await manager.dispose()
  })

  it("reports tab closure without trying to detach a closed target", async () => {
    const host = harness()
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })
    const interrupted = vi.fn()
    manager.subscribe(interrupted)
    await manager.attach("run-1", 7)

    host.fireRemoved(7)

    expect(interrupted).toHaveBeenCalledWith({
      runId: "run-1",
      tabId: 7,
      reason: "tab_closed"
    })
    expect(host.debuggerApi.detach).not.toHaveBeenCalled()
    await manager.dispose()
  })

  it("keeps allowed navigation and releases control for blocked navigation", async () => {
    const host = harness()
    const classifyAccess = vi.fn(async (url?: string) =>
      url?.startsWith("https://") ? ("ok" as const) : ("restricted" as const)
    )
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess,
      readLastError: host.readLastError
    })
    const interrupted = vi.fn()
    manager.subscribe(interrupted)
    await manager.attach("run-1", 7)

    host.fireUpdated(7, "https://example.com/next")
    await vi.waitFor(() => expect(classifyAccess).toHaveBeenCalledTimes(1))
    expect(manager.isAttached("run-1")).toBe(true)

    host.fireUpdated(7, "chrome://settings")
    await vi.waitFor(() => expect(manager.isAttached("run-1")).toBe(false))
    expect(interrupted).toHaveBeenCalledWith({
      runId: "run-1",
      tabId: 7,
      reason: "navigation_blocked"
    })
    expect(host.debuggerApi.detach).toHaveBeenCalledTimes(1)
    await manager.dispose()
  })

  it("releases control when navigation access cannot be classified", async () => {
    const host = harness()
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: vi.fn(async () => {
        throw new Error("settings unavailable")
      }),
      readLastError: host.readLastError
    })
    const interrupted = vi.fn()
    manager.subscribe(interrupted)
    await manager.attach("run-1", 7)

    host.fireUpdated(7, "https://example.com/next")

    await vi.waitFor(() => expect(manager.isAttached("run-1")).toBe(false))
    expect(interrupted).toHaveBeenCalledWith({
      runId: "run-1",
      tabId: 7,
      reason: "navigation_blocked"
    })
    expect(host.debuggerApi.detach).toHaveBeenCalledTimes(1)
    await manager.dispose()
  })

  it("ignores a stale blocked-navigation result after a newer safe navigation", async () => {
    const host = harness()
    let resolveOld: (access: "restricted") => void = () => undefined
    const oldResult = new Promise<"restricted">((resolve) => {
      resolveOld = resolve
    })
    const classifyAccess = vi
      .fn()
      .mockImplementationOnce(() => oldResult)
      .mockResolvedValueOnce("ok")
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess,
      readLastError: host.readLastError
    })
    const interrupted = vi.fn()
    manager.subscribe(interrupted)
    await manager.attach("run-1", 7)

    host.fireUpdated(7, "chrome://settings")
    host.fireUpdated(7, "https://example.com/safe")
    resolveOld("restricted")
    await vi.waitFor(() => expect(classifyAccess).toHaveBeenCalledTimes(2))

    expect(manager.isAttached("run-1")).toBe(true)
    expect(interrupted).not.toHaveBeenCalled()
    await manager.dispose()
  })
})

describe("Agent browser session frame tracking", () => {
  const tree: FrameTreeNode = {
    frame: { id: "F0", url: "https://example.com/" },
    childFrames: [
      { frame: { id: "F1", parentId: "F0", url: "https://example.com/one" } },
      { frame: { id: "F2", parentId: "F0", url: "https://example.com/two" } },
      { frame: { id: "F3", parentId: "F0", url: "https://example.com/two" } },
      {
        frame: { id: "F4", parentId: "F0", url: "https://widgets.example/" },
        childFrames: [
          {
            frame: {
              id: "F5",
              parentId: "F4",
              url: "https://widgets.example/inner"
            }
          }
        ]
      }
    ]
  }
  const extensionFrames = [
    { frameId: 0, url: "https://example.com/" },
    { frameId: 11, parentFrameId: 0, url: "https://example.com/one" },
    { frameId: 12, parentFrameId: 0, url: "https://example.com/two" },
    { frameId: 13, parentFrameId: 0, url: "https://example.com/two" },
    { frameId: 14, parentFrameId: 0, url: "https://widgets.example/" },
    { frameId: 15, parentFrameId: 14, url: "https://widgets.example/inner" },
    { frameId: 16, parentFrameId: 0, url: "https://example.com/none" },
    { frameId: 17, parentFrameId: 99, url: "https://example.com/orphan" }
  ]
  const attached = async (host: ReturnType<typeof harness>) => {
    host.setFrameTree("root", tree)
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })
    await manager.attach("run-1", 7)
    return manager
  }

  it("enables tracking on attach and exposes the tab's frame tree", async () => {
    const host = harness()
    const manager = await attached(host)

    expect(manager.capabilities.frameTracking).toBe(true)
    expect(host.commands.map((command) => command.method)).toEqual([
      "Page.enable",
      "Target.setAutoAttach",
      "Page.setInterceptFileChooserDialog",
      "Page.getFrameTree"
    ])
    expect(host.commands[1]?.params).toMatchObject({
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false
    })
    const frames = manager.frames("run-1")
    expect(frames.status).toBe("tracking")
    expect(frames.frames[0]).toMatchObject({ cdpFrameId: "F0" })
    expect(frames.frames).toHaveLength(6)
    await manager.dispose()
  })

  it("joins extension frames onto debugger frames only when the join is exact", async () => {
    const host = harness()
    const manager = await attached(host)
    const map = (frameId: number) =>
      manager.mapFrame("run-1", frameId, extensionFrames)

    expect(map(0)).toMatchObject({ mapped: true, frame: { cdpFrameId: "F0" } })
    expect(map(11)).toMatchObject({ mapped: true, frame: { cdpFrameId: "F1" } })
    expect(map(12)).toEqual({ mapped: false, reason: "ambiguous_siblings" })
    expect(map(15)).toMatchObject({ mapped: true, frame: { cdpFrameId: "F5" } })
    expect(map(16)).toEqual({ mapped: false, reason: "no_matching_frame" })
    expect(map(17)).toEqual({ mapped: false, reason: "parent_unmapped" })
    expect(map(42)).toEqual({ mapped: false, reason: "unknown_frame" })
    expect(manager.mapFrame("run-2", 0, extensionFrames)).toEqual({
      mapped: false,
      reason: "not_attached"
    })
    await manager.dispose()
  })

  it("follows frame navigation and removal", async () => {
    const host = harness()
    const manager = await attached(host)

    host.fireEvent({ tabId: 7 }, "Page.frameNavigated", {
      frame: { id: "F1", parentId: "F0", url: "https://example.com/moved" }
    })
    expect(
      manager.mapFrame("run-1", 11, [
        extensionFrames[0],
        { frameId: 11, parentFrameId: 0, url: "https://example.com/moved" }
      ])
    ).toMatchObject({ mapped: true, frame: { cdpFrameId: "F1" } })

    host.fireEvent({ tabId: 7 }, "Page.frameDetached", {
      frameId: "F4",
      reason: "remove"
    })
    expect(
      manager.frames("run-1").frames.map((frame) => frame.cdpFrameId)
    ).toEqual(["F0", "F1", "F2", "F3"])
    await manager.dispose()
  })

  it("adopts an out-of-process frame under its child session and drops it on detach", async () => {
    const host = harness()
    const manager = await attached(host)
    host.setFrameTree("S1", {
      frame: { id: "F4", url: "https://widgets.example/" },
      childFrames: [
        {
          frame: {
            id: "F5",
            parentId: "F4",
            url: "https://widgets.example/inner"
          }
        }
      ]
    })

    host.fireEvent({ tabId: 7 }, "Target.attachedToTarget", {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "iframe" }
    })
    await vi.waitFor(() =>
      expect(
        manager
          .frames("run-1")
          .frames.find((frame) => frame.cdpFrameId === "F4")
      ).toMatchObject({
        sessionId: "S1",
        targetId: "T1",
        parentCdpFrameId: "F0"
      })
    )
    expect(
      host.commands.filter((command) => command.target.sessionId === "S1")
    ).toHaveLength(2)

    host.fireEvent({ tabId: 7, sessionId: "S1" }, "Target.detachedFromTarget", {
      sessionId: "S1"
    })
    expect(
      manager.frames("run-1").frames.map((frame) => frame.cdpFrameId)
    ).toEqual(["F0", "F1", "F2", "F3"])
    await manager.dispose()
  })

  it("stays attached and refuses to map when tracking cannot be enabled", async () => {
    const host = harness()
    host.debuggerApi.sendCommand.mockImplementation(
      (_target, method, _params, callback) => {
        host.setRuntimeError(
          method === "Page.enable" ? "Not allowed" : undefined
        )
        callback({})
      }
    )
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })
    await manager.attach("run-1", 7)

    expect(manager.isAttached("run-1")).toBe(true)
    expect(manager.frames("run-1")).toEqual({
      status: "unavailable",
      frames: []
    })
    expect(manager.mapFrame("run-1", 0, extensionFrames)).toEqual({
      mapped: false,
      reason: "tracking_unavailable"
    })
    await manager.dispose()
  })

  it("reports no tracking on the Firefox DOM backend", async () => {
    const host = harness()
    const manager = createAgentBrowserSessionManager({
      debugger: null,
      tabs: host.tabs,
      classifyAccess: async () => "ok"
    })
    await manager.attach("run-1", 7)
    expect(manager.capabilities.frameTracking).toBe(false)
    expect(manager.attachedTabId("run-1")).toBe(7)
    expect(manager.mapFrame("run-1", 0, extensionFrames)).toEqual({
      mapped: false,
      reason: "tracking_unavailable"
    })
    await manager.dispose()
  })
})

describe("native dialogs the debugger holds", () => {
  const attached = async (host: ReturnType<typeof harness>) => {
    const manager = createAgentBrowserSessionManager({
      debugger: host.debuggerApi,
      tabs: host.tabs,
      classifyAccess: async () => "ok",
      readLastError: host.readLastError
    })
    await manager.attach("run-1", 7)
    return manager
  }

  it("records the dialog with an identity an answer can name", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "confirm",
      message: "Delete this project?",
      url: "https://example.com/"
    })
    expect(manager.openDialog("run-1", 7)).toEqual({
      id: "d1",
      type: "confirm",
      origin: "https://example.com",
      message: "Delete this project?"
    })
    await manager.dispose()
  })

  it("names the document that opened the dialog, not the tab", async () => {
    // An embedded frame's confirm blocks the whole tab. Only the event's own
    // url says whose prompt it is, and the answer is an effect on that site.
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "confirm",
      message: "Confirm your payment",
      url: "https://ads.example/frame"
    })
    expect(manager.openDialog("run-1", 7)?.origin).toBe("https://ads.example")
    await manager.dispose()
  })

  it("records a document with no origin of its own as one it cannot place", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "alert",
      message: "?",
      url: "about:blank"
    })
    expect(manager.openDialog("run-1", 7)?.origin).toBe("null")
    await manager.dispose()
  })

  it("records an unreadable url as one it cannot place", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "alert",
      message: "?"
    })
    expect(manager.openDialog("run-1", 7)?.origin).toBe("null")
    await manager.dispose()
  })

  it("keeps a prompt's default and bounds the page's own strings", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "prompt",
      message: "x".repeat(900),
      defaultPrompt: "y".repeat(900)
    })
    const dialog = manager.openDialog("run-1", 7)
    expect(dialog?.message.length).toBe(500)
    expect(dialog?.defaultPrompt?.length).toBe(500)
    await manager.dispose()
  })

  it("reports nothing for a tab this run does not hold", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "alert",
      message: "Saved"
    })
    expect(manager.openDialog("run-1", 9)).toBeUndefined()
    expect(manager.openDialog("run-2", 7)).toBeUndefined()
    await manager.dispose()
  })

  it("answers the dialog it was asked to answer", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "prompt",
      message: "New name",
      defaultPrompt: "Board"
    })
    expect(
      await manager.handleDialog("run-1", 7, {
        dialogId: "d1",
        accept: true,
        promptText: "Roadmap"
      })
    ).toBe("answered")
    expect(
      host.commands.filter(
        (entry) => entry.method === "Page.handleJavaScriptDialog"
      )
    ).toEqual([
      {
        target: { tabId: 7 },
        method: "Page.handleJavaScriptDialog",
        params: { accept: true, promptText: "Roadmap" }
      }
    ])
    expect(manager.openDialog("run-1", 7)).toBeUndefined()
    await manager.dispose()
  })

  it("answers nothing when the prompt named is not the one held", async () => {
    // A page can close one dialog and open another between the observation
    // and the answer. Answering "whatever is open" would confirm something
    // nobody read.
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "confirm",
      message: "First"
    })
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogClosing", {})
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "confirm",
      message: "Second"
    })
    expect(
      await manager.handleDialog("run-1", 7, { dialogId: "d1", accept: true })
    ).toBe("not_open")
    expect(
      host.commands.some(
        (entry) => entry.method === "Page.handleJavaScriptDialog"
      )
    ).toBe(false)
    expect(manager.openDialog("run-1", 7)?.id).toBe("d2")
    await manager.dispose()
  })

  it("keeps prompt text out of an answer to a dialog with no field", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "confirm",
      message: "Delete?"
    })
    await manager.handleDialog("run-1", 7, {
      dialogId: "d1",
      accept: true,
      promptText: "ignored"
    })
    expect(
      host.commands.find(
        (entry) => entry.method === "Page.handleJavaScriptDialog"
      )?.params
    ).toEqual({ accept: true })
    await manager.dispose()
  })

  it("answers a dialog raised in an out-of-process frame's own session", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent(
      { tabId: 7, sessionId: "child" },
      "Page.javascriptDialogOpening",
      { type: "alert", message: "Embedded" }
    )
    await manager.handleDialog("run-1", 7, { dialogId: "d1", accept: true })
    expect(
      host.commands.find(
        (entry) => entry.method === "Page.handleJavaScriptDialog"
      )?.target
    ).toEqual({ tabId: 7, sessionId: "child" })
    await manager.dispose()
  })

  it("dismisses a held dialog before letting go of the tab", async () => {
    // Detaching with one open leaves the tab frozen and nothing left that
    // could answer it. Dismissal confirms nothing and keeps a beforeunload
    // on the page.
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "beforeunload",
      message: "Changes you made"
    })
    await manager.detach("run-1")
    expect(
      host.commands.find(
        (entry) => entry.method === "Page.handleJavaScriptDialog"
      )?.params
    ).toEqual({ accept: false })
    await manager.dispose()
  })

  it("ignores a dialog kind the protocol does not name", async () => {
    const host = harness()
    const manager = await attached(host)
    host.fireEvent({ tabId: 7 }, "Page.javascriptDialogOpening", {
      type: "print",
      message: "?"
    })
    expect(manager.openDialog("run-1", 7)).toBeUndefined()
    await manager.dispose()
  })
})
