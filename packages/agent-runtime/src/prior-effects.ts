import {
  AGENT_CONSEQUENTIAL_EFFECTS,
  type AgentConsequentialEffect,
  type AgentPriorEffect,
  type AgentStepStatus,
  MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS,
  MAX_AGENT_PRIOR_EFFECTS,
  MAX_AGENT_ROW_CONTEXT_CHARS
} from "@ollama-client/contracts"
import { agentStepSourceUrl, agentStepTargetFrom } from "./history"
import type {
  AgentStepReadout,
  AgentStepTarget,
  ResolvedAgentEffect
} from "./ports"
import { agentRowContextBeyond } from "./row-context"

const isConsequential = (
  semantic: string
): semantic is AgentConsequentialEffect =>
  (AGENT_CONSEQUENTIAL_EFFECTS as readonly string[]).includes(semantic)

/** What the consequential classes are read from: the effect and its control. */
export type AgentConsequentialSource = Pick<
  ResolvedAgentEffect,
  "semanticEffects"
> & {
  target?: Pick<
    ResolvedAgentEffect["target"],
    "committingLabel" | "savingLabel"
  >
}

/**
 * The classes of an effect a repeat would double; empty for a routine one.
 *
 * A click on a committing-labelled control no form classifies is a
 * `potential_commit`: recorded on its receipt, guarded against repeats and
 * held to the constraints like a submission, because a script button orders
 * or sends as surely as a submitter does. A saving-labelled one is a `save`,
 * guarded against repeats only. The label only ever adds the class.
 */
export const agentConsequentialEffects = (
  effect: AgentConsequentialSource
): AgentConsequentialEffect[] => {
  const classes: AgentConsequentialEffect[] = []
  for (const semantic of effect.semanticEffects)
    if (isConsequential(semantic)) classes.push(semantic)
  if (classes.length > 0) return classes
  if (effect.target?.committingLabel === true) return ["potential_commit"]
  if (effect.target?.savingLabel === true) return ["save"]
  return classes
}

export const agentEffectIsConsequential = (
  effect: AgentConsequentialSource
): boolean => agentConsequentialEffects(effect).length > 0

/**
 * Whether a constraint's forbidden classes rule out an effect class. A
 * possible commit is a submission or a payment the page did not say which,
 * so forbidding either forbids it.
 */
export const agentForbidsEffect = (
  forbids: readonly AgentConsequentialEffect[] | undefined,
  effect: AgentConsequentialEffect
): boolean =>
  forbids !== undefined &&
  (forbids.includes(effect) ||
    (effect === "potential_commit" &&
      (forbids.includes("submission") || forbids.includes("payment"))))

/**
 * Where a consequential effect sent its form, origin and path only — the
 * same reduction a receipt's page gets, so a token in a GET action's query
 * never becomes durable. Only a submission or payment carries one; a delete
 * or a download is the control, not the form around it.
 */
export const agentConsequentialForm = (
  effect: Pick<ResolvedAgentEffect, "semanticEffects" | "target">
): string | undefined => {
  const classes = agentConsequentialEffects(effect)
  if (!classes.some(sendsForm) || !effect.target.formAction) return undefined
  return agentStepSourceUrl(effect.target.formAction)?.slice(
    0,
    MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS
  )
}

const sendsForm = (effect: AgentConsequentialEffect): boolean =>
  effect === "submission" || effect === "payment"

/**
 * A step's last status says whether its effect may have landed. `uncertain`
 * counts: an effect nobody could confirm or rule out is exactly the one a
 * second attempt would double.
 */
const COMMITTED_STATUSES: readonly AgentStepStatus[] = [
  "executed",
  "verified",
  "uncertain"
]

/**
 * Receipts written before `consequential` existed carry only `mutating` and
 * the price policy put on the step. A critical change is the nearest honest
 * reading of those: it over-counts a critical click, which costs a follow-up
 * one refusal, and never under-counts a payment.
 */
