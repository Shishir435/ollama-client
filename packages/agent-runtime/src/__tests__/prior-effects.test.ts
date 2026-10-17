import type { AgentPriorEffect } from "@ollama-client/contracts"
import { MAX_AGENT_PRIOR_EFFECTS } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { agentStepSourceUrl, agentStepTargetFrom } from "../history"
import type { AgentStepReadout, ResolvedAgentEffect } from "../ports"
import {
  agentCommittedEffects,
  agentConsequentialEffects,
  agentEffectIsConsequential,
  agentForbidsEffect,
  agentEffectSettlement,
  agentInheritedEffects,
  agentOwnEffectSettlement,
  agentRepeatsBeforeClaim,
  agentRepeatsPriorEffect,
  agentRepeatsPriorForm
} from "../prior-effects"

let sequence = 0
const receipt = (patch: Partial<AgentStepReadout>): AgentStepReadout => {
  sequence += 1
  return {
    runId: "parent",
    stepId: "parent:1",
    status: "planned",
    at: sequence,
    sequence,
    ...patch
  }
}

const click = {
  type: "click",
  ref: "e1",
  snapshotId: "s",
  generation: 1
} as AgentStepReadout["command"]

const submitTarget = { role: "button", tag: "button", name: "Post comment" }

const effect = (
  patch: Partial<ResolvedAgentEffect> = {}
): ResolvedAgentEffect =>
  ({
    command: click,
    target: {
      ref: "e9",
      role: "button",
      tag: "button",
      accessibleName: "  Post   COMMENT ",
      sensitive: false,
      maySubmit: true
    },
    semanticEffects: ["activation", "submission"],
    snapshotIdentity: {
      snapshotId: "s",
      generation: 1,
      tabId: 1,
      frameId: 0,
      documentId: "d"
    },
    sourceUrl: "https://Forum.example/thread/7?draft=secret#reply",
    sourceOrigin: "https://forum.example",
    ...patch
  }) as ResolvedAgentEffect

describe("what a run committed", () => {
  it("keeps a consequential step whose last receipt says it landed", () => {
    const steps = [
      receipt({
        command: click,
        target: submitTarget,
        consequential: ["submission"]
      }),
      receipt({ status: "approved", consequential: ["submission"] }),
      receipt({
        status: "verified",
        consequential: ["submission"],
        sourceUrl: "https://forum.example/thread/7"
      })
    ]

    expect(agentCommittedEffects(steps)).toEqual([
      {
        action: "click",
        page: "https://forum.example/thread/7",
        effects: ["submission"],
        role: "button",
        tag: "button",
        name: "Post comment"
      }
    ])
  })

  it("counts an uncertain effect, and not a refused or failed one", () => {
    const steps = [
      receipt({
        stepId: "a",
        command: click,
        target: submitTarget,
        consequential: ["submission"],
        status: "uncertain"
      }),
      receipt({
        stepId: "b",
        command: click,
        consequential: ["submission"],
        status: "rejected"
      }),
      receipt({
        stepId: "c",
        command: click,
        consequential: ["submission"],
        status: "failed"
      })
    ]

    expect(agentCommittedEffects(steps).map((entry) => entry.name)).toEqual([
      "Post comment"
    ])
  })

  it("ignores a routine change", () => {
    expect(
      agentCommittedEffects([
        receipt({
          command: click,
          mutating: true,
          risk: "high",
          consequential: [],
          status: "verified"
        })
      ])
    ).toEqual([])
  })

  /**
   * An older receipt has no `consequential`, and a reviewed disposition
   * re-records an uncertain step without its price. Either receipt of the
   * step may be the one that says what it was.
   */
  it("reads an older run's critical change, even after a review re-recorded it", () => {
    const steps = [
      receipt({
        command: click,
        target: submitTarget,
        mutating: true,
        risk: "critical",
        status: "executed"
      }),
      receipt({ mutating: true, status: "uncertain" })
    ]

    expect(agentCommittedEffects(steps)).toHaveLength(1)
  })
})

