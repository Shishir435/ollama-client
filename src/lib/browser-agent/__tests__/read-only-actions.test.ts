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
  getFrame: async () => ({
    documentId: "document-1",
    url: "https://example.com/start"
  }),
  classifyAccess: async () => "ok",
  scroll: vi.fn(),
  mutate: vi.fn(),
  activateTab: vi.fn(),
  goHistory: vi.fn(),
  resolveHistoryDestination: async () => "https://example.com/previous",
  wait: vi.fn(),
  navigate: vi.fn(),
  createTab: vi.fn(),
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
  before,
  allowedOrigins: ["https://example.com"]
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

  it.each([
    { type: "inspect", target: 'form "signup"' },
    { type: "find", query: "submit" },
    { type: "extract_text" }
  ] as const)("resolves $type as a read that never mutates", async (extra) => {
    const command = {
      ...extra,
      snapshotId: "snapshot-1",
      generation: 1
    } as AgentCommand
    const effect = await resolve(command)
    expect(effect.semanticEffects).toEqual(["read"])
    const receipt = await executeReadOnlyAgentEffect({
      effect: {
        ...effect,
        authorization: { type: "policy", risk: "low", authorizedAt: 2 }
      },
      adapter: executorAdapter(),
      signal
    })
    expect(receipt.details).toBe(extra.type)
    const after = observation({ snapshotId: "snapshot-2", generation: 2 })
    await expect(
      verifyReadOnlyAgentEffect({
        verification: await verificationInput(command),
        adapter: verifierAdapter(after),
        signal
      })
    ).resolves.toMatchObject({ outcome: "confirmed" })
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
      matchesFormState: () => false,
      resolve: vi.fn(),
      referenceIn: vi.fn(),
      existingReference: vi.fn(),
      verificationIdOf: vi.fn(() => "v")
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
          frameId: 0,
          documentId: "document-1"
        },
        document,
        references
      })
    ).toThrow("snapshot is stale")
  })

  it("stops looking as soon as the condition appears", async () => {
    /**
     * A wait used to sleep its whole timeout and read the page once: a save
     * that landed in a moment still cost the full budget, and one that landed
     * just after the single read was reported absent. It polls now, and stops
     * on the first look that shows the condition.
     */
    const command = {
      type: "wait",
      condition: "All changes saved",
      timeoutMs: 30_000,
      snapshotId: "snapshot-1",
      generation: 1
    } as const
    let looks = 0
    const pauses: number[] = []
    const outcome = await verifyReadOnlyAgentEffect({
      verification: await verificationInput(command),
      adapter: verifierAdapter(observation(), {
        observe: async () => {
          looks += 1
          return observation({
            snapshotId: "snapshot-2",
            generation: 2,
            visibleText: looks < 3 ? "Saving…" : "All changes saved"
          })
        },
        wait: async (ms) => {
          pauses.push(ms)
        },
        now: () => 10
      }),
      signal
    })
    expect(outcome).toMatchObject({ outcome: "confirmed" })
    expect(looks).toBe(3)
    /** Bounded gaps, sized from the timeout rather than a fixed tick. */
    expect(pauses).toEqual([5_000, 5_000])
  })

  it("covers the whole named window, not one interval short of it", async () => {
    /**
     * Six looks leave five gaps. Spacing every gap evenly ended a
     * thirty-second wait at twenty-five seconds and reported a condition
     * that arrived in the last five absent — the run then re-planned work
     * that was about to succeed. The timeout is what the model was promised.
     */
    const command = {
      type: "wait",
      condition: "All changes saved",
      timeoutMs: 30_000,
      snapshotId: "snapshot-1",
      generation: 1
    } as const
    let clock = 2
    const looks: number[] = []
    const outcome = await verifyReadOnlyAgentEffect({
      verification: await verificationInput(command),
      adapter: verifierAdapter(observation(), {
        observe: async () => {
          looks.push(clock - 2)
          return observation({
            snapshotId: "snapshot-2",
            generation: 2,
            // Appears in the last stretch, which the old cadence never saw.
            visibleText: clock - 2 >= 30_000 ? "All changes saved" : "Saving…"
          })
        },
        wait: async (ms) => {
          clock += ms
        },
        now: () => clock
      }),
      signal
    })
    expect(looks).toEqual([0, 5_000, 10_000, 15_000, 20_000, 30_000])
    expect(outcome).toMatchObject({ outcome: "confirmed" })
  })

  it("gives up after a bounded number of looks", async () => {
    const command = {
      type: "wait",
      condition: "never appears",
      timeoutMs: 30_000,
      snapshotId: "snapshot-1",
      generation: 1
    } as const
    let looks = 0
    const outcome = await verifyReadOnlyAgentEffect({
      verification: await verificationInput(command),
      adapter: verifierAdapter(observation(), {
        observe: async () => {
          looks += 1
          return observation({
            snapshotId: "snapshot-2",
            generation: 2,
            visibleText: "Saving…"
          })
        },
        wait: async () => undefined,
        now: () => 10
      }),
      signal
    })
    expect(outcome).toMatchObject({ outcome: "negative" })
    // Every look is a full observation and the run pays for each one.
    expect(looks).toBe(6)
  })

  it("stops looking once the named timeout is spent", async () => {
    const command = {
      type: "wait",
      condition: "never appears",
      timeoutMs: 1_000,
      snapshotId: "snapshot-1",
      generation: 1
    } as const
    let looks = 0
    let clock = 2
    const outcome = await verifyReadOnlyAgentEffect({
      verification: await verificationInput(command),
      adapter: verifierAdapter(observation(), {
        observe: async () => {
          looks += 1
          return observation({
            snapshotId: "snapshot-2",
            generation: 2,
            visibleText: "Saving…"
          })
        },
        wait: async (ms) => {
          clock += ms
        },
        now: () => clock
      }),
      signal
    })
    expect(outcome).toMatchObject({ outcome: "negative" })
    // executedAt 2 plus a 1s budget, in 250ms steps: five looks, four gaps.
    expect(looks).toBe(5)
  })

  it("reads once where the host cannot pause between looks", async () => {
    const command = {
      type: "wait",
      condition: "never appears",
      timeoutMs: 30_000,
      snapshotId: "snapshot-1",
      generation: 1
    } as const
    let looks = 0
    const outcome = await verifyReadOnlyAgentEffect({
      verification: await verificationInput(command),
      adapter: verifierAdapter(
        observation({
          snapshotId: "snapshot-2",
          generation: 2,
          visibleText: "Saving…"
        }),
        {
          observe: async () => {
            looks += 1
            return observation({
              snapshotId: "snapshot-2",
              generation: 2,
              visibleText: "Saving…"
            })
          },
          now: () => 10
        }
      ),
      signal
    })
    expect(outcome).toMatchObject({ outcome: "negative" })
    expect(looks).toBe(1)
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

describe("read-only Agent effects across frames", () => {
  it("scrolls a child-frame target through that frame's identity", async () => {
    const base = observation()
    const before: AgentObservation = {
      ...base,
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
          generation: 5
        }
      ],
      elements: [
        {
          ref: "f2e1",
          frameId: 2,
          tag: "button",
          name: "More",
          visible: true,
          enabled: true,
          editable: false,
          sensitive: false
        }
      ]
    }
    const scroll = vi.fn(async () => undefined)
    const effect = await authorize(
      {
        type: "scroll",
        direction: "down",
        ref: "f2e1",
        snapshotId: "snapshot-1",
        generation: 1
      },
      before
    )
    const getFrame = vi.fn(async (_tabId: number, frameId: number) => ({
      documentId: frameId === 0 ? "document-1" : "document-2",
      url:
        frameId === 0
          ? "https://example.com/start"
          : "https://example.com/child"
    }))
    await executeReadOnlyAgentEffect({
      effect,
      adapter: executorAdapter({ scroll, getFrame }),
      signal
    })
    expect(getFrame).toHaveBeenCalledWith(7, 2)
    expect(scroll).toHaveBeenCalledWith(
      effect.command,
      effect.snapshotIdentity,
      {
        snapshotId: "snapshot-child",
        generation: 5,
        tabId: 7,
        frameId: 2,
        documentId: "document-2"
      },
      signal
    )
  })
})
