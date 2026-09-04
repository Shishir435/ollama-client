import type {
  AgentExecutionReceipt,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import type { AgentBrowserAdapters } from "../agent-browser-adapters"
import { createAgentEffectPort } from "../agent-effect-port"

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
  elements: [
    {
      ref: "e1",
      frameId: 0,
      tag: "button",
      name: "Continue",
      sensitive: false,
      visible: true,
      enabled: true,
      editable: false
    }
  ],
  visibleText: "Initial content",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 500
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const adapters = (): AgentBrowserAdapters => ({
  resolver: {
    getTab: async (tabId) => ({ id: tabId, url: "https://example.com/start" }),
    classifyAccess: async () => "ok",
    resolveHistoryDestination: async () => undefined
  },
  executor: {
    getTab: async (tabId) => ({ id: tabId, url: "https://example.com/start" }),
    getMainFrame: async () => ({
      documentId: "document-1",
      url: "https://example.com/start"
    }),
    classifyAccess: async () => "ok",
    scroll: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined),
    activateTab: vi.fn(async () => undefined),
    goHistory: vi.fn(async () => undefined),
    resolveHistoryDestination: async () => undefined,
    wait: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    createTab: vi.fn(async () => undefined),
    now: () => 1_000
  },
  verifier: {
    observe: vi.fn(async () => observation({ generation: 2 })),
    getActiveTabId: async () => 7,
    getTab: async () => ({ url: "https://example.com/start" }),
    classifyAccess: async () => "ok",
    now: () => 2_000
  }
})

const signal = { aborted: false }

const authorized = (
  effect: Awaited<
    ReturnType<ReturnType<typeof createAgentEffectPort>["resolve"]>
  >
): AuthorizedAgentEffect => ({
  ...effect,
  authorization: { type: "policy", risk: "low", authorizedAt: 1_000 }
})

describe("Agent effect port", () => {
  it("refuses an action that belongs to no shipped family", async () => {
    const port = createAgentEffectPort(adapters())
    const command = {
      type: "teleport",
      snapshotId: "snapshot-1",
      generation: 1
    } as unknown as Parameters<typeof port.resolve>[0]

    await expect(port.resolve(command, observation())).rejects.toThrow(
      "Unsupported Agent action"
    )
  })

  it("routes a read through the read-only family", async () => {
    const port = createAgentEffectPort(adapters())
    const effect = await port.resolve(
      { type: "read", snapshotId: "snapshot-1", generation: 1 },
      observation()
    )

    expect(effect.semanticEffects).toContain("read")
    const receipt: AgentExecutionReceipt = await port.execute(
      authorized(effect),
      signal
    )
    expect(receipt.details).toBe("read")
  })

  it("scrolls through the executor adapter rather than a mutation", async () => {
    const deps = adapters()
    const port = createAgentEffectPort(deps)
    const effect = await port.resolve(
      {
        type: "scroll",
        direction: "down",
        snapshotId: "snapshot-1",
        generation: 1
      },
      observation()
    )

    await port.execute(authorized(effect), signal)
    expect(deps.executor.scroll).toHaveBeenCalledOnce()
    expect(deps.executor.mutate).not.toHaveBeenCalled()
  })

  it("routes a click to the DOM mutation family and verifies it there", async () => {
    const deps = adapters()
    const port = createAgentEffectPort(deps)
    const effect = await port.resolve(
      { type: "click", ref: "e1", snapshotId: "snapshot-1", generation: 1 },
      observation()
    )

    expect(effect.semanticEffects).toContain("activation")
    const receipt = await port.execute(authorized(effect), signal)
    expect(deps.executor.mutate).toHaveBeenCalledOnce()

    const verification = await port.verify(
      { effect: authorized(effect), receipt, before: observation() },
      signal
    )
    expect(deps.verifier.observe).toHaveBeenCalledOnce()
    expect(["confirmed", "negative", "ambiguous"]).toContain(
      verification.outcome
    )
  })
})
