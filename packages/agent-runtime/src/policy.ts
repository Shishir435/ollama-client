import type {
  AgentApprovalRequest,
  AgentTakeoverRequest
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
    case "form_mutation":
      return "medium"
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

const makeApprovalRequest = (
  input: AgentPolicyInput,
  risk: Exclude<AgentRisk, "low">
): AgentApprovalRequest => {
  const destination = input.effect.destination?.url
  const action = destination
    ? `Allow navigation to ${destination}`
    : `Allow ${input.effect.command.type}`
  return {
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

export const evaluateAgentPolicy = (
  input: AgentPolicyInput
): AgentPolicyDecision => {
  const destination = input.effect.destination
  if (destination) {
    const scheme = urlScheme(destination.url)
    if (scheme !== "http" && scheme !== "https") {
      return { type: "blocked", risk: "critical", reason: "unsupported_scheme" }
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
  }

  if (risk === "low") return { type: "allow", risk }
  if (
    risk === "medium" &&
    !input.effect.semanticEffects.includes("form_mutation")
  ) {
    return { type: "allow", risk }
  }

  return {
    type: "approval_required",
    risk,
    request: makeApprovalRequest(input, risk)
  }
}
