import type {
  AgentCommand,
  AgentEvidenceRecord,
  AgentFormField,
  AgentObservation,
  AgentRunOutcome,
  AgentStepStatus,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import {
  type AgentCollectedRecord,
  agentAnswerAgainstCompared,
  agentCollectedRecords,
  agentComparedAnswer,
  agentSuperlativeRead
} from "./collected-records"
import {
  AGENT_PAGE_LEAVING_ACTIVATIONS,
  agentCheckFailureUnreadable,
  agentFollowedLink,
  agentHeldLiteralStands,
  agentFactPageLink,
  checkCompletionState,
  groundedCompletionQuote,
  groundedCompletionQuotes,
  visualCompletionRead
} from "./completion-support"
import { latestAgentSteps } from "./history"
import {
  agentHaystackStates,
  agentNormalizedClaim,
  agentObservationStates
} from "./observed-text"
import { agentPageItemTabs } from "./plan-page-items"
import { agentCartServesPurchase } from "./plan-record"
import type {
  AgentSemanticEffect,
  AgentStepReadout,
  ResolvedAgentEffect
} from "./ports"
import { agentForbidsEffect } from "./prior-effects"
import { agentTextNamesRecord } from "./row-context"
import {
  isLocaleNegationWord,
  isLocaleStateClaimWord,
  localeAccepts,
  localeAssertsOff,
  localeAssertsOn
} from "./state-words"

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
 * Planned reads require independently grounded source support. A quote
 * establishes provenance; typed checks or exact receipt facts establish
 * change outcomes. Ambiguous semantic claims return needs_review.
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
  /**
   * The run reached an answer and the answer was "none of it".
   *
   * Separate from `partial` because partial says some of the task was done,
   * and a run that met nothing showing as "Partly done" is the same kind of
   * overstatement the whole gate exists to stop — just a smaller one. The
   * controller settles this as a failure.
   */
  | { type: "unmet"; outcome: AgentRunOutcome }
  | {
      type: "refused"
      reason:
        | "unverified_change"
        | "missing_evidence"
        | "absent_evidence"
        | "self_evidence"
        | "stale_evidence"
        | "missing_outcomes"
        | "premature_unmet"
        | "needs_review"
        | "contradicted_state"
        | "readback_required"
      /** Written for the model, from templates and its own words only. */
      feedback: string
      /**
       * Set only on a `needs_review` refusal an independent reviewer may
       * settle: which planned ids no deterministic check could decide, and
       * what the judge decided about every other one. Absent when the gap is
       * missing evidence rather than missing judgement — a receipt with no
       * recorded effect classes is not something reading can supply.
       */
      review?: AgentCompletionReviewScope
      /** Set on a `readback_required` refusal: the outcomes to read back. */
      readback?: readonly string[]
    }

/**
 * What a `needs_review` refusal leaves undecided, and nothing else.
 *
 * Every id outside `requirementIds` and `constraintIds` was judged
 * deterministically, and `outcome` is that judgement. A reviewer can move
 * only the listed ids, and only into `met`: deterministic failures return
 * before a scope is ever built, so there is no failure here to override.
 */
export interface AgentCompletionReviewScope {
  requirementIds: string[]
  constraintIds: string[]
  outcome: AgentRunOutcome
}

export interface AgentCompletionInput {
  evidenceLedger?: readonly AgentEvidenceRecord[]
  constraints?: readonly AgentTaskConstraint[]
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
  /** The model's own account of the run, read only for what it admits. */
  summary?: string
  /**
   * The page as it read when the run's last change was decided, flattened by
   * `agentObservationHaystack`. Best effort: it lives in the worker that made
   * the change, so a restart loses it and the staleness check is skipped
   * rather than guessed at.
   */
  baselineText?: string
  /** Legacy metadata; never used as independent grounded support. */
  observedTexts?: readonly string[]
  /**
   * The steps whose execution opened the tab the completion was decided on,
   * by step id. Memory-only: a restart loses it, and an absent list never
   * stands in for a tab a step opened.
   */
  tabOpenedBy?: readonly string[]
  /**
   * What the goal asks for, as the planning call fixed it. Absent means the
   * run was never planned — a host with no plan port, or a plan call that
   * failed — and the judge falls back to the single-evidence rule below,
   * which is weaker and is why planning exists.
   */
  requirements?: readonly AgentTaskRequirement[]
  /** The model's answer for each requirement, by id. */
  outcomes?: readonly AgentCompletionOutcomeClaim[]
  /**
   * When the run began. Its first page is read before its first receipt is
   * written, so the receipts alone date the run too late for that page.
   */
  startedAt?: number
}

export interface AgentCompletionOutcomeClaim {
  id: string
  met: boolean
  evidence?: string
  /** One answer per item of an itemized requirement, by position. */
  items?: readonly { index: number; met: boolean; evidence?: string }[]
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
  "fill_form",
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

/**
 * Whether a receipt is a change the completion gate reads.
 *
 * Exported because recovery reconciliation has to find the same receipts the
 * judge will: a supervisor disposition belongs on exactly the recovered
 * change rows a later completion is judged against, and two copies of this
 * rule would be two places for that to drift.
 */
export const isAgentChangeReceipt = (
  step: Pick<AgentStepReadout, "status" | "mutating" | "command">
): boolean => {
  if (!isAppliedAgentStepStatus(step.status)) return false
  if (step.mutating !== undefined) return step.mutating
  return step.command !== undefined && CHANGING_COMMANDS.has(step.command.type)
}

const isChange = (step: AgentStepReadout): boolean => isAgentChangeReceipt(step)

/**
 * Every change the run applied, oldest first.
 *
 * Steps are appended once per lifecycle change, so the receipts hold several
 * rows for one step and only the newest says how it ended: reading them all
 * would let a step's superseded `executed` receipt stand for a step that went
 * on to fail, which is an applied change with no verification and refuses
 * every completion after it. Collapsed to the last receipt per step first,
 * the same way history is.
 *
 * The collapsed rows are re-sorted because map order is first-seen order,
 * not durable order: a step with receipts at sequences 1 and 3 would
 * otherwise sort before a step first seen at 2, and the last change would be
 * the wrong one.
 */
const allChanges = (steps: readonly AgentStepReadout[]): AgentStepReadout[] => {
  const latest = new Map<string, AgentStepReadout>()
  for (const step of [...steps].sort(
    (first, second) => first.sequence - second.sequence
  )) {
    const previous = latest.get(step.stepId)
    latest.set(
      step.stepId,
      previous?.requirementId && !step.requirementId
        ? { ...step, requirementId: previous.requirementId }
        : step
    )
  }
  return [...latest.values()]
    .sort((first, second) => first.sequence - second.sequence)
    .filter(isChange)
}

/**
 * Whether the page the run reads now was loaded after the change a saved
 * outcome rests on. A toast, or the edited page still holding the edit, is
 * the site reporting success: an optimistic save that the server then
 * rejected looks exactly like that. A page loaded afterwards shows what the
 * site kept — a navigation or a new tab the run opened after the change, or
 * a submission the site accepted by moving on to a new page. `back` is not
 * one: a cached page can come back holding exactly what it showed before.
 */
const readBackAfterChange = (
  requirement: AgentTaskRequirement,
  steps: readonly AgentStepReadout[] | undefined
): boolean => {
  if (!steps) return false
  const latest = new Map<string, AgentStepReadout>()
  for (const step of [...steps].sort(
    (first, second) => first.sequence - second.sequence
  ))
    latest.set(step.stepId, step)
  const ordered = [...latest.values()].sort(
    (first, second) => first.sequence - second.sequence
  )
  const changes = allChanges(steps)
  const bound = changes.filter((step) => step.requirementId === requirement.id)
  const last = (bound.length ? bound : changes).at(-1)
  /** Nothing this run changed: there is no save of its own to read back. */
  if (!last) return true
  const evidence = last.verification?.evidence
  if (
    last.verification?.outcome === "confirmed" &&
    evidence?.kind === "submission" &&
    evidence.acceptance === "accepted"
  )
    return true
  return ordered.some(
    (step) =>
      step.sequence > last.sequence &&
      (step.command?.type === "navigate" ||
        step.command?.type === "open_tab") &&
      step.verification?.outcome === "confirmed"
  )
}

/**
 * The refusal that asks for the read back carries its ids in a fixed
 * template, so whether it was already asked is read from the run's own
 * receipts and survives a restart. Asked once per outcome: a run that
 * cannot read the record back settles it as claimed rather than looping.
 */
const READBACK_FEEDBACK_PREFIX = "Read back "

const readbackFeedback = (ids: readonly string[]): string =>
  `${READBACK_FEEDBACK_PREFIX}${ids.join(", ")}: the site only reported ${ids.length === 1 ? "this change" : "these changes"} on the page where ${ids.length === 1 ? "it was" : "they were"} made, which is not proof it was kept. Open the record again — navigate to its page, or open_tab with its address — and complete from what the freshly loaded page shows. Do not make the change again.`

/**
 * The same refusal when the runtime reopens the record itself. It keeps the
 * prefix, so it counts as the one ask.
 */
export const agentReadbackProbeFeedback = (ids: readonly string[]): string =>
  `${READBACK_FEEDBACK_PREFIX}${ids.join(", ")}: the site only reported ${ids.length === 1 ? "this change" : "these changes"} on the page where ${ids.length === 1 ? "it was" : "they were"} made, which is not proof it was kept. The runtime is opening that page again in a new tab. Complete from what the freshly loaded page shows. Do not make the change again.`

const readbackAsked = (
  id: string,
  steps: readonly AgentStepReadout[] | undefined
): boolean =>
  steps?.some((step) => {
    const summary = step.verification?.evidence.summary ?? ""
    return (
      step.stepId.includes(":completion:") &&
      summary.startsWith(READBACK_FEEDBACK_PREFIX) &&
      summary
        .slice(READBACK_FEEDBACK_PREFIX.length, summary.indexOf(":"))
        .split(", ")
        .includes(id)
    )
  }) === true

/** Every change the run applied, oldest first; see `allChanges`. */
export const agentAppliedChanges = (
  steps: readonly AgentStepReadout[]
): AgentStepReadout[] => allChanges(steps)

/**
 * The last change the run applied, by durable order.
 *
 * Only the last change is asked about on the unplanned path: an earlier one
 * that was superseded says nothing about whether the run is finished, while
 * the most recent is the state the completion is claiming about.
 */
const lastChange = (
  steps: readonly AgentStepReadout[]
): AgentStepReadout | undefined => allChanges(steps).at(-1)

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
  /** Every field in a batch holds its resolved value. */
  "fields",
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

/**
 * The checked state a checkbox receipt confirmed, as a quotation would put
 * it. Only the confirmed direction: `checked:false` names an uncheck and
 * refuses a check.
 */
const CHECKED_STATE_WORDS = {
  check: new Set(["checked", "ticked", "selected", "true", "yes"]),
  uncheck: new Set(["unchecked", "unticked", "deselected", "cleared", "false"])
} as const

/**
 * Whether a quotation is made only of what the receipt itself holds — its
 * control's name, its value, the state it confirmed — so that it asserts
 * nothing the receipt does not.
 *
 * The page never says `name=Alice` or `checked:false`; a model that read the
 * address bar or wrote the state as data quotes that way, and refusing it
 * while a requirement answered with no quotation at all is rescued sent a
 * run its receipt had already finished back to ask the user. A word outside
 * those facts — "Bob", "saved", a verifier sentence — is a claim, and refuses
 * as before. Function words count for nothing, so at least one fact must be
 * named.
 */
const quotationStatesReceiptFacts = (
  quoted: string,
  receipt: AgentStepReadout
): boolean => {
  const command = receipt.command
  const value =
    command?.type === "select"
      ? command.value
      : command?.type === "type" ||
          command?.type === "clear_and_type" ||
          command?.type === "replace_text"
        ? command.text
        : undefined
  const facts = factWords([receipt.target?.name, value])
  const state =
    command?.type === "check" || command?.type === "uncheck"
      ? CHECKED_STATE_WORDS[command.type]
      : undefined
  return statesOnlyFacts(quoted, facts, state)
}

/** Every substantive word must be a verified fact, not an added claim. */
const statesOnlyFacts = (
  quoted: string,
  facts: ReadonlySet<string>,
  state?: ReadonlySet<string>
): boolean => {
  const named = claimWords(quoted).filter(
    (word) => !CLAIM_FUNCTION_WORDS.has(word)
  )
  return (
    named.length > 0 &&
    named.every((word) => facts.has(word) || state?.has(word) === true)
  )
}

/**
 * A change whose verified state answers its requirement without a quotation:
 * confirmed, and of a kind the verifier compared against the step's own
 * intended result. `ambiguous` is excluded — the effect landed and the page
 * has not shown its consequence, so nothing here vouches for the outcome.
 */
const isResultVerifiedChange = (step: AgentStepReadout): boolean =>
  step.verification?.outcome === "confirmed" &&
  provesItsOwnResult(step.verification)

/**
 * Whether the plan's own words are about the receipt's control.
 *
 * The binding between a requirement and the receipt that evidences it. The
 * plan is fixed before the first observation, so it cannot be rewritten
 * mid-run to bless whatever happened to verify: a verified change to
 * checkbox B cannot satisfy a claim about checkbox A, because the plan's
 * words for A do not name B's control. New receipts carry the requirement id
 * the command explicitly advanced, so a brief plan label can bind to a longer
 * accessible name without guessing. Legacy receipts fall back to requiring
 * the full target name as a complete phrase. A receipt with neither binding
 * binds to nothing.
 */
const requirementNamesReceiptTarget = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout
): boolean => {
  const name = receipt.target?.name
  const text = agentNormalizedClaim(requirement.text)
  if (receipt.requirementId !== undefined) {
    if (receipt.requirementId !== requirement.id) return false
    /**
     * The tag is the model's word for which outcome a step advanced. On a
     * requirement with a check, the check binds the evidence; without one,
     * the tag alone let any change the model labelled vouch for it. The
     * control it acted on has to share a word with the requirement, which a
     * brief label and a longer accessible name do ("email" and "Work email
     * address") and an unrelated control does not.
     */
    return (
      requirement.check !== undefined ||
      name === undefined ||
      sharesContentWord(text, agentNormalizedClaim(name))
    )
  }
  if (name === undefined) return false
  const want = agentNormalizedClaim(name)
  return (
    want.length > 0 && text.length > 0 && containsCompletePhrase(text, want)
  )
}

/** Words too common to tie a control to an outcome. */
const BINDING_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "this",
  "that",
  "your",
  "our",
  "new",
  "all",
  "set",
  "add",
  "button",
  "field",
  "page"
])

const contentWords = (text: string): string[] =>
  text
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !BINDING_STOP_WORDS.has(word))

const sharesContentWord = (text: string, name: string): boolean => {
  const words = new Set(contentWords(text))
  return contentWords(name).some((word) => words.has(word))
}

/**
 * Whether a requirement names a field: by its whole name, or by the last
 * word of a qualified one when that word picks out exactly one field on the
 * page. "Address" names "Billing address" on a form with no other address;
 * on a form that also has "Shipping address" it names neither.
 */
const requirementNamesField = (
  text: string,
  name: string,
  observation: AgentObservation
): boolean => {
  const want = agentNormalizedClaim(name)
  if (!want) return false
  if (containsCompletePhrase(text, want)) return true
  const head = contentWords(want).at(-1)
  if (!head || head === want || !containsCompletePhrase(text, head))
    return false
  return (
    observation.elements.filter(
      (element) =>
        !element.sensitive &&
        contentWords(agentNormalizedClaim(element.name ?? "")).at(-1) === head
    ).length === 1
  )
}

const CLAIM_WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u

/**
 * Every occurrence whose neighbours are punctuation, whitespace, or string
 * ends. Normalised values remain page text rather than regex source: `red`
 * matches "use red," but never the `red` inside "infrared".
 */
const completePhraseOccurrences = (
  text: string,
  phrase: string
): Array<{ start: number; end: number }> => {
  const matches: Array<{ start: number; end: number }> = []
  if (phrase.length === 0) return matches
  let start = text.indexOf(phrase)
  while (start !== -1) {
    const end = start + phrase.length
    const before = start === 0 ? undefined : text[start - 1]
    const after = end === text.length ? undefined : text[end]
    if (
      (before === undefined || !CLAIM_WORD_CHARACTER.test(before)) &&
      (after === undefined || !CLAIM_WORD_CHARACTER.test(after))
    ) {
      matches.push({ start, end })
    }
    start = text.indexOf(phrase, start + 1)
  }
  return matches
}

const containsCompletePhrase = (text: string, phrase: string): boolean =>
  completePhraseOccurrences(text, phrase).length > 0

/**
 * "on" and "off" are states only when nothing follows them as their object:
 * the planner writes "the Agree checkbox on the current page is unchecked",
 * and reading that "on" as a state made the requirement assert both, so a
 * verified uncheck could never vouch for it.
 */
const PREPOSITION_OBJECT =
  "(?!\\s+(?:the|a|an|this|that|these|those|its|each|every|any|all|page|screen|site|tab|form)\\b)"
const ON = `on${PREPOSITION_OBJECT}`
const OFF = `off${PREPOSITION_OBJECT}`
const ON_WORDS = `check|checked|tick|ticked|select|selected|enable|enabled|${ON}`
const OFF_WORDS = `uncheck|unchecked|untick|unticked|deselect|deselected|clear|cleared|disable|disabled|${OFF}`

const CHECKED_OFF_PATTERN = new RegExp(`\\b(${OFF_WORDS})\\b`)
const CHECKED_ON_PATTERN = new RegExp(`\\b(${ON_WORDS})\\b`)

/**
 * A state word scoped by a negation ("not checked", "isn't selected", "never
 * ticked"). The negation sits up to three words before the state it flips —
 * "not currently checked" still asserts off — so a bare opposite-word test
 * that ignores it reads "not checked" as silence and lets a checked receipt
 * vouch for it.
 */
const negated = (words: string): RegExp =>
  new RegExp(
    `\\b(?:not|never|neither|nor|without)\\b(?:\\s+\\w+){0,3}?\\s+(?:${words})\\b|n['’]t(?:\\s+\\w+){0,3}?\\s+(?:${words})\\b`
  )
const NEGATED_ON_PATTERN = negated(ON_WORDS)
const NEGATED_OFF_PATTERN = negated(OFF_WORDS)
const NEGATED_ON_PATTERN_GLOBAL = new RegExp(NEGATED_ON_PATTERN.source, "g")
const NEGATED_OFF_PATTERN_GLOBAL = new RegExp(NEGATED_OFF_PATTERN.source, "g")