const receiptIsConsequential = (step: AgentStepReadout): boolean =>
  step.consequential
    ? step.consequential.length > 0
    : step.mutating === true && step.risk === "critical"

const priorEffect = (step: AgentStepReadout): AgentPriorEffect | undefined => {
  if (!step.command) return undefined
  const target = step.target
  return {
    action: step.command.type,
    ...(step.sourceUrl
      ? { page: step.sourceUrl.slice(0, MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS) }
      : {}),
    ...(step.consequential?.length ? { effects: step.consequential } : {}),
    ...(step.formAction
      ? { form: step.formAction.slice(0, MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS) }
      : {}),
    ...(target?.role ? { role: target.role } : {}),
    ...(target?.tag ? { tag: target.tag } : {}),
    ...(target?.name ? { name: target.name } : {}),
    ...rowOf(target)
  }
}

/** The row beside the control, without the control's own label. */
const rowOf = (target: AgentStepTarget | undefined): { row?: string } => {
  const row = agentRowContextBeyond(target?.name, target?.rowContext)
  return row ? { row: row.slice(0, MAX_AGENT_ROW_CONTEXT_CHARS) } : {}
}

const normalized = (value: string | undefined): string =>
  (value ?? "").replaceAll(/\s+/g, " ").trim().toLowerCase()

/**
 * A submission or payment of the same class sent to the same place, by
 * whatever command. Evidence of a repeat, not proof: a checkout's next step
 * and a page that posts to itself send to one address too, which is why this
 * asks the user rather than refusing.
 */
const sameForm = (a: AgentPriorEffect, b: AgentPriorEffect): boolean =>
  a.form !== undefined &&
  a.form === b.form &&
  (a.effects ?? []).some(
    (effect) => sendsForm(effect) && (b.effects ?? []).includes(effect)
  )

/**
 * A word that changes when the record does rather than naming it: an amount
 * ("$120", "1,250.00", "€9"), a percentage, a time, a quantity with its unit
 * ("10am", "3x", "5kg"). "Balance $120 Due" and "Balance $0 Paid" are one
 * record before and after a payment.
 */
const VOLATILE_WORD =
  /[$€£¥₹%:]|\d[.,]\d|^\d+(?:am|pm|h|hrs?|min|mins|s|d|x|k|kg|g|km|mi|lbs?|pcs?)$/iu

/**
 * The words of a row that name it, in order: an id mixing letters and digits
 * ("INV-001", "A12"), a capital standing alone, the way "Invoice A" and
 * "Invoice B" are told apart, and a bare number only where an id column
 * puts it — first in the row, or marked "#" or "№". Anywhere else a bare
 * number is as likely a balance, a count or a stock level as an id, and the
 * click under test is exactly what changes those. Amounts, percentages and
 * times never count. Case is read off the page's own text, so an article
 * ("a") never names a record; "I" never does.
 */
