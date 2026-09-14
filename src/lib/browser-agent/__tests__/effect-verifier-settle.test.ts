import type {
  AgentCancellationSignal,
  AgentVerificationInput,
  ResolvedAgentEffect
} from "@ollama-client/agent-runtime"
import type { AgentElement, AgentObservation } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import {
  type AgentEffectVerifierAdapter,
  verifyDomMutationAgentEffect
} from "../effect-verifier"

const signal: AgentCancellationSignal = { aborted: false }

const element = (overrides: Partial<AgentElement> = {}): AgentElement => ({
  ref: "e1",
  frameId: 0,
  tag: "button",
  name: "Save",
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
  url: "https://example.com/form",
  origin: "https://example.com",
  title: "Form",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/form",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [element()],
  visibleText: "Save",
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

const effect = (
  overrides: Partial<ResolvedAgentEffect> = {}
): ResolvedAgentEffect => ({
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
    accessibleName: "Save",
    sensitive: false,
    maySubmit: false
  },
  semanticEffects: ["activation"],
  snapshotIdentity: {
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 7,
    frameId: 0,
    documentId: "document-1"
  },
  sourceUrl: "https://example.com/form",
  sourceOrigin: "https://example.com",
  ...overrides
})

/**
 * A host that can pause, with a clock that only moves when it does. Real time
 * is never waited on: what is under test is how the verifier spends the
 * window, so the window has to be observable rather than endured.
 */
const settlingAdapter = (pages: AgentObservation[]) => {
  const looks: number[] = []
  const waits: number[] = []
  let clock = 0
  const adapter: AgentEffectVerifierAdapter = {
    async observe() {
      looks.push(clock)
      return pages[Math.min(looks.length - 1, pages.length - 1)]
    },
    getActiveTabId: async () => 7,
    getTab: async () => ({ url: "https://example.com/form" }),
    classifyAccess: async () => "ok",
    async wait(ms) {
      waits.push(ms)
      clock += ms
    },
    now: () => clock
  }
  return { adapter, looks, waits }
}

const verify = (
  pages: AgentObservation[],
  overrides: Partial<ResolvedAgentEffect> = {},
  before = observation()
) => {
  const { adapter, looks, waits } = settlingAdapter(pages)
  const verification: AgentVerificationInput = {
    effect: {
      ...effect(overrides),
      authorization: {
        type: "approval",
        risk: "high",
        approvalId: "a1",
        authorizedAt: 2
      }
    },
    receipt: { executedAt: 0, inputDelivery: "delivered" },
    before,
    allowedOrigins: ["https://example.com"]
  }
  return verifyDomMutationAgentEffect({ verification, adapter, signal }).then(
    (result) => ({ result, looks, waits })
  )
}

describe("Agent effect settle window", () => {
  it("confirms an effect that lands after the first look", async () => {
    /**
     * The live failure: a click whose consequence appeared 1.2 seconds later
     * verified `ambiguous`, which pauses the run for the user as an
     * unresolved effect — three seconds after a step that had worked.
     */
    const { result, looks } = await verify([
      observation(),
      observation({ visibleText: "Save — All changes saved" })
    ])
    expect(result.outcome).toBe("confirmed")
    expect(looks).toHaveLength(2)
  })

  it("returns the moment the effect is there rather than sleeping", async () => {
    const { result, looks, waits } = await verify([
      observation({ visibleText: "Save — All changes saved" })
    ])
    expect(result.outcome).toBe("confirmed")
    expect(looks).toEqual([0])
    expect(waits).toEqual([])
  })

  it("still reports an unresolved effect once the window is spent", async () => {
    // The pause for a genuinely unknown outcome is not weakened; it is only
    // given a couple of seconds to stop being unknown.
    const { result, looks, waits } = await verify([observation()])
    expect(result.outcome).toBe("ambiguous")
    expect(looks).toHaveLength(4)
    expect(waits.reduce((total, ms) => total + ms, 0)).toBe(2_000)
  })

  it("does not re-read a conclusive negative", async () => {
    /**
     * A negative is a conclusion drawn from evidence the page already gave.
     * Looking again would cost every honest step two seconds to learn
     * nothing, and a negative lets the run re-decide immediately.
     */
    const field = element({ tag: "input", type: "text", value: "before" })
    const before = observation({ elements: [field] })
    const { result, looks } = await verify(
      [before],
      {
        command: {
          type: "type",
          ref: "e1",
          text: "after",
          snapshotId: "snapshot-1",
          generation: 1
        },
        semanticEffects: ["form_mutation"],
        target: {
          ref: "e1",
          frameId: 0,
          tag: "input",
          inputType: "text",
          accessibleName: "Save",
          observedValue: "before",
          expectedValue: "beforeafter",
          sensitive: false,
          maySubmit: false
        }
      },
      before
    )
    expect(result.outcome).toBe("negative")
    expect(looks).toHaveLength(1)
  })

  it("does not spend the window on a settled input-delivery problem", async () => {
    /**
     * Interference, a misdirected plan and a held file chooser are facts
     * about what happened to the input. Reading the page four more times
     * cannot change any of them, so the settle window sits inside the
     * delivery check rather than around it.
     */
    const { adapter, looks } = settlingAdapter([observation()])
    const result = await verifyDomMutationAgentEffect({
      verification: {
        effect: {
          ...effect(),
          authorization: {
            type: "approval",
            risk: "high",
            approvalId: "a1",
            authorizedAt: 2
          }
        },
        receipt: { executedAt: 0, inputDelivery: "interference" },
        before: observation(),
        allowedOrigins: ["https://example.com"]
      },
      adapter,
      signal
    })
    expect(result.outcome).toBe("ambiguous")
    expect(looks).toHaveLength(0)
  })

  it("reads once when the host cannot pause between looks", async () => {
    const { adapter, looks } = settlingAdapter([observation()])
    const result = await verifyDomMutationAgentEffect({
      verification: {
        effect: {
          ...effect(),
          authorization: {
            type: "approval",
            risk: "high",
            approvalId: "a1",
            authorizedAt: 2
          }
        },
        receipt: { executedAt: 0, inputDelivery: "delivered" },
        before: observation(),
        allowedOrigins: ["https://example.com"]
      },
      adapter: { ...adapter, wait: undefined },
      signal
    })
    expect(result.outcome).toBe("ambiguous")
    expect(looks).toHaveLength(1)
  })
})