/**
 * A bare negation near a resolved value ("not blue", "blue is not selected").
 * The window is deliberately small and fail-safe: a quoted value with a
 * negation beside it is refused, and the run quotes what it meant instead —
 * values are page text, so the quotation exists.
 */
const VALUE_NEGATED_BEFORE_PATTERN =
  /(?:\b(?:not|never|neither|nor|without)\b|n['’]t)(?:\s+[\p{L}\p{N}_'-]+){0,3}\s*$/u
const VALUE_NEGATED_AFTER_PATTERN =
  /^\s+(?:(?:is|are|was|were|be|been|being|should|must|does|do|did|has|have|had|can|could|would|will|may|might)\s+(?:not|never)\b|(?:is|are|was|were|should|must|does|do|did|has|have|had|can|could|would|will|may|might)n['’]t\b)/u

/** The state the requirement asserts, once negations flip what they scope. */
const requirementAssertsOff = (text: string): boolean => {
  if (NEGATED_ON_PATTERN.test(text) || localeAssertsOff(text)) return true
  const unnegated = text
    .replace(NEGATED_ON_PATTERN_GLOBAL, " ")
    .replace(NEGATED_OFF_PATTERN_GLOBAL, " ")
  return CHECKED_OFF_PATTERN.test(unnegated)
}

const requirementAssertsOn = (text: string): boolean => {
  if (NEGATED_OFF_PATTERN.test(text) || localeAssertsOn(text)) return true
  const unnegated = text
    .replace(NEGATED_ON_PATTERN_GLOBAL, " ")
    .replace(NEGATED_OFF_PATTERN_GLOBAL, " ")
  return CHECKED_ON_PATTERN.test(unnegated)
}

/**
 * Whether one complete value occurrence is the subject of a negated
 * predicate. A negation before the value ("not blue") scopes forward; one
 * after it must begin with an auxiliary ("blue is not selected"). Merely
 * finding `not` nearby would misread "blue and not red" as negating blue.
 */
const valueOccurrenceIsNegated = (
  text: string,
  occurrence: { start: number; end: number }
): boolean => {
  const beforeClause = text
    .slice(Math.max(0, occurrence.start - 80), occurrence.start)
    .split(/[.!?,;:]|\b(?:but|instead|rather)\b/u)
    .at(-1)
  const afterClause = text
    .slice(occurrence.end, occurrence.end + 80)
    .split(/[.!?,;:]|\b(?:but|instead|rather)\b/u)[0]
  return (
    VALUE_NEGATED_BEFORE_PATTERN.test(beforeClause ?? "") ||
    VALUE_NEGATED_AFTER_PATTERN.test(afterClause ?? "")
  )
}

/**
 * Whether one complete value occurrence is only one of several the
 * requirement allows. "Color is Blue or Red" does not say the color is Blue,
 * so a receipt for Blue cannot meet it; the list before an `or` counts too
 * ("Blue, Red or Green").
 */
const VALUE_ALTERNATIVE_BEFORE_PATTERN =
  /(?:\b(?:or|either|nor)\b|\/)(?:\s+[\p{L}\p{N}_'-]+){0,3}\s*$/u
const VALUE_ALTERNATIVE_AFTER_PATTERN =
  /^(?:\s*,\s*[^,.;:!?]{1,40}?)*,?\s*(?:\bor\b|\/)/u

const valueOccurrenceIsAlternative = (
  text: string,
  occurrence: { start: number; end: number }
): boolean => {
  const beforeClause = text
    .slice(Math.max(0, occurrence.start - 80), occurrence.start)
    .split(/[.!?;:]|\b(?:but|instead|rather)\b/u)
    .at(-1)
  const afterClause = text
    .slice(occurrence.end, occurrence.end + 80)
    .split(/[.!?;:]|\b(?:but|instead|rather)\b/u)[0]
  return (
    VALUE_ALTERNATIVE_BEFORE_PATTERN.test(beforeClause ?? "") ||
    VALUE_ALTERNATIVE_AFTER_PATTERN.test(afterClause ?? "")
  )
}

/**
 * Whether the resolved value is named as a complete phrase the requirement
 * asserts: not negated, and not one of alternatives.
 */
const valueAssertedWithoutNegation = (text: string, value: string): boolean => {
  const needle = agentNormalizedClaim(value)
  return completePhraseOccurrences(text, needle).some(
    (occurrence) =>
      !valueOccurrenceIsNegated(text, occurrence) &&
      !valueOccurrenceIsAlternative(text, occurrence)
  )
}

/**
 * Whether the requirement asserts the state the receipt confirmed, not its
 * opposite.
 *
 * The receipt proves the control holds its resolved state but does not carry
 * what that state was — a confirmed `checked` verification vouches for
 * checked and for unchecked alike. The binding above is not enough: "Agree
 * is unchecked" names Agree, so without this a run that checked the box
 * satisfies a claim it is unchecked. For checkbox receipts the requirement
 * must not assert the opposite direction; for value receipts (select, typed
 * text) it must name the resolved value, which a quotation could also carry
 * — values are quotable page text, so refusing here only sends the run to
 * quote what it could have quoted. Both fail safe: an uncertain match
 * refuses, and a refusal sends the run back to look again.
 */
const receiptResultAgrees = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout
): boolean => {
  const text = agentNormalizedClaim(requirement.text)
  const command = receipt.command
  const kind = receipt.verification?.evidence.kind
  if (
    kind === "checked" &&
    (command?.type === "check" || command?.type === "uncheck")
  ) {
    const direction =
      command.type === "check"
        ? requirementAssertsOn(text) && !requirementAssertsOff(text)
        : requirementAssertsOff(text) && !requirementAssertsOn(text)
    const stateText = text
      .replaceAll(NEGATED_ON_PATTERN_GLOBAL, "unchecked")
      .replaceAll(NEGATED_OFF_PATTERN_GLOBAL, "checked")
    return (
      direction &&
      statesOnlyFacts(
        stateText,
        factWords([receipt.target?.name, "checkbox", "current"]),
        new Set([...CHECKED_STATE_WORDS[command.type], command.type])
      )
    )
  }
  if (kind === "field" && command?.type === "select" && command.value) {
    return valueAssertedForControl(text, command.value, receipt.target?.name)
  }
  if (
    kind === "field" &&
    (command?.type === "type" ||
      command?.type === "clear_and_type" ||
      command?.type === "replace_text") &&
    command.text
  ) {
    return valueAssertedForControl(text, command.text, receipt.target?.name)
  }
  return true
}

/** Where a requirement joins one claim to the next. */
const CLAUSE_BOUNDARY = /\s*(?:[,;]|\band\b|\bthen\b|\balso\b)\s*/u

/**
 * The value asserted for the receipt's own control, not merely somewhere in
 * the requirement. "Set Name to Bob and Manager to Alice" holds Alice, so a
 * receipt that put Alice in Name agreed with it; now a requirement that names
 * the control must carry the value in the clause that names it. One that
 * never names the control is bound by the requirement id alone, as before.
 */
const valueAssertedForControl = (
  text: string,
  value: string,
  control: string | undefined
): boolean => {
  if (!valueAssertedWithoutNegation(text, value)) return false
  const name = control ? agentNormalizedClaim(control) : ""
  if (!name || !containsCompletePhrase(text, name)) return true
  /**
   * The value is held whole while the requirement is cut into clauses, so a
   * value that itself holds a boundary ("Tom and Jerry", "Smith, John") is
   * never split across two of them.
   */
  const HELD = "\u0001"
  /**
   * Only an occurrence the requirement asserts is held: in "Manager: Bob;
   * Name: not Bob" the Bob beside Name is refused, not matched.
   */
  const held = completePhraseOccurrences(text, agentNormalizedClaim(value))
    .filter(
      (occurrence) =>
        !valueOccurrenceIsNegated(text, occurrence) &&
        !valueOccurrenceIsAlternative(text, occurrence)
    )
    .reverse()
    .reduce(
      (whole, { start, end }) =>
        `${whole.slice(0, start)}${HELD}${whole.slice(end)}`,
      text
    )
  return held
    .split(CLAUSE_BOUNDARY)
    .some(
      (clause) => containsCompletePhrase(clause, name) && clause.includes(HELD)
    )
}

/**
 * The whole value a confirmed batch field was set to: what it replaced the
 * field with, or the option it chose. A `type` field appended to whatever
 * was there, so its own text is not the field's value.
 */
const batchFieldValue = (field: AgentFormField): string | undefined =>
  field.type === "clear_and_type"
    ? field.text
    : field.type === "select"
      ? field.value
      : undefined

/**
 * The one field of a confirmed batch set to exactly `value`, or none when
 * no field or several were. A value two fields share names neither.
 */
const batchFieldWithValue = (
  fields: readonly AgentFormField[],
  value: string
): number | undefined => {
  const wanted = agentNormalizedClaim(value)
  if (!wanted) return undefined
  const hits = fields.flatMap((field, index) => {
    const set = batchFieldValue(field)
    return set !== undefined && agentNormalizedClaim(set) === wanted
      ? [index]
      : []
  })
  return hits.length === 1 ? hits[0] : undefined
}

const confirmedBatch = (
  receipt: AgentStepReadout
):
  | {
      fields: readonly AgentFormField[]
      names: readonly { name?: string }[]
    }
  | undefined => {
  if (
    receipt.command?.type !== "fill_form" ||
    receipt.verification?.outcome !== "confirmed" ||
    receipt.verification.evidence.kind !== "fields"
  )
    return undefined
  const names = receipt.verification.evidence.fields
  if (!names || names.length !== receipt.command.fields.length) return undefined
  return { fields: receipt.command.fields, names }
}

/**
 * A confirmed batch can evidence each control it checked, once per field.
 *
 * The requirement names the field ("Name is Ada"), or asserts the one value
 * only that field was set to ("Enter Ada", "Select Blue"): a plan cuts "enter
 * Ada and select Blue" into one outcome per value and names no control. The
 * field is then read where it is. A field still on the page must hold the
 * value now. One no longer on it — Save took the run to a result page — is
 * vouched for by the value its own confirmed verification saw it hold, which
 * is what typing a value and leaving the page leaves behind.
 */
const matchingBatchField = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout,
  observation: AgentObservation,
  consumed: Set<string>
): number | undefined => {
  const batch = confirmedBatch(receipt)
  if (!batch) return undefined
  const { fields, names } = batch
  const text = agentNormalizedClaim(requirement.text)
  return fields.findIndex((field, index) => {
    const key = `${receipt.stepId}:field:${index}`
    if (consumed.has(key)) return false
    const name = names[index]?.name
    if (!name) return false
    const set = batchFieldValue(field)
    /**
     * Only for a requirement naming no other field of the batch: "Name is
     * Alice" is about Name, and Email holding Alice cannot answer it.
     */
    const namesAnother = names.some(
      (entry, other) =>
        other !== index &&
        entry?.name !== undefined &&
        requirementNamesField(text, entry.name, observation)
    )
    const byValue =
      set !== undefined &&
      !namesAnother &&
      batchFieldWithValue(fields, set) === index &&
      valueAssertedWithoutNegation(text, set)
    if (!byValue && !requirementNamesField(text, name, observation))
      return false
    const matches = observation.elements.filter(
      (element) =>
        !element.sensitive &&
        agentNormalizedClaim(element.name ?? "") === agentNormalizedClaim(name)
    )
    if (matches.length === 0)
      return field.type === "check"
        ? !requirementAssertsOff(text)
        : field.type === "uncheck"
          ? !requirementAssertsOn(text)
          : set !== undefined && valueAssertedWithoutNegation(text, set)
    if (matches.length !== 1) return false
    const current = matches[0]
    if (field.type === "check")
      return current.checked === true && !requirementAssertsOff(text)
    if (field.type === "uncheck")
      return current.checked === false && !requirementAssertsOn(text)
    return (
      !current.valueTruncated &&
      current.value !== undefined &&
      valueAssertedWithoutNegation(text, current.value)
    )
  })
}

/**
 * Whether the quotation names the control the receipt acted on — the only
 * link a quoted label has to the step that changed it. Compared exactly
 * after normalising, the way self-evidence is.
 */
const quotationNamesReceiptTarget = (
  quoted: string,
  receipt: AgentStepReadout
): boolean => {
  const name = receipt.target?.name
  return (
    name !== undefined &&
    agentNormalizedClaim(name).length > 0 &&
    agentNormalizedClaim(name) === agentNormalizedClaim(quoted)
  )
}

/**
 * The one field of a confirmed batch whose value the quotation is, when the
 * batch was sent for this requirement. Filling Name with Alice and
 * submitting leaves no "Alice" on the next page; the batch confirmed the
 * field held it, and one field vouches for one requirement.
 */
const quotedBatchField = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout,
  quoted: string,
  consumed: Set<string>
): number | undefined => {
  if (
    receipt.command?.type !== "fill_form" ||
    receipt.requirementId !== requirement.id ||
    receipt.verification?.outcome !== "confirmed" ||
    receipt.verification.evidence.kind !== "fields"
  )
    return undefined
  const want = agentNormalizedClaim(quoted)
  if (!want) return undefined
  const matches = receipt.command.fields.flatMap((field, index) => {
    const value =
      field.type === "select"
        ? field.value
        : field.type === "check" || field.type === "uncheck"
          ? undefined
          : field.text
    /**
     * The quotation matches what was filled, and the requirement asks for
     * that value: filling Alice and quoting Alice does not meet "Name is Bob".
     */
    return value !== undefined &&
      agentNormalizedClaim(value) === want &&
      valueAssertedWithoutNegation(
        agentNormalizedClaim(requirement.text),
        value
      ) &&
      requirementNamesBatchField(requirement, receipt, index, value) &&
      !consumed.has(`${receipt.stepId}:field:${index}`)
      ? [index]
      : []
  })
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Whether the field the value went into is the one the requirement puts it
 * in. A batch filling Email with Alice and Name with Bob must not meet "Name
 * is Alice": the value is right and the control is not. The field whose
 * verified name sits nearest the value in the requirement is the one it
 * names. A requirement naming no field of the batch binds only a one-field
 * batch, where there is no other control it could mean.
 */
const requirementNamesBatchField = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout,
  index: number,
  value: string
): boolean => {
  const evidence = receipt.verification?.evidence
  const fieldCount =
    receipt.command?.type === "fill_form" ? receipt.command.fields.length : 0
  const names =
    evidence?.kind === "fields"
      ? (evidence.fields ?? []).map((field) =>
          agentNormalizedClaim(field.name ?? "")
        )
      : []
  const text = agentNormalizedClaim(requirement.text)
  const valueAt = completePhraseOccurrences(text, agentNormalizedClaim(value))
  /**
   * The page's own name first; failing that, a word of it. The planner
   * writes "Email" for a field the page calls "E-mail address", and
   * refusing that sends a finished run back for review once the form is
   * gone. A name or word two fields share at one distance is a tie, and a
   * tie binds nothing.
   */
  const exact = nearestFieldName(names, valueAt, (name) =>
    completePhraseOccurrences(text, name)
  )
  const named =
    exact === undefined
      ? nearestFieldName(names, valueAt, (name) =>
          fieldNameWordOccurrences(text, name)
        )
      : exact
  if (named === "tied") return false
  if (named === undefined) return fieldCount === 1
  return named === index
}

type PhraseSpan = { start: number; end: number }

/** The field whose name sits nearest the value, or a tie between two. */
const nearestFieldName = (
  names: readonly string[],
  valueAt: readonly PhraseSpan[],
  occurrencesOf: (name: string) => PhraseSpan[]
): number | "tied" | undefined => {
  const distances = names.flatMap((name, index) =>
    occurrencesOf(name).flatMap((at) =>
      valueAt.map((occurrence) => ({
        index,
        distance:
          at.end <= occurrence.start
            ? occurrence.start - at.end
            : at.start - occurrence.end
      }))
    )
  )
  const reached = distances.filter(({ distance }) => distance >= 0)
  if (reached.length === 0) return undefined
  const closest = Math.min(...reached.map(({ distance }) => distance))
  const fields = new Set(
    reached
      .filter(({ distance }) => distance === closest)
      .map(({ index }) => index)
  )
  return fields.size === 1 ? [...fields][0] : "tied"
}

/** Words too generic to say which field a requirement means. */
const FIELD_NAME_FILLER = new Set([
  "the",
  "your",
  "field",
  "box",
  "input",
  "text",
  "enter",
  "type",
  "and",
  "for"
])

const compactFieldWord = (word: string): string =>
  word.replaceAll(/[-_'’]/gu, "")

/**
 * Where a distinctive word of a field's name, compared without hyphens,
 * appears in the requirement: "e-mail" is "email".
 */
const fieldNameWordOccurrences = (text: string, name: string): PhraseSpan[] => {
  const words = new Set(
    (name.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_'’-]*/gu) ?? [])
      .map(compactFieldWord)
      .filter((word) => word.length >= 3 && !FIELD_NAME_FILLER.has(word))
  )
  if (words.size === 0) return []
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_'’-]*/gu)].flatMap(
    (match) =>
      words.has(compactFieldWord(match[0]))
        ? [{ start: match.index, end: match.index + match[0].length }]
        : []
  )
}

/**
 * Whether the quotation is the value a value receipt confirmed the control
 * holds — the selected option or the typed text. Selecting Blue leaves the
 * word "Blue" exactly where it was, so the staleness rule refuses it, and
 * the value is the phrase a model naturally quotes. Compared exactly after
 * normalising, so only the receipt's own value is rescued.
 */
const quotationNamesReceiptValue = (
  quoted: string,
  receipt: AgentStepReadout
): boolean => {
  const command = receipt.command
  const value =
    command?.type === "select"
      ? command.value
      : command?.type === "type" ||
          command?.type === "clear_and_type" ||
          command?.type === "replace_text"
        ? command.text
        : undefined
  return (
    value !== undefined &&
    agentNormalizedClaim(value).length > 0 &&
    agentNormalizedClaim(value) === agentNormalizedClaim(quoted)
  )
}

/**
 * Every met read needs a retained independent observed fact. Missing
 * support, stale snapshots and model-authored findings stay unknown.
 */
/**
 * A read asking for the present state cannot rest on a historical fact. The
 * same answer decides both whether a quote is grounded and how the report
 * labels it, or a stale quote could hide that a screenshot carried the read.
 * The planner's explicit freshness wins — "still open last Friday" is
 * historical — and only an older plan without it falls back to wording.
 */
const requiresCurrentState = (requirement: AgentTaskRequirement): boolean =>
  requirement.freshness !== undefined
    ? requirement.freshness === "current"
    : [requirement.source, requirement.text].some(
        (text) =>
          text !== undefined &&
          /\b(?:current|currently|now|latest|today|still)\b/i.test(text)
      )

/**
 * The ledger as a read may use it. A read about the present state cannot
 * rest on history, but a fact this run read on a page it has since left is
 * not history in that sense: the run is the present the user asked about,
 * and while it has changed nothing after the reading, nothing it did can
 * have moved it. Requiring the page to be open again sent long runs back
 * to each of three sites in turn to make the first two "current", which
 * left the third historical, and round they went. A change applied after
 * the reading returns it to history; a fact whose own document moved under
 * it (`requires_refresh`) never counts; a fact older than the run itself was
 * not read by this run; an unreadable step record or an uncertain
 * effect keeps the strict reading.
 */
const readableLedger = (
  input: AgentCompletionInput,
  requirement: AgentTaskRequirement
): readonly AgentEvidenceRecord[] | undefined => {
  if (
    !requiresCurrentState(requirement) ||
    !input.steps?.length ||
    input.steps.some((step) => step.status === "uncertain")
  )
    return input.evidenceLedger
  /** Read by this run: no earlier than it began, or than its first step. */
  const started =
    input.startedAt ?? Math.min(...input.steps.map((step) => step.at))
  /**
   * Following a link is how a run reads the next source; it changes nothing
   * the earlier one said. Counted as a change, the third shop's link made
   * the first two shops' prices history, and every read fell to "seen".
   */
  const changes = allChanges(input.steps).filter(
    (step) => !agentFollowedLink(step)
  )
  const lastChange = changes.length
    ? Math.max(...changes.map((step) => step.at))
    : undefined
  return input.evidenceLedger?.map((record) =>
    record.kind === "observed_fact" &&
    record.validity === "historical" &&
    record.observedAt >= started &&
    (lastChange === undefined || record.observedAt > lastChange)
      ? { ...record, validity: "current" as const }
      : record
  )
}

const refusePlannedReadClaim = (
  evidence: string | undefined,
  input: AgentCompletionInput,
  requirement: AgentTaskRequirement
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined => {
  if (!evidence?.trim())
    return {
      type: "refused",
      reason: "missing_evidence",
      feedback:
        "Quote the independently observed fact supporting this read result. Missing support is unknown; do not mark it verified."
    }
  const requirementId = requirement.id
  const current = requiresCurrentState(requirement)
  const ledger = readableLedger(input, requirement)
  if (groundedCompletionQuote(evidence, requirementId, ledger, current))
    return undefined
  /**
   * Nothing the page said, but what the model read off the screenshot it
   * completed on. Met, and reported as seen in a picture rather than
   * verified; without this a value drawn into a canvas could never be an
   * answer, however plainly the model was shown it.
   */
  if (visualCompletionRead(evidence, requirementId, input.evidenceLedger))
    return undefined
  /**
   * A paraphrase of something the run did read is a question of meaning, not
   * of provenance: "Revenue was $4.2M" against a retained "revenue rose to 4.2
   * million". Exact matching cannot decide it, so it goes to review — but
   * only when a grounded fact exists that could answer it. With none, there
   * is nothing for a reviewer to read, and the claim is refused as before.
   */
  if (
    ledger?.some(
      (record) =>
        record.kind === "observed_fact" &&
        record.source !== undefined &&
        (record.validity === "current" ||
          (!current && record.validity === "historical")) &&
        record.requirementId === requirementId
    )
  )
    return {
      type: "refused",
      reason: "needs_review",
      feedback:
        "This read answer does not quote a retained observed fact exactly. Quote the fact verbatim, or the claim needs independent review; inputs and model findings are not proof."
    }
  return {
    type: "refused",
    reason: "absent_evidence",
    feedback:
      "This read claim has no grounded source in the evidence ledger. Request fresh authorized evidence or quote a retained observed fact; inputs and model findings are not proof."
  }
}

const NO_SUBMISSION_MENTION_PATTERN =
  /\b(?:do not|don't|never|without)\s+submitt?(?:ed|ing)?\b|\b(?:remain|stays?|is|was)\s+(?:not\s+submitted|unsubmitted)\b/i
const NO_SUBMISSION_ONLY_PATTERN =
  /^(?:(?:do not|don't|never)\s+submit(?:\s+(?:(?:the|this|a)\s+form|it))?|without\s+submitting(?:\s+(?:(?:the|this|a)\s+form|it))?|(?:(?:(?:the|this|a)\s+)?form\s+)?(?:remains?|stays?|is|was)\s+(?:not\s+submitted|unsubmitted))\.?$/i

const NO_SUBMISSION_UNREADABLE_FEEDBACK =
  "I cannot verify that the form stayed unsubmitted because the action record is incomplete. Ask the user to review the form before finishing."
const NO_SUBMISSION_OCCURRED_FEEDBACK =
  "This run already submitted the form. Do not claim it was left unsubmitted; mark that requirement unmet."

/** A negative form constraint is proved by the run's complete effect record. */
const noSubmissionEvidence = (
  input: AgentCompletionInput
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined => {
  if (!input.steps) {
    return {
      type: "refused",
      reason: "unverified_change",
      feedback: NO_SUBMISSION_UNREADABLE_FEEDBACK
    }
  }
  if (
    input.steps.some(
      (receipt) =>
        isAppliedAgentStepStatus(receipt.status) &&
        receipt.consequential?.some(
          (effect) => effect === "submission" || effect === "potential_commit"
        )
    )
  ) {
    return {
      type: "refused",
      reason: "unverified_change",
      feedback: NO_SUBMISSION_OCCURRED_FEEDBACK
    }
  }
  return undefined
}
/**
 * One met `change` requirement, after its quotation failed.
 *
 * Returns the receipt that evidences it, or the refusal to send back.
 * Receipts are consumed by identity across requirements, and every exemption
 * additionally binds the plan's words to the receipt's control, so one
 * verified state vouches for one requirement — never the whole plan, and
 * never a requirement about another control.
 */
const evidencePlannedChange = (
  requirement: AgentTaskRequirement,
  quoted: string | undefined,
  refusal: Extract<AgentCompletionJudgement, { type: "refused" }>,
  changes: readonly AgentStepReadout[],
  observation: AgentObservation,
  consumed: Set<string>
):
  | AgentStepReadout
  | Extract<AgentCompletionJudgement, { type: "refused" }> => {
  /**
   * A quotation names the current page, and only it. A phrase from a page
   * the run has left cannot be checked against anything the run can still
   * see — not against findings, which are the model's own words, and not
   * against verifier summaries, which are fixed template sentences. An
   * outcome that must outlive its navigation needs result-verified state,
   * which is page-independent — so an absent quotation is rescued only by a
   * result-verified receipt it names in the receipt's own facts, its control,
   * its value or its checked state: typing "Alice" and submitting leaves no
   * "Alice" on the next page, and the receipt that confirmed the field held
   * it is the evidence instead.
   */
  const absent = refusal.reason === "absent_evidence"
  /**
   * A state-only change adds no new words to the page — selecting Blue and
   * ticking a checkbox leave exactly the label that was already there — so
   * a quotation rule alone can never accept them. A confirmed
   * result-verified receipt is the evidence instead, but only when the
   * requirement is about that receipt's control and asserts the state it
   * confirmed rather than its opposite; a missing quotation consumes the
   * earliest such receipt the plan names, and a label quotation must
   * additionally name the receipt's own control. An invented phrase is never
   * rescued.
   */
  if (
    refusal.reason === "missing_evidence" ||
    refusal.reason === "self_evidence" ||
    refusal.reason === "stale_evidence" ||
    absent ||
    refusal.reason === "needs_review"
  ) {
    for (const candidate of changes) {
      const index = matchingBatchField(
        requirement,
        candidate,
        observation,
        consumed
      )
      if (index !== undefined && index >= 0 && quoted === undefined) {
        consumed.add(`${candidate.stepId}:field:${index}`)
        return candidate
      }
    }
    if (quoted !== undefined) {
      for (const candidate of changes) {
        const index = quotedBatchField(requirement, candidate, quoted, consumed)
        if (index === undefined) continue
        consumed.add(`${candidate.stepId}:field:${index}`)
        return candidate
      }
    }
    const receipt = changes.find(
      (candidate) =>
        !consumed.has(candidate.stepId) &&
        isResultVerifiedChange(candidate) &&
        requirementNamesReceiptTarget(requirement, candidate) &&
        receiptResultAgrees(requirement, candidate) &&
        candidate.command?.type !== "fill_form" &&
        (quoted === undefined
          ? !absent
          : quotationNamesReceiptTarget(quoted, candidate) ||
            quotationNamesReceiptValue(quoted, candidate) ||
            quotationStatesReceiptFacts(quoted, candidate))
    )
    if (receipt) {
      consumed.add(receipt.stepId)
      return receipt
    }
    const focused = changes.find(
      (candidate) =>
        !consumed.has(candidate.stepId) &&
        quoted !== undefined &&
        isBoundFocusMove(requirement, candidate, observation) &&
        quotationNamesFocusedControl(quoted, observation)
    )
    if (focused) {
      consumed.add(focused.stepId)
      return focused
    }
    const submitted = changes.find(
      (candidate) =>
        !consumed.has(candidate.stepId) &&
        isBoundSubmission(requirement, candidate) &&
        (quoted === undefined || quotationIsReceiptSummary(quoted, candidate))
    )
    if (submitted) {
      consumed.add(submitted.stepId)
      return submitted
    }
  }
  return refusal
}

/**
 * Whether a requirement claims nothing a receipt does not prove.
 *
 * Every word must be one of three things: a word of the act the receipt
 * performed ("focus", "click"), a function word that asserts nothing ("the",
 * "on", "for"), or a fact the run's own receipts hold (the control's name,
 * a value it typed, the key it pressed, the site it was on). Anything else
 * — a negation, a second action, a result, a constraint — is a claim the
 * receipt cannot vouch for, so the requirement is refused. Refusing an
 * unknown word is the fail-safe direction: the run is sent back to quote
 * evidence rather than credited with something it did not do.
 */
const claimsOnlyAct = (
  requirement: AgentTaskRequirement,
  actWords: ReadonlySet<string>,
  facts: ReadonlySet<string>,
  required: ReadonlySet<string> = actWords
): boolean => {
  const words = claimWords(requirement.text)
  return (
    words.some((word) => required.has(word)) &&
    words.every(
      (word) =>
        actWords.has(word) || CLAIM_FUNCTION_WORDS.has(word) || facts.has(word)
    )
  )
}

/** Lowercased words, compared without hyphens or apostrophes. */
const claimWords = (text: string): string[] =>
  (
    agentNormalizedClaim(text).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_'’-]*/gu) ??
    []
  )
    .map(compactFieldWord)
    .filter(Boolean)

/**
 * A fact is never a negation, even when a typed value or a control name
 * holds one: typing "not now" must not let "Do not click Continue" pass.
 */
const NEGATION_WORDS = new Set([
  "not",
  "no",
  "never",
  "nor",
  "neither",
  "none",
  "without",
  "except",
  "dont",
  "doesnt",
  "didnt",
  "isnt",
  "wasnt",
  "arent",
  "werent",
  "cannot",
  "cant",
  "wont",
  "shouldnt",
  "mustnt"
])

const factWords = (values: readonly (string | undefined)[]): Set<string> =>
  new Set(
    values
      .flatMap((value) => (value ? claimWords(value) : []))
      .filter(
        (word) => !NEGATION_WORDS.has(word) && !isLocaleNegationWord(word)
      )
  )

/**
 * Words that assert nothing by themselves. Deliberately excludes every
 * negation ("not", "no", "never", "don't"), every conjunction that could
 * join a second claim ("and", "then", "but"), and every verb: those are
 * claims, and a claim must be proved.
 */
const CLAIM_FUNCTION_WORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "its",
  "it",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "has",
  "have",
  "had",
  "now",
  "here",
  "there",
  "just",
  "please",
  "on",
  "in",
  "at",
  "to",
  "into",
  "onto",
  "for",
  "of",
  "button",
  "link",
  "field",
  "box",
  "input",
  "control",
  "form",
  "key",
  "page",
  "site",
  "keyboard"
])

/**
 * A confirmed key press the model sent for this requirement, which the
 * verifier saw move focus. Moving focus from First to Second adds no words:
 * "Second" was on the page before, so the staleness rule refused it, and
 * the run asked the user what to do about a task it had finished.
 *
 * Tab reaching Save proves Save has focus, never that it was pressed, so
 * the requirement may claim focus and name only the focused control and
 * the key: "Focus the Save button" and "Keyboard focus is on Second" meet
 * it; "Click Save", "Do not focus Search" and "Focus Search and type
 * Alice" do not.
 */
const FOCUS_WORDS = new Set(["focus", "focused", "focuses", "focusing"])
/**
 * The act of moving focus with a key, as a plan describes it: "Second has
 * focus after moving from First with Tab" claims the key, the control it was
 * pressed on and the one that holds focus now — all three on the receipt and
 * the page — and nothing else.
 */
const FOCUS_ACT_WORDS = new Set([
  ...FOCUS_WORDS,
  "move",
  "moves",
  "moved",
  "moving",
  "press",
  "pressed",
  "pressing",
  "after",
  "from",
  "with",
  "using"
])

const isBoundFocusMove = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout,
  observation: AgentObservation
): boolean =>
  receipt.requirementId === requirement.id &&
  receipt.command?.type === "press_key" &&
  receipt.verification?.outcome === "confirmed" &&
  receipt.verification.evidence.kind === "keyboard" &&
  claimsOnlyAct(
    withoutFocusSource(requirement, receipt.target?.name),
    FOCUS_ACT_WORDS,
    factWords([
      keyText(receipt.command.key),
      ...observation.elements
        .filter((element) => element.focused)
        .map((element) => element.name)
    ]),
    FOCUS_WORDS
  )

/**
 * The requirement without "from <the control the key was pressed on>". The
 * source is on the receipt, but only as where focus left: counted as a fact
 * anywhere, "Focus First" would pass while Second holds focus.
 */
const withoutFocusSource = (
  requirement: AgentTaskRequirement,
  source: string | undefined
): AgentTaskRequirement => {
  const name = source?.trim()
  if (!name) return requirement
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return {
    ...requirement,
    text: requirement.text.replaceAll(
      new RegExp(`\\bfrom\\s+(?:the\\s+)?${escaped}\\b`, "giu"),
      " "
    )
  }
}

/** A pressed key as the words a requirement would name it by. */
const keyText = (key: unknown): string =>
  typeof key === "string"
    ? key.replaceAll("+", " ")
    : key && typeof key === "object" && "key" in key
      ? [
          ...((key as { modifiers?: readonly string[] }).modifiers ?? []),
          String((key as { key: unknown }).key)
        ].join(" ")
      : ""

/** Whether the quotation is the name of the one control focused now. */
const quotationNamesFocusedControl = (
  quoted: string,
  observation: AgentObservation
): boolean => {
  const focused = observation.elements.filter((element) => element.focused)
  if (focused.length !== 1) return false
  const name = focused[0].name
  return (
    name !== undefined &&
    agentNormalizedClaim(name).length > 0 &&
    agentNormalizedClaim(name) === agentNormalizedClaim(quoted)
  )
}

/**
 * A confirmed submission the model sent for this requirement. The verifier
 * confirmed the form committed the destination the user approved, which is
 * what a "submit it" requirement asks; bound by the requirement id the
 * command carried, never by name, so it vouches for its own requirement.
 *
 * It proves the form was sent, not what sending it achieved, so the
 * requirement may claim the act and name only what the run's receipts
 * hold: the control pressed, the values the form sent, the key and the
 * site. "Click on Continue" and "Search in Google for Alice" (Alice sent)
 * meet it; "Search for Alice excluding archived orders", "Search for Alice
 * and read the first hit" and "The address is saved" do not.
 */
const SUBMISSION_WORDS = new Set([
  "submit",
  "submits",
  "submitted",
  "click",
  "clicks",
  "clicked",
  "press",
  "presses",
  "pressed",
  "continue",
  "continued",
  "send",
  "sent",
  "search",
  "searched"
])
/**
 * Typing may be named beside the send ("Type Alice and search" is still
 * refused for its "and"), but never alone: "Enter Alice in the Name field"
 * is a claim about the field, which the field's own receipt answers.
 */
const SUBMISSION_ACT_WORDS = new Set([
  ...SUBMISSION_WORDS,
  "type",
  "typed",
  "enter",
  "entered",
  "fill",
  "filled"
])

const isBoundSubmission = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout
): boolean =>
  receipt.requirementId === requirement.id &&
  receipt.verification?.outcome === "confirmed" &&
  receipt.verification.evidence.kind === "submission" &&
  /**
   * A form that went is not a form the site took: a validation error drawn
   * on the same page used to verify as a submission and complete the run.
   */
  receipt.verification.evidence.acceptance === "accepted" &&
  claimsOnlyAct(
    requirement,
    SUBMISSION_ACT_WORDS,
    submissionFacts(requirement, receipt),
    SUBMISSION_WORDS
  )

/**
 * What a submission's own receipt proves for this requirement: the control
 * it went through, the key, the site's host labels, and the values its GET
 * query sent that the requirement puts where the form did.
 *
 * Never a value typed earlier: a page with two forms can hold Alice in one
 * and send the other. And of several sent values, only one the requirement
 * binds to its own control: with Alice in Search and Bob in Category,
 * "Search for Alice" names Search beside Alice and is met, while "Search
 * for Bob" names Search beside Bob, which Bob was not in, and is refused.
 * One sent value needs no binding; there is no other control it could be.
 */
const submissionFacts = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout
): Set<string> => {
  const sent = receipt.verification?.evidence.values ?? []
  const assigned =
    sent.length === 1
      ? new Map([[0, 0]])
      : assignSentValues(agentNormalizedClaim(requirement.text), sent)
  const bound = sent.filter((_, index) => assigned.get(index) === index)
  return factWords([
    receipt.target?.name,
    receipt.command?.type === "press_key" ? keyText(receipt.command.key) : "",
    hostLabels(receipt.sourceUrl),
    hostLabels(receipt.formAction),
    /** A bound value's label names a control this form sent from. */
    ...bound.flatMap(({ name, value }) => [name, value])
  ])
}

/**
 * Which control's label the requirement puts each sent value beside, paired
 * one to one, closest first: in "search for alice in category bob",
 * Category is nearer Alice than Search is, but it is nearer still to Bob,
 * so Bob takes it and Alice is left with Search. Two pairs at one distance
 * competing for a label or a value bind neither. Returns value index →
 * label index; a value the requirement does not name is absent.
 */
const assignSentValues = (
  text: string,
  sent: readonly { name?: string; value: string }[]
): Map<number, number> => {
  const pairs = sent.flatMap(({ name }, label) => {
    const normalized = agentNormalizedClaim(name ?? "")
    const exact = completePhraseOccurrences(text, normalized)
    const labelAt = exact.length
      ? exact
      : fieldNameWordOccurrences(text, normalized)
    return sent.flatMap(({ value }, valueIndex) =>
      labelAt.flatMap((at) =>
        completePhraseOccurrences(text, agentNormalizedClaim(value)).flatMap(
          (occurrence) => {
            const distance =
              at.end <= occurrence.start
                ? occurrence.start - at.end
                : at.start - occurrence.end
            return distance >= 0 ? [{ label, value: valueIndex, distance }] : []
          }
        )
      )
    )
  })
  const assigned = new Map<number, number>()
  /** A value or label contested at its closest distance binds nothing. */
  const settledValues = new Set<number>()
  const settledLabels = new Set<number>()
  const distances = [...new Set(pairs.map(({ distance }) => distance))].sort(
    (first, second) => first - second
  )
  for (const distance of distances) {
    const open = pairs.filter(
      (pair) =>
        pair.distance === distance &&
        !settledValues.has(pair.value) &&
        !settledLabels.has(pair.label)
    )
    const count = (key: "value" | "label", of: number) =>
      new Set(
        open
          .filter((pair) => pair[key] === of)
          .map((pair) => (key === "value" ? pair.label : pair.value))
      ).size
    for (const pair of open) {
      if (count("value", pair.value) === 1 && count("label", pair.label) === 1)
        assigned.set(pair.value, pair.label)
    }
    for (const pair of open) {
      settledValues.add(pair.value)
      settledLabels.add(pair.label)
    }
  }
  return assigned
}

/**
 * The labels of a URL's host, read without the DOM's URL parser, which this
 * package does not have: `https://www.google.com/search` gives "www google
 * com".
 */
const hostLabels = (url: string | undefined): string =>
  url
    ?.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:]+)/iu)?.[1]
    ?.replaceAll(".", " ") ?? ""