describe("what a follow-up inherits", () => {
  const entry = (name: string): AgentPriorEffect => ({
    action: "click",
    role: "button",
    name
  })

  it("keeps the chain's effects, deduplicated, newest last", () => {
    expect(
      agentInheritedEffects(
        [entry("Pay"), entry("Post")],
        [entry("Pay"), entry("Save")]
      )?.map((effect) => effect.name)
    ).toEqual(["Post", "Pay", "Save"])
  })

  it("carries every effect up to its bound", () => {
    const all = Array.from({ length: MAX_AGENT_PRIOR_EFFECTS }, (_, i) =>
      entry(`e${i}`)
    )

    expect(agentInheritedEffects(all.slice(0, 5), all.slice(5))).toEqual(all)
  })

  /**
   * Past the bound nothing is trimmed: the oldest effect is exactly the one
   * a trimmed list would let a follow-up repeat, so the chain cannot be
   * continued at all.
   */
  it("refuses a chain it could only carry by forgetting some of it", () => {
    const many = Array.from({ length: MAX_AGENT_PRIOR_EFFECTS + 1 }, (_, i) =>
      entry(`e${i}`)
    )

    expect(agentInheritedEffects(many, [])).toBeUndefined()
    expect(agentInheritedEffects([], many)).toBeUndefined()
  })
})

describe("a repeat", () => {
  const prior: AgentPriorEffect[] = [
    {
      action: "click",
      page: "https://forum.example/thread/7",
      role: "button",
      tag: "button",
      name: "Post comment"
    }
  ]

  it("matches the same control on the same page, however it is spelled", () => {
    expect(agentRepeatsPriorEffect(effect(), prior)).toBe(true)
  })

  it("is not a different control, page or command", () => {
    expect(
      agentRepeatsPriorEffect(
        effect({
          target: {
            role: "button",
            tag: "button",
            accessibleName: "Delete comment",
            sensitive: false,
            maySubmit: true
          }
        }),
        prior
      )
    ).toBe(false)
    expect(
      agentRepeatsPriorEffect(
        effect({ sourceUrl: "https://forum.example/thread/8" }),
        prior
      )
    ).toBe(false)
  })

  /**
   * The parent clicked the submit button; the child presses Enter in a field
   * of the same form. That may be the same comment again or a new one, so it
   * is not refused as a repeat — it is flagged, and policy asks.
   */
  it("flags the same form sent by another command and control", () => {
    const committed = agentCommittedEffects([
      receipt({
        stepId: "p:1",
        command: click,
        target: submitTarget,
        sourceUrl: "https://forum.example/thread/7",
        consequential: ["submission"],
        formAction: "https://forum.example/comments",
        status: "verified"
      })
    ])
    const enter = effect({
      command: {
        type: "press_key",
        ref: "e4",
        key: "Enter",
        snapshotId: "s",
        generation: 1
      } as ResolvedAgentEffect["command"],
      semanticEffects: ["submission"],
      target: {
        ref: "e4",
        role: "textbox",
        tag: "textarea",
        accessibleName: "Your comment",
        formAction: "https://forum.example/comments?csrf=abc",
        sensitive: false,
        maySubmit: true
      }
    })

    expect(committed[0]).toMatchObject({
      effects: ["submission"],
      form: "https://forum.example/comments"
    })
    expect(agentRepeatsPriorEffect(enter, committed)).toBe(false)
    expect(agentRepeatsPriorForm(enter, committed)).toBe(true)
  })

  /**
   * The false positive review raised: a checkout's second step posts to the
   * same address as its first. Refusing it would stop the checkout, so the
   * form match only ever reaches the user.
   */
  it("does not refuse a checkout's next step that posts to the same address", () => {
    const prior: AgentPriorEffect[] = [
      {
        action: "click",
        page: "https://forum.example/thread/7",
        effects: ["submission"],
        form: "https://forum.example/checkout",
        role: "button",
        tag: "button",
        name: "Continue to payment"
      }
    ]
    const next = effect({
      semanticEffects: ["submission"],
      target: {
        role: "button",
        tag: "button",
        accessibleName: "Confirm shipping",
        formAction: "https://forum.example/checkout",
        sensitive: false,
        maySubmit: true
      }
    })

    expect(agentRepeatsPriorEffect(next, prior)).toBe(false)
    expect(agentRepeatsPriorForm(next, prior)).toBe(true)
  })

  it("does not match a submission to a different form", () => {
    const prior: AgentPriorEffect[] = [
      {
        action: "click",
        effects: ["submission"],
        form: "https://forum.example/comments",
        role: "button",
        name: "Post comment"
      }
    ]
    const other = effect({
      semanticEffects: ["submission"],
      target: {
        role: "button",
        tag: "button",
        accessibleName: "Subscribe",
        formAction: "https://forum.example/newsletter",
        sensitive: false,
        maySubmit: true
      }
    })

    expect(agentRepeatsPriorEffect(other, prior)).toBe(false)
    expect(agentRepeatsPriorForm(other, prior)).toBe(false)
  })

  it("never refuses a routine effect", () => {
    const routine = effect({ semanticEffects: ["activation"] })

    expect(agentEffectIsConsequential(routine)).toBe(false)
    expect(agentRepeatsPriorEffect(routine, prior)).toBe(false)
  })
})

