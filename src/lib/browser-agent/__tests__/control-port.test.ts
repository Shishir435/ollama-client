import { AgentControlFailedError } from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { MESSAGE_KEYS } from "@/lib/constants"
import {
  AGENT_CONTROL_VERSION,
  type AgentControlBrowserAdapter,
  type AgentControlEvent,
  type AgentControlPort,
  type AgentDomMutationInstruction,
  AgentDomMutationInstructionSchema,
  AgentExecuteRequestSchema,
  AgentExecuteScrollRequestSchema,
  AgentObserveRequestSchema,
  type AgentScrollInstruction,
  AgentScrollInstructionSchema,
  agentControlSchemaIssues,
  attachAgentControlContentPort,
  createAgentControlSession,
  openAgentControlSession,
  readAgentControlFailure,
  validateAgentObservationResponse
} from "../control-port"

class FakeEvent<T extends (...args: never[]) => unknown>
  implements AgentControlEvent<T>
{
  listeners = new Set<T>()
  addListener = (listener: T) => this.listeners.add(listener)
  removeListener = (listener: T) => this.listeners.delete(listener)
  emit(...args: Parameters<T>) {
    for (const listener of this.listeners) listener(...args)
  }
}

const rootFrame = (
  observation: Pick<
    AgentObservation,
    "frameId" | "documentId" | "origin" | "url" | "snapshotId" | "generation"
  >
): AgentObservation["frames"][number] => ({
  frameId: observation.frameId,
  documentId: observation.documentId,
  origin: observation.origin,
  url: observation.url,
  access: "ok",
  snapshotId: observation.snapshotId,
  generation: observation.generation
})

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => {
  const base = {
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 7,
    frameId: 0,
    documentId: "document-1",
    url: "https://example.com/",
    origin: "https://example.com",
    title: "Example",
    elements: [],
    visibleText: "Example",
    scroll: {
      x: 0,
      y: 0,
      viewportWidth: 100,
      viewportHeight: 100,
      documentWidth: 100,
      documentHeight: 100
    },
    dialogs: [],
    capturedAt: 1,
    ...overrides
  }
  return { ...base, frames: overrides.frames ?? [rootFrame(base)] }
}

const binding = {
  runId: "run-1",
  tabId: 7,
  frameId: 0 as const,
  nonce: "0123456789abcdef",
  documentId: "document-1"
}

const response = (overrides: Record<string, unknown> = {}) => ({
  version: AGENT_CONTROL_VERSION,
  type: "agent_observation",
  ...binding,
  sequence: 1,
  observation: observation(),
  ...overrides
})

const mutationInstruction = (
  overrides: Partial<AgentDomMutationInstruction> = {}
): AgentDomMutationInstruction => ({
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
    accessibleName: "Continue",
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
  },
  ...overrides
})

const scrollInstruction = (
  overrides: Partial<AgentScrollInstruction> = {}
): AgentScrollInstruction => ({
  command: {
    type: "scroll",
    direction: "down",
    snapshotId: "snapshot-1",
    generation: 1
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
  },
  ...overrides
})

const createPort = () => {
  const onMessage = new FakeEvent<(message: unknown) => void>()
  const onDisconnect = new FakeEvent<() => void>()
  const port: AgentControlPort = {
    name: MESSAGE_KEYS.AGENT.CONTROL_PORT,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage,
    onDisconnect
  }
  return { port, onMessage, onDisconnect }
}

