import type {
  AgentCommand,
  AgentObservation,
  AgentRunOutcome,
  AgentStepStatus,
  AgentTaskRequirement
} from "@ollama-client/contracts"

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
 * What a quotation is for is the gap between the second answer and the third,
 * and it is only asked for where that gap exists. Whether it exists is a
 * question about the verification, not about the outcome: `confirmed` is one
 * word for two different findings.
 *
 * A verifier that compared the step's own intended result against the page —
 * the field holds the resolved value, the control holds the resolved checked
 * state, the dragged item is among its new neighbours — has already answered
 * the third question for the change it checked, and that check is the
 * evidence. Demanding a quotation on top of it asked for something a toggle
 * cannot produce: selecting Blue in a dropdown and ticking a checkbox add no
 * new words to the page, so every phrase the model could name was either
 * already there (`stale_evidence`), the control's own label (`self_evidence`)
 * or not page text at all (`absent_evidence`). Three live runs finished the
 * task, were confirmed, and then spent their whole budget being refused for
 * work they had done.
 *
 * A verifier that could only watch for a reaction has not. `activation` is
 * `confirmed` when the page changed in any observable way, or when the
 * control merely took focus; `submission` when the form went; `navigation`
 * when the tab arrived. Every one of those is the first two answers and
 * neither is the third — a menu opening is an observable page change, so
 * accepting a confirmed activation unevidenced let a run click any
 * intermediate control and report the goal met. Those still owe a quotation.
 *
 * The quotation is also required where the run cannot vouch for its own
 * change at all: a step that verified `ambiguous` — the effect landed and the
 * page has not shown its consequence — and a run whose receipts could not be
 * read. A change with no verification recorded is refused outright; there is
 * nothing for a quotation to add to a step nobody checked.
 *
 * A run that changed nothing owes none of this — a reading task's answer is
 * the thing it read, and asking it to quote a saved-state indicator that does
 * not exist would refuse every research goal.
 */
export type AgentCompletionJudgement =
  | { type: "accepted"; outcome?: AgentRunOutcome }
  /**
   * Some of what was asked, and the run said so itself.
   *
   * Not a refusal: a refusal sends the run back to look again, and a run that
   * has correctly reported it could not do one of three things would loop
   * forever on the one it cannot do. This settles it, and the status it
   * settles into is not `completed`.
   */
  | { type: "partial"; outcome: AgentRunOutcome }
  | {
      type: "refused"
      reason:
        | "unverified_change"
        | "missing_evidence"
        | "absent_evidence"
        | "self_evidence"
        | "stale_evidence"
        | "missing_outcomes"
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
  /**
   * What the goal asks for, as the planning call fixed it. Absent means the
   * run was never planned — a host with no plan port, or a plan call that
   * failed — and the judge falls back to the single-evidence rule below,
   * which is weaker and is why planning exists.
   */
  requirements?: readonly AgentTaskRequirement[]
  /** The model's answer for each requirement, by id. */
  outcomes?: readonly AgentCompletionOutcomeClaim[]
}

