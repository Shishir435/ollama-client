import type { AgentCommand } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { evaluateAgentPolicy } from "../policy"
import type {
  AgentPolicyInput,
  AgentSemanticEffect,
  ResolvedAgentEffect
} from "../ports"

const command: AgentCommand = {
  type: "click",
  ref: "button",
  snapshotId: "snapshot-1",
  generation: 1
}

const effect = (
  semanticEffects: readonly AgentSemanticEffect[],
  overrides: Partial<ResolvedAgentEffect> = {}
): ResolvedAgentEffect => ({
  command,
  target: { sensitive: false, maySubmit: false, accessibleName: "Continue" },
  semanticEffects,
  snapshotIdentity: {
    snapshotId: "snapshot-1",
    generation: 1,
    tabId: 1,
    frameId: 0,
    documentId: "document-1"
  },
  sourceUrl: "https://example.com/",
  sourceOrigin: "https://example.com",
  ...overrides
})

const input = (
  resolved: ResolvedAgentEffect,
  overrides: Partial<AgentPolicyInput> = {}
): AgentPolicyInput => ({
  runId: "run-1",
  stepId: "step-1",
  effect: resolved,
  allowedOrigins: ["https://example.com"],
  scopedTabIds: [1],
  now: 100,
  ...overrides
})