/**
 * The model quoting the verifier's sentence about the very step it cites —
 * which the feedback asks it not to do, and which it does anyway. That
 * sentence is the receipt, so it evidences nothing the receipt does not.
 */
const quotationIsReceiptSummary = (
  quoted: string,
  receipt: AgentStepReadout
): boolean => {
  const summary = receipt.verification?.evidence.summary
  return (
    summary !== undefined &&
    agentNormalizedClaim(summary) === agentNormalizedClaim(quoted)
  )
}

/**
 * Words admitting a part of the answer was never established. English only,
 * and only the model's own epistemic phrasing — "could not be found" is
 * left out, since a page saying an order could not be found is an answer.
 */
const AGENT_HEDGE =
  /\b(?:(?:could|can|was|were|is|has|have|had|did|does|do)(?: not|n['’]t)|can['’]t|cannot) (?:be |been )?(?:able to )?(?:determined?|verif(?:y|ied)|confirm(?:ed)?|identif(?:y|ied)|establish(?:ed)?)\b|\bunable to (?:determine|verify|confirm|identify|establish|read)\b|\bnot (?:been )?(?:independently )?(?:verified|confirmed|determined)\b|\bun(?:verified|confirmed|determined)\b/iu

/**
 * Whether the summary hedges in words the page did not use. "The order is
 * unconfirmed" is the answer when the page reads "Order status:
 * Unconfirmed"; a status word the page or a grounded quote carries is the
 * answer being repeated, not an admission.
 */
const summaryHedges = (input: AgentCompletionInput): boolean =>
  [...(input.summary ?? "").matchAll(new RegExp(AGENT_HEDGE, "giu"))].some(
    ([phrase]) =>
      !agentObservationStates(phrase, input.observation) &&
      !(input.evidenceLedger ?? []).some((record) =>
        agentNormalizedClaim(record.quote ?? "").includes(
          agentNormalizedClaim(phrase)
        )
      )
  )

const HEDGED_COMPLETION_FEEDBACK =
  "Your answer says part of it could not be determined or confirmed, yet every requirement is reported met. Report the requirement that part belongs to as unmet and say what is missing in the summary; do not guess a value."

/**
 * The honest way out of every refusal that asks for proof. Without it the
 * only answers a refusal offered were a better quote or more waiting, and a
 * run that had not got the answer was pushed toward claiming it had.
 */
const UNMET_EXIT =
  " If the page does not show it, complete with that requirement reported unmet and say why in the summary; never guess or paraphrase a value."

const UNCOMPUTED_SUPERLATIVE_FEEDBACK =
  "This answer ranks one item above the others, and a single quote shows only that item's value. Quote every candidate's value from the page, or report the requirement unmet if any candidate was not read."

const MISSING_EVIDENCE_FEEDBACK =
  "This run changed the page, so complete needs evidence: a short phrase that is visible on the page now and shows the goal is met, such as a saved-state indicator or the new value itself. Observe the page and complete again with evidence, or keep working." +
  UNMET_EXIT

const ABSENT_EVIDENCE_FEEDBACK =
  "The evidence string does not occur on the current page. Copy ONLY an exact phrase from observation text or an element value into evidence, without explanation or quotation marks. For an edit use the changed words themselves. Do not quote history or verifier commentary. If the result has not appeared, wait for it." +
  UNMET_EXIT

const UNVERIFIED_CHANGE_FEEDBACK =
  "The last change this run made was not confirmed, so the goal cannot be reported as met. Observe the page and check the change took effect — wait for a saved-state indicator — before completing." +
  UNMET_EXIT

const SELF_EVIDENCE_FEEDBACK =
  "The evidence named for complete is the label of the control this run acted on, which was on the page before the action and shows nothing about its outcome. Name what the page says now that it did not say before." +
  UNMET_EXIT

const STALE_EVIDENCE_FEEDBACK =
  "The evidence named for complete was already on the page before this run changed anything, so it does not show the change happened. Name something the change produced, or wait for it to appear." +
  UNMET_EXIT

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
const MISSING_ITEM_OUTCOMES_FEEDBACK =
  "A requirement that lists items is answered item by item: give items in its outcome, one per item by position from 0, each saying whether it is met and quoting the page text that shows it."

const UNMET_PART_FEEDBACK =
  "Part of this read is answered unmet, so the read is not met: report it unmet, or read that part and answer it. Preserve completed effects; do not repeat an action to produce evidence."

const REPEATED_ITEM_FEEDBACK =
  "Answer each listed item once, by its own position, quoting the page text that shows that item."

const UNLISTED_ITEM_FEEDBACK =
  "Answer only the items the requirement lists, by position from 0; an answer past the last item belongs to no item. Report a part outside the list in summary, or report the requirement unmet."

/**
 * Every page item's link open in a tab of its own right now, as the browser
 * lists the run's tabs, for a requirement that asks for nothing but that.
 * The run's own receipts already show it opened each one; the listing shows
 * the tab is still there and still at that link. A requirement that asks for
 * more than the opening — "open every link and delete it" — still goes to
 * review, and a host that sent no listing leaves it there too.
 */
const pageItemTabsOpen = (
  requirement: AgentTaskRequirement & { items: readonly string[] },
  input: AgentCompletionInput,
  receipts: readonly AgentStepReadout[]
): boolean => {
  const listed = openedTabsListed(input)
  const links = requirement.itemLinks ?? []
  return (
    listed !== undefined &&
    links.length === requirement.items.length &&
    claimsOnlyAct(
      requirement,
      PAGE_ITEM_OPEN_WORDS,
      factWords([...requirement.items, ...links.map(pathWords)]),
      OPEN_WORDS
    ) &&
    /**
     * By the tab the receipt opened, wherever it has since been led; by
     * address only for a receipt that predates the id.
     */
    links.every((link, index) => {
      const tabId = receipts[index]?.verification?.evidence.tabId
      return tabId === undefined
        ? listed.some((tab) => samePage(link, tab.url))
        : listed.some((tab) => tab.tabId === tabId)
    })
  )
}

const PAGE_ITEM_TABS_REVIEW_FEEDBACK =
  "Each listed page link has its own confirmed tab, which shows only that the page opened. Whether opening is all each item asks for needs independent review. Preserve completed effects; do not open a link again."

/** Refusals that mean no proof was found, which a page item's tab may stand in for. */
const PAGE_ITEM_REVIEWABLE: ReadonlySet<
  Extract<AgentCompletionJudgement, { type: "refused" }>["reason"]
> = new Set([
  "absent_evidence",
  "missing_evidence",
  "unverified_change",
  "needs_review"
])

const UNLISTED_PARTS_FEEDBACK =
  "This read was answered in parts the plan did not list, so which quote answers which part needs independent review. Preserve completed effects; do not repeat an action to produce evidence."

const MISSING_OUTCOMES_FEEDBACK =
  "Answer every requirement the task was planned with, by id, saying for each whether it is met and quoting the page text that shows it."

/**
 * Sent back once when a run reports a requirement unmet while it still has
 * steps to spend. Ids only: the feedback is a template, never page text.
 */
export const prematureUnmetFeedback = (ids: readonly string[]): string =>
  `You reported ${ids.join(", ")} as not met, and the run still has steps left. First look at the page: if what you already did achieved it, answer complete with it met and quote the page text that shows it — do not repeat the action. If it is not done and can still be done, do it now. If it truly cannot, answer complete again with it unmet and say in the summary what stops it.`

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
  change: AgentStepReadout | "unreadable",
  /**
   * A reading outcome's quotation is something the page already said — that
   * is what reading it means — so it owes presence and nothing else. Running
   * the staleness rule over it would refuse every correct answer, since the
   * text it names was on the page before the run touched anything.
   */
  produced = true
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
  if (!produced) return undefined
  if (change !== "unreadable" && isSelfEvidence(quoted, change))
    return {
      type: "refused",
      reason: "self_evidence",
      feedback: SELF_EVIDENCE_FEEDBACK
    }
  if (
    (input.baselineText !== undefined &&
      agentHaystackStates(quoted, input.baselineText)) ||
    (change !== "unreadable" && observedBeforeChange(quoted, change, input))
  )
    return {
      type: "refused",
      reason: "stale_evidence",
      feedback: STALE_EVIDENCE_FEEDBACK
    }
  return undefined
}

