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
  if (receipt.requirementId !== undefined)
    return receipt.requirementId === requirement.id
  const name = receipt.target?.name
  if (name === undefined) return false
  const want = agentNormalizedClaim(name)
  const text = agentNormalizedClaim(requirement.text)
  return (
    want.length > 0 && text.length > 0 && containsCompletePhrase(text, want)
  )
}

const CLAIM_WORD_CHARACTER = /[\p{L}\p{N}_]/u

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
const ON_WORDS = `check|checked|tick|ticked|select|selected|${ON}`
const OFF_WORDS = `uncheck|unchecked|untick|unticked|deselect|deselected|clear|cleared|${OFF}`

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
  if (NEGATED_ON_PATTERN.test(text)) return true
  const unnegated = text
    .replace(NEGATED_ON_PATTERN_GLOBAL, " ")
    .replace(NEGATED_OFF_PATTERN_GLOBAL, " ")
  return CHECKED_OFF_PATTERN.test(unnegated)
}

const requirementAssertsOn = (text: string): boolean => {
  if (NEGATED_OFF_PATTERN.test(text)) return true
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
    if (command.type === "check") return !requirementAssertsOff(text)
    return !requirementAssertsOn(text)
  }
  if (kind === "field" && command?.type === "select" && command.value) {
    return valueAssertedWithoutNegation(text, command.value)
  }
  if (
    kind === "field" &&
    (command?.type === "type" ||
      command?.type === "clear_and_type" ||
      command?.type === "replace_text") &&
    command.text
  ) {
    return valueAssertedWithoutNegation(text, command.text)
  }
  return true
}

