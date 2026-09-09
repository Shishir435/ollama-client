import { describe, expect, it, vi } from "vitest"

import { createAgentBrowserSessionManager } from "../agent-browser-session-manager"

type Debuggee = { tabId?: number }
type DetachListener = (source: Debuggee, reason: string) => void
type RemovedListener = (tabId: number) => void
type UpdatedListener = (tabId: number, change: { url?: string }) => void

const harness = () => {
  const detachListeners = new Set<DetachListener>()
  const removedListeners = new Set<RemovedListener>()
  const updatedListeners = new Set<UpdatedListener>()
  let runtimeError: string | undefined

  const debuggerApi = {
    attach: vi.fn((_target: Debuggee, _version: string, callback: () => void) =>
      callback()
    ),
    detach: vi.fn((_target: Debuggee, callback: () => void) => callback()),
    onDetach: {
      addListener: (listener: DetachListener) => detachListeners.add(listener),
      removeListener: (listener: DetachListener) =>
        detachListeners.delete(listener)
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
      domControl: true
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
