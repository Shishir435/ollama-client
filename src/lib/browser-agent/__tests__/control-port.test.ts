import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { MESSAGE_KEYS } from "@/lib/constants"
import {
  AGENT_CONTROL_VERSION,
  type AgentControlBrowserAdapter,
  type AgentControlEvent,
  type AgentControlPort,
  AgentObserveRequestSchema,
  attachAgentControlContentPort,
  createAgentControlSession,
  openAgentControlSession,
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

const observation = (overrides: Partial<AgentObservation> = {}) =>
  ({
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 7,
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
  }) satisfies AgentObservation

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

  it("rejects subframe elements and inconsistent origins", () => {
    expect(() =>
      validateAgentObservationResponse(
        response({
          observation: observation({
            elements: [
              {
                ref: "e1",
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

  it("locks content responses to the first run, nonce, sequence, and document", () => {
    const { port, onMessage } = createPort()
    expect(attachAgentControlContentPort(port, () => observation())).toBe(true)
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

  it.each([
    "file:///tmp/page.html",
    "chrome://settings",
    "ftp://example.com"
  ])("refuses non-http(s) tab access for %s", async (url) => {
    const { port } = createPort()
    const adapter: AgentControlBrowserAdapter = {
      getTab: async () => ({ url }),
      getMainFrame: vi.fn(),
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
      getMainFrame: vi.fn(),
      inject: vi.fn(),
      connect: vi.fn(() => port),
      classifyAccess: async () => "excluded",
      createNonce: () => binding.nonce
    }
    await expect(
      openAgentControlSession({ runId: "run-1", tabId: 7, adapter })
    ).rejects.toThrow("excluded")
    expect(adapter.getMainFrame).not.toHaveBeenCalled()
  })

  it("connects only to the observed main-frame document", async () => {
    const { port } = createPort()
    const connect = vi.fn(() => port)
    const adapter: AgentControlBrowserAdapter = {
      getTab: async () => ({ url: "https://example.com" }),
      getMainFrame: async () => ({
        frameId: 0,
        documentId: "document-1",
        url: "https://example.com/"
      }),
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
