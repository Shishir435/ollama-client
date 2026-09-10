import { describe, expect, it, vi } from "vitest"

import { createAgentBrowserSessionManager } from "../agent-browser-session-manager"

type Debuggee = { tabId?: number; sessionId?: string }

type FrameTreeNode = {
  frame: { id: string; parentId?: string; url: string }
  childFrames?: FrameTreeNode[]
}

/**
 * A debugger whose answers are scripted per method. The channel is the only
 * thing under test here, so attachment and frame tracking are given a tree
 * and the box models the channel should sum.
 */
const harness = (input: {
  trees?: Record<string, FrameTreeNode>
  boxes?: Record<string, number[]>
  owners?: Record<string, number>
}) => {
  const commands: { target: Debuggee; method: string; params?: object }[] = []
  const trees = input.trees ?? {
    root: { frame: { id: "F0", url: "https://example.com/" } }
  }
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
        commands.push({ target, method, params })
        switch (method) {
          case "Page.getFrameTree":
            callback({ frameTree: trees[target.sessionId ?? "root"] })
            return
          case "DOM.getFrameOwner": {
            const frameId = (params as { frameId: string }).frameId
            callback({ backendNodeId: input.owners?.[frameId] ?? 1 })
            return
          }
          case "DOM.getBoxModel": {
            const id = (params as { backendNodeId: number }).backendNodeId
            callback({
              model: { content: input.boxes?.[String(id)] ?? [0, 0] }
            })
            return
          }
          case "Page.getLayoutMetrics":
            callback({
              cssLayoutViewport: { clientWidth: 800, clientHeight: 600 }
            })
            return
          default:
            callback({})
        }
      }
    ),
    onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
    onEvent: { addListener: vi.fn(), removeListener: vi.fn() }
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
  const sent = (method: string) =>
    commands.filter((command) => command.method === method)
  return { manager, commands, sent }
}

describe("Agent native input channel", () => {
  it("is absent without an attachment and for a tab the run does not hold", async () => {
    const { manager } = harness({})
    expect(manager.nativeInput("run-1", 7)).toBeUndefined()
    await manager.attach("run-1", 7)
    expect(manager.nativeInput("run-1", 8)).toBeUndefined()
    expect(manager.nativeInput("run-1", 7)).toBeDefined()
    await manager.detach("run-1")
    expect(manager.nativeInput("run-1", 7)).toBeUndefined()
  })

  it("translates mouse, key, text and wheel steps to Input commands on the tab target", async () => {
    const { manager, sent } = harness({})
    await manager.attach("run-1", 7)
    const channel = manager.nativeInput("run-1", 7)
    if (!channel) throw new Error("channel missing")
    await channel.dispatch({
      kind: "mouse",
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
      modifiers: 0
    })
    await channel.dispatch({
      kind: "key",
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      modifiers: 8
    })
    await channel.dispatch({
      kind: "key",
      type: "keyDown",
      key: "a",
      code: "KeyA",
      keyCode: 65,
      text: "a",
      modifiers: 0,
      commands: ["selectAll"]
    })
    await channel.dispatch({ kind: "insertText", text: "é" })
    await channel.dispatch({ kind: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 80 })

    const mouse = sent("Input.dispatchMouseEvent")
    expect(mouse[0]).toEqual({
      target: { tabId: 7 },
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mousePressed",
        x: 10,
        y: 20,
        button: "left",
        clickCount: 1,
        modifiers: 0,
        buttons: 1
      }
    })
    expect(mouse[1]?.params).toMatchObject({ type: "mouseWheel", deltaY: 80 })
    const keys = sent("Input.dispatchKeyEvent")
    /* A key without text is a rawKeyDown, so a chord never also types its letter. */
    expect(keys[0]?.params).toMatchObject({
      type: "rawKeyDown",
      key: "Tab",
      windowsVirtualKeyCode: 9,
      modifiers: 8
    })
    expect(keys[1]?.params).toMatchObject({
      type: "keyDown",
      text: "a",
      unmodifiedText: "a",
      commands: ["selectAll"]
    })
    expect(sent("Input.insertText")[0]?.params).toEqual({ text: "é" })
  })

  it("refuses to dispatch through a channel whose attachment was released", async () => {
    const { manager } = harness({})
    await manager.attach("run-1", 7)
    const channel = manager.nativeInput("run-1", 7)
    await manager.detach("run-1")
    await expect(
      channel?.dispatch({ kind: "insertText", text: "x" })
    ).rejects.toThrow(/no longer attached/)
  })

  it("places the root frame at the origin and an out-of-process child by its owner's box in the parent session", async () => {
    const { manager, sent } = harness({
      trees: {
        root: {
          frame: { id: "F0", url: "https://example.com/" },
          childFrames: [
            {
              frame: { id: "F1", parentId: "F0", url: "https://embed.example/" }
            }
          ]
        },
        "session-1": {
          frame: { id: "F1", parentId: "F0", url: "https://embed.example/" },
          childFrames: [
            {
              frame: {
                id: "F2",
                parentId: "F1",
                url: "https://embed.example/inner"
              }
            }
          ]
        }
      },
      owners: { F1: 11, F2: 22 },
      boxes: { "11": [100, 50, 400, 50, 400, 250, 100, 250], "22": [10, 5] }
    })
    await manager.attach("run-1", 7)
    const channel = manager.nativeInput("run-1", 7)
    if (!channel) throw new Error("channel missing")
    expect(await channel.frameOffset(0, [])).toEqual({ x: 0, y: 0 })
    const frames = [
      { frameId: 0, url: "https://example.com/" },
      { frameId: 5, parentFrameId: 0, url: "https://embed.example/" }
    ]
    expect(await channel.frameOffset(5, frames)).toEqual({ x: 100, y: 50 })
    expect(sent("DOM.getFrameOwner")[0]).toMatchObject({
      target: { tabId: 7 },
      params: { frameId: "F1" }
    })
    expect(sent("DOM.enable")).toHaveLength(1)
    /* An unknown or ambiguous frame is not placed. */
    expect(await channel.frameOffset(9, frames)).toBeUndefined()
    expect(await channel.viewportCentre()).toEqual({ x: 400, y: 300 })
  })

  it("sums a same-process grandchild once per session rather than once per frame", async () => {
    const { manager } = harness({
      trees: {
        root: {
          frame: { id: "F0", url: "https://example.com/" },
          childFrames: [
            {
              frame: { id: "F1", parentId: "F0", url: "https://example.com/a" },
              childFrames: [
                {
                  frame: {
                    id: "F2",
                    parentId: "F1",
                    url: "https://example.com/b"
                  }
                }
              ]
            }
          ]
        }
      },
      owners: { F1: 11, F2: 22 },
      boxes: { "11": [100, 50], "22": [130, 70] }
    })
    await manager.attach("run-1", 7)
    const channel = manager.nativeInput("run-1", 7)
    const frames = [
      { frameId: 0, url: "https://example.com/" },
      { frameId: 5, parentFrameId: 0, url: "https://example.com/a" },
      { frameId: 6, parentFrameId: 5, url: "https://example.com/b" }
    ]
    /*
     * Both owners render in the root session, whose box models are already in
     * root-viewport coordinates: the grandchild's own owner box is the answer.
     */
    expect(await channel?.frameOffset(6, frames)).toEqual({ x: 130, y: 70 })
  })
})
