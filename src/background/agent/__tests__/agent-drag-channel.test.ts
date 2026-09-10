import { describe, expect, it, vi } from "vitest"

import { createAgentBrowserSessionManager } from "../agent-browser-session-manager"

type Debuggee = { tabId?: number; sessionId?: string }
type EventListener = (
  source: Debuggee,
  method: string,
  params?: unknown
) => void

/**
 * The drag and file-chooser halves of the native channel. A held pointer move
 * either becomes an HTML5 drag the browser reports, after which the channel
 * speaks drag events, or stays a pointer move; a file chooser the page opens
 * is counted, never shown, and charged to the action that asks.
 */
const harness = (input: { interceptsDrag?: boolean } = {}) => {
  const commands: { method: string; params?: object }[] = []
  const listeners = new Set<EventListener>()
  const debuggerApi = {
    attach: vi.fn((_t: Debuggee, _v: string, callback: () => void) =>
      callback()
    ),
    detach: vi.fn((_t: Debuggee, callback: () => void) => callback()),
    sendCommand: vi.fn(
      (
        target: Debuggee,
        method: string,
        params: object | undefined,
        callback: (result?: unknown) => void
      ) => {
        commands.push({ method, params })
        if (method === "Page.getFrameTree") {
          callback({
            frameTree: { frame: { id: "F0", url: "https://e.com/" } }
          })
          return
        }
        callback({})
        /* The browser answers a held move that starts a drag with an event. */
        if (
          input.interceptsDrag &&
          method === "Input.dispatchMouseEvent" &&
          (params as { buttons?: number }).buttons === 1
        ) {
          for (const listener of listeners) {
            listener(target, "Input.dragIntercepted", {
              data: { items: [], dragOperationsMask: 1 }
            })
          }
        }
      }
    ),
    onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
    onEvent: {
      addListener: (listener: EventListener) => listeners.add(listener),
      removeListener: (listener: EventListener) => listeners.delete(listener)
    }
  }
  const tabs = {
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() }
  }
  const manager = createAgentBrowserSessionManager({
    debugger: debuggerApi,
    tabs,
    classifyAccess: async () => "ok",
    readLastError: () => undefined
  })
  const fire = (method: string, params?: unknown) => {
    for (const listener of listeners) listener({ tabId: 7 }, method, params)
  }
  const sent = (method: string) =>
    commands.filter((command) => command.method === method)
  return { manager, commands, sent, fire }
}

const channelOf = async (host: ReturnType<typeof harness>) => {
  await host.manager.attach("run-1", 7)
  const channel = host.manager.nativeInput("run-1", 7)
  if (!channel) throw new Error("channel missing")
  return channel
}

describe("Agent native drag channel", () => {
  it("drives an intercepted HTML5 drag with drag events and drops with the drag data", async () => {
    const host = harness({ interceptsDrag: true })
    const channel = await channelOf(host)
    await channel.dispatch({ kind: "drag", type: "move", x: 20, y: 20 })
    await channel.dispatch({ kind: "drag", type: "move", x: 40, y: 40 })
    await channel.dispatch({ kind: "drag", type: "drop", x: 60, y: 60 })
    expect(
      host.sent("Input.setInterceptDrags").map((command) => command.params)
    ).toEqual([{ enabled: true }, { enabled: false }])
    expect(
      host.sent("Input.dispatchDragEvent").map((command) => command.params)
    ).toEqual([
      expect.objectContaining({ type: "dragEnter", x: 20, y: 20 }),
      expect.objectContaining({ type: "dragOver", x: 40, y: 40 }),
      expect.objectContaining({
        type: "drop",
        x: 60,
        y: 60,
        data: { items: [], dragOperationsMask: 1 }
      })
    ])
    /* The release went into the drag, not as a mouse button. */
    expect(
      host
        .sent("Input.dispatchMouseEvent")
        .filter(
          (command) =>
            (command.params as { type: string }).type === "mouseReleased"
        )
    ).toHaveLength(0)
  })

  it("keeps a pointer-based drag as held mouse moves and a real release", async () => {
    vi.useFakeTimers()
    try {
      const host = harness()
      const channel = await channelOf(host)
      const first = channel.dispatch({
        kind: "drag",
        type: "move",
        x: 20,
        y: 20
      })
      await vi.advanceTimersByTimeAsync(200)
      await first
      await channel.dispatch({ kind: "drag", type: "move", x: 40, y: 40 })
      await channel.dispatch({ kind: "drag", type: "drop", x: 60, y: 60 })
      expect(host.sent("Input.dispatchDragEvent")).toHaveLength(0)
      expect(
        host.sent("Input.dispatchMouseEvent").map((command) => command.params)
      ).toEqual([
        expect.objectContaining({
          type: "mouseMoved",
          x: 20,
          y: 20,
          buttons: 1
        }),
        expect.objectContaining({
          type: "mouseMoved",
          x: 40,
          y: 40,
          buttons: 1
        }),
        expect.objectContaining({ type: "mouseReleased", x: 60, y: 60 })
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("cancels an intercepted drag without dropping", async () => {
    const host = harness({ interceptsDrag: true })
    const channel = await channelOf(host)
    await channel.dispatch({ kind: "drag", type: "move", x: 20, y: 20 })
    await channel.dispatch({ kind: "drag", type: "cancel", x: 20, y: 20 })
    expect(
      host
        .sent("Input.dispatchDragEvent")
        .map((command) => (command.params as { type: string }).type)
    ).toEqual(["dragEnter", "dragCancel"])
  })

  it("holds file choosers back on attach and charges one to the first action that asks", async () => {
    const host = harness()
    const channel = await channelOf(host)
    expect(
      host
        .sent("Page.setInterceptFileChooserDialog")
        .map((command) => command.params)
    ).toEqual([{ enabled: true }])
    expect(channel.consumeFileChooser()).toBe(false)
    host.fire("Page.fileChooserOpened", { frameId: "F0", mode: "selectSingle" })
    expect(channel.consumeFileChooser()).toBe(true)
    expect(channel.consumeFileChooser()).toBe(false)
  })
})