describe("resolved-effect policy", () => {
  it("derives risk from target semantics rather than command name", () => {
    expect(evaluateAgentPolicy(input(effect(["read"])))).toEqual({
      type: "allow",
      risk: "low"
    })
  })

  it("classifies click on a submit control as critical", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["submission"], {
          target: { sensitive: false, maySubmit: true }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("critical")
  })

  it("classifies Enter that may submit as critical", () => {
    const enter: AgentCommand = {
      type: "press_key",
      key: "Enter",
      ref: "input",
      snapshotId: "snapshot-1",
      generation: 1
    }
    const decision = evaluateAgentPolicy(
      input(
        effect(["form_mutation"], {
          command: enter,
          target: { sensitive: false, maySubmit: true }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("critical")
  })

  it("requires approval for a new origin", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["navigation"], {
          destination: {
            url: "https://other.example/path",
            origin: "https://other.example",
            source: "observed"
          }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("high")
  })

  it("shows a complete model-constructed URL with query parameters", () => {
    const url = "https://example.com/search?q=private%20query&sort=new"
    const decision = evaluateAgentPolicy(
      input(
        effect(["navigation"], {
          destination: {
            url,
            origin: "https://example.com",
            source: "model"
          }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    if (decision.type === "approval_required") {
      expect(decision.request.consequence).toContain(url)
    }
  })

  it("blocks a composed destination carrying a value the user typed", () => {
    expect(
      evaluateAgentPolicy(
        input(
          effect(["navigation"], {
            destination: {
              url: "https://example.com/collect?d=typed",
              origin: "https://example.com",
              source: "model",
              pageDataEvidence: "field_value"
            }
          })
        )
      )
    ).toEqual({
      type: "blocked",
      risk: "critical",
      reason: "private_data_egress"
    })
  })

  it("requires approval for a composed destination carrying page text", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["navigation"], {
          destination: {
            url: "https://example.com/search?q=page+text",
            origin: "https://example.com",
            source: "model",
            pageDataEvidence: "visible_text"
          }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("critical")
  })

  it("does not charge a link the page rendered for carrying its own data", () => {
    expect(
      evaluateAgentPolicy(
        input(
          effect(["navigation"], {
            destination: {
              url: "https://example.com/next?token=abc",
              origin: "https://example.com",
              source: "observed",
              pageDataEvidence: "field_value"
            }
          })
        )
      )
    ).toEqual({ type: "allow", risk: "medium" })
  })

  it.each([
    "javascript:alert(1)",
    "data:text/plain,secret",
    "file:///tmp/a"
  ])("blocks non-http and non-https destination %s", (url) => {
    expect(
      evaluateAgentPolicy(
        input(
          effect(["navigation"], {
            destination: { url, origin: "null", source: "model" }
          })
        )
      )
    ).toEqual({
      type: "blocked",
      risk: "critical",
      reason: "unsupported_scheme"
    })
  })

  it.each([
    "authentication",
    "payment"
  ] as const)("requires takeover for %s destinations", (semanticEffect) => {
    expect(evaluateAgentPolicy(input(effect([semanticEffect]))).type).toBe(
      "takeover_required"
    )
  })

  it("requires takeover for sensitive inputs", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["form_mutation"], {
          target: { sensitive: true, maySubmit: false, inputType: "password" }
        })
      )
    )
    expect(decision.type).toBe("takeover_required")
  })

  it("does not let destructive-language evidence lower risk", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["destructive"], {
          target: {
            sensitive: false,
            maySubmit: false,
            accessibleName: "Looks harmless"
          }
        })
      )
    )
    expect(decision.risk).toBe("critical")
  })

  it("remains safe when destructive language is unrecognized", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["submission"], {
          target: {
            sensitive: false,
            maySubmit: true,
            accessibleName: "完全に消去"
          }
        })
      )
    )
    expect(decision.risk).toBe("critical")
  })

  it("does not allow page observations to expand the origin allowlist", () => {
    const policyInput = {
      ...input(
        effect(["navigation"], {
          destination: {
            url: "https://other.example",
            origin: "https://other.example",
            source: "observed"
          }
        })
      ),
      pageSuggestedOrigins: ["https://other.example"]
    }
    expect(evaluateAgentPolicy(policyInput).type).toBe("approval_required")
  })

  const grant = (
    effects: ("activation" | "form_mutation")[] = ["activation"],
    origin = "https://example.com"
  ) => ({ origin, effects, grantedAt: 1 })

  it("offers widening only for what may be widened", () => {
    const offered = evaluateAgentPolicy(input(effect(["activation"])))
    expect(offered).toMatchObject({
      type: "approval_required",
      request: { origin: "https://example.com", grantable: ["activation"] }
    })

    // Critical arrives with no offer attached, so the panel cannot render one.
    const critical = evaluateAgentPolicy(input(effect(["submission"])))
    expect(critical).toMatchObject({ type: "approval_required" })
    if (critical.type === "approval_required") {
      expect(critical.request.grantable).toBeUndefined()
      expect(critical.request.origin).toBeUndefined()
    }
  })

  it("allows a granted class on the granted origin", () => {
    expect(
      evaluateAgentPolicy(input(effect(["activation"]), { grants: [grant()] }))
    ).toEqual({
      type: "granted",
      risk: "high",
      origin: "https://example.com"
    })
  })

  it("still asks for a class the grant does not name", () => {
    expect(
      evaluateAgentPolicy(
        input(effect(["form_mutation"]), { grants: [grant(["activation"])] })
      ).type
    ).toBe("approval_required")
  })

  it("never lets a grant cover a critical effect", () => {
    // Submission, destruction, payment, authentication and sensitive input
    // are the prompts that have to keep meaning something.
    for (const critical of ["submission", "destructive", "payment"] as const) {
      expect(
        evaluateAgentPolicy(
          input(effect(["activation", critical]), {
            grants: [grant(["activation", "form_mutation"])]
          })
        ).type
      ).not.toBe("granted")
    }
  })

  it("never lets a grant cover another origin", () => {
    expect(
      evaluateAgentPolicy(
        input(effect(["activation"]), {
          grants: [grant(["activation"], "https://other.example")]
        })
      ).type
    ).toBe("approval_required")
  })

  it("never lets a grant cover a destination leaving its origin", () => {
    expect(
      evaluateAgentPolicy(
        input(
          effect(["activation"], {
            destination: {
              url: "https://other.example/next",
              origin: "https://other.example",
              source: "observed"
            }
          }),
          { grants: [grant()] }
        ).valueOf() as AgentPolicyInput
      ).type
    ).toBe("approval_required")
  })

  it("never lets a grant cover an origin the run is not allowed on", () => {
    expect(
      evaluateAgentPolicy(
        input(effect(["activation"]), {
          allowedOrigins: [],
          grants: [grant()]
        })
      ).type
    ).not.toBe("granted")
  })
})

describe("tab scope policy", () => {
  const switchTab = (tabId: number): ResolvedAgentEffect => ({
    command: {
      type: "switch_tab",
      tabId,
      snapshotId: "snapshot-1",
      generation: 1
    },
    target: { sensitive: false, maySubmit: false },
    destination: {
      url: "https://example.com/other",
      origin: "https://example.com",
      source: "browser"
    },
    semanticEffects: ["navigation"],
    snapshotIdentity: {
      snapshotId: "snapshot-1",
      generation: 1,
      tabId: 1,
      frameId: 0,
      documentId: "document-1"
    },
    sourceUrl: "https://example.com/",
    sourceOrigin: "https://example.com"
  })

  it("lets the run switch between the tabs it already drives", () => {
    expect(
      evaluateAgentPolicy(input(switchTab(2), { scopedTabIds: [1, 2] }))
    ).toEqual({ type: "allow", risk: "medium" })
  })

  it("asks before adopting a tab outside the run's scope, whatever its origin", () => {
    const decision = evaluateAgentPolicy(
      input(switchTab(9), { scopedTabIds: [1] })
    )
    expect(decision).toMatchObject({
      type: "approval_required",
      risk: "high",
      request: { action: "Adopt tab 9 at https://example.com/other" }
    })
  })
})
