import { AgentEffectNotAppliedError } from "@ollama-client/agent-runtime"
import { describe, expect, it } from "vitest"

import {
  AGENT_EFFECT_REJECTION_REASONS,
  AGENT_EFFECT_REJECTIONS,
  agentRejectionField,
  agentRejectionMessage,
  agentRejectionReason
} from "../effect-rejection"

describe("Agent effect rejection vocabulary", () => {
  it("classifies every reason it can compose", () => {
    for (const reason of AGENT_EFFECT_REJECTION_REASONS) {
      const error = new AgentEffectNotAppliedError(
        agentRejectionMessage(reason)
      )
      expect(agentRejectionReason(error)).toBe(reason)
    }
  })

  it("keeps a named identity field distinguishable from a value refusal", () => {
    const changed = new AgentEffectNotAppliedError(
      agentRejectionMessage(AGENT_EFFECT_REJECTIONS.targetChanged, "enabled")
    )
    const value = new AgentEffectNotAppliedError(
      agentRejectionMessage(AGENT_EFFECT_REJECTIONS.valueChanged)
    )
    expect(agentRejectionReason(changed)).toBe(
      AGENT_EFFECT_REJECTIONS.targetChanged
    )
    expect(agentRejectionReason(value)).toBe(
      AGENT_EFFECT_REJECTIONS.valueChanged
    )
  })

  it("refuses to forward a message this build did not compose", () => {
    const pageAuthored = new AgentEffectNotAppliedError(
      "Sign in to continue, account holder"
    )
    expect(agentRejectionReason(pageAuthored)).toBe(
      AGENT_EFFECT_REJECTIONS.unspecified
    )
    expect(
      agentRejectionMessage(agentRejectionReason(pageAuthored))
    ).not.toContain("account holder")
  })
})

describe("rejection fields", () => {
  it("reads back the identity field a refusal named", () => {
    const error = new Error(
      agentRejectionMessage(AGENT_EFFECT_REJECTIONS.targetChanged, "visible")
    )

    expect(agentRejectionReason(error)).toBe("target_changed")
    expect(agentRejectionField(error)).toBe("visible")
  })

  it("drops a field this build did not compose", () => {
    /*
     * The refusing document is untrusted, so a name outside the vocabulary is
     * dropped rather than forwarded — the same rule the codes follow.
     */
    const error = new Error(
      "Agent mutation target changed after approval: Enter your password"
    )

    expect(agentRejectionReason(error)).toBe("target_changed")
    expect(agentRejectionField(error)).toBeUndefined()
  })
})