/** A confirmed batch can evidence each control it checked, once per field. */
const matchingBatchField = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout,
  observation: AgentObservation,
  consumed: Set<string>
): number | undefined => {
  if (
    receipt.command?.type !== "fill_form" ||
    receipt.verification?.outcome !== "confirmed" ||
    receipt.verification.evidence.kind !== "fields"
  )
    return undefined
  const names = receipt.verification.evidence.fields
  if (!names || names.length !== receipt.command.fields.length) return undefined
  const text = agentNormalizedClaim(requirement.text)
  return receipt.command.fields.findIndex((field, index) => {
    const key = `${receipt.stepId}:field:${index}`
    if (consumed.has(key)) return false
    const name = names[index]?.name
    if (!name || !containsCompletePhrase(text, agentNormalizedClaim(name)))
      return false
    const matches = observation.elements.filter(
      (element) =>
        !element.sensitive &&
        agentNormalizedClaim(element.name ?? "") === agentNormalizedClaim(name)
    )
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
    (name.match(/[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu) ?? [])
      .map(compactFieldWord)
      .filter((word) => word.length >= 3 && !FIELD_NAME_FILLER.has(word))
  )
  if (words.size === 0) return []
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu)].flatMap(
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
 * One met `read` requirement. A read owes no quotation, but one it
 * volunteers must still be real: an accepted completion carrying a phrase
 * the page does not contain is a false record whichever kind of outcome it
 * was attached to.
 */
const refusePlannedReadClaim = (
  evidence: string | undefined,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable" | undefined
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined =>
  evidence
    ? judgeEvidence(evidence, input, change ?? "unreadable", false)
    : undefined

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
        receipt.consequential?.includes("submission")
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
   * result-verified receipt it names exactly, by its control or its value:
   * typing "Alice" and submitting leaves no "Alice" on the next page, and
   * the receipt that confirmed the field held it is the evidence instead.
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
    absent
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
            quotationNamesReceiptValue(quoted, candidate))
    )
    if (receipt) {
      consumed.add(receipt.stepId)
      return receipt
    }
    const focused = changes.find(
      (candidate) =>
        !consumed.has(candidate.stepId) &&
        quoted !== undefined &&
        isBoundFocusMove(requirement, candidate) &&
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
 * A confirmed key press the model sent for this requirement, which the
 * verifier saw move focus. Moving focus from First to Second adds no words:
 * "Second" was on the page before, so the staleness rule refused it, and
 * the run asked the user what to do about a task it had finished.
 */
const isBoundFocusMove = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout
): boolean =>
  receipt.requirementId === requirement.id &&
  receipt.command?.type === "press_key" &&
  receipt.verification?.outcome === "confirmed" &&
  receipt.verification.evidence.kind === "keyboard"

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
 */
const SUBMITTING_REQUIREMENT_PATTERN =
  /\b(?:submit|submits|submitted|click|clicks|clicked|press|presses|pressed|continue|continued|send|sent|search|searched)\b/

/**
 * A requirement claiming what the page shows afterwards. "Search results for
 * Alice are displayed" says search, but it claims results appeared, which a
 * sent form does not prove.
 */
const RESULT_STATE_REQUIREMENT_PATTERN =
  /\b(?:results?|displayed|display|displays|shown|shows|show|appear|appears|appeared|visible|listed|lists|loaded|loads|saved|created|updated|returned|returns|opened|opens)\b/

/**
 * A second clause after the act: "Search for Alice and read the first hit"
 * claims the hit was read, in words no result list could name. A
 * requirement the submission can meet is the act alone, so anything joined
 * to it is an outcome the sent form does not prove.
 */
const FURTHER_CLAIM_PATTERN =
  /[,;:]|\b(?:and|then|to|so|until|after|before|while|once|when|where|which|that|if|showing|finding|reading|opening|open|read|find|get|check|verify|confirm|see|view|report)\b/

/**
 * Whether the requirement claims only the act of sending: an imperative
 * that begins with it ("Search for Alice", "Click Continue"), or a
 * statement that ends with it ("Continue has been clicked").
 */
const SUBMISSION_ACT_PATTERN = new RegExp(
  `^(?:please )?${SUBMITTING_REQUIREMENT_PATTERN.source}|${SUBMITTING_REQUIREMENT_PATTERN.source}$`
)

const claimsOnlySubmission = (requirement: AgentTaskRequirement): boolean => {
  const text = agentNormalizedClaim(requirement.text).replace(/[.!]+$/u, "")
  return (
    SUBMISSION_ACT_PATTERN.test(text) &&
    !FURTHER_CLAIM_PATTERN.test(text) &&
    !RESULT_STATE_REQUIREMENT_PATTERN.test(text)
  )
}

const isBoundSubmission = (
  requirement: AgentTaskRequirement,
  receipt: AgentStepReadout
): boolean =>
  receipt.requirementId === requirement.id &&
  /**
   * The verifier confirmed the form was sent, not what sending it achieved:
   * it evidences "Continue has been clicked", never "the address is saved".
   */
  claimsOnlySubmission(requirement) &&
  receipt.verification?.outcome === "confirmed" &&
  receipt.verification.evidence.kind === "submission"

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

const MISSING_EVIDENCE_FEEDBACK =
  "This run changed the page, so complete needs evidence: a short phrase that is visible on the page now and shows the goal is met, such as a saved-state indicator or the new value itself. Observe the page and complete again with evidence, or keep working."

const ABSENT_EVIDENCE_FEEDBACK =
  "The evidence string does not occur on the current page. Copy ONLY an exact phrase from observation text or an element value into evidence, without explanation or quotation marks. For an edit use the changed words themselves. Do not quote history or verifier commentary. If the result has not appeared, wait for it."

const UNVERIFIED_CHANGE_FEEDBACK =
  "The last change this run made was not confirmed, so the goal cannot be reported as met. Observe the page and check the change took effect — wait for a saved-state indicator — before completing."

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
const judgeMetRequirement = (
  requirement: AgentTaskRequirement,
  claim: AgentCompletionOutcomeClaim,
  input: AgentCompletionInput,
  change: AgentStepReadout | "unreadable" | undefined,
  changes: readonly AgentStepReadout[],
  consumed: Set<string>
): Extract<AgentCompletionJudgement, { type: "refused" }> | undefined => {
  if (requirement.kind === "read")
    return refusePlannedReadClaim(claim.evidence, input, change ?? "unreadable")
  if (NO_SUBMISSION_MENTION_PATTERN.test(requirement.text)) {
    const refusal = noSubmissionEvidence(input)
    if (refusal) return refusal
    if (NO_SUBMISSION_ONLY_PATTERN.test(requirement.text.trim()))
      return undefined
  }
  const refusal = judgeEvidence(claim.evidence, input, change ?? "unreadable")
  if (!refusal) return undefined
  const evidenced = evidencePlannedChange(
    requirement,
    claim.evidence?.trim() || undefined,
    refusal,
    changes,
    input.observation,
    consumed
  )
  return "stepId" in evidenced ? undefined : evidenced
}

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
  for (const requirement of requirements) {
    const claim = claims.get(requirement.id)
    if (!claim?.met) {
      unmet.push(requirement.id)
      continue
    }
    const refusal = judgeMetRequirement(
      requirement,
      claim,
      input,
      change,
      changes,
      consumed
    )
    if (refusal) return refusal
    met.push(requirement.id)
  }
  const outcome = { met, unmet }
  if (unmet.length === 0) return { type: "accepted", outcome }
  return met.length === 0
    ? { type: "unmet", outcome }
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
