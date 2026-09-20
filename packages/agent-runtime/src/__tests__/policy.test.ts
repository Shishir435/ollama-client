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

  it("classifies click on a submit control as a grantable approval", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["submission"], {
          target: { sensitive: false, maySubmit: true }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("high")
    /**
     * High rather than critical is the whole point: a submission still costs
     * an approval, and the user may now answer it once for this origin. As
     * critical it could never be answered in advance, so an agent asked to
     * post ten comments asked a human for ten final clicks.
     */
    expect(
      decision.type === "approval_required" && decision.request.grantable
    ).toEqual(["submission"])
  })

  it("classifies Enter that may submit as a submission", () => {
    const enter: AgentCommand = {
      type: "press_key",
      key: "Enter",
      ref: "input",
      snapshotId: "snapshot-1",
      generation: 1
    }
    /**
     * The resolver classifies Enter in a field that submits on it as a
     * submission, and the submission is what costs critical. The target's
     * `maySubmit` is not asked a second time: it is true of every field on a
     * submit path, typing included.
     */
    const decision = evaluateAgentPolicy(
      input(
        effect(["form_mutation", "submission"], {
          command: enter,
          target: { sensitive: false, maySubmit: true }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("high")
  })

  it("prices typing into a field on a submit path as a form mutation", () => {
    const typing: AgentCommand = {
      type: "type",
      text: "sunglasses",
      ref: "input",
      snapshotId: "snapshot-1",
      generation: 1
    }
    const decision = evaluateAgentPolicy(
      input(
        effect(["form_mutation"], {
          command: typing,
          target: { sensitive: false, maySubmit: true }
        })
      )
    )
    expect(decision.type).toBe("approval_required")
    expect(decision.risk).toBe("high")
    /**
     * The point of the change: high is grantable, so filling in a search box
     * costs one prompt for the origin rather than one per field. Critical
     * never is, which is why pricing typing as a submission trained the user
     * to approve without reading.
     */
    expect(
      decision.type === "approval_required" && decision.request.grantable
    ).toEqual(["form_mutation"])
  })

  it("covers later typing on a granted origin without asking again", () => {
    const typing: AgentCommand = {
      type: "type",
      text: "sunglasses",
      ref: "input",
      snapshotId: "snapshot-1",
      generation: 1
    }
    const decision = evaluateAgentPolicy({
      ...input(
        effect(["form_mutation"], {
          command: typing,
          target: { sensitive: false, maySubmit: true }
        })
      ),
      grants: [
        {
          origin: "https://example.com",
          effects: ["form_mutation"],
          grantedAt: 1
        }
      ]
    })
    expect(decision).toEqual({
      type: "granted",
      risk: "high",
      origin: "https://example.com"
    })
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

  it("blocks a composed destination carrying a value the run read off the page", () => {
    expect(
      evaluateAgentPolicy(
        input(
          effect(["navigation"], {
            destination: {
              url: "https://example.com/collect?d=4111111111111111",
              origin: "https://example.com",
              source: "model",
              pageDataEvidence: "field_value"
            }
          }),
          { authoredText: ["Find the cheapest flight to Lisbon"] }
        )
      )
    ).toEqual({
      type: "blocked",
      risk: "critical",
      reason: "private_data_egress"
    })
  })

  it("blocks it just as firmly when the run cannot say what it authored", () => {
    // No authored words is not a claim of authorship: receipts that could not
    // be read leave the rule exactly as strict as it was before provenance.
    expect(
      evaluateAgentPolicy(
        input(
          effect(["navigation"], {
            destination: {
              url: "https://example.com/collect?d=4111111111111111",
              origin: "https://example.com",
              source: "model",
              pageDataEvidence: "field_value"
            }
          })
        )
      )
    ).toMatchObject({ type: "blocked", reason: "private_data_egress" })
  })

  it("lets the run search for the words the goal gave it", () => {
    /**
     * The live failure: the run typed the user's own query into the search
     * box and followed the site's own search URL, so the query was a field
     * value and the rule killed the run for exfiltrating it. Text that came
     * from the goal is not data the run read off the page.
     */
    const decision = evaluateAgentPolicy(
      input(
        effect(["navigation"], {
          destination: {
            url: "https://example.com/?q=ollama+browser+extension",
            origin: "https://example.com",
            source: "model",
            pageDataEvidence: "field_value"
          }
        }),
        {
          authoredText: [
            "Search for ollama browser extension and summarise the first result"
          ]
        }
      )
    )
    expect(decision.type).toBe("approval_required")
    /** The destination raise is untouched: the user still sees the whole URL. */
    expect(decision.risk).toBe("high")
  })

  it("lets the run search for the words it typed itself", () => {
    const decision = evaluateAgentPolicy(
      input(
        effect(["navigation"], {
          destination: {
            url: "https://example.com/?q=lisbon+flights+in+may",
            origin: "https://example.com",
            source: "model",
            pageDataEvidence: "field_value"
          }
        }),
        { authoredText: ["Book me a holiday", "lisbon flights in may"] }
      )
    )
    expect(decision.type).toBe("approval_required")
  })

  it("still blocks a URL that mixes the goal's words with the page's", () => {
    // One authored phrase does not authorize the parameter beside it.
    expect(
      evaluateAgentPolicy(
        input(
          effect(["navigation"], {
            destination: {
              url: "https://example.com/?q=ollama+browser+extension&d=4111111111111111",
              origin: "https://example.com",
              source: "model",
              pageDataEvidence: "field_value"
            }
          }),
          { authoredText: ["Search for ollama browser extension"] }
        )
      )
    ).toMatchObject({ type: "blocked", reason: "private_data_egress" })
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
    /**
     * A submission whose label the reader cannot parse is still a submission
     * and still costs an approval. What makes a wipe critical is the
     * `destructive` class the resolver attaches, never the wording: a rule
     * that read labels would be a rule a page could write.
     */
    const decision = evaluateAgentPolicy(
      input(
        effect(["submission", "destructive"], {
          target: {
            sensitive: false,
            maySubmit: true,
            accessibleName: "完全に消去"
          }
        })
      )
    )
    expect(decision.risk).toBe("critical")
    expect(
      decision.type === "approval_required" && decision.request.grantable
    ).toBeUndefined()
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
    effects: ("activation" | "form_mutation" | "submission")[] = ["activation"],
    origin = "https://example.com"
  ) => ({ origin, effects, grantedAt: 1 })

  it("offers widening only for what may be widened", () => {
    const offered = evaluateAgentPolicy(input(effect(["activation"])))
    expect(offered).toMatchObject({
      type: "approval_required",
      request: { origin: "https://example.com", grantable: ["activation"] }
    })

    // Critical arrives with no offer attached, so the panel cannot render one.
    const critical = evaluateAgentPolicy(input(effect(["destructive"])))
    expect(critical).toMatchObject({ type: "approval_required" })
    if (critical.type === "approval_required") {
      expect(critical.request.grantable).toBeUndefined()
      expect(critical.request.origin).toBeUndefined()
    }

    // A submission riding along with a critical class is not widenable either.
    const mixed = evaluateAgentPolicy(input(effect(["submission", "payment"])))
    expect(mixed.type).toBe("takeover_required")
  })

  it("does not re-prompt a submission the user granted for this origin", () => {
    /**
     * The point of moving submission off critical. One "always allow this on
     * this site for this run" covers the tenth comment as well as the first;
     * before this the answer to every one of them was another prompt.
     */
    expect(
      evaluateAgentPolicy(
        input(effect(["submission"]), { grants: [grant(["submission"])] })
      )
    ).toEqual({
      type: "granted",
      risk: "high",
      origin: "https://example.com"
    })
  })

  it("does not let a submission grant cover a destructive one", () => {
    expect(
      evaluateAgentPolicy(
        input(effect(["submission", "destructive"]), {
          grants: [grant(["submission"])]
        })
      )
    ).toMatchObject({ type: "approval_required", risk: "critical" })
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

describe("child frame policy", () => {
  const grant = {
    origin: "https://example.com",
    effects: ["activation" as const],
    grantedAt: 1
  }
  const framed = effect(["activation"], {
    frameUrl: "https://widgets.example/login",
    frameOrigin: "https://widgets.example"
  })

  it("does not spend a page grant on a frame from another site", () => {
    const decision = evaluateAgentPolicy(
      input(framed, {
        allowedOrigins: ["https://example.com", "https://widgets.example"],
        grants: [grant]
      })
    )
    expect(decision).toMatchObject({ type: "approval_required", risk: "high" })
    expect(
      (decision as { request?: { origin?: string } }).request?.origin
    ).toBe("https://widgets.example")
  })

  it("spends a grant given for the frame's own site", () => {
    expect(
      evaluateAgentPolicy(
        input(framed, {
          allowedOrigins: ["https://example.com", "https://widgets.example"],
          grants: [{ ...grant, origin: "https://widgets.example" }]
        })
      )
    ).toEqual({
      type: "granted",
      risk: "high",
      origin: "https://widgets.example"
    })
  })

  it("treats a frame on an origin outside the allowlist as a new site", () => {
    expect(evaluateAgentPolicy(input(effect(["read"], framed)))).toMatchObject({
      type: "approval_required",
      risk: "high"
    })
  })
})

describe("a batched fill's approval", () => {
  const field = (name: string, value: string) => ({
    command: {
      type: "clear_and_type" as const,
      ref: name,
      text: value,
      snapshotId: "snapshot-1",
      generation: 1
    },
    target: {
      ref: name,
      sensitive: false,
      maySubmit: false,
      accessibleName: name
    }
  })

  type BatchField = {
    command: AgentCommand
    target: ResolvedAgentEffect["target"]
  }

  const batch = (fields: BatchField[]): ReturnType<typeof effect> =>
    effect(["form_mutation"], {
      command: {
        type: "fill_form",
        snapshotId: "snapshot-1",
        generation: 1,
        fields: fields.map((entry) => entry.command)
      } as AgentCommand,
      target: fields[0].target,
      batch: { fields }
    })

  it("names every control it will set, not just the first", () => {
    /**
     * One approval stands in for the several the user would otherwise have
     * answered, so it owes the disclosure all of them would have made. Naming
     * the first of six and a count was a weaker prompt than the six it
     * replaced, which is the one thing batching may not cost.
     */
    const decision = evaluateAgentPolicy(
      input(
        batch([
          field("Given name", "Ada"),
          field("Family name", "Lovelace"),
          field("City", "London")
        ])
      )
    )
    expect(decision.type).toBe("approval_required")
    const request =
      decision.type === "approval_required" ? decision.request : undefined
    expect(request?.action).toBe("Set 3 form fields in one step")
    expect(request?.pageEvidence).toBe("1. Given name\n2. Family name\n3. City")
  })

  it("says what a batch cannot do without promising what the page will not", () => {
    /**
     * It cannot click, so it cannot press submit — that much the run knows.
     * Whether the page stored anything is the page's business: a field that
     * saves as you type has already saved by the time the batch moves on, and
     * an approval that said "nothing is submitted" invited the user to read
     * that as "nothing is kept".
     */
    const decision = evaluateAgentPolicy(
      input(batch([field("City", "London")]))
    )
    const request =
      decision.type === "approval_required" ? decision.request : undefined
    expect(request?.consequence).toContain("cannot submit the form")
    expect(request?.consequence).toContain("saves as you type")
    expect(request?.consequence).not.toContain("nothing is submitted")
  })

  it("names an unnamed control by what the page does say about it", () => {
    const anonymous = {
      command: {
        type: "check" as const,
        ref: "e9",
        snapshotId: "snapshot-1",
        generation: 1
      },
      target: {
        ref: "e9",
        sensitive: false,
        maySubmit: false,
        tag: "input",
        inputType: "checkbox"
      }
    }
    const decision = evaluateAgentPolicy(
      input(batch([field("City", "London"), anonymous]))
    )
    const request =
      decision.type === "approval_required" ? decision.request : undefined
    expect(request?.pageEvidence).toBe("1. City\n2. checkbox")
  })

  it("keeps the list inside the bound the request schema allows", () => {
    const many = Array.from({ length: 12 }, (_value, index) =>
      field(`Field ${index} ${"n".repeat(120)}`, "x")
    )
    const decision = evaluateAgentPolicy(input(batch(many)))
    const request =
      decision.type === "approval_required" ? decision.request : undefined
    expect(request?.pageEvidence?.length).toBeLessThanOrEqual(1_000)
    /** Cut short is said, never silently done. */
    expect(request?.pageEvidence).toContain("more")
  })
})
