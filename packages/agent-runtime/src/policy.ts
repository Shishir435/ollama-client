import {
  AGENT_GRANTABLE_EFFECTS,
  type AgentApprovalRequest,
  type AgentGrant,
  type AgentTakeoverRequest
} from "@ollama-client/contracts"
import type {
  AgentPolicyDecision,
  AgentPolicyInput,
  AgentRisk,
  AgentSemanticEffect
} from "./ports"

const RISK_ORDER: readonly AgentRisk[] = ["low", "medium", "high", "critical"]

const urlScheme = (url: string): string | undefined =>
  /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase()

const hasQuery = (url: string): boolean => {
  const queryStart = url.indexOf("?")
  if (queryStart < 0) return false
  const fragmentStart = url.indexOf("#", queryStart)
  return fragmentStart < 0
    ? queryStart < url.length - 1
    : fragmentStart > queryStart + 1
}

const raiseRisk = (current: AgentRisk, candidate: AgentRisk): AgentRisk =>
  RISK_ORDER.indexOf(candidate) > RISK_ORDER.indexOf(current)
    ? candidate
    : current

const effectRisk = (effect: AgentSemanticEffect): AgentRisk => {
  switch (effect) {
    case "read":
    case "scroll":
      return "low"
    case "navigation":
      return "medium"
    case "activation":
    case "form_mutation":
      return "high"
    case "download":
      return "high"
    case "submission":
    case "destructive":
    case "authentication":
    case "payment":
    case "sensitive_input":
      return "critical"
  }
}

const takeoverReason = (
  input: AgentPolicyInput
): AgentTakeoverRequest["reason"] | undefined => {
  const effects = input.effect.semanticEffects
  if (input.effect.target.sensitive || effects.includes("sensitive_input")) {
    return "sensitive_input"
  }
  if (effects.includes("authentication")) return "authentication"
  if (effects.includes("payment")) return "payment"
  return undefined
}

const makeTakeoverRequest = (
  input: AgentPolicyInput,
  reason: AgentTakeoverRequest["reason"]
): AgentTakeoverRequest => ({
  id: `${input.stepId}:takeover`,
  runId: input.runId,
  stepId: input.stepId,
  reason,
  instruction:
    "Take control of the page, complete the sensitive step, then explicitly continue.",
  createdAt: input.now
})

/**
 * Which classes this approval may be widened to, if any.
 *
 * Decided here rather than in the panel: the panel renders what it is given,
 * and a UI that worked out for itself when widening is safe would be a second
 * copy of this rule. Critical risk, a class outside the grantable set, or a
 * destination leaving the origin all mean the offer is simply absent.
 */
const grantableFor = (
  input: AgentPolicyInput,
  risk: Exclude<AgentRisk, "low">
): Pick<AgentApprovalRequest, "origin" | "grantable"> => {
  const origin = input.effect.sourceOrigin
  const destination = input.effect.destination
  const grantable: readonly string[] = AGENT_GRANTABLE_EFFECTS
  if (
    risk === "critical" ||
    !input.allowedOrigins.includes(origin) ||
    (destination && destination.origin !== origin) ||
    !input.effect.semanticEffects.every((effect) => grantable.includes(effect))
  ) {
    return {}
  }
  return {
    origin,
    grantable: input.effect
      .semanticEffects as unknown as AgentApprovalRequest["grantable"]
  }
}

const makeApprovalRequest = (
  input: AgentPolicyInput,
  risk: Exclude<AgentRisk, "low">
): AgentApprovalRequest => {
  const destination = input.effect.destination?.url
  const action = destination
    ? `Allow navigation to ${destination}`
    : `Allow ${input.effect.command.type}`
  return {
    ...grantableFor(input, risk),
    id: `${input.stepId}:approval`,
    runId: input.runId,
    stepId: input.stepId,
    risk,
    action,
    consequence: destination
      ? `The browser will use the complete destination URL: ${destination}`
      : "The browser will perform the resolved page effect shown above.",
    pageEvidence: input.effect.target.accessibleName,
    createdAt: input.now
  }
}

/**
 * Whether a grant the user already gave covers this effect.
 *
 * Deliberately narrow. The grant has to name the origin the effect happens
 * on; every semantic effect the step carries has to be one of the grantable
 * classes, so a submission riding along inside an activation is not covered;
 * and a critical risk is never covered at all, however it got there. A
 * destination leaving the granted origin is a different site and a different
 * decision.
 */
const grantFor = (
  input: AgentPolicyInput,
  risk: AgentRisk
): AgentGrant | undefined => {
  if (risk === "critical" || !input.grants?.length) return undefined
  const origin = input.effect.sourceOrigin
  if (!input.allowedOrigins.includes(origin)) return undefined
  const destination = input.effect.destination
  if (destination && destination.origin !== origin) return undefined
  const grantable: readonly string[] = AGENT_GRANTABLE_EFFECTS
  if (
    !input.effect.semanticEffects.every((effect) => grantable.includes(effect))
  ) {
    return undefined
  }
  return input.grants.find(
    (grant) =>
      grant.origin === origin &&
      input.effect.semanticEffects.every((effect) =>
        (grant.effects as readonly string[]).includes(effect)
      )
  )
}

export const evaluateAgentPolicy = (
  input: AgentPolicyInput
): AgentPolicyDecision => {
  const destination = input.effect.destination
  if (destination) {
    const scheme = urlScheme(destination.url)
    if (scheme !== "http" && scheme !== "https") {
      return { type: "blocked", risk: "critical", reason: "unsupported_scheme" }
    }
    /**
     * A destination the page rendered may carry the page's own data back to
     * its own site; one the model composed may not, because observing the
     * user's page is the only way it could have learned that data. A value the
     * user typed is never worth a confirmation prompt, so it is refused
     * outright; rendered text is what an ordinary research task carries into a
     * search, so it is escalated below rather than blocked.
     */
    if (
      destination.source !== "observed" &&
      destination.pageDataEvidence === "field_value"
    ) {
      return {
        type: "blocked",
        risk: "critical",
        reason: "private_data_egress"
      }
    }
  }

  const takeover = takeoverReason(input)
  if (takeover) {
    return {
      type: "takeover_required",
      risk: "critical",
      request: makeTakeoverRequest(input, takeover)
    }
  }

  let risk: AgentRisk = "low"
  for (const effect of input.effect.semanticEffects) {
    risk = raiseRisk(risk, effectRisk(effect))
  }
  if (input.effect.target.maySubmit) risk = raiseRisk(risk, "critical")

  if (destination) {
    const newOrigin = !input.allowedOrigins.includes(destination.origin)
    if (newOrigin) risk = raiseRisk(risk, "high")
    if (destination.source === "model" && hasQuery(destination.url)) {
      risk = raiseRisk(risk, "high")
    }
    /**
     * Page text the model carried into a destination it composed is the shape
     * an exfiltration attempt takes, and also the shape an ordinary search
     * takes. The user decides, against the complete URL.
     */
    if (
      destination.source !== "observed" &&
      destination.pageDataEvidence === "visible_text"
    ) {
      risk = raiseRisk(risk, "critical")
    }
  }

  if (risk === "low") return { type: "allow", risk }
  if (
    risk === "medium" &&
    !input.effect.semanticEffects.includes("form_mutation")
  ) {
    return { type: "allow", risk }
  }

  const granted = grantFor(input, risk)
  if (granted) return { type: "granted", risk, origin: granted.origin }

  return {
    type: "approval_required",
    risk,
    request: makeApprovalRequest(input, risk)
  }
}