describe("Agent control port", () => {
  it("rejects malformed and unversioned envelopes with Zod", () => {
    expect(
      AgentObserveRequestSchema.safeParse({ type: "agent_observe" }).success
    ).toBe(false)
    expect(
      AgentObserveRequestSchema.safeParse({
        version: 99,
        type: "agent_observe",
        ...binding,
        sequence: 1,
        minimumGeneration: 0
      }).success
    ).toBe(false)
  })

  it.each([
    ["runId", "other-run"],
    ["tabId", 8],
    ["nonce", "fedcba9876543210"],
    ["sequence", 2],
    ["documentId", "other-document"]
  ])("rejects a mismatched %s", (field, value) => {
    expect(() =>
      validateAgentObservationResponse(response({ [field]: value }), binding, 1)
    ).toThrow("binding mismatch")
  })

  it("rejects mismatched observation identity", () => {
    expect(() =>
      validateAgentObservationResponse(
        response({ observation: observation({ documentId: "other" }) }),
        binding,
        1
      )
    ).toThrow("binding mismatch")
  })

  it("rejects elements from another frame and inconsistent origins", () => {
    const base = observation()
    expect(() =>
      validateAgentObservationResponse(
        response({
          observation: observation({
            frames: [
              base.frames[0],
              {
                frameId: 2,
                parentFrameId: 0,
                documentId: "document-2",
                origin: "https://example.com",
                url: "https://example.com/child",
                access: "ok",
                snapshotId: "snapshot-child",
                generation: 1
              }
            ],
            elements: [
              {
                ref: "f2e1",
                frameId: 2,
                tag: "button",
                visible: true,
                enabled: true,
                editable: false,
                sensitive: false
              }
            ]
          })
        }),
        binding,
        1
      )
    ).toThrow("binding mismatch")
    expect(() =>
      validateAgentObservationResponse(
        response({
          observation: observation({ origin: "https://other.example" })
        }),
        binding,
        1
      )
    ).toThrow("invalid origin")
  })

  it("requires browser evidence for the exact main-frame document", () => {
    const { port } = createPort()
    expect(() =>
      createAgentControlSession({
        port,
        binding,
        sender: { tabId: 7, frameId: 2, documentId: "document-1" }
      })
    ).toThrow("sender binding mismatch")
  })

  it("uses a monotonic sequence and validates each response", async () => {
    const { port, onMessage } = createPort()
    vi.mocked(port.postMessage).mockImplementation((raw) => {
      const request = AgentObserveRequestSchema.parse(raw)
      queueMicrotask(() =>
        onMessage.emit(
          response({
            sequence: request.sequence,
            observation: observation({
              generation: Math.max(1, request.minimumGeneration)
            })
          })
        )
      )
    })
    const session = createAgentControlSession({
      port,
      binding,
      sender: { tabId: 7, frameId: 0, documentId: "document-1" }
    })

    await expect(session.observe(0)).resolves.toMatchObject({ generation: 1 })
    await expect(session.observe(2)).resolves.toMatchObject({ generation: 2 })
    expect(
      vi
        .mocked(port.postMessage)
        .mock.calls.map(([raw]) => (raw as { sequence: number }).sequence)
    ).toEqual([1, 2])
  })

  it("carries a resolved DOM mutation over the bound port", async () => {
    const { port, onMessage } = createPort()
    vi.mocked(port.postMessage).mockImplementation((raw) => {
      const request = AgentExecuteRequestSchema.parse(raw)
      queueMicrotask(() =>
        onMessage.emit({
          version: AGENT_CONTROL_VERSION,
          type: "agent_dom_mutation_executed",
          ...binding,
          sequence: request.sequence
        })
      )
    })
    const session = createAgentControlSession({
      port,
      binding,
      sender: { tabId: 7, frameId: 0, documentId: "document-1" }
    })

    await expect(
      session.executeDomMutation(mutationInstruction())
    ).resolves.toBeUndefined()
    const request = AgentExecuteRequestSchema.parse(
      vi.mocked(port.postMessage).mock.calls[0]?.[0]
    )
    expect(request.instruction.target.accessibleName).toBe("Continue")
    expect(request.sequence).toBe(1)
  })

  it("does not consume a sequence for a concurrent control request", async () => {
    const { port, onMessage } = createPort()
    const session = createAgentControlSession({
      port,
      binding,
      sender: { tabId: 7, frameId: 0, documentId: "document-1" }
    })
    const pending = session.observe(0)
    await expect(
      session.executeDomMutation(mutationInstruction())
    ).rejects.toThrow("already in flight")
    onMessage.emit(response())
    await pending

    vi.mocked(port.postMessage).mockImplementation((raw) => {
      const request = AgentExecuteRequestSchema.parse(raw)
      queueMicrotask(() =>
        onMessage.emit({
          version: AGENT_CONTROL_VERSION,
          type: "agent_dom_mutation_executed",
          ...binding,
          sequence: request.sequence
        })
      )
    })
    await session.executeDomMutation(mutationInstruction())
    expect(
      AgentExecuteRequestSchema.parse(
        vi.mocked(port.postMessage).mock.calls[1]?.[0]
      ).sequence
    ).toBe(2)
  })

  it("rejects a generation older than the requested minimum", async () => {
    const { port, onMessage } = createPort()
    vi.mocked(port.postMessage).mockImplementation(() => {
      queueMicrotask(() => onMessage.emit(response()))
    })
    const session = createAgentControlSession({
      port,
      binding,
      sender: { tabId: 7, frameId: 0, documentId: "document-1" }
    })
    await expect(session.observe(2)).rejects.toThrow("generation is stale")
    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("carries a snapshot-bound scroll to the page and back", async () => {
    const { port, onMessage } = createPort()
    vi.mocked(port.postMessage).mockImplementation((raw) => {
      const request = AgentExecuteScrollRequestSchema.parse(raw)
      queueMicrotask(() =>
        onMessage.emit({
          version: AGENT_CONTROL_VERSION,
          type: "agent_scroll_executed",
          ...binding,
          sequence: request.sequence
        })
      )
    })
    const session = createAgentControlSession({
      port,
      binding,
      sender: { tabId: 7, frameId: 0, documentId: "document-1" }
    })

    await expect(
      session.executeScroll(scrollInstruction())
    ).resolves.toBeUndefined()
    expect(
      AgentExecuteScrollRequestSchema.parse(
        vi.mocked(port.postMessage).mock.calls[0]?.[0]
      ).instruction.command.type
    ).toBe("scroll")
  })

  it("refuses a scroll instruction whose command is not a scroll", () => {
    expect(
      AgentScrollInstructionSchema.safeParse({
        ...scrollInstruction(),
        command: {
          type: "click",
          ref: "e1",
          snapshotId: "snapshot-1",
          generation: 1
        }
      }).success
    ).toBe(false)
  })

  it("executes only a snapshot-bound scroll on the content side", () => {
    const { port, onMessage } = createPort()
    const executeScroll = vi.fn()
    attachAgentControlContentPort(port, {
      buildObservation: () => observation(),
      executeDomMutation: vi.fn(),
      executeScroll,
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_execute_scroll",
      ...binding,
      sequence: 1,
      instruction: scrollInstruction({
        snapshotIdentity: {
          snapshotId: "snapshot-1",
          generation: 1,
          tabId: 8,
          frameId: 0,
          documentId: "document-1"
        }
      })
    })
    expect(executeScroll).not.toHaveBeenCalled()
    expect(port.disconnect).toHaveBeenCalledOnce()

    const live = createPort()
    attachAgentControlContentPort(live.port, {
      buildObservation: () => observation(),
      executeDomMutation: vi.fn(),
      executeScroll,
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    live.onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_execute_scroll",
      ...binding,
      sequence: 1,
      instruction: scrollInstruction()
    })
    expect(executeScroll).toHaveBeenCalledOnce()
    expect(live.port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "agent_scroll_executed", sequence: 1 })
    )
  })

  it("locks content responses to the first run, nonce, sequence, and document", () => {
    const { port, onMessage } = createPort()
    expect(
      attachAgentControlContentPort(port, {
        buildObservation: () => observation(),
        executeDomMutation: vi.fn(),
        executeScroll: vi.fn(),
        prepareNativeInput: vi.fn(),
        settleNativeInput: vi.fn()
      })
    ).toBe(true)
    onMessage.emit({
      version: 1,
      type: "agent_observe",
      ...binding,
      sequence: 1,
      minimumGeneration: 0
    })
    expect(port.postMessage).toHaveBeenCalledOnce()
    onMessage.emit({
      version: 1,
      type: "agent_observe",
      ...binding,
      nonce: "fedcba9876543210",
      sequence: 2,
      minimumGeneration: 0
    })
    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("executes only a snapshot-bound DOM mutation on the content side", () => {
    const { port, onMessage } = createPort()
    const executeDomMutation = vi.fn()
    attachAgentControlContentPort(port, {
      buildObservation: () => observation(),
      executeDomMutation,
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_observe",
      ...binding,
      sequence: 1,
      minimumGeneration: 0
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_execute_dom_mutation",
      ...binding,
      sequence: 2,
      instruction: mutationInstruction()
    })

    expect(executeDomMutation).toHaveBeenCalledOnce()
    expect(port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "agent_dom_mutation_executed",
        sequence: 2
      })
    )
  })

  it("disconnects before a mutation with a mismatched snapshot binding", () => {
    const { port, onMessage } = createPort()
    const executeDomMutation = vi.fn()
    attachAgentControlContentPort(port, {
      buildObservation: () => observation(),
      executeDomMutation,
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_execute_dom_mutation",
      ...binding,
      sequence: 1,
      instruction: mutationInstruction({
        snapshotIdentity: {
          snapshotId: "snapshot-1",
          generation: 1,
          tabId: 8,
          frameId: 0,
          documentId: "document-1"
        }
      })
    })

    expect(executeDomMutation).not.toHaveBeenCalled()
    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    "file:///tmp/page.html",
    "chrome://settings",
    "ftp://example.com"
  ])("refuses non-http(s) tab access for %s", async (url) => {
    const { port } = createPort()
    const adapter: AgentControlBrowserAdapter = {
      getTab: async () => ({ url }),
      getFrame: vi.fn(),
      listFrames: vi.fn(async () => []),
      inject: vi.fn(),
      connect: vi.fn(() => port),
      classifyAccess: async (candidate) =>
        candidate?.startsWith("http") ? "ok" : "restricted",
      createNonce: () => binding.nonce
    }
    await expect(
      openAgentControlSession({ runId: "run-1", tabId: 7, adapter })
    ).rejects.toThrow("restricted")
    expect(adapter.inject).not.toHaveBeenCalled()
  })

  it("reuses excluded-site classification before injection", async () => {
    const { port } = createPort()
    const adapter: AgentControlBrowserAdapter = {
      getTab: async () => ({ url: "https://private.example" }),
      getFrame: vi.fn(),
      listFrames: vi.fn(async () => []),
      inject: vi.fn(),
      connect: vi.fn(() => port),
      classifyAccess: async () => "excluded",
      createNonce: () => binding.nonce
    }
    await expect(
      openAgentControlSession({ runId: "run-1", tabId: 7, adapter })
    ).rejects.toThrow("excluded")
    expect(adapter.getFrame).not.toHaveBeenCalled()
  })

  it("connects only to the observed main-frame document", async () => {
    const { port } = createPort()
    const connect = vi.fn(() => port)
    const adapter: AgentControlBrowserAdapter = {
      getTab: async () => ({ url: "https://example.com" }),
      getFrame: async () => ({
        frameId: 0,
        parentFrameId: -1,
        documentId: "document-1",
        url: "https://example.com/"
      }),
      listFrames: vi.fn(async () => []),
      inject: vi.fn(),
      connect,
      classifyAccess: async () => "ok",
      createNonce: () => binding.nonce
    }
    await openAgentControlSession({ runId: "run-1", tabId: 7, adapter })
    expect(connect).toHaveBeenCalledWith(7, {
      name: MESSAGE_KEYS.AGENT.CONTROL_PORT,
      frameId: 0,
      documentId: "document-1"
    })
  })
})