/**
 * The durable half of the staleness rule. The baseline above lives only in
 * the worker that made the change, so a restart skipped the check; the
 * ledger survives, and a fact it recorded in this same document no later
 * than the observation the change was decided on was already on the page
 * and cannot be the change's result. Ordered by snapshot generation, not by
 * clock: the page and the worker keep different ones.
 */
const observedBeforeChange = (
  quoted: string,
  change: AgentStepReadout,
  input: AgentCompletionInput
): boolean => {
  const decided =
    change.command && "generation" in change.command
      ? change.command.generation
      : undefined
  if (decided === undefined) return false
  return (
    input.evidenceLedger?.some(
      (record) =>
        record.kind === "observed_fact" &&
        record.quote !== undefined &&
        record.source?.tabId === input.observation.tabId &&
        record.source.frameId === input.observation.frameId &&
        record.source.documentId === input.observation.documentId &&
        record.source.generation <= decided &&
        agentNormalizedClaim(record.quote) === agentNormalizedClaim(quoted)
    ) === true
  )
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
 * Each change requires its own typed observable state or exact receipt
 * facts; provenance alone cannot establish it. Each read requires grounded
 * support, which may be historical when the run retained it before leaving.
 */
/** A requirement that says where a page opens: a new tab or window. */
export const AGENT_NEW_TAB_PATTERN =
  /\b(?:new|another|separate|second)\s+(?:browser\s+)?(?:tab|window)\b/i

const NEW_TAB_FEEDBACK =
  "This requirement asks for a new tab, and no step in this run opened one: the page opened in the same tab. Use open_tab for it, or mark the requirement unmet."

/**
 * A confirmed step that put a page in a tab of its own: `open_tab`, or a
 * click the verifier saw open one.
 */
const openedNewTab = (receipt: AgentStepReadout): boolean =>
  isAppliedAgentStepStatus(receipt.status) &&
  receipt.verification?.outcome === "confirmed" &&
  (receipt.command?.type === "open_tab" ||
    receipt.verification.evidence.kind === "tab" ||
    receipt.verification.evidence.summary === "Control opened a new tab")

/**
 * Where a page opened is a claim no quotation shows: the page reads the same
 * in either tab. gpt-6-luna clicked a link that opened in place, quoted the
 * page's title, and completed "Open Details in a new browser tab" — a click
 * is navigation, not a change, so no receipt stood in the way. The run's own
 * record of a tab it opened is the only evidence, and unreadable receipts
 * refuse rather than pass.
 */
const refuseUnopenedTab = (
  requirement: AgentTaskRequirement,
  input: AgentCompletionInput
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined =>
  AGENT_NEW_TAB_PATTERN.test(requirement.text) &&
  !(input.steps ?? []).some(
    (receipt) =>
      openedTabFor(requirement, receipt, input) ||
      /**
       * "Open every source link in a new tab" is not one tab, and the page
       * the run completed on is at most one of them: any tab it opened for
       * this requirement, or for none, means one was opened. Whether all of
       * them were is the review's question, not grounds for this refusal.
       */
      (openedNewTab(receipt) &&
        receipt.command?.type !== "switch_tab" &&
        (receipt.requirementId === undefined ||
          receipt.requirementId === requirement.id))
  )
    ? {
        type: "refused",
        reason: "unverified_change",
        feedback: NEW_TAB_FEEDBACK
      }
    : undefined

/**
 * A tab this requirement opened, not merely one the run opened: a tab opened
 * for an earlier step says nothing about where Details went. Bound by the
 * requirement id the step carried or the control it names, or, for an
 * `open_tab` sent for no other requirement, by its address being the page the
 * run completed on or that page being in the very tab it opened — a site may
 * redirect the address it was asked for, and another step's tab is not it.
 */
const openedTabFor = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout,
  input: AgentCompletionInput
): boolean =>
  openedNewTab(receipt) &&
  (requirementNamesReceiptTarget(requirement, receipt) ||
    (receipt.command?.type === "open_tab" &&
      (receipt.requirementId === undefined ||
        receipt.requirementId === requirement.id) &&
      (samePage(receipt.command.url, input.observation.url) ||
        input.tabOpenedBy?.includes(receipt.stepId) === true)))

const OPEN_TAB_ACT_WORDS = new Set([
  "open",
  "opened",
  "opens",
  "is",
  "new",
  "another",
  "separate",
  "second",
  "browser",
  "tab",
  "window"
])
const OPEN_WORDS = new Set(["open", "opened", "opens"])

/** The opening words, plus the ones that count every page item's tab. */
const PAGE_ITEM_OPEN_WORDS = new Set([
  ...OPEN_TAB_ACT_WORDS,
  "every",
  "each",
  "all",
  "both",
  "links",
  "own",
  "their",
  "them",
  "one",
  "tabs"
])

/** The words of an address's path: `/open_tab/details` → open tab details. */
const pathWords = (url: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(url)?.[1] ?? ""

/**
 * "Details is open in a new tab", met by the run's own `open_tab` receipt for
 * it. Which tab a page sits in is a claim no quotation shows, so the receipt
 * is the only evidence there is — and a confirmed one is all of it: the
 * verifier saw the destination commit in the tab it opened. The run must be
 * on that page now, and the requirement may say nothing but that it opened:
 * every other word has to name the page, by the control, the address or the
 * title. "Details is open in a new tab and saved" is still a claim to prove.
 */
const RETURN_TO_START_TAB =
  /\b(?:return|returns|returned|go|goes|went|switch|switched|come|came|get|back)\b.*\b(?:home|original|first|starting|start|initial|main)\s+(?:browser\s+)?tab\b/i

const RETURN_WORDS = new Set([
  "return",
  "returns",
  "returned",
  "go",
  "goes",
  "went",
  "switch",
  "switched",
  "come",
  "came",
  "get",
  "back",
  "to",
  "the",
  "this",
  "that",
  "my",
  "your",
  "its",
  "home",
  "original",
  "first",
  "starting",
  "start",
  "initial",
  "main",
  "browser",
  "tab",
  "and",
  "then",
  "finally",
  "end",
  "on"
])

/** The tab the run's first page was read in, from its own oldest receipt. */
const startTabOf = (
  steps: readonly AgentStepReadout[] | undefined
): number | undefined =>
  latestAgentSteps(steps ?? [])
    .flatMap((step) => step.evidenceLedger ?? [])
    .find((record) => record.source)?.source?.tabId

/**
 * "Return to the home tab" is where the run ends, and the page it completed
 * on is in a tab the observation names: the tab its first step was taken in,
 * reached again after the run went elsewhere. No quotation shows which tab a
 * page is in, so a reviewer could only refuse it.
 */
const returnedToStartTab = (
  requirement: AgentTaskRequirement,
  input: AgentCompletionInput
): boolean => {
  if (
    requirement.kind !== "change" ||
    requirement.check ||
    !RETURN_TO_START_TAB.test(requirement.text) ||
    /** Only the return: "go to the first tab and delete it" asks for more. */
    agentNormalizedClaim(requirement.text)
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => word && !RETURN_WORDS.has(word))
  )
    return false
  const start = startTabOf(input.steps)
  return (
    start !== undefined &&
    input.observation.tabId === start &&
    latestAgentSteps(input.steps ?? []).some(
      (step) =>
        isAppliedAgentStepStatus(step.status) &&
        step.verification?.outcome === "confirmed" &&
        (step.command?.type === "open_tab" ||
          step.command?.type === "switch_tab" ||
          step.verification.evidence.summary === "Control opened a new tab")
    )
  )
}

/** The run's open tabs as the browser listed them, the start tab left out. */
const openedTabsListed = (input: AgentCompletionInput) =>
  input.observation.tabs?.filter((tab) => !tab.start && !tab.closed)

/**
 * "Leave the source tabs open" is a claim about the browser now, which no
 * quotation shows and a reviewer could only refuse. The observation lists
 * every tab of the run's scope and marks the closed ones, so it is checked
 * there: the run opened a tab, and none it opened has closed — wherever a
 * tab has since been led, it is still open. The requirement may say nothing
 * else, by the same rule as an opened tab.
 */
const KEEP_TABS_OPEN =
  /\b(?:leave|leaves|left|keep|keeps|kept)\b.*\btabs?\b.*\bopen\b/i

const KEEP_OPEN_WORDS = new Set([
  "leave",
  "leaves",
  "left",
  "keep",
  "keeps",
  "kept",
  "open",
  "opened",
  "all",
  "every",
  "each",
  "both",
  "them",
  "those",
  "these",
  "they",
  "new",
  "separate",
  "browser",
  "tab",
  "tabs"
])

const keptTabsOpen = (
  requirement: AgentTaskRequirement,
  input: AgentCompletionInput
): boolean => {
  const tabs = input.observation.tabs
  if (
    requirement.kind !== "change" ||
    requirement.check ||
    !tabs ||
    !KEEP_TABS_OPEN.test(requirement.text)
  )
    return false
  const opened = latestAgentSteps(input.steps ?? []).flatMap((step) =>
    isAppliedAgentStepStatus(step.status) &&
    step.verification?.outcome === "confirmed" &&
    step.command?.type === "open_tab"
      ? [step.command.url]
      : []
  )
  return (
    opened.length > 0 &&
    claimsOnlyAct(
      requirement,
      KEEP_OPEN_WORDS,
      factWords(opened.map(pathWords)),
      new Set(["open", "opened"])
    ) &&
    tabs.some((tab) => !tab.start) &&
    tabs.every((tab) => tab.start || !tab.closed)
  )
}

const openedTabMeets = (
  requirement: AgentTaskRequirement,
  input: AgentCompletionInput,
  consumed: Set<string>
): boolean => {
  if (
    requirement.kind !== "change" ||
    requirement.check ||
    !AGENT_NEW_TAB_PATTERN.test(requirement.text)
  )
    return false
  /**
   * Consumed by identity like every other change receipt: one opened tab is
   * evidence for one opening, not for two requirements that each ask for one.
   */
  const receipt = (input.steps ?? []).find(
    (receipt) =>
      !consumed.has(receipt.stepId) &&
      /**
       * Untagged counts, as it does in `openedTabFor`: the model often names
       * no requirement for an open, and the page the run is on, named by the
       * requirement, is what binds the receipt to it. Tagged for another
       * requirement does not.
       */
      (receipt.requirementId === undefined ||
        receipt.requirementId === requirement.id) &&
      receipt.command?.type === "open_tab" &&
      openedTabFor(requirement, receipt, input) &&
      samePage(receipt.command.url, input.observation.url) &&
      claimsOnlyAct(
        requirement,
        OPEN_TAB_ACT_WORDS,
        factWords([
          receipt.target?.name,
          pathWords(receipt.command.url),
          input.observation.title
        ]),
        OPEN_WORDS
      )
  )
  if (!receipt) return false
  consumed.add(receipt.stepId)
  return true
}

/**
 * Same scheme, host and path: where a page is, whatever its query picked up.
 * The package has no DOM `URL`, so the address is read by pattern, and one
 * it cannot read matches nothing, which refuses.
 */
const samePage = (first: string, second: string): boolean => {
  const page = (url: string) => {
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)/i.exec(url)
    return match ? `${match[1].toLowerCase()}${match[2] || "/"}` : undefined
  }
  const a = page(first)
  return a !== undefined && a === page(second)
}

