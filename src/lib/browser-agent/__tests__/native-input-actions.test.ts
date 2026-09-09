import {
  type AgentCancellationSignal,
  AgentEffectNotAppliedError,
  type AgentVerificationInput,
  type AuthorizedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentElement, AgentObservation } from "@ollama-client/contracts"
import { type AgentCommand, AgentCommandSchema } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  type AgentCommandExecutorAdapter,
  type AgentNativeControlFacts,
  executeDomMutationAgentEffect,
  executeReadOnlyAgentEffect
} from "../command-executor"
import {
  type AgentEffectVerifierAdapter,
  verifyDomMutationAgentEffect,
  verifyReadOnlyAgentEffect
} from "../effect-verifier"
import type { AgentNativeInputPlan } from "../native-input"
import {
  type AgentEffectResolverAdapter,
  resolveDomMutationAgentEffect,
  resolveReadOnlyAgentEffect
} from "../resolved-effect"

/**
 * The executor's contract with the native backend: chosen before the action,
 * never swapped after it, and recorded on the receipt the verifier reads.
 */

const signal: AgentCancellationSignal = { aborted: false }

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  frameId: 0,
  tag: "button",
  name: "Open",
  visible: true,
  enabled: true,
  editable: false,
  sensitive: false,
  ...overrides
})

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/app",
  origin: "https://example.com",
  title: "App",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/app",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [element()],
  visibleText: "Open",
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
})

const command = (input: Record<string, unknown>): AgentCommand =>
  AgentCommandSchema.parse({
    ...input,
    snapshotId: "snapshot-1",
    generation: 1
  })

const resolverAdapter: AgentEffectResolverAdapter = {
  getTab: async (tabId) => ({ id: tabId, url: observation().url }),
  classifyAccess: async () => "ok",
  resolveHistoryDestination: async () => undefined
}

const authorize = async (
  action: AgentCommand,
  before = observation()
): Promise<AuthorizedAgentEffect> => ({
  ...(await (action.type === "scroll"
    ? resolveReadOnlyAgentEffect
    : resolveDomMutationAgentEffect)({
    command: action,
    observation: before,
    adapter: resolverAdapter
  })),
  authorization: { type: "policy", risk: "low", authorizedAt: 2 }
})

const facts = (
  overrides: Partial<AgentNativeControlFacts> = {}
): AgentNativeControlFacts => ({
  cdpControl: true,
  attached: true,
  frameMapped: true,
  frameOffset: { x: 0, y: 0 },
  platform: "other",
  ...overrides
})

const adapter = (
  overrides: Partial<AgentCommandExecutorAdapter> = {}
): AgentCommandExecutorAdapter => ({
  getTab: async (tabId) => ({ id: tabId, url: observation().url }),
  getFrame: async () => ({ documentId: "document-1", url: observation().url }),
  classifyAccess: async () => "ok",
  scroll: vi.fn(),
  mutate: vi.fn(async () => undefined),
  nativeControl: vi.fn(async () => facts()),
  prepareNativeInput: vi.fn(async () => ({
    point: { x: 5, y: 5 },
    focused: false
  })),
  dispatchNativeInput: vi.fn(async (_effect, plan: AgentNativeInputPlan) => ({
    dispatched: plan.steps.length
  })),
  settleNativeInput: vi.fn(async () => ({
    events: [
      { type: "mousemove" as const, x: 5, y: 5, onTarget: true },
      { type: "mousedown" as const, x: 5, y: 5, onTarget: true },
      { type: "mouseup" as const, x: 5, y: 5, onTarget: true }
    ]
  })),
  viewportCentre: vi.fn(async () => ({ x: 50, y: 50 })),
  activateTab: vi.fn(),
  goHistory: vi.fn(),
  resolveHistoryDestination: async () => undefined,
  wait: vi.fn(async () => undefined),
  navigate: vi.fn(),
  createTab: vi.fn(),
  now: () => 10,
  ...overrides
})

