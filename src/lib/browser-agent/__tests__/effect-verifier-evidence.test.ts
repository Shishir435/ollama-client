import type {
  AgentCancellationSignal,
  AgentExecutionReceipt,
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

const adapterFor = (pages: AgentObservation[]) => {
  const looks: number[] = []
  let clock = 0
  const adapter: AgentEffectVerifierAdapter = {
    async observe() {
      looks.push(clock)
      return pages[Math.min(looks.length - 1, pages.length - 1)]
    },
    getTab: async () => ({ url: "https://example.com/form" }),
    classifyAccess: async () => "ok",
    async wait(ms) {
      clock += ms
    },
    now: () => clock
  }
  return { adapter, looks }
}

const run = (
  adapter: AgentEffectVerifierAdapter,
  overrides: Partial<ResolvedAgentEffect> = {},
  receipt: Partial<AgentExecutionReceipt> = {},
  before = observation()
) =>
  verifyDomMutationAgentEffect({
    verification: {
      effect: {
        ...effect(overrides),
        authorization: {
          type: "approval",
          risk: "high",
          approvalId: "a1",
          authorizedAt: 2
        }
      },
      receipt: { executedAt: 0, inputDelivery: "delivered", ...receipt },
      before,
      allowedOrigins: ["https://example.com"]
    },
    adapter,
    signal
  })

describe("a checkbox a controlled component updates late", () => {
  const checkbox = (checked: boolean) =>
    element({ tag: "input", type: "checkbox", name: "Agree", checked })
  const checkEffect: Partial<ResolvedAgentEffect> = {
    command: {
      type: "check",
      ref: "e1",
      snapshotId: "snapshot-1",
      generation: 1
    },
    semanticEffects: ["form_mutation"],
    target: {
      ref: "e1",
      frameId: 0,
      tag: "input",
      inputType: "checkbox",
      accessibleName: "Agree",
      observedChecked: false,
      expectedChecked: true,
      sensitive: false,
      maySubmit: false
    }
  }

  it("re-reads and confirms once the state arrives", async () => {
    const before = observation({ elements: [checkbox(false)] })
    const { adapter, looks } = adapterFor([
      before,
      observation({ elements: [checkbox(true)] })
    ])
    const result = await run(adapter, checkEffect, {}, before)
    expect(result.outcome).toBe("confirmed")
    expect(looks).toHaveLength(2)
  })

  it("is negative only when the state is still unchanged after the window", async () => {
    const before = observation({ elements: [checkbox(false)] })
    const { adapter, looks } = adapterFor([before])
    const result = await run(adapter, checkEffect, {}, before)
    expect(result.outcome).toBe("negative")
    expect(looks).toHaveLength(4)
  })
})

describe("a page that says the outcome is unknown", () => {
  it("is ambiguous, not a confirmed page change", async () => {
    const { adapter } = adapterFor([
      observation({ visibleText: "Save Request acknowledged; outcome unknown" })
    ])
    const result = await run(adapter)
    expect(result.outcome).toBe("ambiguous")
  })

  it("still confirms an ordinary change", async () => {
    const { adapter } = adapterFor([observation({ visibleText: "Save Saved" })])
    expect((await run(adapter)).outcome).toBe("confirmed")
  })
})

describe("a failed write against a success toast", () => {
  it("is negative and says a retry is allowed", async () => {
    const { adapter } = adapterFor([
      observation({ visibleText: "Save Saved!" })
    ])
    const result = await run(adapter, {}, { failedWrites: [500] })
    expect(result.outcome).toBe("negative")
    expect(result.evidence.summary).toContain("HTTP 500")
    expect(result.evidence.summary).toContain("may be tried again")
  })

  it("catches a write that failed while the page was being read", async () => {
    const failedWrites: number[] = []
    const { adapter } = adapterFor([observation({ visibleText: "Saved!" })])
    const observe = adapter.observe
    adapter.observe = async (...args) => {
      failedWrites.push(503)
      return observe(...args)
    }
    const result = await run(adapter, {}, { failedWrites })
    expect(result.outcome).toBe("negative")
  })

  it("leaves a toast alone when no write failed", async () => {
    const { adapter } = adapterFor([observation({ visibleText: "Saved!" })])
    const result = await run(adapter, {}, { failedWrites: [] })
    expect(result.outcome).toBe("confirmed")
  })
})

describe("a link the page's own script navigates", () => {
  const pressed: Partial<AgentExecutionReceipt> = { backend: "cdp" }
  const linkEffect: Partial<ResolvedAgentEffect> = {
    target: {
      ref: "e1",
      frameId: 0,
      tag: "a",
      role: "link",
      accessibleName: "Next",
      href: "https://example.com/next",
      sensitive: false,
      maySubmit: false
    },
    destination: {
      url: "https://example.com/next",
      source: "observed",
      origin: "https://example.com"
    }
  }

  it("confirms when the tab moved elsewhere on the origin", async () => {
    const { adapter } = adapterFor([
      observation({
        url: "https://example.com/other",
        visibleText: "Other page"
      })
    ])
    adapter.waitForNavigation = async () => undefined
    expect((await run(adapter, linkEffect, pressed)).outcome).toBe("confirmed")
  })

  it("confirms when a router swapped the content in place", async () => {
    const { adapter } = adapterFor([observation({ visibleText: "Next step" })])
    adapter.waitForNavigation = async () => undefined
    expect((await run(adapter, linkEffect, pressed)).outcome).toBe("confirmed")
  })

  it("keeps a move to another origin for review", async () => {
    const { adapter } = adapterFor([
      observation({
        url: "https://other.example/x",
        origin: "https://other.example"
      })
    ])
    adapter.waitForNavigation = async () => undefined
    expect((await run(adapter, linkEffect, pressed)).outcome).toBe("ambiguous")
  })
})
