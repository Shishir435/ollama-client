import {
  AGENT_READINESS_REASONS,
  AGENT_READINESS_STATUSES,
  AGENT_READINESS_VISION
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import type { AgentModelCompatibility } from "../agent-model-compatibility"
import {
  agentModelReadiness,
  agentReadinessPermitsStart
} from "../agent-model-readiness"

/**
 * Every shape the compatibility union can take. The point of the list is that
 * it is the union written out: a variant added to the union and forgotten here
 * fails to typecheck against `AgentModelCompatibility`, and a variant the
 * mapping cannot label fails to build at all.
 */
const COMPATIBILITIES: AgentModelCompatibility[] = [
  { status: "supported", mode: "native", reason: "metadata" },
  { status: "supported", mode: "native-user-results", reason: "metadata" },
  { status: "supported", mode: "native", reason: "verified_probe" },
  { status: "experimental", mode: "native", reason: "user_override" },
  { status: "unsupported", reason: "reported_unsupported" },
  { status: "unsupported", reason: "unverified" },
  { status: "unsupported", reason: "unknown" }
]

describe("agentModelReadiness", () => {
  it("labels every compatibility the resolver can return", () => {
    for (const compatibility of COMPATIBILITIES) {
      const readiness = agentModelReadiness(compatibility)
      expect(AGENT_READINESS_STATUSES).toContain(readiness.status)
      expect(AGENT_READINESS_REASONS).toContain(readiness.reason)
      expect(AGENT_READINESS_VISION).toContain(readiness.vision)
      expect(readiness.reason).toBe(compatibility.reason)
    }
  })

  it("maps each compatibility status onto exactly one readiness status", () => {
    expect(
      agentModelReadiness({
        status: "supported",
        mode: "native",
        reason: "metadata"
      }).status
    ).toBe("ready")
    expect(
      agentModelReadiness({
        status: "experimental",
        mode: "native",
        reason: "user_override"
      }).status
    ).toBe("experimental")
    expect(
      agentModelReadiness({ status: "unsupported", reason: "unknown" }).status
    ).toBe("unsupported")
  })

  /**
   * Absent evidence and a reported "no" are different facts. Collapsing them
   * told a user their vision model was text-only, and silenced the screenshot
   * acknowledgement for a model that does read pictures.
   */
  it("keeps unknown vision distinct from unsupported vision", () => {
    const base = {
      status: "supported",
      mode: "native",
      reason: "metadata"
    } as const
    expect(agentModelReadiness(base).vision).toBe("unknown")
    expect(agentModelReadiness({ ...base, vision: true }).vision).toBe(
      "supported"
    )
    expect(agentModelReadiness({ ...base, vision: false }).vision).toBe(
      "unsupported"
    )
  })
})

describe("agentReadinessPermitsStart", () => {
  it("permits a ready model and refuses an unsupported one", () => {
    expect(
      agentReadinessPermitsStart(
        { status: "ready", reason: "metadata", vision: "unknown" },
        false
      )
    ).toBe(true)
    expect(
      agentReadinessPermitsStart(
        { status: "unsupported", reason: "unknown", vision: "unknown" },
        true
      )
    ).toBe(false)
  })

  it("permits an experimental model only with the explicit opt-in", () => {
    const readiness = {
      status: "experimental",
      reason: "user_override",
      vision: "unknown"
    } as const
    expect(agentReadinessPermitsStart(readiness, false)).toBe(false)
    expect(agentReadinessPermitsStart(readiness, true)).toBe(true)
  })

  /** Still resolving is not a verdict; the run's own assertion still guards. */
  it("permits a start while readiness is unresolved", () => {
    expect(agentReadinessPermitsStart(undefined, false)).toBe(true)
  })
})
