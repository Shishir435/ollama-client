import { AgentControlFailedError } from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import type { AgentControlSession } from "@/lib/browser-agent/control-port"
import { createAgentControlSessionRegistry } from "../agent-control-sessions"

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/start",
  origin: "https://example.com",
  title: "Example",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/start",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [],
  visibleText: "Initial content",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 200
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const session = (
  overrides: Partial<AgentControlSession> = {}
): AgentControlSession => ({
  frameId: 0,
  observe: vi.fn(async () => observation()),
  executeDomMutation: vi.fn(async () => undefined),
  executeScroll: vi.fn(async () => undefined),
  prepareNativeInput: vi.fn(async () => ({
    point: { x: 10, y: 10 },
    focused: false
  })),
  settleNativeInput: vi.fn(async () => undefined),
  sensitiveRegions: vi.fn(async () => null),
  hitTest: vi.fn(async () => null),
  disconnect: vi.fn(),
  ...overrides
})

const mutationInstruction = () =>
  ({
    command: {
      type: "click",
      ref: "e1",
      snapshotId: "snapshot-1",
      generation: 1
    },
    target: {
      ref: "e1",
      frameId: 0,
      tag: "button",
      sensitive: false,
      maySubmit: false
    },
    snapshotIdentity: {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 7,
      frameId: 0,
      documentId: "document-1"
    },
    frame: {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 7,
      frameId: 0,
      documentId: "document-1"
    }
  }) as Parameters<
    ReturnType<typeof createAgentControlSessionRegistry>["executeDomMutation"]
  >[0]["instruction"]

describe("Agent control session registry", () => {
  it("reuses one session per run and tab", async () => {
    const open = vi.fn(async () => session())
    const registry = createAgentControlSessionRegistry({ open })

    await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins: ["https://example.com"]
    })
    await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins: ["https://example.com"]
    })

    expect(open).toHaveBeenCalledOnce()
  })

  it("reopens once when the bound document is gone", async () => {
    const dead = session({
      observe: vi.fn(async () => {
        throw new Error("Agent control port closed")
      })
    })
    const live = session({
      observe: vi.fn(async () => observation({ documentId: "document-2" }))
    })
    const open = vi
      .fn<() => Promise<AgentControlSession>>()
      .mockResolvedValueOnce(dead)
      .mockResolvedValueOnce(live)
    const registry = createAgentControlSessionRegistry({ open })

    const observed = await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins: ["https://example.com"]
    })

    expect(observed.documentId).toBe("document-2")
    expect(open).toHaveBeenCalledTimes(2)
    expect(dead.disconnect).toHaveBeenCalledOnce()
  })

  it("gives up rather than reopening a second time", async () => {
    const failing = () =>
      session({
        observe: vi.fn(async () => {
          throw new Error("Agent control port closed")
        })
      })
    const open = vi.fn(async () => failing())
    const registry = createAgentControlSessionRegistry({ open })

    await expect(
      registry.observe({
        runId: "run-1",
        tabId: 7,
        minimumGeneration: 0,
        allowedOrigins: ["https://example.com"]
      })
    ).rejects.toThrow("closed")
    expect(open).toHaveBeenCalledTimes(2)
  })

  it("does not reopen for an observation the caller cancelled", async () => {
    const controller = new AbortController()
    const cancelled = session({
      observe: vi.fn(async () => {
        controller.abort()
        throw new Error("Agent control request cancelled")
      })
    })
    const open = vi.fn(async () => cancelled)
    const registry = createAgentControlSessionRegistry({ open })

    await expect(
      registry.observe(
        {
          runId: "run-1",
          tabId: 7,
          minimumGeneration: 0,
          allowedOrigins: ["https://example.com"]
        },
        controller.signal
      )
    ).rejects.toThrow("cancelled")
    expect(open).toHaveBeenCalledOnce()
  })

  it("does not reopen for a failure the page already answered", async () => {
    const answered = session({
      observe: vi.fn(async () => {
        throw new AgentControlFailedError({
          reason: "observation_invalid",
          issues: [{ path: "elements.0.editable", code: "invalid_type" }]
        })
      })
    })
    const open = vi.fn(async () => answered)
    const registry = createAgentControlSessionRegistry({ open })

    await expect(
      registry.observe({
        runId: "run-1",
        tabId: 7,
        minimumGeneration: 0,
        allowedOrigins: ["https://example.com"]
      })
    ).rejects.toMatchObject({ reason: "observation_invalid" })
    expect(open).toHaveBeenCalledOnce()
    expect(answered.observe).toHaveBeenCalledOnce()
    expect(answered.disconnect).toHaveBeenCalledOnce()
  })

  it("never repeats a mutation whose port died", async () => {
    const executeDomMutation = vi.fn(async () => {
      throw new Error("Agent control port closed")
    })
    const failing = session({ executeDomMutation })
    const open = vi.fn(async () => failing)
    const registry = createAgentControlSessionRegistry({ open })

    await expect(
      registry.executeDomMutation({
        runId: "run-1",
        tabId: 7,
        instruction: mutationInstruction()
      })
    ).rejects.toThrow("closed")
    expect(executeDomMutation).toHaveBeenCalledOnce()
    expect(failing.disconnect).toHaveBeenCalledOnce()
  })

  it("releases only the sessions of the run it was asked about", async () => {
    const first = session()
    const second = session()
    const open = vi
      .fn<() => Promise<AgentControlSession>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    const registry = createAgentControlSessionRegistry({ open })

    await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins: ["https://example.com"]
    })
    await registry.observe({
      runId: "run-2",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins: ["https://example.com"]
    })
    registry.release("run-1")

    expect(first.disconnect).toHaveBeenCalledOnce()
    expect(second.disconnect).not.toHaveBeenCalled()
  })
})