describe("Agent control failures", () => {
  const failure = (overrides: Record<string, unknown> = {}) => ({
    version: AGENT_CONTROL_VERSION,
    type: "agent_control_failed",
    ...binding,
    sequence: 1,
    reason: "observation_invalid",
    issues: [{ path: "visibleText", code: "too_big" }],
    ...overrides
  })

  it("answers a page it cannot read with a bound typed failure", () => {
    const { port, onMessage } = createPort()
    attachAgentControlContentPort(port, {
      buildObservation: () => {
        throw new Error("Agent observations are main-frame only")
      },
      executeDomMutation: vi.fn(),
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_observe",
      ...binding,
      sequence: 1,
      minimumGeneration: 0
    })

    expect(port.disconnect).not.toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenCalledWith({
      version: AGENT_CONTROL_VERSION,
      type: "agent_control_failed",
      ...binding,
      sequence: 1,
      reason: "observation_build_failed",
      issues: []
    })
  })

  it("reports a rejected snapshot as paths and codes without its values", () => {
    const { port, onMessage } = createPort()
    const secret = "s".repeat(100_001)
    attachAgentControlContentPort(port, {
      buildObservation: () =>
        observation({ visibleText: secret }) as AgentObservation,
      executeDomMutation: vi.fn(),
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_observe",
      ...binding,
      sequence: 1,
      minimumGeneration: 0
    })

    const [sent] = vi.mocked(port.postMessage).mock.calls[0]
    expect(sent).toMatchObject({
      type: "agent_control_failed",
      reason: "observation_invalid",
      issues: [{ path: "visibleText", code: "too_big" }]
    })
    expect(JSON.stringify(sent)).not.toContain("sss")
  })

  it("consumes the sequence a failure answered and keeps serving the port", () => {
    const { port, onMessage } = createPort()
    let readable = false
    attachAgentControlContentPort(port, {
      buildObservation: () => {
        if (!readable) throw new Error("not yet")
        return observation()
      },
      executeDomMutation: vi.fn(),
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_observe",
      ...binding,
      sequence: 1,
      minimumGeneration: 0
    })
    readable = true
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_observe",
      ...binding,
      sequence: 2,
      minimumGeneration: 0
    })

    expect(port.disconnect).not.toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "agent_observation", sequence: 2 })
    )
  })

  it("reports an execution that threw without closing the port", () => {
    const { port, onMessage } = createPort()
    attachAgentControlContentPort(port, {
      buildObservation: () => observation(),
      executeDomMutation: () => {
        throw new Error("detached")
      },
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_execute_dom_mutation",
      ...binding,
      sequence: 1,
      instruction: mutationInstruction()
    })

    expect(port.disconnect).not.toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "agent_control_failed",
        reason: "execution_failed"
      })
    )
  })

  it("raises a bound failure as a typed error carrying its reason", () => {
    expect(() =>
      validateAgentObservationResponse(failure(), binding, 1)
    ).toThrow(AgentControlFailedError)
    try {
      validateAgentObservationResponse(failure(), binding, 1)
    } catch (error) {
      expect(error).toMatchObject({
        reason: "observation_invalid",
        issues: [{ path: "visibleText", code: "too_big" }]
      })
    }
  })

  it.each([
    ["nonce", "fedcba9876543210"],
    ["runId", "other-run"],
    ["sequence", 2]
  ])("refuses a failure that is not bound to the request (%s)", (field, value) => {
    expect(
      readAgentControlFailure(failure({ [field]: value }), binding, 1)
    ).toBeUndefined()
    expect(() =>
      validateAgentObservationResponse(failure({ [field]: value }), binding, 1)
    ).not.toThrow(AgentControlFailedError)
  })

  it("rejects a failure carrying more issues than the cap allows", () => {
    expect(
      readAgentControlFailure(
        failure({
          issues: Array.from({ length: 21 }, () => ({
            path: "elements.0.editable",
            code: "invalid_type"
          }))
        }),
        binding,
        1
      )
    ).toBeUndefined()
  })

  it("collects no schema evidence from an untyped error", () => {
    expect(agentControlSchemaIssues(new Error("boom"))).toEqual([])
  })

  it("fails an observation request with the typed reason the page answered", async () => {
    const { port, onMessage } = createPort()
    const session = createAgentControlSession({
      port,
      binding,
      sender: { tabId: 7, frameId: 0, documentId: "document-1" }
    })
    const observing = session.observe(0)
    onMessage.emit(failure({ reason: "observation_build_failed", issues: [] }))
    await expect(observing).rejects.toMatchObject({
      name: "AgentControlFailedError",
      reason: "observation_build_failed"
    })
  })
})

