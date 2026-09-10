import type { AgentCommand, AgentObservation } from "@ollama-client/contracts"

import {
  agentHaystackStates,
  agentNormalizedClaim,
  agentObservationStates
} from "./observed-text"
import type {
  AgentSemanticEffect,
  AgentStepReadout,
  ResolvedAgentEffect
} from "./ports"

/**
 * The semantic classes that change the page rather than read it.
 *
 * Navigation is not one: going somewhere is how a run reads, and a research
 * task that followed three links has changed nothing it owes evidence for.
 * Nor are the classes a URL's own shape suggests — `authentication` and
 * `payment` are attached from a path pattern, so a click on a link to
 * `/login` would otherwise count as having changed something. `dialog` alone
 * is a dismissal; accepting one carries `destructive`, which is here.
 */
const CHANGING_EFFECTS = new Set<AgentSemanticEffect>([
  "activation",
  "form_mutation",
  "submission",
  "destructive",
  "drag",
  "download"
])

/** Whether an effect about to be attempted changes the page. */
export const agentEffectChangesPage = (effect: ResolvedAgentEffect): boolean =>
  effect.semanticEffects.some((semantic) => CHANGING_EFFECTS.has(semantic))

/**
 * Whether a run may declare its goal met.
 *
 * A run has three separate things it can know, and conflating them is how it
 * reports work it did not do:
 *
 * - **Input delivered** — the page received the events (`AgentInputDelivery`).
 * - **Effect observed** — the control changed as the step intended
 *   (`AgentVerificationResult`).
 * - **Goal achieved** — the thing the user asked for is true of the page.
 *
 * The third does not follow from the second. Clicking Save is an activation
 * whose effect a verifier can confirm — the button was pressed, the page
 * changed — while the document is still unsaved, the request still in flight,
 * or the form rejected. `complete` used to be taken at the model's word, so
 * every run that pressed the right button reported success.
 *
 * So a run that changed anything owes evidence: a string it can point to in
 * the page as it stands now. A run that changed nothing owes none — a reading
 * task's answer is the thing it read, and asking it to quote a saved-state
 * indicator that does not exist would refuse every research goal.
 */
export type AgentCompletionJudgement =
  | { type: "accepted" }
  | {
      type: "refused"
      reason:
        | "unverified_change"
        | "missing_evidence"
        | "absent_evidence"
        | "self_evidence"
        | "stale_evidence"
      /** Written for the model, from templates and its own words only. */
      feedback: string
    }

export interface AgentCompletionInput {
  /**
   * The run's own receipts, oldest first, as persistence returns them.
   * `undefined` means they could not be read — which is not the same as
   * there being none, and must not be judged as a run that changed nothing.
   */
  steps?: readonly AgentStepReadout[]
  /** The page the completion was decided on. */
  observation: AgentObservation
  /** What the model says shows the goal is met, if it said anything. */
  evidence?: string
  /**
   * The page as it read when the run's last change was decided, flattened by
   * `agentObservationHaystack`. Best effort: it lives in the worker that made
   * the change, so a restart loses it and the staleness check is skipped
   * rather than guessed at.
   */
  baselineText?: string
}

/**
 * Commands that change the page rather than read it.
 *
 * Read against the command rather than the semantic effects, because the
 * effects are not what a receipt keeps — but a receipt does record whether
 * the step it closed was a change, and that is what `mutating` carries. This
 * set is the fallback for a receipt written before that field existed: an
 * older run in flight across an upgrade still has to be judged, and judging
 * it as a change is the conservative half of the answer.
 */
const CHANGING_COMMANDS = new Set<AgentCommand["type"]>([
  "click",
  "click_point",
  "double_click",
  "type",
  "clear_and_type",
  "replace_text",
  "drag",
  "select",
  "check",
  "uncheck",
  "press_key",
  "handle_dialog"
])

/** A step is a change once it has actually been applied to the page. */
const APPLIED_STATUSES = new Set(["executed", "verified", "uncertain"])

const isChange = (step: AgentStepReadout): boolean => {
  if (!APPLIED_STATUSES.has(step.status)) return false
  if (step.mutating !== undefined) return step.mutating
  return step.command !== undefined && CHANGING_COMMANDS.has(step.command.type)
}

/**
 * The last change the run applied, by durable order. Only the last one is
 * asked about: an earlier change that was superseded says nothing about
 * whether the run is finished, while the most recent one is the state the
 * completion is claiming about.
 */
