import {
  type AgentPriorEffect,
  type AgentStepStatus,
  MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS,
  MAX_AGENT_PRIOR_EFFECTS
} from "@ollama-client/contracts"

import { agentStepSourceUrl, agentStepTargetFrom } from "./history"
import type {
  AgentSemanticEffect,
  AgentStepReadout,
  ResolvedAgentEffect
} from "./ports"

/**
 * The effects that cannot be taken back by doing them again.
 *
 * A second click on a tab or a second value in a field costs nothing; a
 * second submission posts the comment twice, a second payment pays twice, a
 * second delete removes the next row. These are the classes a follow-up must
 * never repeat on the strength of a model's reading of an earlier record.
 */
export const AGENT_CONSEQUENTIAL_EFFECTS: readonly AgentSemanticEffect[] = [
  "submission",
  "destructive",
  "payment",
  "download"
]

export const agentEffectIsConsequential = (
  effect: Pick<ResolvedAgentEffect, "semanticEffects">
): boolean =>
  effect.semanticEffects.some((semantic) =>
    AGENT_CONSEQUENTIAL_EFFECTS.includes(semantic)
  )

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
  step.consequential ?? (step.mutating === true && step.risk === "critical")

const priorEffect = (step: AgentStepReadout): AgentPriorEffect | undefined => {
  if (!step.command) return undefined
  const target = step.target
  return {
    action: step.command.type,
    ...(step.sourceUrl
      ? { page: step.sourceUrl.slice(0, MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS) }
      : {}),
    ...(target?.role ? { role: target.role } : {}),
    ...(target?.tag ? { tag: target.tag } : {}),
    ...(target?.name ? { name: target.name } : {})
  }
}

const normalized = (value: string | undefined): string =>
  (value ?? "").replaceAll(/\s+/g, " ").trim().toLowerCase()

const sameEffect = (a: AgentPriorEffect, b: AgentPriorEffect): boolean =>
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
): AgentPriorEffect[] => {
  const byStep = new Map<string, { step: AgentStepReadout; weighty: boolean }>()
  for (const step of [...steps].sort((a, b) => a.sequence - b.sequence)) {
    const seen = byStep.get(step.stepId)
    byStep.delete(step.stepId)
    byStep.set(step.stepId, {
      /** Status from the newest receipt; description from any that has it. */
      step: seen
        ? {
            ...seen.step,
            ...step,
            command: step.command ?? seen.step.command,
            target: step.target ?? seen.step.target,
            sourceUrl: step.sourceUrl ?? seen.step.sourceUrl
          }
        : step,
      weighty: (seen?.weighty ?? false) || receiptIsConsequential(step)
    })
  }
  return [...byStep.values()].flatMap(({ step, weighty }) => {
    if (!weighty || !COMMITTED_STATUSES.includes(step.status)) return []
    const effect = priorEffect(step)
    return effect ? [effect] : []
  })
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
    const index = kept.findIndex((existing) => sameEffect(existing, effect))
    if (index >= 0) kept.splice(index, 1)
    kept.push(effect)
  }
  return kept.length <= MAX_AGENT_PRIOR_EFFECTS ? kept : undefined
}

/**
 * Whether a resolved effect is one an earlier run already committed.
 *
 * Matched on the command, the control's role, tag and name, and the page
 * when both sides know it. Deliberately coarse: two submit buttons with the
 * same label on the same page are one control as far as this is concerned,
 * and refusing the second costs a follow-up a look again. Guessing they
 * differ costs a user a second order.
 */
export const agentRepeatsPriorEffect = (
  effect: ResolvedAgentEffect,
  prior: readonly AgentPriorEffect[]
): boolean => {
  if (prior.length === 0 || !agentEffectIsConsequential(effect)) return false
  const target = agentStepTargetFrom(effect.target)
  const page = effect.sourceUrl
    ? agentStepSourceUrl(effect.sourceUrl)
    : undefined
  /** Cut to the receipt's own bounds, or a long label could never match. */
  const candidate: AgentPriorEffect = {
    action: effect.command.type,
    ...(page ? { page: page.slice(0, MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS) } : {}),
    ...(target?.role ? { role: target.role.slice(0, 60) } : {}),
    ...(target?.tag ? { tag: target.tag.slice(0, 40) } : {}),
    ...(target?.name ? { name: target.name.slice(0, 120) } : {})
  }
  return prior.some((existing) => sameEffect(existing, candidate))
}