describe("native input execution", () => {
  it("runs an activation click natively and records backend and delivery", async () => {
    const executor = adapter()
    const receipt = await executeDomMutationAgentEffect({
      effect: await authorize(command({ type: "click", ref: "e1" })),
      adapter: executor,
      signal
    })
    expect(receipt).toMatchObject({
      backend: "cdp",
      inputDelivery: "delivered"
    })
    expect(executor.mutate).not.toHaveBeenCalled()
    expect(executor.prepareNativeInput).toHaveBeenCalledOnce()
    expect(executor.dispatchNativeInput).toHaveBeenCalledOnce()
  })

  it("keeps a submitter click on the guarded DOM path even with a debugger attached", async () => {
    const executor = adapter()
    const before = observation({
      elements: [
        element({
          submitter: true,
          maySubmit: true,
          formAction: "https://example.com/submit",
          formMethod: "post"
        })
      ]
    })
    const receipt = await executeDomMutationAgentEffect({
      effect: await authorize(command({ type: "click", ref: "e1" }), before),
      adapter: executor,
      signal
    })
    expect(receipt.backend).toBe("dom")
    expect(executor.mutate).toHaveBeenCalledOnce()
    expect(executor.dispatchNativeInput).not.toHaveBeenCalled()
  })

  it("falls to the DOM backend before acting when the frame cannot be placed", async () => {
    const executor = adapter({
      nativeControl: vi.fn(async () =>
        facts({ frameMapped: false, frameOffset: undefined })
      )
    })
    const receipt = await executeDomMutationAgentEffect({
      effect: await authorize(command({ type: "hover", ref: "e1" })),
      adapter: executor,
      signal
    })
    expect(receipt.backend).toBe("dom")
    expect(executor.prepareNativeInput).not.toHaveBeenCalled()
    expect(executor.mutate).toHaveBeenCalledOnce()
  })

  it("never completes a plan on the DOM backend after native dispatch failed mid-way", async () => {
    const { AgentNativeInputFailedError } = await import("../native-input")
    const executor = adapter({
      dispatchNativeInput: vi.fn(async () => {
        throw new AgentNativeInputFailedError(2, new Error("detached"))
      })
    })
    await expect(
      executeDomMutationAgentEffect({
        effect: await authorize(command({ type: "click", ref: "e1" })),
        adapter: executor,
        signal
      })
    ).rejects.toBeInstanceOf(AgentNativeInputFailedError)
    expect(executor.mutate).not.toHaveBeenCalled()
  })

  it("treats a plan the debugger refused from its first step as a clean non-application", async () => {
    const { AgentNativeInputFailedError } = await import("../native-input")
    const executor = adapter({
      dispatchNativeInput: vi.fn(async () => {
        throw new AgentNativeInputFailedError(0, new Error("detached"))
      })
    })
    await expect(
      executeDomMutationAgentEffect({
        effect: await authorize(command({ type: "click", ref: "e1" })),
        adapter: executor,
        signal
      })
    ).rejects.toBeInstanceOf(AgentEffectNotAppliedError)
    expect(executor.mutate).not.toHaveBeenCalled()
  })

  it("reports delivery as unknown when the document cannot be asked afterwards", async () => {
    const executor = adapter({
      settleNativeInput: vi.fn(async () => {
        throw new Error("Agent control port closed")
      })
    })
    const receipt = await executeDomMutationAgentEffect({
      effect: await authorize(command({ type: "click", ref: "e1" })),
      adapter: executor,
      signal
    })
    expect(receipt).toMatchObject({ backend: "cdp", inputDelivery: "unknown" })
  })

  it("reports interference when the page received input the plan did not send", async () => {
    const executor = adapter({
      settleNativeInput: vi.fn(async () => ({
        events: [
          { type: "mousemove" as const, x: 5, y: 5, onTarget: true },
          { type: "mousedown" as const, x: 5, y: 5, onTarget: true },
          { type: "mouseup" as const, x: 5, y: 5, onTarget: true },
          { type: "keydown" as const, key: "x", onTarget: false }
        ]
      }))
    })
    const receipt = await executeDomMutationAgentEffect({
      effect: await authorize(command({ type: "click", ref: "e1" })),
      adapter: executor,
      signal
    })
    expect(receipt.inputDelivery).toBe("interference")
  })

  it("scrolls with a native wheel at the viewport centre when no element is named", async () => {
    const executor = adapter()
    const receipt = await executeReadOnlyAgentEffect({
      effect: await authorize(command({ type: "scroll", direction: "down" })),
      adapter: executor,
      signal
    })
    expect(receipt.backend).toBe("cdp")
    const plan = (
      executor.dispatchNativeInput as unknown as {
        mock: { calls: unknown[][] }
      }
    ).mock.calls[0]?.[1] as AgentNativeInputPlan
    expect(plan.steps).toEqual([
      { kind: "wheel", x: 50, y: 50, deltaX: 0, deltaY: 80 }
    ])
    expect(executor.scroll).not.toHaveBeenCalled()
  })

  it("keeps a referenced scroll on scrollIntoView", async () => {
    const executor = adapter()
    const receipt = await executeReadOnlyAgentEffect({
      effect: await authorize(
        command({ type: "scroll", direction: "down", ref: "e1" })
      ),
      adapter: executor,
      signal
    })
    expect(receipt.backend).toBe("dom")
    expect(executor.scroll).toHaveBeenCalledOnce()
  })
})

