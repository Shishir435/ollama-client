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
    documentId: "document-1"
  },
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
})
