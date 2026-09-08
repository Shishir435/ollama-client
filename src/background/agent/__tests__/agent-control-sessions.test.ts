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
  documentId: "document-1",
  url: "https://example.com/start",
  origin: "https://example.com",
  title: "Example",
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
  observe: vi.fn(async () => observation()),
  executeDomMutation: vi.fn(async () => undefined),
  executeScroll: vi.fn(async () => undefined),
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
      documentId: "document-1"
    }
  }) as Parameters<
    ReturnType<typeof createAgentControlSessionRegistry>["executeDomMutation"]
  >[0]["instruction"]

describe("Agent control session registry", () => {
  it("reuses one session per run and tab", async () => {
    const open = vi.fn(async () => session())
    const registry = createAgentControlSessionRegistry({ open })

    await registry.observe({ runId: "run-1", tabId: 7, minimumGeneration: 0 })
    await registry.observe({ runId: "run-1", tabId: 7, minimumGeneration: 0 })

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
      minimumGeneration: 0
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
      registry.observe({ runId: "run-1", tabId: 7, minimumGeneration: 0 })
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
        { runId: "run-1", tabId: 7, minimumGeneration: 0 },
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
      registry.observe({ runId: "run-1", tabId: 7, minimumGeneration: 0 })
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

    await registry.observe({ runId: "run-1", tabId: 7, minimumGeneration: 0 })
    await registry.observe({ runId: "run-2", tabId: 7, minimumGeneration: 0 })
    registry.release("run-1")

    expect(first.disconnect).toHaveBeenCalledOnce()
    expect(second.disconnect).not.toHaveBeenCalled()
  })
})