describe("Agent control session registry across frames", () => {
  const allowedOrigins = ["https://example.com"]
  const rootFrame = {
    frameId: 0,
    parentFrameId: -1,
    documentId: "document-1",
    url: "https://example.com/start"
  }
  const childObservation = (frameId: number): AgentObservation => ({
    ...observation({
      snapshotId: `snapshot-f${frameId}`,
      frameId,
      documentId: `document-${frameId}`,
      url: "https://example.com/child",
      visibleText: "Child content"
    }),
    frames: [
      {
        frameId,
        documentId: `document-${frameId}`,
        origin: "https://example.com",
        url: "https://example.com/child",
        access: "ok",
        snapshotId: `snapshot-f${frameId}`,
        generation: 1
      }
    ],
    elements: [
      {
        ref: `f${frameId}e1`,
        frameId,
        tag: "button",
        name: "Continue",
        visible: true,
        enabled: true,
        editable: false,
        sensitive: false
      }
    ]
  })
  const openByFrame = (
    sessions: Record<number, AgentControlSession>
  ): ReturnType<typeof vi.fn> =>
    vi.fn(async ({ frameId }: { frameId?: number }) => {
      const found = sessions[frameId ?? 0]
      if (!found) throw new Error(`no session for frame ${frameId}`)
      return found
    })

  it("reads authorized child frames through their own sessions and lists the rest", async () => {
    const root = session()
    const child = session({
      frameId: 2,
      observe: vi.fn(async () => childObservation(2))
    })
    const open = openByFrame({ 0: root, 2: child })
    const registry = createAgentControlSessionRegistry({
      open: open as never,
      frames: {
        listFrames: async () => [
          rootFrame,
          {
            frameId: 3,
            parentFrameId: 0,
            documentId: "document-3",
            url: "https://ads.example/slot?id=secret"
          },
          {
            frameId: 2,
            parentFrameId: 0,
            documentId: "document-2",
            url: "https://example.com/child"
          },
          { frameId: 4, parentFrameId: 0, url: "about:blank" }
        ],
        classifyAccess: async () => "ok"
      }
    })

    const observed = await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins
    })

    expect(open.mock.calls.map(([input]) => input.frameId)).toEqual([0, 2])
    expect(
      observed.frames.map((frame) => [frame.frameId, frame.access])
    ).toEqual([
      [0, "ok"],
      [2, "ok"],
      [3, "unauthorized_origin"]
    ])
    expect(observed.frames[2]).not.toHaveProperty("url")
    expect(observed.elements.map((element) => element.ref)).toEqual(["f2e1"])
    expect(observed.visibleText).toBe("Initial content\nChild content")
  })

  it("lists a child whose observation failed as unreadable without retrying it", async () => {
    const child = session({
      frameId: 2,
      observe: vi.fn(async () => {
        throw new Error("port closed")
      })
    })
    const open = openByFrame({ 0: session(), 2: child })
    const registry = createAgentControlSessionRegistry({
      open: open as never,
      frames: {
        listFrames: async () => [
          rootFrame,
          {
            frameId: 2,
            parentFrameId: 0,
            documentId: "document-2",
            url: "https://example.com/child"
          }
        ],
        classifyAccess: async () => "ok"
      }
    })

    const observed = await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 0,
      allowedOrigins
    })

    expect(observed.frames[1]).toMatchObject({
      frameId: 2,
      access: "unreadable"
    })
    expect(child.observe).toHaveBeenCalledOnce()
    expect(child.disconnect).toHaveBeenCalledOnce()
  })

  it("hands a child only the element budget the root left", async () => {
    const root = session({
      observe: vi.fn(async () =>
        observation({
          elements: Array.from({ length: 3 }, (_, index) => ({
            ref: `e${index + 1}`,
            frameId: 0,
            tag: "button",
            visible: true,
            enabled: true,
            editable: false,
            sensitive: false
          }))
        })
      )
    })
    const child = session({
      frameId: 2,
      observe: vi.fn(async () => childObservation(2))
    })
    const registry = createAgentControlSessionRegistry({
      open: openByFrame({ 0: root, 2: child }) as never,
      frames: {
        listFrames: async () => [
          rootFrame,
          {
            frameId: 2,
            parentFrameId: 0,
            documentId: "document-2",
            url: "https://example.com/child"
          }
        ],
        classifyAccess: async () => "ok"
      }
    })

    await registry.observe({
      runId: "run-1",
      tabId: 7,
      minimumGeneration: 4,
      allowedOrigins
    })

    expect(child.observe).toHaveBeenCalledWith(4, undefined, 1_997)
  })

  it("routes page work to the frame the instruction binds", async () => {
    const root = session()
    const child = session({ frameId: 2 })
    const open = openByFrame({ 0: root, 2: child })
    const registry = createAgentControlSessionRegistry({ open: open as never })
    const instruction = mutationInstruction()
    const bound = {
      ...instruction,
      target: { ...instruction.target, ref: "f2e1", frameId: 2 },
      frame: {
        snapshotId: "snapshot-f2",
        generation: 1,
        tabId: 7,
        frameId: 2,
        documentId: "document-2"
      }
    }

    await registry.executeDomMutation({
      runId: "run-1",
      tabId: 7,
      instruction: bound
    })

    expect(open).toHaveBeenCalledWith({ runId: "run-1", tabId: 7, frameId: 2 })
    expect(child.executeDomMutation).toHaveBeenCalledWith(bound, undefined)
    expect(root.executeDomMutation).not.toHaveBeenCalled()
  })
})