/**
 * "Accept the terms" and "agree to the policy" ask for a ticked box. Read
 * only for a checked-state check, and only in the words around the
 * control's own name, never negated: a box is often labelled "Agree", and
 * "the Agree checkbox is unchecked" asks for the opposite.
 */
const acceptsBox = (text: string, name: string): boolean => {
  const rest = ` ${text} `.replace(` ${agentNormalizedClaim(name)} `, " ")
  return (
    (/\b(?:accept|accepted|agree|agreed)\b/.test(rest) ||
      localeAccepts(rest)) &&
    !/\b(?:not|never|don t|do not|without|decline|refuse)\b/.test(rest)
  )
}

const typedControlStateAgrees = (
  check: Extract<
    NonNullable<AgentTaskRequirement["check"]>,
    { type: "field" | "selected" | "checked" }
  >,
  text: string
): boolean => {
  if (check.type === "checked") {
    if (
      check.checked &&
      acceptsBox(text, check.name) &&
      !requirementAssertsOff(text)
    )
      return true
    return check.checked
      ? requirementAssertsOn(text) && !requirementAssertsOff(text)
      : requirementAssertsOff(text) && !requirementAssertsOn(text)
  }
  return check.value
    ? valueAssertedWithoutNegation(text, check.value)
    : /\bempty\b/u.test(text)
}

/** A predicate cannot silently replace a larger or different requested goal. */
const typedCheckAgrees = (requirement: AgentTaskRequirement): boolean => {
  const check = requirement.check
  if (!check) return false
  const text = agentNormalizedClaim(requirement.text)
  const verbs = new Set([
    "set",
    "sets",
    "setting",
    "enter",
    "entered",
    "type",
    "typed",
    "fill",
    "filled",
    "contains",
    "contain",
    "holds",
    "hold",
    "value",
    "equals",
    "equal",
    "should",
    "must",
    "checkbox",
    "checked",
    "check",
    "unchecked",
    "uncheck",
    "tick",
    "ticked",
    "untick",
    "unticked",
    "selected",
    "select",
    "option",
    "empty",
    /** A switch is turned or switched on, and a setting enabled. */
    "turn",
    "turned",
    "switch",
    "switched",
    "enable",
    "enabled",
    "disable",
    "disabled",
    "on",
    "off",
    /** Terms are accepted, or agreed to, by ticking their box. */
    "accept",
    "accepted",
    "agree",
    "agreed"
  ])
  if (
    check.type === "field" ||
    check.type === "selected" ||
    check.type === "checked"
  ) {
    if (!containsCompletePhrase(text, agentNormalizedClaim(check.name)))
      return false
    if (!typedControlStateAgrees(check, text)) return false
    const facts = factWords([
      check.name,
      check.record,
      check.type === "checked" ? undefined : check.value
    ])
    return claimWords(text).every(
      (word) =>
        verbs.has(word) ||
        CLAIM_FUNCTION_WORDS.has(word) ||
        (check.type === "checked" && isLocaleStateClaimWord(word)) ||
        facts.has(word)
    )
  }
  if (check.type === "control_transition") {
    // A renamed button establishes only an outcome explicitly naming that
    // transition; broader business claims still require independent review.
    // Direction is bound too: "Paid changes to Pay" never vouches for a
    // check from Pay to Paid, so the from label, a transition verb and the
    // to label must appear in that order. "Replaces" reverses the order and
    // is not accepted.
    const froms = completePhraseOccurrences(
      text,
      agentNormalizedClaim(check.from)
    )
    const tos = completePhraseOccurrences(text, agentNormalizedClaim(check.to))
    const ordered = froms.some((from) =>
      tos.some(
        (to) =>
          from.end <= to.start &&
          /\b(?:becomes?|became|changes?|changed|renamed|turns?|turned)\b/u.test(
            text.slice(from.end, to.start)
          )
      )
    )
    return (
      ordered &&
      (!check.record ||
        containsCompletePhrase(text, agentNormalizedClaim(check.record)))
    )
  }
  const identity = check.type === "url" ? check.url : check.record
  if (!containsCompletePhrase(text, agentNormalizedClaim(identity)))
    return false
  const acts =
    check.type === "record_state"
      ? new Set([
          check.state,
          {
            saved: "save",
            submitted: "submit",
            open: "open",
            closed: "close",
            merged: "merge",
            approved: "approve",
            deleted: "delete"
          }[check.state]
        ])
      : check.type === "url"
        ? new Set([
            "open",
            "opened",
            "navigate",
            "arrive",
            "arrived",
            "url",
            "new",
            "browser",
            "tab",
            "window"
          ])
        : new Set(["exists", "exist", "present", "row", "record", "listed"])
  return claimsOnlyAct(requirement, acts, factWords([identity]))
}

/**
 * A change that must be kept, made and confirmed by the run, whose check
 * does not hold: a page reporting success it then rejected — a toast over a
 * failed save — looks exactly like one that kept it. Telling the run never
 * to repeat it left a failed save unretried; telling it to repeat it would
 * double one that landed. So the feedback says which page says which, and
 * the repeat guards still stand between it and a second effect.
 */
const unkeptChange = (
  requirement: AgentTaskRequirement,
  changes: readonly AgentStepReadout[]
): boolean =>
  requirement.kind === "change" &&
  requirement.persist === true &&
  changes.some(
    (step) =>
      step.requirementId === requirement.id &&
      step.verification?.outcome === "confirmed"
  )

const UNKEPT_CHANGE_FEEDBACK =
  "The change is not shown as kept: the current observation does not hold the required value or state, so the save may not have persisted. If the page says the save failed, or still shows the old value, the change did not persist: re-apply it once and save again. If the page shows it kept, quote that instead and do not repeat it."

