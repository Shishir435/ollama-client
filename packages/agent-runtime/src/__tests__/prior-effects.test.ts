import type { AgentPriorEffect } from "@ollama-client/contracts"
import { MAX_AGENT_PRIOR_EFFECTS } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import type { AgentStepReadout, ResolvedAgentEffect } from "../ports"
import {
  agentCommittedEffects,
  agentEffectIsConsequential,
  agentInheritedEffects,
  agentRepeatsPriorEffect
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
      receipt({ command: click, target: submitTarget, consequential: true }),
      receipt({ status: "approved", consequential: true }),
      receipt({
        status: "verified",
        consequential: true,
        sourceUrl: "https://forum.example/thread/7"
      })
    ]

    expect(agentCommittedEffects(steps)).toEqual([
      {
        action: "click",
        page: "https://forum.example/thread/7",
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
        consequential: true,
        status: "uncertain"
      }),
      receipt({
        stepId: "b",
        command: click,
        consequential: true,
        status: "rejected"
      }),
      receipt({
        stepId: "c",
        command: click,
        consequential: true,
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
          consequential: false,
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
      ).map((effect) => effect.name)
    ).toEqual(["Post", "Pay", "Save"])
  })

  it("stays inside its bound", () => {
    const many = Array.from({ length: MAX_AGENT_PRIOR_EFFECTS + 5 }, (_, i) =>
      entry(`e${i}`)
    )
    const kept = agentInheritedEffects(many, [])

    expect(kept).toHaveLength(MAX_AGENT_PRIOR_EFFECTS)
    expect(kept.at(-1)?.name).toBe(`e${MAX_AGENT_PRIOR_EFFECTS + 4}`)
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

  it("never refuses a routine effect", () => {
    const routine = effect({ semanticEffects: ["activation"] })

    expect(agentEffectIsConsequential(routine)).toBe(false)
    expect(agentRepeatsPriorEffect(routine, prior)).toBe(false)
  })
})