const identifiers = (row: string): string[] =>
  row
    .replaceAll(/\s+/g, " ")
    .trim()
    .split(" ")
    .flatMap((raw, index) => {
      if (VOLATILE_WORD.test(raw)) return []
      const word = raw.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      const named =
        (/\p{N}/u.test(word) && /\p{L}/u.test(word)) ||
        (/^\p{N}+$/u.test(word) && (index === 0 || /^[#№]/u.test(raw))) ||
        (/^\p{Lu}$/u.test(word) && word !== "I")
      return named ? [word.toLocaleLowerCase()] : []
    })

/**
 * Whether two rows are plainly different records: each leads with an
 * identifier — an id, a marked record number, a lone capital — the two lead
 * with different ones, and they share none at all. "#5 Due" and "#6 Due" are
 * two records; "INV-1 $120 Due" and "INV-1 $0 Paid", or "Balance 120 Due" and
 * "Balance 0 Paid", are one record before and after the click, which is the
 * repeat this guard exists for. A row with no identifier, or no row at all,
 * proves nothing, and the match stays as coarse as it always was.
 *
 * Residual: "Record 5" and "Record 6" name no record by these rules, so the
 * second asks as a repeat — the safe direction. A list that renumbers on
 * change and shows nothing else that names the record reads its moved row
 * as a new one; that repeat still meets policy's own approval for the
 * class, and loses only the repeat notice.
 */
const distinctRows = (a: AgentPriorEffect, b: AgentPriorEffect): boolean => {
  if (!a.row || !b.row) return false
  const left = identifiers(a.row)
  const right = identifiers(b.row)
  if (left.length === 0 || right.length === 0) return false
  if (left[0] === right[0]) return false
  const seen = new Set(right)
  return !left.some((word) => seen.has(word))
}

/**
 * The same command on the same control in the same record: a repeat,
 * refused outright.
 */
const sameControl = (a: AgentPriorEffect, b: AgentPriorEffect): boolean =>
  a.action === b.action &&
  normalized(a.role) === normalized(b.role) &&
  normalized(a.tag) === normalized(b.tag) &&
  normalized(a.name) === normalized(b.name) &&
  (a.page === undefined || b.page === undefined || a.page === b.page) &&
  !distinctRows(a, b)

/**
 * The consequential effects a run committed, in the order it committed them,
 * one per step.
 *
 * Read from the receipts rather than from memory, because the receipts are
 * what a worker restart leaves behind. A step writes several receipts as it
 * moves through its lifecycle: its last one says where it ended, and any of
 * them may be the one that says what it was — a reviewed disposition
 * re-records an uncertain step without the price policy put on it.
 */
export const agentCommittedEffects = (
  steps: readonly AgentStepReadout[]
): AgentPriorEffect[] =>
  mergedSteps(steps).flatMap(({ step, weighty }) => {
    if (!weighty || !COMMITTED_STATUSES.includes(step.status)) return []
    const effect = priorEffect(step)
    return effect ? [effect] : []
  })

/**
 * One entry per step: status from the newest receipt, description from any
 * receipt that has it, and whether any receipt called it consequential.
 */
const mergedSteps = (
  steps: readonly AgentStepReadout[]
): { step: AgentStepReadout; weighty: boolean }[] => {
  const byStep = new Map<string, { step: AgentStepReadout; weighty: boolean }>()
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    const seen = byStep.get(step.stepId)
    byStep.delete(step.stepId)
    byStep.set(step.stepId, {
      step: seen
        ? {
            ...seen.step,
            ...step,
            command: step.command ?? seen.step.command,
            target: step.target ?? seen.step.target,
            sourceUrl: step.sourceUrl ?? seen.step.sourceUrl,
            consequential: step.consequential?.length
              ? step.consequential
              : seen.step.consequential,
            formAction: step.formAction ?? seen.step.formAction
          }
        : step,
      weighty: (seen?.weighty ?? false) || receiptIsConsequential(step)
    })
  }
  return [...byStep.values()]
}

/**
 * What a step's last status proves about its effect, in three answers that
 * must not be collapsed into two.
 *
 * `confirmed` landed and was seen to land. `not_applied` is known not to
 * have reached the page: never approved, refused before execution, or
 * verified negative. `unknown` is everything between — approved and then
 * lost, executed and unverified, or verified ambiguous — and is the one a
 * second attempt could double, so it is never treated as `not_applied`.
 */
export type AgentEffectSettlement = "not_applied" | "unknown" | "confirmed"

export const agentEffectSettlement = (
  status: AgentStepStatus
): AgentEffectSettlement => {
  if (status === "verified") return "confirmed"
  if (status === "planned" || status === "rejected" || status === "failed")
    return "not_applied"
  return "unknown"
}

const SETTLEMENT_WEIGHT: Record<AgentEffectSettlement, number> = {
  not_applied: 0,
  unknown: 1,
  confirmed: 2
}

/**
 * How this run's own earlier attempts at the same consequential effect
 * settled: the strongest answer among them, or undefined when the run never
 * tried it. Same control only. A shared form address is evidence, not proof —
 * a checkout's next step posts to the same place as the one before it — so
 * it is left to policy to ask about, never refused here. A routine effect
 * answers undefined, because repeating a click on a tab is not the kind of
 * thing this guards.
 */
export const agentOwnEffectSettlement = (
  effect: ResolvedAgentEffect,
  steps: readonly AgentStepReadout[]
): AgentEffectSettlement | undefined => {
  if (!agentEffectIsConsequential(effect)) return undefined
  const candidate = candidateFor(effect)
  let strongest: AgentEffectSettlement | undefined
  for (const { step, weighty } of mergedSteps(steps)) {
    if (!weighty) continue
    const prior = priorEffect(step)
    if (!prior) continue
    if (!sameControl(prior, candidate)) continue
    const settlement = agentEffectSettlement(step.status)
    if (
      strongest === undefined ||
      SETTLEMENT_WEIGHT[settlement] > SETTLEMENT_WEIGHT[strongest]
    )
      strongest = settlement
  }
  return strongest
}

/**
 * What a follow-up inherits: everything the chain before it committed, the
 * parent's own inheritance included, deduplicated, newest last. A chain of
 * retries must not forget the payment its first run made because two later
 * runs made none.
 *
 * Undefined when the chain holds more than a follow-up can carry. Nothing is
 * trimmed: the list is what the controller refuses by, and an effect dropped
 * from it is one a follow-up would be free to repeat.
 */
export const agentInheritedEffects = (
  inherited: readonly AgentPriorEffect[],
  committed: readonly AgentPriorEffect[]
): AgentPriorEffect[] | undefined => {
  const kept: AgentPriorEffect[] = []
  for (const effect of [...inherited, ...committed]) {
    const index = kept.findIndex((existing) => sameControl(existing, effect))
    if (index >= 0) kept.splice(index, 1)
    kept.push(effect)
  }
  return kept.length <= MAX_AGENT_PRIOR_EFFECTS ? kept : undefined
}

/** A resolved effect as the prior list describes one, cut to its bounds. */
const candidateFor = (effect: ResolvedAgentEffect): AgentPriorEffect => {
  const target = agentStepTargetFrom(effect.target)
  const page = effect.sourceUrl
    ? agentStepSourceUrl(effect.sourceUrl)
    : undefined
  const form = agentConsequentialForm(effect)
  /** Cut to the receipt's own bounds, or a long label could never match. */
  return {
    action: effect.command.type,
    ...(page ? { page: page.slice(0, MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS) } : {}),
    effects: agentConsequentialEffects(effect),
    ...(form ? { form } : {}),
    ...(target?.role ? { role: target.role.slice(0, 60) } : {}),
    ...(target?.tag ? { tag: target.tag.slice(0, 40) } : {}),
    ...(target?.name ? { name: target.name.slice(0, 120) } : {}),
    ...rowOf(target)
  }
}

/**
 * Whether a resolved effect is one an earlier run already committed: the
 * same command on a control with the same role, tag and name, on the same
 * page when both sides know it. Refused before policy.
 *
 * Deliberately coarse: two submit buttons with the same label on the same
 * page are one control as far as this is concerned, and refusing the second
 * costs a follow-up a look again. Guessing they differ costs a user a second
 * order.
 */
export const agentRepeatsPriorEffect = (
  effect: ResolvedAgentEffect,
  prior: readonly AgentPriorEffect[]
): boolean => {
  if (prior.length === 0 || !agentEffectIsConsequential(effect)) return false
  const candidate = candidateFor(effect)
  return prior.some((existing) => sameControl(existing, candidate))
}

/**
 * Whether a resolved effect sends a form an earlier run already sent, by a
 * different control — Enter in a field after a click on its button, or the
 * next step of a checkout that posts to the same address. The two are not
 * told apart from here, so policy asks the user, says why, and accepts no
 * grant for it.
 */
export const agentRepeatsPriorForm = (
  effect: ResolvedAgentEffect,
  prior: readonly AgentPriorEffect[]
): boolean => {
  if (prior.length === 0 || !agentEffectIsConsequential(effect)) return false
  const candidate = candidateFor(effect)
  return prior.some((existing) => sameForm(existing, candidate))
}

/**
 * Whether the run was already told, by a refusal carrying `feedback`, not to
 * repeat this effect on this control. Read from the refusal receipts, so a
 * worker restart remembers it.
 */
export const agentRepeatWasRefused = (
  effect: ResolvedAgentEffect,
  steps: readonly AgentStepReadout[],
  feedback: string
): boolean => {
  const candidate = candidateFor(effect)
  return steps.some((step) => {
    if (step.status !== "rejected") return false
    const evidence = step.verification?.evidence
    if (!evidence || !("summary" in evidence) || evidence.summary !== feedback)
      return false
    const prior = priorEffect(step)
    return prior !== undefined && sameControl(prior, candidate)
  })
}

/** Commands that press a control, which a repeat can make happen twice. */
const PRESSES = new Set(["click", "double_click", "click_point", "press_key"])

/**
 * Whether a press repeats, on the same page, a control this run pressed and
 * saw confirmed before it first reported the task done.
 *
 * A refused completion means the run's evidence fell short, not that its
 * work did. Measured live: a checkout run stopped at payment as asked, was
 * refused because the review page did not show the address, then went Back
 * and pressed "Continue to payment" twice more to make the page say so —
 * sending the shipping form three times. Nothing marked that button
 * consequential, so no repeat guard saw it. After a claim, a press already
 * confirmed, which moved the run to another page, is not evidence-gathering;
 * reading is. A link that only goes
 * somewhere is exempt, since reopening a page to read it again is exactly
 * what a refused completion asks for. Read from the receipts, so a worker
 * restart keeps it.
 */
export const agentRepeatsBeforeClaim = (
  effect: ResolvedAgentEffect,
  steps: readonly AgentStepReadout[]
): boolean => {
  if (!PRESSES.has(effect.command.type)) return false
  if (
    effect.semanticEffects.length > 0 &&
    effect.semanticEffects.every((kind) => kind === "navigation")
  )
    return false
  const claimedAt = steps
    .filter(
      (step) =>
        step.status === "rejected" &&
        step.verification?.evidence?.kind === "completion"
    )
    .reduce((first, step) => Math.min(first, step.sequence), Infinity)
  if (claimedAt === Infinity) return false
  const firstSeen = new Map<string, number>()
  for (const step of steps)
    firstSeen.set(
      step.stepId,
      Math.min(firstSeen.get(step.stepId) ?? Infinity, step.sequence)
    )
  const candidate = candidateFor(effect)
  if (candidate.page === undefined) return false
  const ordered = mergedSteps(steps)
    .map(({ step }) => step)
    .sort(
      (a, b) =>
        (firstSeen.get(a.stepId) ?? Infinity) -
        (firstSeen.get(b.stepId) ?? Infinity)
    )
  return ordered.some((step, index) => {
    if ((firstSeen.get(step.stepId) ?? Infinity) > claimedAt) return false
    if (
      step.status !== "verified" ||
      step.verification?.outcome !== "confirmed"
    )
      return false
    const prior = priorEffect(step)
    if (
      prior === undefined ||
      prior.page !== candidate.page ||
      !sameControl(prior, candidate)
    )
      return false
    /**
     * Only a press that took the run off its page did work a repeat would
     * redo: the run's next step was somewhere else. "Load more", a tab, a
     * disclosure — presses that leave the run where it was — show more of
     * the page, which is what a refused completion is asking for.
     */
    const next = ordered
      .slice(index + 1)
      .find((later) => later.sourceUrl !== undefined)
    return (
      next?.sourceUrl !== undefined &&
      next.sourceUrl.slice(0, MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS) !== prior.page
    )
  })
}