export interface AgentCompletionOutcomeClaim {
  id: string
  met: boolean
  evidence?: string
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

/**
 * A step is a change once it has actually been applied to the page.
 *
 * Exported because the controller has to promote its evidence baseline for
 * exactly the steps this selects: a mutating command that policy refused, or
 * that executed and then verified negative, is not the change a later
 * completion is judged against, and a baseline captured for it would measure
 * that completion against a page already holding the previous change's own
 * result. Two copies of this rule would be two places for that to drift.
 */
const APPLIED_STATUSES = new Set<AgentStepStatus>([
  "executed",
  "verified",
  "uncertain"
])

export const isAppliedAgentStepStatus = (status: AgentStepStatus): boolean =>
  APPLIED_STATUSES.has(status)

const isChange = (step: AgentStepReadout): boolean => {
  if (!isAppliedAgentStepStatus(step.status)) return false
  if (step.mutating !== undefined) return step.mutating
  return step.command !== undefined && CHANGING_COMMANDS.has(step.command.type)
}

/**
 * The last change the run applied, by durable order.
 *
 * A step is appended once per lifecycle change, so the receipts hold several
 * rows for one step and only the newest says how it ended: reading them all
 * would let a step's superseded `executed` receipt stand for a step that went
 * on to fail, which is an applied change with no verification and refuses
 * every completion after it. Collapsed to the last receipt per step first,
 * the same way history is.
 *
 * Only the last change is then asked about: an earlier one that was
 * superseded says nothing about whether the run is finished, while the most
 * recent is the state the completion is claiming about.
 */
const lastChange = (
  steps: readonly AgentStepReadout[]
): AgentStepReadout | undefined => {
  const latest = new Map<string, AgentStepReadout>()
  for (const step of [...steps].sort(
    (first, second) => first.sequence - second.sequence
  )) {
    latest.set(step.stepId, step)
  }
  return [...latest.values()].filter(isChange).at(-1)
}

/**
 * Verification evidence that answers what the step was for, rather than that
 * something happened.
 *
 * Read off the evidence kind rather than the command, because the verifier is
 * what decides which question it managed to answer: a click on a checkbox is
 * verified against its resolved checked state, while a click on a menu item
 * is verified against the page having changed at all. The second is true of
 * every intermediate step a run takes.
 */
const RESULT_VERIFIED_EVIDENCE = new Set([
  /** The control holds the value the step resolved. */
  "field",
  /** The control holds the checked state the step resolved. */
  "checked",
  /** The dragged item is where the drag meant to put it. */
  "arrangement",
  /** `wait` saw the application state it was told to wait for. */
  "condition"
])

const provesItsOwnResult = (
  verification: AgentStepReadout["verification"]
): boolean =>
  verification !== undefined &&
  RESULT_VERIFIED_EVIDENCE.has(verification.evidence.kind)

const MISSING_EVIDENCE_FEEDBACK =
  "This run changed the page, so complete needs evidence: a short phrase that is visible on the page now and shows the goal is met, such as a saved-state indicator or the new value itself. Observe the page and complete again with evidence, or keep working."

const ABSENT_EVIDENCE_FEEDBACK =
  "The evidence string does not occur on the current page. Copy ONLY an exact phrase from observation text or an element value into evidence, without explanation or quotation marks. For an edit use the changed words themselves. Do not quote history or verifier commentary. If the result has not appeared, wait for it."

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
const MISSING_OUTCOMES_FEEDBACK =
  "Answer every requirement the task was planned with, by id, saying for each whether it is met and quoting the page text that shows it."

/**
 * The checks a single quotation has to survive, shared by both paths.
 *
 * Presence is necessary and not sufficient. Nothing here can judge whether a
 * phrase demonstrates an outcome — that is the claim the model is making, and
 * a deterministic rule cannot check it. What it can refuse is evidence that
 * was already true before the change, which therefore cannot be evidence of
 * it: the acted-on control's own label, and anything the page already said
 * when the change was decided.
 */
const judgeEvidence = (
  evidence: string | undefined,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable"
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined => {
  const quoted = evidence?.trim()
  if (!quoted)
    return {
      type: "refused",
      reason: "missing_evidence",
      feedback: MISSING_EVIDENCE_FEEDBACK
    }
  if (!agentObservationStates(quoted, input.observation))
    return {
      type: "refused",
      reason: "absent_evidence",
      feedback: ABSENT_EVIDENCE_FEEDBACK
    }
  if (change !== "unreadable" && isSelfEvidence(quoted, change))
    return {
      type: "refused",
      reason: "self_evidence",
      feedback: SELF_EVIDENCE_FEEDBACK
    }
  if (
    input.baselineText !== undefined &&
    agentHaystackStates(quoted, input.baselineText)
  )
    return {
      type: "refused",
      reason: "stale_evidence",
      feedback: STALE_EVIDENCE_FEEDBACK
    }
  return undefined
}

/**
 * Judged requirement by requirement, which is the whole point of planning.
 *
 * The rule this replaces selected the run's last applied mutation and
 * accepted the entire task when that one step's verification confirmed the
 * step's own intended result. A run told to fill a form and submit it could
 * submit an empty one and pass, because submitting is a mutation and the
 * verifier confirmed a submission had happened.
 *
 * Each `change` requirement now owes its own quotation, and each quotation
 * faces the same four checks the single one used to. A `read` requirement
 * owes none: what it read is its answer, and asking a research goal to quote
 * a saved-state indicator that does not exist would refuse every one.
 */
const judgePlanned = (
  input: AgentCompletionInput,
  requirements: readonly AgentTaskRequirement[],
  change: AgentStepReadout | "unreadable" | undefined
): AgentCompletionJudgement => {
  /**
   * The verification gate applies once, before any requirement is read: a
   * change nobody checked is a change nothing can be quoted about, and
   * per-requirement evidence cannot substitute for it.
   */
  if (change !== undefined && change !== "unreadable") {
    const verified = change.verification?.outcome
    if (verified !== "confirmed" && verified !== "ambiguous")
      return {
        type: "refused",
        reason: "unverified_change",
        feedback: UNVERIFIED_CHANGE_FEEDBACK
      }
  }
  const claims = new Map(
    (input.outcomes ?? []).map((claim) => [claim.id, claim])
  )
  /**
   * Every requirement answered, or the run is sent back to answer them. A
   * silent omission is the cheapest way to drop the inconvenient one, so it
   * cannot be read as "not met" — it has to be read as no answer at all.
   */
  if (requirements.some((requirement) => !claims.has(requirement.id)))
    return {
      type: "refused",
      reason: "missing_outcomes",
      feedback: MISSING_OUTCOMES_FEEDBACK
    }
  const met: string[] = []
  const unmet: string[] = []
  for (const requirement of requirements) {
    const claim = claims.get(requirement.id)
    if (!claim?.met) {
      unmet.push(requirement.id)
      continue
    }
    if (requirement.kind === "read") {
      met.push(requirement.id)
      continue
    }
    const refusal = judgeEvidence(claim.evidence, input, change ?? "unreadable")
    if (refusal) return refusal
    met.push(requirement.id)
  }
  const outcome = { met, unmet }
  return unmet.length === 0
    ? { type: "accepted", outcome }
    : { type: "partial", outcome }
}

export const judgeAgentCompletion = (
  input: AgentCompletionInput
): AgentCompletionJudgement => {
  const change = input.steps ? lastChange(input.steps) : "unreadable"
  if (input.requirements?.length)
    return judgePlanned(input, input.requirements, change)
  /** Only a run whose receipts say it changed nothing completes unevidenced. */
  if (change === undefined) {
    // A read needs no change evidence, but a supplied page quote must still be real.
    if (
      input.evidence?.trim() &&
      !agentObservationStates(input.evidence, input.observation)
    )
      return {
        type: "refused",
        reason: "absent_evidence",
        feedback: ABSENT_EVIDENCE_FEEDBACK
      }
    return { type: "accepted" }
  }
  /**
   * Receipts that cannot be read are an unknown, and an unknown is not a no.
   * The verification check is skipped — there is nothing to check it against,
   * and a refusal the run could never clear would loop it to death — but the
   * evidence requirement stands, because that is the half a model can answer
   * by looking at the page in front of it.
   */
  if (change !== "unreadable") {
    const verification = change.verification
    const outcome = verification?.outcome
    /**
     * The verification is the evidence, where the verifier compared the
     * step's own intended result against the page. That is strictly more
     * than a quoted phrase proves — and it is what a reaction-shaped
     * confirmation does not carry.
     */
    if (outcome === "confirmed" && provesItsOwnResult(verification))
      return { type: "accepted" }
    /**
     * Neither `confirmed` nor `ambiguous` means no verification was recorded
     * at all: a step a worker restart interrupted, which is `uncertain` with
     * nothing behind it. Nobody checked it, so there is nothing a quotation
     * could complete.
     */
    if (outcome !== "confirmed" && outcome !== "ambiguous") {
      return {
        type: "refused",
        reason: "unverified_change",
        feedback: UNVERIFIED_CHANGE_FEEDBACK
      }
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