const judgeMetRequirement = (
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable" | undefined,
  changes: readonly AgentStepReadout[],
  consumed: Set<string>,
  credits?: Map<string, AgentStepReadout>
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined => {
  const unopened = refuseUnopenedTab(requirement, input)
  if (unopened) return unopened
  if (openedTabMeets(requirement, input, consumed)) return undefined
  if (returnedToStartTab(requirement, input)) return undefined
  if (keptTabsOpen(requirement, input)) return undefined
  if (requirement.kind === "read") {
    /**
     * A read the plan gave no items, answered item by item anyway — "the
     * lead time of each of the three suppliers", one quote per supplier.
     * There is no single string to judge, and refusing for the missing one
     * sent a run that had every fact round the same refusal until it asked
     * the user. But nothing ties each quote to the item the model filed it
     * under: "Blue Kettle 41 credits" names no shop, and accepted as claimed
     * it reached the user as a price from an unnamed shop. Every quote must
     * be grounded, and then a reviewer reads them against the question.
     */
    const parts = (claim.items ?? []).filter((item) => item.met)
    if (
      claim.evidence?.trim() ||
      parts.length === 0 ||
      requirement.items?.length
    )
      return refusePlannedReadClaim(claim.evidence, input, requirement)
    /** One part answered unmet leaves the read unmet, whatever the rest show. */
    if (parts.length < (claim.items ?? []).length)
      return {
        type: "refused",
        reason: "missing_outcomes",
        feedback: UNMET_PART_FEEDBACK
      }
    for (const part of parts) {
      const refused = refusePlannedReadClaim(part.evidence, input, requirement)
      if (refused) return refused
    }
    return {
      type: "refused",
      reason: "needs_review",
      feedback: UNLISTED_PARTS_FEEDBACK
    }
  }
  if (NO_SUBMISSION_MENTION_PATTERN.test(requirement.text)) {
    const refusal = noSubmissionEvidence(input)
    if (refusal) return refusal
    if (NO_SUBMISSION_ONLY_PATTERN.test(requirement.text.trim()))
      return undefined
  }
  /** Its quoted exact text, written and held by the run's own write. */
  if (agentHeldLiteralStands(requirement, changes, input.observation))
    return undefined
  const checked = checkCompletionState(
    requirement,
    input.observation,
    input.evidenceLedger,
    claim.evidence,
    changes
  )
  if (checked === true) {
    if (typedCheckAgrees(requirement)) return undefined
    /**
     * A check that holds but answers a different question — an empty "Second"
     * field for "focus is on Second" — settles nothing either way. The
     * requirement's own receipt can still settle it, exactly as it would with
     * no check at all; only when none does is the claim left to review.
     */
    const credited = evidencePlannedChange(
      requirement,
      claim.evidence?.trim() || undefined,
      {
        type: "refused",
        reason: "needs_review",
        feedback:
          "The predicate holds, but does not fully answer the requested outcome. Preserve completed effects and review the remaining claim."
      },
      changes,
      input.observation,
      consumed
    )
    if (!("stepId" in credited)) return credited
    credits?.set(requirement.id, credited)
    return undefined
  }
  if (checked === false)
    return {
      type: "refused",
      reason: "contradicted_state",
      feedback:
        unkeptChange(requirement, changes) &&
        !agentCheckFailureUnreadable(
          requirement,
          input.observation,
          input.evidenceLedger,
          claim.evidence,
          changes
        )
          ? UNKEPT_CHANGE_FEEDBACK
          : "The required identity, value or final state is not verified in the current observation. Read fresh evidence before considering any further action; do not repeat a completed effect."
    }
  if (requirement.check)
    return {
      type: "refused",
      reason: "needs_review",
      feedback:
        "The explicit predicate cannot establish the requested record or state. Preserve completed effects and review the claim; a receipt cannot replace this check."
    }
  const refusal = judgeEvidence(
    claim.evidence,
    input,
    change ?? "unreadable"
  ) ?? {
    type: "refused" as const,
    reason: "needs_review" as const,
    feedback:
      "The quote has page provenance but does not deterministically prove this outcome. This claim needs review. Preserve completed effects and request fresh evidence; do not repeat the action."
  }
  const evidenced = evidencePlannedChange(
    requirement,
    claim.evidence?.trim() || undefined,
    refusal,
    changes,
    input.observation,
    consumed
  )
  if (!("stepId" in evidenced)) return evidenced
  credits?.set(requirement.id, evidenced)
  return undefined
}

/**
 * An itemized requirement is met only when every item is, and each item is
 * judged as a requirement of its own: its own quotation, or its own verified
 * change consumed by identity. One invoice marked paid is evidence for one
 * invoice. An item answered `met:false` leaves the requirement unmet; an
 * item not answered at all is no answer, and the run is sent back.
 */
const judgeItemizedRequirement = (
  requirement: AgentTaskRequirement & { items: readonly string[] },
  claim: AgentCompletionOutcomeClaim,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable" | undefined,
  changes: readonly AgentStepReadout[],
  consumed: Set<string>,
  judgedItems: number[]
):
  | Extract<AgentCompletionJudgement, { type: "refused" }>
  | "unmet"
  | undefined => {
  /**
   * A read answered more than once for one item was itemized along the
   * wrong axis: "each of the three shops" planned as the one product they
   * sell, answered with three prices for item 0. The last answer would
   * stand for all of them, so the run goes to review instead, once every
   * quotation it gave is grounded. Only a read of one planned item: with
   * several, a review of the whole would let answers for one item stand for
   * the others, so each has to be answered once, by its own position.
   */
  if (answersAnItemTwice(requirement, claim)) {
    if ((claim.items ?? []).some((part) => !part.met))
      return {
        type: "refused",
        reason: "missing_outcomes",
        feedback: UNMET_PART_FEEDBACK
      }
    for (const part of claim.items ?? []) {
      const refused = refusePlannedReadClaim(part.evidence, input, requirement)
      if (refused) return refused
    }
    return {
      type: "refused",
      reason: "needs_review",
      feedback: UNLISTED_PARTS_FEEDBACK
    }
  }
  const indexes = (claim.items ?? []).map((item) => item.index)
  if (new Set(indexes).size < indexes.length)
    return {
      type: "refused",
      reason: "missing_outcomes",
      feedback: REPEATED_ITEM_FEEDBACK
    }
  /** An answer for no listed item, met or not, is a part the judge never reads. */
  if (indexes.some((index) => index < 0 || index >= requirement.items.length))
    return {
      type: "refused",
      reason: "missing_outcomes",
      feedback: UNLISTED_ITEM_FEEDBACK
    }
  const answers = new Map((claim.items ?? []).map((item) => [item.index, item]))
  if (requirement.items.some((_, index) => !answers.has(index)))
    return {
      type: "refused",
      reason: "missing_outcomes",
      feedback: MISSING_ITEM_OUTCOMES_FEEDBACK
    }
  /**
   * Page-link items are an enumeration of the outcome's every, all or each,
   * never a credit: the runtime does not meet one from its tab. A run that
   * answered every item met and opened each item's own link in a tab still
   * reaches the completion reviewer, which decides whether a tab is all each
   * item asked for. Judged item by item first, on copies, so an item proven
   * by its own quote or receipt is not sent to review for having a tab too.
   */
  const tabs =
    requirement.kind === "change" &&
    requirement.items.every((_, index) => answers.get(index)?.met === true)
      ? agentPageItemTabs(requirement, input.steps, consumed)
      : undefined
  if (tabs) {
    const trial = new Set(consumed)
    const trialItems: number[] = []
    const judged = judgeEachItem(
      requirement,
      answers,
      input,
      change,
      changes,
      trial,
      trialItems
    )
    if (judged === undefined) {
      for (const stepId of trial) consumed.add(stepId)
      judgedItems.push(...trialItems)
      return undefined
    }
    /**
     * Only a missing proof is sent on. A quote the page contradicts, a stale
     * reading or the run's own words stay refused: a tab does not answer
     * what the item's evidence actively says against it.
     */
    if (judged !== "unmet" && !PAGE_ITEM_REVIEWABLE.has(judged.reason))
      return judged
    for (const receipt of tabs) consumed.add(receipt.stepId)
    if (pageItemTabsOpen(requirement, input, tabs)) {
      judgedItems.push(...requirement.items.keys())
      return undefined
    }
    return {
      type: "refused",
      reason: "needs_review",
      feedback: PAGE_ITEM_TABS_REVIEW_FEEDBACK
    }
  }
  return judgeEachItem(
    requirement,
    answers,
    input,
    change,
    changes,
    consumed,
    judgedItems
  )
}

/**
 * Each item of an itemized requirement through the single-outcome judge,
 * bound to its own quotation or receipt.
 */
const judgeEachItem = (
  requirement: AgentTaskRequirement & { items: readonly string[] },
  answers: ReadonlyMap<
    number,
    NonNullable<AgentCompletionOutcomeClaim["items"]>[number]
  >,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable" | undefined,
  changes: readonly AgentStepReadout[],
  consumed: Set<string>,
  judgedItems: number[]
):
  | Extract<AgentCompletionJudgement, { type: "refused" }>
  | "unmet"
  | undefined => {
  let allMet = true
  let review: Extract<AgentCompletionJudgement, { type: "refused" }> | undefined
  const quoted = new Set<string>()
  for (const [index, item] of requirement.items.entries()) {
    const answer = answers.get(index)
    if (!answer?.met) {
      allMet = false
      continue
    }
    /**
     * Bound to its item, twice over. A quotation must name the item and may
     * not be one another item already used — "Invoice 1 Paid" twice is one
     * invoice, not two. A receipt standing in for a quotation must have
     * acted on a control or row that names the item, because every item
     * shares the requirement's id and the id alone would let any receipt
     * vouch for any item.
     */
    const quote = answer.evidence?.trim()
    const claim = quote ? agentNormalizedClaim(quote) : undefined
    const lead =
      requirement.kind === "read"
        ? leadNamingOnly(quote, item, requirement, input)
        : undefined
    /** A quote bound by its page's heading is one per fact, not one per line. */
    const key = lead !== undefined ? `${claim}\u0000${lead}` : claim
    const bound =
      claim !== undefined &&
      key !== undefined &&
      (namesItem(claim, item) || lead !== undefined) &&
      (requirement.kind !== "change" ||
        quotesOnlyItsItem(claim, item, requirement.items, input.observation)) &&
      !quoted.has(key)
    /**
     * A quotation not bound to its item is set aside, not fatal: the item's
     * own verified receipt can still credit it. A page that writes "Paid
     * Invoice 2" has the state first, which a quote alone cannot tell from
     * the end of the row before it.
     */
    if (bound) quoted.add(key)
    const evidence = bound ? quote : undefined
    const { items: _items, ...single } = requirement
    const refusal = judgeMetRequirement(
      { ...single, text: `${item}: ${requirement.text}` },
      {
        id: requirement.id,
        met: true,
        ...(evidence ? { evidence } : {})
      },
      input,
      change,
      changes.filter(
        (receipt) =>
          agentReceiptNamesItem(
            receipt,
            item,
            requirement.items,
            input.observation
          ) || soleItemReceipt(requirement, receipt)
      ),
      consumed
    )
    if (refusal?.reason === "needs_review") {
      review = refusal
      continue
    }
    if (refusal)
      return quote && !bound
        ? {
            type: "refused",
            reason: "absent_evidence",
            feedback: itemEvidenceFeedback(index, item)
          }
        : refusal
    judgedItems.push(index)
  }
  /**
   * An item the run itself reported unmet leaves the requirement unmet,
   * whatever a review of its other items could say. Returning the review
   * instead let a supported verdict on one item carry the whole requirement
   * into `met` with another item still unfinished.
   */
  if (!allMet) return "unmet"
  return review
}

/**
 * For a change, the quotation is about its item and nothing else: it starts
 * at the item's name, carries a state after it, and names no other item of
 * the requirement. "Paid Invoice 2" quotes invoice 1's state beside invoice
 * 2's name, and "Invoice 1 Due Invoice 2 Paid" quotes invoice 2's. A page
 * that writes the state first fails here and is credited only by the item's
 * own receipt.
 */
const quotesOnlyItsItem = (
  claim: string,
  item: string,
  items: readonly string[],
  observation: AgentObservation
): boolean => {
  const phrase = agentNormalizedClaim(item)
  if (!phrase) return false
  const alone = items.every(
    (other) => other === item || !namesItem(claim, other)
  )
  /**
   * A status or alert message quoted whole is one message about one thing,
   * whatever order its words come in: "Order placed for Blue Kettle" puts
   * the state first and the item last, and no row boundary can cut through
   * it. Only the whole message counts — a run of text that starts or ends
   * inside one is exactly the cut this rule exists to refuse.
   */
  if (wholeStatusMessage(claim, observation))
    return namesItem(claim, item) && alone
  if (!claim.startsWith(phrase)) return false
  const rest = claim.slice(phrase.length)
  if (!/^[^\p{L}\p{N}]/u.test(rest) || !/[\p{L}\p{N}]/u.test(rest)) return false
  return alone
}

/** Whether the claim is the whole text of a status or alert the page announced. */
const wholeStatusMessage = (
  claim: string,
  observation: AgentObservation
): boolean =>
  observation.elements.some(
    (element) =>
      ["status", "alert"].includes(element.role?.toLowerCase() ?? "") &&
      element.name !== undefined &&
      agentNormalizedClaim(element.name) === claim
  )

/** Whether normalized text names an item as a whole phrase, not a prefix. */
const namesItem = (text: string, item: string): boolean => {
  const phrase = agentNormalizedClaim(item)
  return phrase.length > 0 && containsCompletePhrase(text, phrase)
}

/**
 * Whether a receipt acted on this item. Either its control or row names the
 * item — "Invoice 3 — Due" names "invoice 3" — or the item names the control
 * and no other item does: "Given name Ada" names the field "Given name", but
 * "Status" is named by both "Invoice 1 Status" and "Invoice 2 Status" and
 * identifies neither, so a receipt under that name alone credits no item.
 * A reverse match must also prove the value or state the item adds.
 */
export const agentReceiptNamesItem = (
  receipt: AgentStepReadout,
  item: string,
  items: readonly string[],
  observation: AgentObservation
): boolean =>
  batchStatesItem(receipt, item, items) ||
  receiptNames(receipt).some(
    (name) =>
      namesItem(agentNormalizedClaim(name), item) ||
      (namesItem(agentNormalizedClaim(item), name) &&
        receiptProvesItem(receipt, item, observation) &&
        items.every(
          (other) =>
            other === item || !namesItem(agentNormalizedClaim(other), name)
        ))
  )

/** A reverse-name match owes every value or state the item adds to the name. */
const receiptProvesItem = (
  receipt: AgentStepReadout,
  item: string,
  observation: AgentObservation
): boolean => {
  if (!isResultVerifiedChange(receipt)) return false
  if (receipt.command?.type !== "fill_form")
    return quotationStatesReceiptFacts(item, receipt)
  const index = matchingBatchField(
    { id: receipt.requirementId ?? "", text: item, kind: "change" },
    receipt,
    observation,
    new Set()
  )
  if (index === undefined || index < 0) return false
  const field = receipt.command.fields[index]
  const name = receipt.verification?.evidence.fields?.[index]?.name
  const current = observation.elements.find(
    (element) =>
      agentNormalizedClaim(element.name ?? "") ===
      agentNormalizedClaim(name ?? "")
  )
  if (!field || !name || !current) return false
  const state =
    field.type === "check" || field.type === "uncheck"
      ? CHECKED_STATE_WORDS[field.type]
      : undefined
  return statesOnlyFacts(
    item,
    factWords([name, state ? undefined : current.value]),
    state
  )
}

/**
 * Every name a receipt acted under: its control, its row, and — for a
 * verified batch — each field the verifier checked. It vouches for an item
 * when one names the other: a row "Invoice 3 — Due" names the item
 * "invoice 3", and the item "Given name Ada" names the field "Given name". A batch's top-level
 * target names one control at most, so reading only that filtered out the
 * verified fields of an itemized form.
 */
/**
 * Whether a confirmed batch set exactly one field to the item itself — the
 * item of "select Blue" is Blue, and the field that holds it is named
 * Color, which no item names. The value is the batch's own, confirmed.
 */
const batchStatesItem = (
  receipt: AgentStepReadout,
  item: string,
  items: readonly string[]
): boolean => {
  const batch = confirmedBatch(receipt)
  if (!batch || batchFieldWithValue(batch.fields, item) === undefined)
    return false
  const wanted = agentNormalizedClaim(item)
  return items.every(
    (other) => other === item || agentNormalizedClaim(other) !== wanted
  )
}

const receiptNames = (receipt: AgentStepReadout): string[] =>
  [
    receipt.target?.name,
    receipt.target?.rowContext,
    ...(receipt.verification?.outcome === "confirmed" &&
    receipt.verification.evidence.kind === "fields"
      ? (receipt.verification.evidence.fields ?? []).map((field) => field.name)
      : [])
  ].filter((name): name is string => name !== undefined && name.length > 0)

/**
 * A receipt of a one-item change that sits in no row. With one item there is
 * no other item it could have been for, and a form field carries no row:
 * "complete the application for Record 4" planned with the record as its one
 * item filled Name and Color, which no item names, and item by item nothing
 * could credit it. Only an item the requirement's own words name as their
 * subject: an item that is itself a fact ("Given name Ada saved") is still
 * owed by a receipt that proves it. A receipt in a row still has to name the
 * item, because a row is how one record's control is told from another's.
 */
const soleItemReceipt = (
  requirement: AgentTaskRequirement & { items: readonly string[] },
  receipt: AgentStepReadout
): boolean =>
  requirement.kind === "change" &&
  requirement.items.length === 1 &&
  agentTextNamesRecord(requirement.text, requirement.items[0]) &&
  receipt.requirementId === requirement.id &&
  !receipt.target?.rowContext

/**
 * The retained fact behind a read's quote, when the page it was read on
 * opened by naming this item and none of the requirement's others — or was
 * reached by following a link that does: "Blue Kettle 41 credits" read on
 * the page headed, or linked as, "Kettle Corner" is Kettle Corner's price.
 * A page naming two items — a menu listing every shop — binds neither. Two
 * shops showing the same line are two facts, and each is asked in turn.
 */
const leadNamingOnly = (
  quote: string | undefined,
  item: string,
  requirement: AgentTaskRequirement & { items: readonly string[] },
  input: AgentCompletionInput
): string | undefined =>
  groundedCompletionQuotes(quote, requirement.id, input.evidenceLedger).find(
    (fact) => factNamesOnly(fact, item, requirement, input.steps)
  )?.id

const factNamesOnly = (
  fact: AgentEvidenceRecord,
  item: string,
  requirement: AgentTaskRequirement & { items: readonly string[] },
  steps: AgentCompletionInput["steps"]
): boolean => {
  const named = (fact.pageItems ?? []).filter((entry) =>
    requirement.items.includes(entry)
  )
  if (named.length === 1) return named[0] === item
  /** Or the link the run followed to that page names it, and only it. */
  const link = agentFactPageLink(fact, steps)
  const said = link ? agentNormalizedClaim(link) : ""
  return (
    said.length > 0 &&
    namesItem(said, item) &&
    requirement.items.every(
      (other) => other === item || !namesItem(said, other)
    )
  )
}

const itemEvidenceFeedback = (index: number, item: string): string =>
  `The quotation for item ${index} ("${item.slice(0, 80)}") has to name that item and be its own: quote the page text that shows it, not another item's. Do not repeat an action to produce evidence.`

/**
 * A read of one planned item answered in more than one part, whether filed
 * twice under that item or under positions past it.
 */
const answersAnItemTwice = (
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim | undefined
): boolean =>
  requirement.kind === "read" &&
  requirement.items?.length === 1 &&
  (claim?.items ?? []).length > 1

/**
 * An itemized requirement is met only item by item, and a review answers for
 * the requirement as a whole: one supported citation cannot say which item it
 * supports. A refusal that includes one keeps no scope and is never reviewed —
 * except a read answered twice for one item, whose items were planned along
 * the wrong axis and so say nothing a review would have to answer by, and a
 * change whose every item is answered by its own quote about it alone, and
 * a page-item change whose every item has its own tab at its link.
 * Then each citation already says which item it is for: "Record 2 Paid" and
 * "Record 5 Paid" were refused as unproven and never reviewed, so a run that
 * had marked both paid asked the user whether it was done.
 */
const withReviewScope = (
  review: Extract<AgentCompletionJudgement, { type: "refused" }>,
  requirements: readonly AgentTaskRequirement[],
  reviewIds: string[],
  outcome: AgentRunOutcome,
  claims: ReadonlyMap<string, AgentCompletionOutcomeClaim>,
  input: AgentCompletionInput
): Extract<AgentCompletionJudgement, { type: "refused" }> =>
  requirements.some(
    (requirement) =>
      requirement.items?.length &&
      reviewIds.includes(requirement.id) &&
      !answersAnItemTwice(requirement, claims.get(requirement.id)) &&
      !everyItemQuotedAlone(
        requirement,
        claims.get(requirement.id),
        input.observation
      ) &&
      !everyPageItemOpened(requirement, claims.get(requirement.id), input)
  )
    ? review
    : {
        ...review,
        review: { requirementIds: reviewIds, constraintIds: [], outcome }
      }

/**
 * Whether every item of a change is answered met by a distinct quote that
 * names it alone and first, the same binding the item-by-item judge asks of
 * a quotation. Only a change: its reviewer reads the page's state, while a
 * read's quotes are the answer and each must stand on its own grounding.
 */
const everyItemQuotedAlone = (
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim | undefined,
  observation: AgentObservation
): boolean => {
  if (requirement.kind !== "change") return false
  const items = requirement.items ?? []
  const answers = new Map(
    (claim?.items ?? []).map((item) => [item.index, item])
  )
  const quotes = new Set<string>()
  return items.every((item, index) => {
    const answer = answers.get(index)
    const quote = answer?.met ? answer.evidence?.trim() : undefined
    const said = quote ? agentNormalizedClaim(quote) : ""
    if (!said || quotes.has(said) || !namesItem(said, item)) return false
    if (!quotesOnlyItsItem(said, item, items, observation)) return false
    quotes.add(said)
    return true
  })
}

/**
 * Whether every item of a page-item change is answered met and has its own
 * confirmed tab at its link. The tab is only the citation's shape: a
 * reviewer still has to support the requirement, citing each item's tab or
 * a quote naming it, and what it carries is `supported`, never `verified`.
 */
const everyPageItemOpened = (
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim | undefined,
  input: AgentCompletionInput
): boolean =>
  requirement.kind === "change" &&
  (requirement.items ?? []).every(
    (_, index) =>
      claim?.items?.find((item) => item.index === index)?.met === true
  ) &&
  agentPageItemTabs(requirement, input.steps) !== undefined

const recordJudgedItems = (
  items: NonNullable<AgentRunOutcome["items"]>,
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim,
  judgedItems: number[],
  input: AgentCompletionInput
): void => {
  if (requirement.items?.length) {
    const visualItems = judgedItems.filter((index) => {
      const quote = claim.items?.find((item) => item.index === index)?.evidence
      return (
        requirement.kind === "read" &&
        !groundedCompletionQuote(
          quote,
          requirement.id,
          readableLedger(input, requirement),
          requiresCurrentState(requirement)
        ) &&
        visualCompletionRead(quote, requirement.id, input.evidenceLedger) !==
          undefined
      )
    })
    items.push({
      id: requirement.id,
      met: judgedItems,
      ...(visualItems.length ? { visual: visualItems } : {})
    })
  }
}

/**
 * The requirement stays unmet, but the items the run did finish are still
 * judged for the report, on a copy of the consumed receipts so an unmet
 * requirement credits nothing another one needs.
 */
const recordUnmetItems = (
  items: NonNullable<AgentRunOutcome["items"]>,
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim | undefined,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable" | undefined,
  changes: readonly AgentStepReadout[],
  consumed: Set<string>
): void => {
  if (
    !claim ||
    !requirement.items?.length ||
    !claim.items?.some((item) => item.met)
  )
    return
  const judgedItems: number[] = []
  judgeItemizedRequirement(
    { ...requirement, items: requirement.items },
    claim,
    input,
    change,
    changes,
    new Set(consumed),
    judgedItems
  )
  recordJudgedItems(items, requirement, claim, judgedItems, input)
}

/**
 * Whether a read's quote sits in the row of the record its check names. Row
 * context is the whole row's text, so the quote has to be inside it and the
 * row has to name the record as a complete phrase: "$9" quoted from the
 * Basic row is not the price of the Pro plan, however exactly it was quoted.
 */
/**
 * Told to the model when its superlative answer names the wrong item. The
 * item is the plan's own wording and the value a number the page showed.
 */
const comparedAnswerFeedback = (
  id: string,
  winner: AgentCollectedRecord
): string =>
  `${id}: the values collected for each item say "${winner.item}" (${winner.value}) is the answer, not the item your answer names. Check the collected quotes and complete again.${UNMET_EXIT}`

/**
 * A page this short, with no row of its own, is one document about one thing:
 * the confirmation after a save. Longer pages and any page with rows are
 * lists, where a quote has to sit in its record's own row.
 */
const MAX_SINGLE_DOCUMENT_CHARS = 1_500

/**
 * The record a read is about: its own check's, else the one a sibling change
 * is checked against when the plan names exactly one. "Read the confirmation
 * code" after "save Record 6" has no check of its own, and could otherwise
 * never be bound.
 */
const readRecordFor = (
  requirement: AgentTaskRequirement,
  plan: readonly AgentTaskRequirement[]
): string | undefined => {
  const own = (entry: AgentTaskRequirement): string | undefined =>
    entry.check && "record" in entry.check ? entry.check.record : undefined
  const direct = own(requirement)
  if (direct) return direct
  const siblings = new Set(
    plan
      .filter((entry) => entry.kind === "change")
      .flatMap((entry) => {
        const record = own(entry)
        return record ? [record] : []
      })
  )
  return siblings.size === 1 ? [...siblings][0] : undefined
}

const readBoundToItsRecord = (
  requirement: AgentTaskRequirement,
  quote: string | undefined,
  input: Pick<AgentCompletionInput, "observation" | "evidenceLedger"> & {
    requirements?: readonly AgentTaskRequirement[]
  }
): boolean => {
  const record = readRecordFor(requirement, input.requirements ?? [])
  const quoted = quote ? agentNormalizedClaim(quote) : ""
  if (!record || !quoted) return false
  /**
   * The quote has to be one the run read on this page, in the frame the row
   * is in: a historical quote that happens to match today's row is about
   * whatever page it was read on.
   */
  const fact = groundedCompletionQuote(
    quote,
    requirement.id,
    input.evidenceLedger,
    true
  )
  const frame = input.observation.frames.find(
    (entry) => entry.frameId === fact?.source?.frameId
  )
  if (!fact?.source || frame?.documentId !== fact.source.documentId)
    return false
  const named = agentNormalizedClaim(record)
  const rowed = input.observation.elements.some(
    (element) => !element.sensitive && element.rowContext
  )
  const text = agentNormalizedClaim(input.observation.visibleText ?? "")
  if (
    !rowed &&
    text.length > 0 &&
    input.observation.visibleText.length <= MAX_SINGLE_DOCUMENT_CHARS &&
    containsCompletePhrase(text, named) &&
    agentHaystackStates(quoted, text)
  )
    return true
  return input.observation.elements.some((element) => {
    if (
      element.sensitive ||
      !(element.visible || element.offscreen) ||
      element.frameId !== fact.source?.frameId
    )
      return false
    const row = agentNormalizedClaim(element.rowContext ?? "")
    return (
      containsCompletePhrase(row, named) && agentHaystackStates(quoted, row)
    )
  })
}

const judgePlanned = (
  input: AgentCompletionInput,
  requirements: readonly AgentTaskRequirement[],
  change: AgentStepReadout | "unreadable" | undefined,
  credits?: Map<string, AgentStepReadout>
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
  /**
   * Every outcome claimed met while the model's own words say part of the
   * answer could not be established. Measured live: "Offer 2 could not be
   * determined" sat in the summary of a run that claimed every reference
   * code read. The admission is the model's, so it is believed over the claim.
   * Only the summary is read: evidence is page text, where "Email not
   * verified" can be the answer itself — and the summary repeating that
   * answer is no hedge either.
   */
  if (summaryHedges(input) && [...claims.values()].every((claim) => claim.met))
    return {
      type: "refused",
      reason: "contradicted_state",
      feedback: HEDGED_COMPLETION_FEEDBACK
    }
  const met: string[] = []
  const unmet: string[] = []
  /**
   * One verified state vouches for one requirement — never the whole plan.
   * Each exemption consumes a distinct change receipt by identity, so a run
   * that verified a single field still owes quotations (or further receipts)
   * for everything else it claimed. The receipts are the bounded record: they
   * carry the verified state, the source URL and the step identity, and the
   * judge re-derives the same answer from them every time.
   */
  const changes = allChanges(input.steps ?? [])
  const consumed = new Set<string>()
  let review: Extract<AgentCompletionJudgement, { type: "refused" }> | undefined
  const reviewIds: string[] = []
  const items: NonNullable<AgentRunOutcome["items"]> = []
  /**
   * A superlative read — the cheapest, the highest — is computed from what
   * the run collected for each item of the plan's itemized read, not taken
   * from the model. An answer naming the computed item is verified without a
   * quote of its own — it is a computation over quotes already grounded —
   * and one naming another collected item is sent back with the computed one.
   */
  const collected = agentCollectedRecords(
    requirements,
    input.outcomes,
    input.evidenceLedger
  )
  const compared = new Set<string>()
  /**
   * A superlative the collected values cannot settle is put to the reviewer
   * rather than met on its quote. Measured live: "which shop is cheapest"
   * was verified on one grounded price line from the wrong shop — the quote
   * was real, and said nothing about the other two.
   */
  const uncomputed = new Set<string>()
  for (const requirement of requirements) {
    const id = requirement.id
    if (!claims.get(id)?.met) continue
    const winner = agentComparedAnswer(requirement, collected, requirements)
    if (!winner) {
      if (agentSuperlativeRead(requirement)) uncomputed.add(id)
      continue
    }
    const stance = agentAnswerAgainstCompared(
      claims.get(id)?.evidence,
      winner,
      collected
    )
    if (stance === "disagrees")
      return {
        type: "refused",
        reason: "contradicted_state",
        feedback: comparedAnswerFeedback(id, winner)
      }
    if (stance === "agrees") compared.add(id)
    else if (agentSuperlativeRead(requirement)) uncomputed.add(id)
  }
  for (const requirement of requirements) {
    const claim = claims.get(requirement.id)
    if (!claim?.met) {
      unmet.push(requirement.id)
      recordUnmetItems(
        items,
        requirement,
        claim,
        input,
        change,
        changes,
        consumed
      )
      continue
    }
    if (compared.has(requirement.id)) {
      met.push(requirement.id)
      continue
    }
    const judgedItems: number[] = []
    const quoted = requirement.items?.length
      ? judgeItemizedRequirement(
          { ...requirement, items: requirement.items },
          claim,
          input,
          change,
          changes,
          consumed,
          judgedItems
        )
      : judgeMetRequirement(
          requirement,
          claim,
          input,
          change,
          changes,
          consumed,
          credits
        )
    const judged =
      quoted === undefined && uncomputed.has(requirement.id)
        ? ({
            type: "refused",
            reason: "needs_review",
            feedback: UNCOMPUTED_SUPERLATIVE_FEEDBACK
          } as const)
        : quoted
    if (!answersAnItemTwice(requirement, claim))
      recordJudgedItems(items, requirement, claim, judgedItems, input)
    if (judged === "unmet") {
      unmet.push(requirement.id)
      continue
    }
    if (judged?.reason === "needs_review") {
      review = judged
      reviewIds.push(requirement.id)
      continue
    }
    if (judged) return judged
    met.push(requirement.id)
  }
  /**
   * A kept change is verified only by its check holding on a page loaded
   * after it. A later navigation alone proves nothing: a field receipt can
   * still vouch for a value the reopened record no longer shows. A change
   * with no check cannot be read back by rule at all, so it stays claimed
   * and the run is not sent to try; one with a check, shown only on the page
   * it was made on, is asked to be read back once.
   */
  const unreadSaves = met.filter((id) => {
    const requirement = requirements.find((entry) => entry.id === id)
    if (requirement?.kind !== "change" || requirement.persist !== true)
      return false
    return !(
      requirement.check &&
      readBackAfterChange(requirement, input.steps) &&
      checkCompletionState(
        requirement,
        input.observation,
        input.evidenceLedger,
        claims.get(id)?.evidence,
        changes
      ) === true
    )
  })
  const toAsk = unreadSaves.filter((id) => {
    const requirement = requirements.find((entry) => entry.id === id)
    return (
      requirement?.check !== undefined &&
      !readBackAfterChange(requirement, input.steps) &&
      !readbackAsked(id, input.steps)
    )
  })
  if (toAsk.length > 0)
    return {
      type: "refused",
      reason: "readback_required",
      feedback: readbackFeedback(toAsk),
      readback: toAsk
    }
  const visual = met.filter((id) => {
    const requirement = requirements.find((entry) => entry.id === id)
    if (requirement?.kind !== "read") return false
    const claim = claims.get(id)
    const evidence = requirement.items?.length
      ? (claim?.items ?? [])
          .filter((item) => item.met)
          .map((item) => item.evidence)
      : [claim?.evidence]
    return evidence.some(
      (quote) =>
        !groundedCompletionQuote(
          quote,
          id,
          readableLedger(input, requirement),
          requiresCurrentState(requirement)
        ) && visualCompletionRead(quote, id, input.evidenceLedger) !== undefined
    )
  })
  /**
   * A met read rests on a grounded quote, which proves where the words came
   * from and not that they answer the question: an exact quote from the
   * wrong row, or from a page about something else, is grounded too. It is
   * verified only when the runtime can tie the quote to what was asked —
   * the item it names, or the row of the record its check names. Anything
   * else is the model's claim until a reviewer supports it.
   */
  const claimed = met.filter((id) => {
    if (unreadSaves.includes(id)) return true
    const requirement = requirements.find((entry) => entry.id === id)
    if (
      requirement?.kind !== "read" ||
      requirement.items?.length ||
      visual.includes(id) ||
      compared.has(id)
    )
      return false
    return !readBoundToItsRecord(requirement, claims.get(id)?.evidence, {
      ...input,
      requirements
    })
  })
  const outcome = {
    met,
    unmet,
    ...(items.length ? { items } : {}),
    ...(visual.length ? { visual } : {}),
    ...(claimed.length ? { claimed } : {}),
    graded: true as const
  }
  if (review)
    return withReviewScope(
      review,
      requirements,
      reviewIds,
      outcome,
      claims,
      input
    )
  if (unmet.length === 0) return { type: "accepted", outcome }
  return met.length === 0
    ? { type: "unmet", outcome }
    : { type: "partial", outcome }
}

/**
 * Constraints judged in two halves: anything that settles the run — a
 * violation, an unreadable record — is returned at once, and a limit nothing
 * deterministic can check is collected for review. A violation found after a
 * reviewable limit still wins; the order constraints were planned in is not
 * a reason to ask a reviewer about a run that already broke one.
 */
/**
 * A limit on how the run acts — "using Tab", "with the Enter key" — is about
 * the run's own input, which no page shows and no quotation can cite, so a
 * reviewer shown the page could only ever refuse it. The receipts answer it
 * instead: every change the run applied was a confirmed press of a key the
 * constraint names. A click, a typed value or an unconfirmed press leaves it
 * to review, and a constraint naming no key is never read this way.
 */
/**
 * The only words a "use this key" limit may hold besides the key and the
 * controls the run moved between. An allowlist, not a list of bad words: "Do
 * not press Tab", "Press Tab at most once" and "Tab only after saving" all
 * name the key, and every word they add is one this shortcut cannot judge,
 * so anything outside it leaves the limit to review.
 */
const PRESS_WORDS = new Set([
  "press",
  "presses",
  "pressing",
  "pressed",
  "hit",
  "hitting"
])

const KEY_METHOD_WORDS = new Set([
  "use",
  "uses",
  "using",
  "used",
  "press",
  "presses",
  "pressing",
  "pressed",
  "hit",
  "hitting",
  "key",
  "keys",
  "keyboard",
  "via",
  "by",
  "with",
  "move",
  "moving",
  "reach",
  "reaching",
  "get",
  "focus",
  "navigate",
  "navigating",
  "go",
  "from",
  "to",
  "into",
  "onto",
  "next",
  "control",
  "field"
])

/**
 * A limit on how the run acts — "using Tab", "with the Enter key" — is about
 * the run's own input, which no page shows and no quotation can cite, so a
 * reviewer shown the page could only ever refuse it. The receipts answer it
 * instead: every change the run applied was a confirmed press of a key the
 * limit names, and the limit says nothing else.
 */
const keyMethodHonored = (
  constraint: AgentTaskConstraint,
  steps: readonly AgentStepReadout[],
  observation: AgentObservation
): boolean => {
  const changes = allChanges(steps)
  if (
    changes.length === 0 ||
    !changes.every(
      (step) =>
        step.command?.type === "press_key" &&
        step.verification?.outcome === "confirmed"
    )
  )
    return false
  const keys = changes.map((step) =>
    step.command?.type === "press_key" ? keyText(step.command.key) : ""
  )
  const text = agentNormalizedClaim(constraint.text)
  if (
    !keys.every((key) =>
      containsCompletePhrase(text, agentNormalizedClaim(key))
    )
  )
    return false
  /**
   * "Press Tab" asks for a press, not a method: one press per time the key is
   * named. A run that pressed it three times went past what was asked, so
   * an instruction to press counts, while "using Tab" allows any number.
   */
  if (claimWords(constraint.text).some((word) => PRESS_WORDS.has(word))) {
    for (const key of new Set(keys)) {
      const named = completePhraseOccurrences(
        text,
        agentNormalizedClaim(key)
      ).length
      if (keys.filter((pressed) => pressed === key).length !== named)
        return false
    }
  }
  return claimsOnlyAct(
    { id: constraint.id, kind: "change", text: constraint.text },
    KEY_METHOD_WORDS,
    factWords([
      ...keys,
      ...changes.map((step) => step.target?.name),
      ...observation.elements
        .filter((element) => element.focused && !element.sensitive)
        .map((element) => element.name)
    ]),
    new Set(keys.flatMap((key) => claimWords(key)))
  )
}

/**
 * "Don't approve or change anything" asks for nothing the page shows and
 * names no effect class the planner could forbid, so it went to a reviewer
 * who had nothing to cite and refused it every time — on runs that only
 * read. The receipts answer it instead: an exclusion about changing things
 * holds when the run applied no change at all and no effect is uncertain.
 * One that also speaks of where the run goes ("don't open other pages") is
 * about navigation, which a read-only run does, and stays with review.
 */
const CHANGE_EXCLUSION =
  /\b(?:change|changes|changing|changed|modify|modifies|modifying|edit|edits|editing|update|updates|updating|alter|alters|altering|approve|approves|approving|reorder|reorders|reordering|submit|submits|submitting|send|sends|sending|save|saves|saving|delete|deletes|deleting|remove|removes|removing|order|orders|ordering|buy|buys|buying|pay|pays|paying|book|books|booking|cancel|cancels|cancelling|canceling|touch|touches|touching|publish|publishes|publishing|post|posts|posting|share|shares|sharing|deploy|deploys|deploying)\b/
const NAVIGATION_VERBS =
  "open|opens|opening|visit|visits|visiting|go|goes|going|navigate|navigates|navigating|leave|leaves|leaving|follow|follows|following|click|clicks|clicking"
const NAVIGATION_EXCLUSION = new RegExp(
  `\\b(?:${NAVIGATION_VERBS}|tab|tabs|site|sites|page|pages|link|links)\\b`
)
const NAVIGATION_ACTION = new RegExp(`\\b(?:${NAVIGATION_VERBS})\\b`)

/**
 * Whether an exclusion is about what the run itself does — changing,
 * sending, opening — and so is answered by the actions it recorded. One
 * about what the page shows ("no seller outside the EU") is not, and needs
 * a quotation bound to it like any other claim about the page.
 */
export const agentExclusionNamesActions = (text: string): boolean => {
  const normalized = agentNormalizedClaim(text)
  return CHANGE_EXCLUSION.test(normalized) || NAVIGATION_ACTION.test(normalized)
}
/**
 * Words that exclude change itself rather than one class of effect. "Don't
 * approve or change anything" forbids submissions by rule, and the forbidden
 * classes alone would then settle it — a run that saved an edit broke the
 * "change" half and passed. Such an exclusion still needs the run to have
 * changed nothing, or a reviewer.
 */
const BROAD_CHANGE_EXCLUSION =
  /\b(?:change|changes|changing|modify|modifies|modifying|edit|edits|editing|update|updates|updating|alter|alters|altering|touch|touches|touching)\b/
const excludesChangeItself = (constraint: AgentTaskConstraint): boolean =>
  constraint.kind === "exclude" &&
  BROAD_CHANGE_EXCLUSION.test(agentNormalizedClaim(constraint.text))

const nothingChanged = (
  constraint: AgentTaskConstraint,
  steps: readonly AgentStepReadout[]
): boolean => {
  if (constraint.kind !== "exclude") return false
  const text = agentNormalizedClaim(constraint.text)
  return (
    CHANGE_EXCLUSION.test(text) &&
    !NAVIGATION_EXCLUSION.test(text) &&
    allChanges(steps).length === 0 &&
    !steps.some((step) => step.status === "uncertain")
  )
}

/**
 * A negative lead: "don't", "do not", "never", "avoid", "without". The
 * exclusion names an act the run would have to perform, so a run that
 * performed none cannot have done it.
 */
const NEGATIVE_LEAD = /^(?:do not|don['’]?t|never|avoid|without)\b/u

/**
 * An exclusion no effect touched. "Don't X" names an act, and a run that
 * applied no change and has nothing uncertain cannot have done it, whatever
 * the act was — the receipts are the whole answer, and a reviewer shown
 * nothing had nothing to cite. Not for navigation, which a run that only
 * read still does, and not for a run that only reads: there the exclusion is
 * about what the answer contains, which the answer's own facts show.
 */
const noEffectTouched = (
  constraint: AgentTaskConstraint,
  steps: readonly AgentStepReadout[],
  requirements: readonly AgentTaskRequirement[] | undefined
): boolean =>
  constraint.kind === "exclude" &&
  NEGATIVE_LEAD.test(agentNormalizedClaim(constraint.text)) &&
  !NAVIGATION_EXCLUSION.test(agentNormalizedClaim(constraint.text)) &&
  (requirements ?? []).some((requirement) => requirement.kind === "change") &&
  allChanges(steps).length === 0 &&
  !steps.some((step) => step.status === "uncertain")

/**
 * "Do not publish." names an act the page offers as a control and no effect
 * class the planner could forbid, and no page text can show an act that did
 * not happen: a reviewer asked for a quote that cannot exist. The receipts
 * answer it, as for a control the run pressed or did not. The exclusion is
 * only the act, on nothing but the task's own objects, and the act is one a
 * control carries rather than data that could leave in a field.
 */
const CONTROL_ACT_EXCLUSION =
  /^(?:do not|don['’]?t|never)\s+(publish|post|deploy)\b\s*(.*?)[.!]?$/u
const PRESSING_COMMANDS = new Set([
  "click",
  "click_point",
  "double_click",
  "press_key"
])

const controlNamesAct = (name: string | undefined, verb: string): boolean =>
  new RegExp(`\\b${verb}(?:es|s|ed|ing)?\\b`, "u").test(
    agentNormalizedClaim(name ?? "")
  )

const excludedControlAct = (
  constraint: AgentTaskConstraint,
  requirements: readonly AgentTaskRequirement[] | undefined
): string | undefined => {
  if (constraint.kind !== "exclude") return undefined
  const match = CONTROL_ACT_EXCLUSION.exec(
    agentNormalizedClaim(constraint.text)
  )
  if (!match) return undefined
  const own = new Set(
    (requirements ?? []).flatMap((requirement) => claimWords(requirement.text))
  )
  return claimWords(match[2]).every(
    (word) => CLAIM_FUNCTION_WORDS.has(word) || own.has(word)
  )
    ? match[1]
    : undefined
}

/**
 * A control carrying the excluded act that the run pressed. "Don't publish"
 * names the act only to decline it, so pressing it is no violation; whether
 * it kept the act from happening is left to `changeMayCarryAct`'s review.
 */
const pressedExcludedControl = (
  verb: string,
  steps: readonly AgentStepReadout[]
): boolean =>
  steps.some(
    (step) =>
      isAppliedAgentStepStatus(step.status) &&
      PRESSING_COMMANDS.has(step.command?.type ?? "") &&
      setsAct(step.target?.name, verb)
  )

/**
 * Words that turn a label or an option into the act's opposite: "Not
 * published", "Don't publish", "Unpublished", "Never post". Setting such a
 * control is not the act, and whether it kept the act from happening is a
 * reading only a reviewer can give.
 */
const ACT_NEGATION =
  /(?:^|[^\p{L}\p{N}])(?:not|no|never|without|don['’]?t|do not|won['’]?t)(?![\p{L}\p{N}])/u

/** A label or option that names the act itself, unnegated. */
const setsAct = (text: string | undefined, verb: string): boolean => {
  const said = agentNormalizedClaim(text ?? "")
  return (
    controlNamesAct(said, verb) &&
    !ACT_NEGATION.test(said) &&
    !new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:un|non-?)${verb}`, "u").test(said)
  )
}

/**
 * A control set, not pressed, to the excluded act: "Publish to web" checked,
 * "Status" set to "Published", a batched fill choosing the same option or
 * checking the same box. A press is not the only way to publish, and these
 * say so as plainly. A batched box is named by the field its receipt
 * recorded in the same place; one without a name is a change that may have
 * carried the act, which `changeMayCarryAct` sends to review.
 */
const setExcludedControl = (
  verb: string,
  steps: readonly AgentStepReadout[]
): boolean =>
  latestAgentSteps(steps).some((step) => {
    const command = step.command
    if (!isAppliedAgentStepStatus(step.status) || !command) return false
    if (command.type === "check") return setsAct(step.target?.name, verb)
    if (command.type === "select") return setsAct(command.value, verb)
    if (command.type === "fill_form") {
      const evidence = step.verification?.evidence
      const names =
        step.verification?.outcome === "confirmed" &&
        evidence?.kind === "fields"
          ? (evidence.fields ?? [])
          : []
      return command.fields.some(
        (field, index) =>
          (field.type === "select" && setsAct(field.value, verb)) ||
          (field.type === "check" && setsAct(names[index]?.name, verb))
      )
    }
    return false
  })

/**
 * Whether a change the run applied could have carried the act without
 * pressing a control named for it, so that only a reviewer can say. Only
 * typing text that does not carry the verb, and pressing a control named for
 * something else, cannot: a toggle is checked, an option chosen or a card
 * dropped into a column whose words the receipt need not share with the act
 * ("Make public", "Status: Live"), a point may have no control named under
 * it, and a dialog answered may have been the act's confirmation. Any of
 * these and the receipts no longer show the act did not happen.
 */
const changeMayCarryAct = (
  verb: string,
  steps: readonly AgentStepReadout[]
): boolean =>
  allChanges(steps).some((step) => {
    const command = step.command
    if (!command) return true
    if (PRESSING_COMMANDS.has(command.type))
      return !step.target?.name || controlNamesAct(step.target.name, verb)
    if (controlNamesAct(step.target?.name, verb)) return true
    switch (command.type) {
      case "type":
      case "clear_and_type":
      case "replace_text":
        return controlNamesAct(command.text, verb)
      case "fill_form":
        return command.fields.some(
          (field) =>
            (field.type !== "type" && field.type !== "clear_and_type") ||
            controlNamesAct(field.text, verb)
        )
      default:
        return true
    }
  })

/**
 * Held when the page offers the act as a control the run can see, the run
 * never pressed one, set none to it, applied no change that could have
 * carried it unnamed, sent no form that could have carried it, and nothing
 * it did is uncertain. In doubt, review: holding is the one answer here no
 * reviewer gets to check.
 */
const excludedControlUnpressed = (
  verb: string,
  steps: readonly AgentStepReadout[],
  observation: AgentObservation
): boolean =>
  observation.elements.some(
    (element) =>
      !element.sensitive &&
      (element.visible || element.offscreen) &&
      controlNamesAct(element.name, verb)
  ) &&
  !pressedExcludedControl(verb, steps) &&
  !setExcludedControl(verb, steps) &&
  !changeMayCarryAct(verb, steps) &&
  !steps.some(
    (step) =>
      step.status === "uncertain" ||
      (isAppliedAgentStepStatus(step.status) &&
        step.consequential?.some(
          (effect) => effect === "submission" || effect === "potential_commit"
        ) === true)
  )

/** How many times a limit lets an act happen, in words or digits. */
const COUNT_WORDS: Record<string, number> = {
  once: 1,
  twice: 2,
  thrice: 3
}
/**
 * "Once" is a count only where it closes the act or is qualified as one:
 * "save it once." and "exactly once" are counts, "stop once it is saved" is
 * a when.
 */
const COUNT_PATTERN =
  /\b(?:(?:exactly|only|just)\s+(once|twice|thrice)\b|(once|twice|thrice)\s*(?:[.,;:!)]|$)|(\d+|one|two|three)\s+times?\b)/u
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3 }
const COUNT_NEGATION =
  /\b(?:never|no|don't|dont|without|nor|not)\b(?! more than)/

/**
 * "Save Record 1 exactly once" asks how many times the run did something,
 * and only the run's own receipts can say: a reviewer shown one Save click
 * agreed there was one and still answered that it could not cite it. Held
 * when the applied changes whose control the limit names — each word of the
 * label is in the limit — number exactly the count, or under "at most"
 * wording at least one and no more, and nothing is uncertain. A negated
 * count ("don't save twice") is left to review: counting it the other way
 * round is not worth the risk.
 */
const countHonored = (
  constraint: AgentTaskConstraint,
  steps: readonly AgentStepReadout[]
): boolean => {
  if (constraint.kind !== "limit") return false
  const text = agentNormalizedClaim(constraint.text)
  const match = COUNT_PATTERN.exec(constraint.text.toLowerCase().trim())
  if (!match || COUNT_NEGATION.test(text)) return false
  const word = match[1] ?? match[2]
  const allowed = word
    ? COUNT_WORDS[word]
    : (NUMBER_WORDS[match[3]] ?? Number(match[3]))
  if (!allowed || steps.some((step) => step.status === "uncertain"))
    return false
  const words = new Set(contentWords(text))
  const counted = allChanges(steps).filter((step) => {
    const label = contentWords(agentNormalizedClaim(step.target?.name ?? ""))
    return label.length > 0 && label.every((word) => words.has(word))
  })
  /** "At most twice" is a ceiling; "twice", "exactly twice" are the count. */
  return CEILING_PATTERN.test(text)
    ? counted.length >= 1 && counted.length <= allowed
    : counted.length === allowed
}

const CEILING_PATTERN =
  /\b(?:at most|no more than|not more than|up to|maximum|max)\b/

/**
 * "Open every source link in a separate tab" planned as a limit is about how
 * the run moves, and its receipts say: every page it went to it opened in a
 * tab of its own, and none it left in place. A reviewer shown a list of
 * open_tab steps could cite none of them and refused it with every source
 * open and every code read.
 */
/**
 * Words that ask how many or which pages, not how: "every source link in a
 * new tab" is met only when each one was opened, which the receipts cannot
 * count against a list they never saw. Those go to review, which is shown
 * every tab the run opened and where it went.
 */
const TAB_COUNT_WORDS =
  /\b(?:\d+|one|two|three|four|five|single|once|twice|at most|no more than|up to|maximum|max|only|limit|fewer|less|every|each|all|another|second|both)\b/

const newTabMethodHonored = (
  constraint: AgentTaskConstraint,
  steps: readonly AgentStepReadout[]
): boolean => {
  const text = agentNormalizedClaim(constraint.text)
  if (
    !AGENT_NEW_TAB_PATTERN.test(constraint.text) ||
    COUNT_NEGATION.test(text) ||
    /** How many tabs is a count the receipts would have to be read for. */
    TAB_COUNT_WORDS.test(text)
  )
    return false
  const settled = latestAgentSteps(steps).filter(
    (step) =>
      isAppliedAgentStepStatus(step.status) &&
      step.verification?.outcome === "confirmed"
  )
  const opened = settled.filter(
    (step) =>
      step.command?.type === "open_tab" ||
      step.verification?.evidence.summary === "Control opened a new tab"
  )
  const leftInPlace = settled.some((step) => {
    const evidence = step.verification?.evidence
    if (!evidence || opened.includes(step)) return false
    return (
      ["navigate", "back", "forward"].includes(step.command?.type ?? "") ||
      evidence.kind === "navigation" ||
      (evidence.kind === "submission" && evidence.acceptance === "accepted") ||
      (evidence.kind === "activation" &&
        AGENT_PAGE_LEAVING_ACTIVATIONS.has(evidence.summary))
    )
  })
  return opened.length > 0 && !leftInPlace
}

const judgeConstraints = (
  input: AgentCompletionInput
):
  | Extract<AgentCompletionJudgement, { type: "refused" }>
  | { review: string[] } => {
  const review: string[] = []
  for (const constraint of input.constraints ?? []) {
    if (!input.steps)
      return {
        type: "refused",
        reason: "unverified_change",
        feedback:
          "The effect record is unavailable; constraints cannot be verified. Read fresh evidence without repeating completed effects."
      }
    if (
      input.steps.some(
        (receipt) =>
          isAppliedAgentStepStatus(receipt.status) &&
          receipt.consequential?.some((effect) =>
            /** A purchase's own cart, as the policy let it through. */
            effect === "potential_commit" &&
            receipt.cartAddition === true &&
            agentCartServesPurchase(
              input.requirements?.find(
                (requirement) => requirement.id === receipt.requirementId
              ),
              input.requirements
            )
              ? constraint.forbids?.includes("potential_commit") === true
              : agentForbidsEffect(constraint.forbids, effect)
          )
      )
    )
      return {
        type: "refused",
        reason: "contradicted_state",
        feedback: `The run violated constraint ${constraint.id}. Report the violation; do not claim full success.`
      }
    const act = excludedControlAct(constraint, input.requirements)
    if (
      act &&
      (pressedExcludedControl(act, input.steps) ||
        setExcludedControl(act, input.steps))
    )
      return {
        type: "refused",
        reason: "contradicted_state",
        feedback: `The run violated constraint ${constraint.id}. Report the violation; do not claim full success.`
      }
    if (
      input.steps.some(
        (receipt) =>
          isAgentChangeReceipt(receipt) && receipt.consequential === undefined
      )
    )
      return {
        type: "refused",
        reason: "needs_review",
        feedback:
          "An applied effect has no recorded consequential classes. Constraints need review; missing effect evidence is unknown."
      }
    if (
      (!constraint.forbids?.length || excludesChangeItself(constraint)) &&
      !keyMethodHonored(constraint, input.steps, input.observation) &&
      !nothingChanged(constraint, input.steps) &&
      !noEffectTouched(constraint, input.steps, input.requirements) &&
      !countHonored(constraint, input.steps) &&
      !newTabMethodHonored(constraint, input.steps) &&
      !(act && excludedControlUnpressed(act, input.steps, input.observation))
    )
      review.push(constraint.id)
  }
  return { review }
}

const constraintReviewFeedback = (ids: readonly string[]): string =>
  `Constraint ${ids.join(", ")} requires review; the requested scope or limit has no deterministic support. Preserve completed effects.`

/**
 * A planned completion: constraints that settle the run first, then every
 * requirement, then any limit only a reviewer can read folded into the same
 * review scope as the requirements that need one.
 */
/** Lowercase words, punctuation dropped: "Color." and "color" are one word. */
const stopWords = (text: string): string[] =>
  agentNormalizedClaim(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)

/** "Stop once Blue is selected" → "blue is selected". */
const STOP_CONDITION =
  /^(?:stop|finish|end|be done|you are done)\s+(?:once|when|as soon as|after)\s+(.+)$/u
const STOP_FILLER = new Set([
  "is",
  "are",
  "was",
  "has",
  "have",
  "been",
  "the",
  "a",
  "an",
  "it",
  "from",
  "in",
  "on",
  "of",
  "to",
  "field",
  "control",
  "option"
])

/**
 * A limit that only restates when to stop — "Stop once Blue is selected" for
 * the outcome "Blue is selected from Color" — adds nothing a page could show
 * beyond that outcome. It holds when the outcome it names was judged met and
 * the run changed nothing after the step that met it; a run that went on to
 * act again is left to review. Every content word of the condition must be a
 * word of that one outcome, so a condition naming anything else never reads
 * as it.
 */
const stopConditionMet = (
  constraint: AgentTaskConstraint,
  requirements: readonly AgentTaskRequirement[],
  met: ReadonlySet<string>,
  steps: readonly AgentStepReadout[] | undefined,
  observation: AgentObservation,
  credits: ReadonlyMap<string, AgentStepReadout>
): boolean => {
  const condition = STOP_CONDITION.exec(
    agentNormalizedClaim(constraint.text)
  )?.[1]
  if (!condition || !steps) return false
  const words = stopWords(condition).filter((word) => !STOP_FILLER.has(word))
  if (words.length === 0) return false
  const changes = allChanges(steps)
  const last = changes.at(-1)
  return requirements.some((requirement) => {
    if (!met.has(requirement.id)) return false
    const own = new Set(
      stopWords(
        [
          requirement.text,
          requirement.check && "name" in requirement.check
            ? requirement.check.name
            : "",
          requirement.check && "value" in requirement.check
            ? requirement.check.value
            : ""
        ].join(" ")
      )
    )
    return (
      words.every((word) => own.has(word)) &&
      /**
       * A change outcome is held by this run's own change: met with no
       * change at all, it was already true, and stopping "once" it held
       * says nothing about what this run did. The last change must be the
       * one that established it, never an act past it:
       * - an outcome with a state check ("Blue is selected") is set by a change
       *   verified against that state; a Save after it acted past the stop;
       * - one without (“Color shows Blue”, “the form is submitted”) is met
       *   by a change the completion judge credits with it, so the last
       *   change must be one: the one it credited, read with the run's own
       *   quotation as the judge read it (a Tab press quoted by "Second"), or
       *   one it credits on its own (the submit after a fill). A select
       *   credited with Blue and a Save after it acted past the stop. A second
       *   change verified the same way repeated an act that already met it.
       */
      (last === undefined
        ? requirement.kind !== "change"
        : last.requirementId === requirement.id &&
          last.verification?.outcome === "confirmed" &&
          (requirement.check
            ? provesItsOwnResult(last.verification)
            : (credits.get(requirement.id)?.stepId === last.stepId ||
                agentWorkflowReceiptSupport(
                  requirement,
                  undefined,
                  [last],
                  observation,
                  new Set()
                )?.stepId === last.stepId) &&
              !changes.some(
                (change) =>
                  change !== last &&
                  change.requirementId === requirement.id &&
                  change.verification?.outcome === "confirmed" &&
                  change.verification.evidence.kind ===
                    last.verification?.evidence.kind
              )))
    )
  })
}

const judgePlannedWithConstraints = (
  input: AgentCompletionInput,
  requirements: readonly AgentTaskRequirement[],
  change: AgentStepReadout | "unreadable" | undefined
): AgentCompletionJudgement => {
  const judged = judgeConstraints(input)
  if ("type" in judged) return judged
  /** The receipt the judge credited with each requirement it met. */
  const credits = new Map<string, AgentStepReadout>()
  const planned = judgePlanned(input, requirements, change, credits)
  /** Only what this judgement settled; a refusal settles nothing. */
  const met = new Set<string>(
    planned.type === "accepted"
      ? (planned.outcome?.met ??
          requirements.map((requirement) => requirement.id))
      : planned.type === "refused"
        ? []
        : planned.outcome.met
  )
  const constraints = {
    review: judged.review.filter((id) => {
      const constraint = input.constraints?.find((entry) => entry.id === id)
      return !(
        constraint &&
        stopConditionMet(
          constraint,
          requirements,
          met,
          input.steps,
          input.observation,
          credits
        )
      )
    })
  }
  if (constraints.review.length === 0) return planned
  if (planned.type === "refused") {
    if (!planned.review) return planned
    return {
      ...planned,
      feedback: `${planned.feedback} ${constraintReviewFeedback(constraints.review)}`,
      review: { ...planned.review, constraintIds: constraints.review }
    }
  }
  return {
    type: "refused",
    reason: "needs_review",
    feedback: constraintReviewFeedback(constraints.review),
    review: {
      requirementIds: [],
      constraintIds: constraints.review,
      outcome: planned.outcome ?? {
        met: requirements.map((requirement) => requirement.id),
        unmet: []
      }
    }
  }
}

export const judgeAgentCompletion = (
  input: AgentCompletionInput
): AgentCompletionJudgement => {
  const change = input.steps ? lastChange(input.steps) : "unreadable"
  if (input.requirements?.length)
    return judgePlannedWithConstraints(input, input.requirements, change)
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
    (input.baselineText !== undefined &&
      agentHaystackStates(evidence, input.baselineText)) ||
    (change !== "unreadable" && observedBeforeChange(evidence, change, input))
  ) {
    return {
      type: "refused",
      reason: "stale_evidence",
      feedback: STALE_EVIDENCE_FEEDBACK
    }
  }
  return { type: "accepted" }
}

/**
 * A checked change whose predicate the judge's own `checkCompletionState`
 * holds now — read off the control, or credited for one a save or a
 * navigation took off the page — is settled by the run's receipt for it: its
 * last write recorded as holding exactly the check's value, or, when the
 * requirement says no more than its check, its last confirmed change.
 * Anything else is credited only as the judge would credit it.
 */
const checkedReceiptSupport = (
  requirement: AgentTaskRequirement,
  changes: readonly AgentStepReadout[],
  observation: AgentObservation,
  consumed: Set<string>
): AgentStepReadout | undefined => {
  const own = changes.filter(
    (step) =>
      step.verification?.outcome === "confirmed" &&
      (step.requirementId === requirement.id ||
        step.heldPlannedFor?.includes(requirement.id) === true)
  )
  const held = [...own]
    .reverse()
    .find(
      (step) =>
        (step.heldPlannedValue === true &&
          step.requirementId === requirement.id) ||
        step.heldPlannedFor?.includes(requirement.id) === true
    )
  if (
    checkCompletionState(
      requirement,
      observation,
      undefined,
      undefined,
      changes
    ) !== true
  )
    return undefined
  if (held) return held
  if (typedCheckAgrees(requirement) && own.length) return own.at(-1)
  const credited = evidencePlannedChange(
    requirement,
    undefined,
    {
      type: "refused",
      reason: "needs_review",
      feedback: "Read fresh evidence without replaying a completed effect."
    },
    changes,
    observation,
    consumed
  )
  return "stepId" in credited ? credited : undefined
}

/** Exact receipt support for compact progress, using the completion judge's rules. */
export const agentWorkflowReceiptSupport = (
  requirement: AgentTaskRequirement,
  item: string | undefined,
  steps: readonly AgentStepReadout[],
  observation: AgentObservation,
  consumed: Set<string>
): AgentStepReadout | undefined => {
  if (requirement.kind !== "change") return undefined
  if (requirement.check)
    return item === undefined
      ? checkedReceiptSupport(
          requirement,
          allChanges(steps),
          observation,
          consumed
        )
      : undefined
  const { items, ...single } = requirement
  const changes = allChanges(steps).filter(
    (receipt) =>
      !item || agentReceiptNamesItem(receipt, item, items ?? [], observation)
  )
  const result = evidencePlannedChange(
    item ? { ...single, text: `${item}: ${single.text}` } : single,
    undefined,
    {
      type: "refused",
      reason: "needs_review",
      feedback: "Read fresh evidence without replaying a completed effect."
    },
    changes,
    observation,
    consumed
  )
  return "stepId" in result ? result : undefined
}