describe("Agent control port across frames", () => {
  const childIdentity = {
    snapshotId: "snapshot-child",
    generation: 3,
    tabId: 7,
    frameId: 2,
    documentId: "document-2"
  }

  it("opens a child frame session on that frame's own document", async () => {
    const { port } = createPort()
    const connect = vi.fn(() => port)
    const inject = vi.fn()
    const adapter: AgentControlBrowserAdapter = {
      getTab: async () => ({ url: "https://example.com" }),
      getFrame: async (_tabId, frameId) => ({
        frameId,
        parentFrameId: 0,
        documentId: "document-2",
        url: "https://example.com/child"
      }),
      listFrames: vi.fn(async () => []),
      inject,
      connect,
      classifyAccess: async () => "ok",
      createNonce: () => binding.nonce
    }
    const session = await openAgentControlSession({
      runId: "run-1",
      tabId: 7,
      frameId: 2,
      adapter
    })
    expect(session.frameId).toBe(2)
    expect(inject).toHaveBeenCalledWith(7, 2)
    expect(connect).toHaveBeenCalledWith(7, {
      name: MESSAGE_KEYS.AGENT.CONTROL_PORT,
      frameId: 2,
      documentId: "document-2"
    })
  })

  it("refuses an instruction bound to a frame other than the port's", () => {
    const { port, onMessage } = createPort()
    const executeDomMutation = vi.fn()
    attachAgentControlContentPort(port, {
      buildObservation: () => observation(),
      executeDomMutation,
      executeScroll: vi.fn(),
      prepareNativeInput: vi.fn(),
      settleNativeInput: vi.fn()
    })
    onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_execute_dom_mutation",
      ...binding,
      sequence: 1,
      instruction: mutationInstruction({
        target: { ...mutationInstruction().target, ref: "f2e1", frameId: 2 },
        frame: childIdentity
      })
    })
    expect(executeDomMutation).not.toHaveBeenCalled()
    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("accepts a child frame identity only when it names another frame", () => {
    const base = mutationInstruction()
    expect(
      AgentDomMutationInstructionSchema.safeParse({
        ...base,
        target: { ...base.target, frameId: 2 },
        frame: childIdentity
      }).success
    ).toBe(true)
    expect(
      AgentDomMutationInstructionSchema.safeParse({
        ...base,
        frame: { ...childIdentity, frameId: 0 }
      }).success
    ).toBe(false)
    expect(
      AgentDomMutationInstructionSchema.safeParse({
        ...base,
        frame: { ...childIdentity, tabId: 8 }
      }).success
    ).toBe(false)
    expect(
      AgentDomMutationInstructionSchema.safeParse({
        ...base,
        frame: childIdentity
      }).success
    ).toBe(false)
  })
})
