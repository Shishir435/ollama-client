import {
  AGENT_CONSEQUENTIAL_EFFECTS,
  type AgentConsequentialEffect,
  type AgentPriorEffect,
  type AgentStepStatus,
  MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS,
  MAX_AGENT_PRIOR_EFFECTS
} from "@ollama-client/contracts"

import { agentStepSourceUrl, agentStepTargetFrom } from "./history"
import type { AgentStepReadout, ResolvedAgentEffect } from "./ports"

const isConsequential = (
  semantic: string
): semantic is AgentConsequentialEffect =>
  (AGENT_CONSEQUENTIAL_EFFECTS as readonly string[]).includes(semantic)

/** The classes of an effect a repeat would double; empty for a routine one. */
export const agentConsequentialEffects = (
  effect: Pick<ResolvedAgentEffect, "semanticEffects">
): AgentConsequentialEffect[] => effect.semanticEffects.filter(isConsequential)

export const agentEffectIsConsequential = (
  effect: Pick<ResolvedAgentEffect, "semanticEffects">
): boolean => agentConsequentialEffects(effect).length > 0

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
    ...(target?.name ? { name: target.name } : {})
  }
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

/** The same command on the same control: a repeat, refused outright. */
const sameControl = (a: AgentPriorEffect, b: AgentPriorEffect): boolean =>
  a.action === b.action &&
  normalized(a.role) === normalized(b.role) &&
  normalized(a.tag) === normalized(b.tag) &&
  normalized(a.name) === normalized(b.name) &&
  (a.page === undefined || b.page === undefined || a.page === b.page)

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
 * tried it. Same control or same form, as a follow-up is judged. A routine
 * effect answers undefined, because repeating a click on a tab is not the
 * kind of thing this guards.
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
    if (!sameControl(prior, candidate) && !sameForm(prior, candidate)) continue
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
    ...(target?.name ? { name: target.name.slice(0, 120) } : {})
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