describe("how the run's own earlier attempt settled", () => {
  const attempt = (status: AgentStepReadout["status"], stepId = "run:1") =>
    receipt({
      runId: "run",
      stepId,
      status,
      command: click,
      target: submitTarget,
      consequential: ["submission"]
    })

  it.each([
    ["verified", "confirmed"],
    ["uncertain", "unknown"],
    ["executed", "unknown"],
    ["approved", "unknown"],
    ["executing", "unknown"],
    ["failed", "not_applied"],
    ["rejected", "not_applied"],
    ["planned", "not_applied"]
  ] as const)("reads %s as %s", (status, settlement) => {
    expect(agentEffectSettlement(status)).toBe(settlement)
    expect(agentOwnEffectSettlement(effect(), [attempt(status)])).toBe(
      settlement
    )
  })

  it("takes the strongest answer across attempts", () => {
    expect(
      agentOwnEffectSettlement(effect(), [
        attempt("failed", "run:1"),
        attempt("uncertain", "run:2"),
        attempt("failed", "run:3")
      ])
    ).toBe("unknown")
  })

  it("has nothing to say about a routine effect or one never tried", () => {
    expect(
      agentOwnEffectSettlement(effect({ semanticEffects: ["activation"] }), [
        attempt("verified")
      ])
    ).toBeUndefined()
    expect(agentOwnEffectSettlement(effect(), [])).toBeUndefined()
  })
})

describe("a script button labelled as committing", () => {
  const placeOrder = (patch: Partial<ResolvedAgentEffect["target"]> = {}) =>
    effect({
      semanticEffects: ["activation"],
      target: {
        ref: "e4",
        role: "button",
        tag: "button",
        accessibleName: "Place order",
        sensitive: false,
        maySubmit: false,
        committingLabel: true,
        ...patch
      }
    })

  it("is recorded as a possible commit, never as routine", () => {
    expect(agentConsequentialEffects(placeOrder())).toEqual([
      "potential_commit"
    ])
    expect(agentEffectIsConsequential(placeOrder())).toBe(true)
    expect(
      agentConsequentialEffects(placeOrder({ committingLabel: undefined }))
    ).toEqual([])
  })

  it("adds nothing when a form already classifies it", () => {
    expect(
      agentConsequentialEffects(
        effect({ target: { ...effect().target, committingLabel: true } })
      )
    ).toEqual(["submission"])
  })

  it("is forbidden by a constraint against submitting or paying", () => {
    expect(agentForbidsEffect(["submission"], "potential_commit")).toBe(true)
    expect(agentForbidsEffect(["payment"], "potential_commit")).toBe(true)
    expect(agentForbidsEffect(["destructive"], "potential_commit")).toBe(false)
    expect(agentForbidsEffect(undefined, "potential_commit")).toBe(false)
  })

  it("is a repeat after a worker restart left only its receipt", () => {
    const receipts = [
      receipt({
        runId: "run",
        stepId: "run:4",
        status: "uncertain",
        command: click,
        target: { role: "button", tag: "button", name: "Place order" },
        consequential: ["potential_commit"],
        sourceUrl: "https://forum.example/thread/7"
      })
    ]
    expect(agentOwnEffectSettlement(placeOrder(), receipts)).toBe("unknown")
    expect(
      agentRepeatsPriorEffect(placeOrder(), agentCommittedEffects(receipts))
    ).toBe(true)
  })
})

