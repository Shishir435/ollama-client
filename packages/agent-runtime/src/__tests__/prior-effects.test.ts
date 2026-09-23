import type { AgentPriorEffect } from "@ollama-client/contracts"
import { MAX_AGENT_PRIOR_EFFECTS } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import type { AgentStepReadout, ResolvedAgentEffect } from "../ports"
import {
  agentCommittedEffects,
  agentEffectIsConsequential,
  agentInheritedEffects,
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
