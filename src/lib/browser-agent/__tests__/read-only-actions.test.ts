import type {
  AgentCancellationSignal,
  AgentVerificationInput,
  AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentCommand, AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentCommandExecutorAdapter,
  executeAgentScrollInDocument,
  executeReadOnlyAgentEffect,
  READ_ONLY_AGENT_EXECUTORS
} from "../command-executor"
import {
  type AgentEffectVerifierAdapter,
  READ_ONLY_AGENT_VERIFIERS,
  verifyReadOnlyAgentEffect
} from "../effect-verifier"
import {
  type AgentEffectResolverAdapter,
  READ_ONLY_AGENT_ACTIONS,
  resolveReadOnlyAgentEffect
} from "../resolved-effect"

const signal: AgentCancellationSignal = { aborted: false }

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
    y: 20,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 500
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const resolverAdapter = (
  overrides: Partial<AgentEffectResolverAdapter> = {}
): AgentEffectResolverAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: "https://example.com/other" }),
  classifyAccess: async () => "ok",
  resolveHistoryDestination: async () => "https://example.com/previous",
  ...overrides
})

const resolve = (
  command: AgentCommand,
  before = observation(),
  adapter = resolverAdapter()
) => resolveReadOnlyAgentEffect({ command, observation: before, adapter })

const authorize = async (
  command: AgentCommand,
  before = observation(),
  adapter = resolverAdapter()
): Promise<AuthorizedAgentEffect> => ({
  ...(await resolve(command, before, adapter)),
  authorization: { type: "policy", risk: "low", authorizedAt: 2 }
})

const executorAdapter = (
  overrides: Partial<AgentCommandExecutorAdapter> = {}
): AgentCommandExecutorAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: "https://example.com/start" }),
  getMainFrame: async () => ({
    documentId: "document-1",
    url: "https://example.com/start"
  }),
  classifyAccess: async () => "ok",
  scroll: vi.fn(),
  activateTab: vi.fn(),
  goHistory: vi.fn(),
  resolveHistoryDestination: async () => "https://example.com/previous",
  wait: vi.fn(),
  now: () => 10,
  ...overrides
})

const verifierAdapter = (
  after: AgentObservation,
  overrides: Partial<AgentEffectVerifierAdapter> = {}
): AgentEffectVerifierAdapter => ({
  observe: async () => after,
  getActiveTabId: async () => 7,
  getTab: async () => ({ url: after.url }),
  classifyAccess: async () => "ok",
  now: () => 10,
  ...overrides
})

const verificationInput = async (
  command: AgentCommand,
  before = observation()
): Promise<AgentVerificationInput> => ({
  effect: await authorize(command, before),
  receipt: { executedAt: 2 },
  before
})

describe("read-only Agent effects", () => {
  it("rejects stale observations during resolution", async () => {
    await expect(
      resolve({ type: "read", snapshotId: "stale", generation: 1 })
    ).rejects.toThrow("stale observation")
  })

  it("resolves browser-owned destinations for switch and safe history", async () => {
    await expect(
      resolve({
        type: "switch_tab",
        tabId: 9,
        snapshotId: "snapshot-1",
        generation: 1
      })
    ).resolves.toMatchObject({
      destination: { url: "https://example.com/other", source: "browser" },
      semanticEffects: ["navigation"]
    })
    await expect(
      resolve({ type: "back", snapshotId: "snapshot-1", generation: 1 })
    ).resolves.toMatchObject({
      destination: { url: "https://example.com/previous" }
    })
  })

  it("refuses history when its destination cannot be known before execution", async () => {
    await expect(
      resolve(
        { type: "back", snapshotId: "snapshot-1", generation: 1 },
        observation(),
        resolverAdapter({ resolveHistoryDestination: async () => undefined })
      )
    ).rejects.toThrow("not known safely")
  })

  it("rejects excluded destinations during semantic resolution", async () => {
    await expect(
      resolve(
        { type: "forward", snapshotId: "snapshot-1", generation: 1 },
        observation(),
        resolverAdapter({
          classifyAccess: async (url) =>
            url?.endsWith("/previous") ? "excluded" : "ok"
        })
      )
    ).rejects.toThrow("destination is not readable")
  })

  it("re-runs source, destination, origin access, and history policy", async () => {
    const effect = await authorize({
      type: "back",
      snapshotId: "snapshot-1",
      generation: 1
    })
    const goHistory = vi.fn()
    const classifyAccess = vi.fn(async () => "excluded" as const)
    await expect(
      executeReadOnlyAgentEffect({
        effect,
        adapter: executorAdapter({ classifyAccess, goHistory }),
        signal
      })
    ).rejects.toThrow("access changed")
    expect(goHistory).not.toHaveBeenCalled()
  })

  it.each([
    ["confirmed", 20, 120, 500],
    ["negative", 400, 400, 500],
    ["ambiguous", 20, 20, 500]
  ] as const)("classifies scroll verification as %s", async (expected, beforeY, afterY, documentHeight) => {
    const before = observation({
      scroll: { ...observation().scroll, y: beforeY, documentHeight }
    })
    const after = observation({
      snapshotId: "snapshot-2",
      generation: 2,
      scroll: { ...before.scroll, y: afterY }
    })
    const input = await verificationInput(
      {
        type: "scroll",
        direction: "down",
        snapshotId: "snapshot-1",
        generation: 1
      },
      before
    )
    await expect(
      verifyReadOnlyAgentEffect({
        verification: input,
        adapter: verifierAdapter(after),
        signal
      })
    ).resolves.toMatchObject({ outcome: expected })
  })

  it("rejects a document scroll after its snapshot was invalidated", () => {
    const references = {
      beginSnapshot: vi.fn(),
      invalidate: vi.fn(),
      currentGeneration: () => 2,
      matches: () => false,
      resolve: vi.fn()
    }
    expect(() =>
      executeAgentScrollInDocument({
        command: {
          type: "scroll",
          direction: "down",
          snapshotId: "snapshot-1",
          generation: 1
        },
        identity: {
          snapshotId: "snapshot-1",
          generation: 1,
          tabId: 7,
          documentId: "document-1"
        },
        document,
        references
      })
    ).toThrow("snapshot is stale")
  })

  it("confirms or negatively verifies a named wait condition", async () => {
    const command = {
      type: "wait",
      condition: "results ready",
      timeoutMs: 1,
      snapshotId: "snapshot-1",
      generation: 1
    } as const
    const input = await verificationInput(command)
    await expect(
      verifyReadOnlyAgentEffect({
        verification: input,
        adapter: verifierAdapter(
          observation({
            snapshotId: "snapshot-2",
            generation: 2,
            visibleText: "Results ready"
          })
        ),
        signal
      })
    ).resolves.toMatchObject({ outcome: "confirmed" })
    await expect(
      verifyReadOnlyAgentEffect({
        verification: input,
        adapter: verifierAdapter(
          observation({
            snapshotId: "snapshot-2",
            generation: 2,
            visibleText: "Still loading"
          })
        ),
        signal
      })
    ).resolves.toMatchObject({ outcome: "negative" })
  })

  it("registers a verifier for every shipped executor", () => {
    expect(Object.keys(READ_ONLY_AGENT_EXECUTORS).sort()).toEqual(
      [...READ_ONLY_AGENT_ACTIONS].sort()
    )
    expect(Object.keys(READ_ONLY_AGENT_VERIFIERS).sort()).toEqual(
      [...READ_ONLY_AGENT_ACTIONS].sort()
    )
  })
})