const verifierAdapter = (
  after: AgentObservation
): AgentEffectVerifierAdapter => ({
  observe: async () => after,
  getActiveTabId: async () => 7,
  getTab: async () => ({ url: after.url }),
  classifyAccess: async () => "ok",
  now: () => 10
})

const verify = async (
  action: AgentCommand,
  receipt: AgentVerificationInput["receipt"],
  after: AgentObservation,
  before = observation()
) => {
  const verification: AgentVerificationInput = {
    effect: await authorize(action, before),
    receipt,
    before,
    allowedOrigins: ["https://example.com"]
  }
  const run =
    action.type === "scroll"
      ? verifyReadOnlyAgentEffect
      : verifyDomMutationAgentEffect
  return run({ verification, adapter: verifierAdapter(after), signal })
}

describe("native input verification", () => {
  it("leaves a step unresolved when a user's input was observed during it", async () => {
    const result = await verify(
      command({ type: "click", ref: "e1" }),
      { executedAt: 5, backend: "cdp", inputDelivery: "interference" },
      observation({ visibleText: "Opened" })
    )
    expect(result.outcome).toBe("ambiguous")
    expect(result.evidence.summary).toMatch(/User input/)
  })

  it("does the same for input that landed elsewhere or was cut short", async () => {
    for (const inputDelivery of ["misdirected", "partial"] as const) {
      const result = await verify(
        command({ type: "type", ref: "e1", text: "x" }),
        { executedAt: 5, backend: "cdp", inputDelivery },
        observation({ elements: [element({ value: "x" })] }),
        observation({
          elements: [
            element({ tag: "input", type: "text", editable: true, value: "" })
          ]
        })
      )
      expect(result.outcome, inputDelivery).toBe("ambiguous")
    }
  })

  it("confirms a hover on delivery alone, and needs page change or delivery to confirm at all", async () => {
    const delivered = await verify(
      command({ type: "hover", ref: "e1" }),
      { executedAt: 5, backend: "cdp", inputDelivery: "delivered" },
      observation()
    )
    expect(delivered.outcome).toBe("confirmed")
    const unknown = await verify(
      command({ type: "hover", ref: "e1" }),
      { executedAt: 5, backend: "dom" },
      observation()
    )
    expect(unknown.outcome).toBe("ambiguous")
    const reacted = await verify(
      command({ type: "hover", ref: "e1" }),
      { executedAt: 5, backend: "dom" },
      observation({ visibleText: "Open Menu" })
    )
    expect(reacted.outcome).toBe("confirmed")
  })

  it("confirms a native scroll that moved an inner container by its visible text", async () => {
    const result = await verify(
      command({ type: "scroll", direction: "down" }),
      { executedAt: 5, backend: "cdp" },
      observation({ visibleText: "Further down" })
    )
    expect(result.outcome).toBe("confirmed")
    const synthetic = await verify(
      command({ type: "scroll", direction: "down" }),
      { executedAt: 5, backend: "dom" },
      observation({ visibleText: "Further down" })
    )
    expect(synthetic.outcome).toBe("negative")
  })

  it("reads a Shift+Tab as focus traversal", async () => {
    const before = observation({
      elements: [
        element({ tag: "input", type: "text", editable: true, focused: true }),
        element({
          ref: "e2",
          name: "Other",
          tag: "input",
          type: "text",
          editable: true
        })
      ]
    })
    const result = await verify(
      command({ type: "press_key", ref: "e1", key: "Shift+Tab" }),
      { executedAt: 5, backend: "cdp", inputDelivery: "delivered" },
      observation({
        elements: [
          element({ tag: "input", type: "text", editable: true }),
          element({
            ref: "e2",
            name: "Other",
            tag: "input",
            type: "text",
            editable: true,
            focused: true
          })
        ]
      }),
      before
    )
    expect(result.evidence.summary).toBe(
      "Keyboard focus moved to another control"
    )
  })
})

describe("activation evidence after a native click", () => {
  it("does not credit a silent button for merely taking focus", async () => {
    const result = await verify(
      command({ type: "click", ref: "e1" }),
      { executedAt: 5, backend: "cdp", inputDelivery: "delivered" },
      observation({ elements: [element({ focused: true })] })
    )
    expect(result.outcome).toBe("ambiguous")
  })

  it("confirms a click that lands focus on a widget that takes input", async () => {
    const before = observation({
      elements: [element({ tag: "ul", role: "listbox", name: "Size" })]
    })
    const result = await verify(
      command({ type: "click", ref: "e1" }),
      { executedAt: 5, backend: "cdp", inputDelivery: "delivered" },
      observation({
        elements: [
          element({ tag: "ul", role: "listbox", name: "Size", focused: true })
        ]
      }),
      before
    )
    expect(result.outcome).toBe("confirmed")
    expect(result.evidence.summary).toMatch(/took focus/)
  })
})