describe("a repeat in a list of records", () => {
  const markPaid = (row: string) =>
    effect({
      target: {
        ref: "e3",
        role: "button",
        tag: "button",
        accessibleName: "Mark paid",
        rowContext: row,
        sensitive: false,
        maySubmit: true
      }
    })
  const done = (row: string) =>
    receipt({
      runId: "run",
      stepId: `run:${row}`,
      status: "verified",
      command: click,
      target: {
        role: "button",
        tag: "button",
        name: "Mark paid",
        rowContext: row
      },
      consequential: ["submission"],
      sourceUrl: "https://forum.example/thread/7"
    })

  it("lets the next record's button through", () => {
    expect(
      agentOwnEffectSettlement(markPaid("#6 Due Mark paid"), [
        done("#5 Due Mark paid")
      ])
    ).toBeUndefined()
    expect(
      agentOwnEffectSettlement(markPaid("1043 Beta Due Mark paid"), [
        done("1042 Acme Due Mark paid")
      ])
    ).toBeUndefined()
    expect(
      agentRepeatsPriorEffect(
        markPaid("INV-002 Beta $80 Due Mark paid"),
        agentCommittedEffects([done("INV-001 Acme $120 Due Mark paid")])
      )
    ).toBe(false)
  })

  it("tells records apart by a lone letter", () => {
    expect(
      agentOwnEffectSettlement(markPaid("Invoice B Due Mark paid"), [
        done("Invoice A Due Mark paid")
      ])
    ).toBeUndefined()
    expect(
      agentOwnEffectSettlement(markPaid("Invoice A Paid Mark paid"), [
        done("Invoice A Due Mark paid")
      ])
    ).toBe("confirmed")
  })

  it("still refuses the same record, even after its row changed", () => {
    expect(
      agentRepeatsPriorEffect(
        markPaid("INV-001 Acme $0 Paid Mark paid"),
        agentCommittedEffects([done("INV-001 Acme $120 Due Mark paid")])
      )
    ).toBe(true)
    expect(
      agentOwnEffectSettlement(markPaid("Record 5 Paid Mark paid"), [
        done("Record 5 Due Mark paid")
      ])
    ).toBe("confirmed")
  })

  it("does not read a changed amount or an article as a new record", () => {
    expect(
      agentOwnEffectSettlement(markPaid("Balance $0 Paid Mark paid"), [
        done("Balance $120 Due Mark paid")
      ])
    ).toBe("confirmed")
    /** A bare number in the middle of a row is a balance or a count. */
    expect(
      agentOwnEffectSettlement(markPaid("Balance 0 Paid Mark paid"), [
        done("Balance 120 Due Mark paid")
      ])
    ).toBe("confirmed")
    expect(
      agentOwnEffectSettlement(markPaid("Kettle 2 left Mark paid"), [
        done("Kettle 3 left Mark paid")
      ])
    ).toBe("confirmed")
    expect(
      agentOwnEffectSettlement(markPaid("Slot 11am Mark paid"), [
        done("Slot 10am Mark paid")
      ])
    ).toBe("confirmed")
    expect(
      agentOwnEffectSettlement(markPaid("Paid in 2.5 days Mark paid"), [
        done("Due in 1.5 days Mark paid")
      ])
    ).toBe("confirmed")
    expect(
      agentOwnEffectSettlement(markPaid("Beta is a supplier Mark paid"), [
        done("Acme is a supplier Mark paid")
      ])
    ).toBe("confirmed")
  })

  it("stays coarse when either side cannot name its record", () => {
    /** An unmarked number after a label could be either; it asks. */
    expect(
      agentOwnEffectSettlement(markPaid("Record 6 Due Mark paid"), [
        done("Record 5 Due Mark paid")
      ])
    ).toBe("confirmed")
    expect(
      agentOwnEffectSettlement(markPaid("Acme Due Mark paid"), [
        done("Beta Due Mark paid")
      ])
    ).toBe("confirmed")
    expect(
      agentOwnEffectSettlement(
        effect({ target: { ...markPaid("x").target, rowContext: undefined } }),
        [done("Record 5 Due Mark paid")]
      )
    ).toBe("confirmed")
  })
})

