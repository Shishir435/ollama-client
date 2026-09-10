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
    case "hover":
    /**
     * Answering a dialog is low in itself: dismissing one is the safe
     * direction and closing an alert is the only way past it. What accepting
     * a confirm, a prompt or a beforeunload commits to is carried as
     * `destructive` by whatever resolved it, and priced there.
     */
    case "dialog":
      return "low"
    case "navigation":
      return "medium"
    case "activation":
    case "form_mutation":
    /** A drop rearranges or hands off whatever was picked up; never granted. */
    case "drag":
      return "high"
    case "download":
      return "high"
    case "submission":
    case "destructive":
    case "authentication":
    case "payment":
    case "sensitive_input":
    case "file_selection":
      return "critical"
  }
}

const takeoverReason = (
  input: AgentPolicyInput
): AgentTakeoverRequest["reason"] | undefined => {
  const effects = input.effect.semanticEffects
  /**
   * A file chooser names the user's own files; the run neither sees them nor
   * chooses among them, so opening one is the user's step from the start. It
   * is decided before the sensitive-input class a file input also carries,
   * because the takeover instruction the user reads has to be about the file.
   */
  if (effects.includes("file_selection")) return "file_upload"
  if (input.effect.target.sensitive || effects.includes("sensitive_input")) {
    return "sensitive_input"
  }
  if (effects.includes("authentication")) return "authentication"
  if (effects.includes("payment")) return "payment"
  return undefined
}

const takeoverInstruction = (reason: AgentTakeoverRequest["reason"]): string =>
  reason === "file_upload"
    ? "Take control of the page, choose the file yourself, then explicitly continue."
    : "Take control of the page, complete the sensitive step, then explicitly continue."

const makeTakeoverRequest = (
  input: AgentPolicyInput,
  reason: AgentTakeoverRequest["reason"]
): AgentTakeoverRequest => ({
  id: `${input.stepId}:takeover`,
  runId: input.runId,
  stepId: input.stepId,
  reason,
  instruction: takeoverInstruction(reason),
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
/**
 * The origin an effect acts on. A target in a child frame acts on that
 * frame's origin; a grant for the page around it does not reach in, and an
 * approval given here is offered for the frame's site, not the page's.
 */
const actingOrigin = (input: AgentPolicyInput): string =>
  input.effect.frameOrigin ?? input.effect.sourceOrigin

const grantableFor = (
  input: AgentPolicyInput,
  risk: Exclude<AgentRisk, "low">
): Pick<AgentApprovalRequest, "origin" | "grantable"> => {
  const origin = actingOrigin(input)
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

/**
 * Whether this step's own change is already persisted by making it.
 *
 * A form is prepared and then submitted, and the submission is the prompt
 * that matters. An application that saves on input has no such step: the
 * field belongs to no form, or it is an editing host, and the typing is the
 * whole change. The risk is the same either way — a form mutation — but the
 * sentence the user grants against must not imply a later confirmation that
 * is never going to be asked for.
 */
const persistsOnChange = (input: AgentPolicyInput): boolean =>
  input.effect.target.persistsOnChange === true &&
  input.effect.semanticEffects.includes("form_mutation")

/**
 * How a dialog answer reads to the user. The command's name says nothing —
 * what is being decided is whether the page gets its OK — so the dialog's own
 * kind and the direction of the answer are what the prompt states. The
 * dialog's message travels separately as page evidence.
 */
const dialogAction = (
  input: AgentPolicyInput
): { action: string; consequence: string } | undefined => {
  const command = input.effect.command
  if (command.type !== "handle_dialog") return undefined
  const kind = input.effect.dialog?.type ?? "dialog"
  if (!command.accept) {
    return {
      action: `Dismiss the page's ${kind} dialog`,
      consequence:
        "The page is told the dialog was dismissed and nothing is confirmed."
    }
  }
  return {
    action: `Accept the page's ${kind} dialog`,
    consequence:
      kind === "beforeunload"
        ? "The page is allowed to leave; anything it has not saved is discarded."
        : "The page proceeds as though the user pressed its confirm button, whatever that action is."
  }
}

const makeApprovalRequest = (
  input: AgentPolicyInput,
  risk: Exclude<AgentRisk, "low">
): AgentApprovalRequest => {
  const destination = input.effect.destination?.url
  const adopting = adoptsTab(input)
  const dialog = dialogAction(input)
  const action =
    dialog?.action ??
    (adopting
      ? `Adopt tab ${adopting} at ${destination}`
      : destination
        ? `Allow navigation to ${destination}`
        : `Allow ${input.effect.command.type}`)
  return {
    ...grantableFor(input, risk),
    id: `${input.stepId}:approval`,
    runId: input.runId,
    stepId: input.stepId,
    risk,
    action,
    consequence:
      dialog?.consequence ??
      (destination
        ? `The browser will use the complete destination URL: ${destination}`
        : persistsOnChange(input)
          ? "The browser will enter this into the control shown above. The page has no submit step, so the change is saved as it is entered."
          : "The browser will perform the resolved page effect shown above."),
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
  const origin = actingOrigin(input)
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

/**
 * The tab a switch would adopt, when it is one the run does not drive yet. A
 * tab outside the scope is a page the user was working in, and reading it is
 * the user's to grant whatever its origin — the site allowlist answers a
 * different question.
 */
const adoptsTab = (input: AgentPolicyInput): number | undefined => {
  const command = input.effect.command
  if (command.type !== "switch_tab") return undefined
  return input.scopedTabIds.includes(command.tabId) ? undefined : command.tabId
}

/**
 * The risk an effect carries before its destination is considered: what it
 * does to the page, whether it adopts a tab the run does not drive, and
 * whether it acts inside a frame on a site outside the allowlist — a frame
 * the run reads is on an allowed origin, so anything else is a new site.
 *
 * Submission is priced as the `submission` class the resolver attaches to the
 * commands that actually submit — a click on a submitter, Enter in a field
 * that submits on it. It used to be priced a second time from the target's
 * `maySubmit`, which says only that the control sits on a submit path: every
 * character typed into an ordinary single-field form was therefore critical,
 * and critical is never grantable, so filling in a search box cost one
 * unskippable prompt per keystroke-batch and trained the user to approve
 * without reading. Typing is a form mutation and priced as one.
 */
const baselineRisk = (input: AgentPolicyInput): AgentRisk => {
  let risk: AgentRisk = "low"
  for (const effect of input.effect.semanticEffects) {
    risk = raiseRisk(risk, effectRisk(effect))
  }
  if (adoptsTab(input) !== undefined) risk = raiseRisk(risk, "high")
  if (
    input.effect.frameOrigin !== undefined &&
    !input.allowedOrigins.includes(input.effect.frameOrigin)
  ) {
    risk = raiseRisk(risk, "high")
  }
  return risk
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

  let risk = baselineRisk(input)

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