const lastChange = (
  steps: readonly AgentStepReadout[]
): AgentStepReadout | undefined =>
  [...steps]
    .sort((first, second) => first.sequence - second.sequence)
    .filter(isChange)
    .at(-1)

const MISSING_EVIDENCE_FEEDBACK =
  "This run changed the page, so complete needs evidence: a short phrase that is visible on the page now and shows the goal is met, such as a saved-state indicator or the new value itself. Observe the page and complete again with evidence, or keep working."

const ABSENT_EVIDENCE_FEEDBACK =
  "The evidence named for complete is not present in the observation. Quote text the page actually shows now, or keep working until it does; wait can hold for an indicator that has not appeared yet."

const UNVERIFIED_CHANGE_FEEDBACK =
  "The last change this run made was not confirmed, so the goal cannot be reported as met. Observe the page and check the change took effect — wait for a saved-state indicator, or make the change again — before completing."

const SELF_EVIDENCE_FEEDBACK =
  "The evidence named for complete is the label of the control this run acted on, which was on the page before the action and shows nothing about its outcome. Name what the page says now that it did not say before."

const STALE_EVIDENCE_FEEDBACK =
  "The evidence named for complete was already on the page before this run changed anything, so it does not show the change happened. Name something the change produced, or wait for it to appear."

/**
 * Evidence that is the acted-on control's own label.
 *
 * Clicking Save and then citing "Save" is the shape of a false completion
 * that presence alone cannot catch: the word is on the page, and it was on
 * the page before the click. Compared exactly after normalising, not by
 * containment — a goal whose own wording happens to include a button's label
 * ("rename it to Save the world") is a real answer, and refusing it would
 * cost more than the bypass does.
 */
const isSelfEvidence = (
  evidence: string,
  change: AgentStepReadout
): boolean => {
  const name = change.target?.name
  return (
    name !== undefined &&
    agentNormalizedClaim(name).length > 0 &&
    agentNormalizedClaim(name) === agentNormalizedClaim(evidence)
  )
}

/**
 * `accepted` means the completion may be recorded. A refusal is a safe
 * failure: nothing was done to the page and the run can look again, so it is
 * fed back to the model rather than ending the run.
 */
export const judgeAgentCompletion = (
  input: AgentCompletionInput
): AgentCompletionJudgement => {
  const change = input.steps ? lastChange(input.steps) : "unreadable"
  /** Only a run whose receipts say it changed nothing completes unevidenced. */
  if (change === undefined) return { type: "accepted" }
  /**
   * Receipts that cannot be read are an unknown, and an unknown is not a no.
   * The verification check is skipped — there is nothing to check it against,
   * and a refusal the run could never clear would loop it to death — but the
   * evidence requirement stands, because that is the half a model can answer
   * by looking at the page in front of it.
   */
  if (change !== "unreadable" && change.verification?.outcome !== "confirmed") {
    return {
      type: "refused",
      reason: "unverified_change",
      feedback: UNVERIFIED_CHANGE_FEEDBACK
    }
  }
  const evidence = input.evidence?.trim()
  if (!evidence) {
    return {
      type: "refused",
      reason: "missing_evidence",
      feedback: MISSING_EVIDENCE_FEEDBACK
    }
  }
  if (!agentObservationStates(evidence, input.observation)) {
    return {
      type: "refused",
      reason: "absent_evidence",
      feedback: ABSENT_EVIDENCE_FEEDBACK
    }
  }
  /**
   * Presence is necessary and not sufficient. Nothing here can judge whether
   * a phrase demonstrates the goal — that is the claim the model is making,
   * and a deterministic rule cannot check it. What it can refuse is evidence
   * that was already true before the change, which therefore cannot be
   * evidence of the change: the acted-on control's own label, and anything
   * the page already said when the change was decided.
   */
  if (change !== "unreadable" && isSelfEvidence(evidence, change)) {
    return {
      type: "refused",
      reason: "self_evidence",
      feedback: SELF_EVIDENCE_FEEDBACK
    }
  }
  if (
    input.baselineText !== undefined &&
    agentHaystackStates(evidence, input.baselineText)
  ) {
    return {
      type: "refused",
      reason: "stale_evidence",
      feedback: STALE_EVIDENCE_FEEDBACK
    }
  }
  return { type: "accepted" }
}