describe("a script button labelled as saving", () => {
  const save = effect({
    semanticEffects: ["activation"],
    target: {
      ref: "e2",
      role: "button",
      tag: "button",
      accessibleName: "Save",
      sensitive: false,
      maySubmit: false,
      savingLabel: true
    }
  })

  it("is recorded as a save, which no constraint forbids", () => {
    expect(agentConsequentialEffects(save)).toEqual(["save"])
    expect(agentForbidsEffect(["submission", "payment"], "save")).toBe(false)
  })

  it("is caught when pressed again", () => {
    const pressed = receipt({
      runId: "run",
      stepId: "run:2",
      status: "verified",
      command: click,
      target: { role: "button", tag: "button", name: "Save" },
      consequential: ["save"],
      sourceUrl: "https://forum.example/thread/7"
    })
    expect(agentOwnEffectSettlement(save, [pressed])).toBe("confirmed")
  })
})

describe("a press repeated after the run claimed done", () => {
  const shipping = effect({
    target: {
      ref: "e3",
      role: "button",
      tag: "button",
      accessibleName: "Continue to payment",
      sensitive: false,
      maySubmit: false
    },
    semanticEffects: ["activation"],
    sourceUrl: "https://shop.example/site/a/shipping"
  } as Partial<ResolvedAgentEffect>)
  const pressed = (stepId: string, url = shipping.sourceUrl) => [
    receipt({
      runId: "run",
      stepId,
      command: click,
      target: agentStepTargetFrom(shipping.target),
      sourceUrl: agentStepSourceUrl(url ?? ""),
      status: "planned"
    }),
    receipt({
      runId: "run",
      stepId,
      status: "verified",
      verification: {
        outcome: "confirmed",
        evidence: { kind: "page", summary: "changed", observedAt: 1 }
      }
    } as Partial<AgentStepReadout>)
  ]
  const claimed = () =>
    receipt({
      runId: "run",
      stepId: "run:completion:9",
      status: "rejected",
      verification: {
        outcome: "negative",
        evidence: { kind: "completion", summary: "refused", observedAt: 1 }
      }
    } as Partial<AgentStepReadout>)

  it("refuses pressing a confirmed control again once the run claimed done", () => {
    expect(
      agentRepeatsBeforeClaim(shipping, [...pressed("run:4"), claimed()])
    ).toBe(true)
  })

  it("allows the same press before any claim, or one first made after it", () => {
    expect(agentRepeatsBeforeClaim(shipping, pressed("run:4"))).toBe(false)
    expect(
      agentRepeatsBeforeClaim(shipping, [claimed(), ...pressed("run:10")])
    ).toBe(false)
  })

  it("allows a press on another page, a plain link, and reading", () => {
    const steps = [...pressed("run:4"), claimed()]
    expect(
      agentRepeatsBeforeClaim(
        { ...shipping, sourceUrl: "https://shop.example/site/a/cart" },
        steps
      )
    ).toBe(false)
    expect(
      agentRepeatsBeforeClaim(
        { ...shipping, semanticEffects: ["navigation"] },
        steps
      )
    ).toBe(false)
    expect(
      agentRepeatsBeforeClaim(
        {
          ...shipping,
          command: { type: "extract_text", snapshotId: "s", generation: 1 }
        } as ResolvedAgentEffect,
        steps
      )
    ).toBe(false)
  })

  it("does not count a press that never verified", () => {
    const [planned] = pressed("run:4")
    expect(agentRepeatsBeforeClaim(shipping, [planned, claimed()])).toBe(false)
  })
})
