import type { AgentModelReadiness } from "@ollama-client/contracts"

import type { AgentModelCompatibility } from "./agent-model-compatibility"

/**
 * The panel's word for a compatibility, derived rather than written twice.
 *
 * The panel used to learn a model could not run a step at a time: the Start
 * button was live, the run began, and planning threw
 * `AgentModelCompatibilityError` after the browser had already attached. The
 * only way a label can stay true is to come from the same union the run is
 * refused by, so this is a total mapping over that union — a new variant
 * stops the build here instead of rendering a raw key beside Start.
 */
export const agentModelReadiness = (
  compatibility: AgentModelCompatibility
): AgentModelReadiness => {
  const vision: AgentModelReadiness["vision"] =
    compatibility.vision === undefined
      ? "unknown"
      : compatibility.vision
        ? "supported"
        : "unsupported"

  switch (compatibility.status) {
    case "supported":
      return { status: "ready", reason: compatibility.reason, vision }
    case "experimental":
      return { status: "experimental", reason: compatibility.reason, vision }
    case "unsupported":
      return { status: "unsupported", reason: compatibility.reason, vision }
    default: {
      /** A compatibility variant with no label is a build failure, not a run. */
      const unreachable: never = compatibility
      return unreachable
    }
  }
}

/** Whether a run may be started with this model at all. */
export const agentReadinessPermitsStart = (
  readiness: AgentModelReadiness | undefined,
  allowExperimental: boolean
): boolean => {
  if (!readiness) return true
  if (readiness.status === "ready") return true
  return readiness.status === "experimental" && allowExperimental
}
