import type {
  AgentPriorEffect,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import type { AgentStepReadout, ResolvedAgentEffect } from "./ports"
import {
  agentEffectControl,
  agentEffectIsConsequential,
  agentEffectSettlement,
  agentMergedEffectSteps,
  agentReceiptControl,
  agentSameControl
} from "./prior-effects"
import { agentRowRecords } from "./row-context"

/**
 * How many acts a requirement that states `times` has had, counted from the
 * run's own receipts bound to its id whose consequential effect may have
 * landed. Approved, executing, executed, verified and uncertain all count,
 * because a second attempt at an effect nobody could rule out is the
 * duplicate this exists to stop; a step refused, failed or verified negative
 * never reached the page and does not. A cart addition buys nothing and is
 * never an act.
 *
 * `times` bounds how often the same control is acted on, by the identity the
 * same-control repeat guard uses (`agentSameControl`): a checkout's shipping
 * submit and its Place order are two controls, and so are a Delete and the
 * Confirm or dialog accept that finishes it. Each control is counted on its
 * own, and a requirement's count is its largest group. The cost is that a
 * second act through another control — Enter in a field after its button —
 * is not counted against the first.
 */
export interface AgentRequirementCount {
  /** The largest group of counted acts on one control, whichever item. */
  applied: number
  /** For each item, by position, the largest such group naming it; empty without items. */
  perItem: number[]
  /**
   * For each item, the largest group naming it or naming no item at all. A
   * rowless control on a record's own page names no item by its receipt, so
   * a shortfall is judged by this and never by `perItem` alone.
   */
  creditable: number[]
  /** The newest step of the largest group, named to the model in a refusal. */
  lastStepId?: string
}

/**
 * Whether a receipt acted on one item of its requirement. The completion
 * judge's own rule is passed in by the caller; without it, the receipt's row
 * naming the item is the whole answer.
 */
export type AgentReceiptItemMatcher = (
  step: AgentStepReadout,
  item: string,
  items: readonly string[]
) => boolean

const rowNamesItem: AgentReceiptItemMatcher = (step, item) =>
  agentRowRecords(step.target, [item]).length > 0

interface CountedAct {
  step: AgentStepReadout
  /** Undefined for a receipt with no command, which matches every control. */
  control?: AgentPriorEffect
}

const sameAct = (
  a: AgentPriorEffect | undefined,
  b: AgentPriorEffect | undefined
): boolean => a === undefined || b === undefined || agentSameControl(a, b)

/** Every landed, consequential, non-cart act bound to the requirement. */
const countedActs = (
  requirement: AgentTaskRequirement,
  steps: readonly AgentStepReadout[]
): CountedAct[] =>
  agentMergedEffectSteps(steps).flatMap(({ step, weighty }) =>
    weighty &&
    step.requirementId === requirement.id &&
    step.cartAddition !== true &&
    agentEffectSettlement(step.status) !== "not_applied"
      ? [{ step, control: agentReceiptControl(step) }]
      : []
  )

const largestGroup = (
  acts: readonly CountedAct[]
): { size: number; lastStepId?: string } => {
  let best: { size: number; lastStepId?: string } = { size: 0 }
  for (const act of acts) {
    const group = acts.filter((other) => sameAct(act.control, other.control))
    if (group.length > best.size)
      best = { size: group.length, lastStepId: group.at(-1)?.step.stepId }
  }
  return best
}

const namesNoItem = (
  step: AgentStepReadout,
  items: readonly string[],
  namesItem: AgentReceiptItemMatcher
): boolean => !items.some((item) => namesItem(step, item, items))

export const agentRequirementCount = (
  requirement: AgentTaskRequirement,
  steps: readonly AgentStepReadout[],
  namesItem: AgentReceiptItemMatcher = rowNamesItem
): AgentRequirementCount => {
  const items = requirement.items ?? []
  const acts = countedActs(requirement, steps)
  const whole = largestGroup(acts)
  return {
    applied: whole.size,
    perItem: items.map(
      (item) =>
        largestGroup(acts.filter((act) => namesItem(act.step, item, items)))
          .size
    ),
    creditable: items.map(
      (item) =>
        largestGroup(
          acts.filter(
            (act) =>
              namesItem(act.step, item, items) ||
              namesNoItem(act.step, items, namesItem)
          )
        ).size
    ),
    ...(whole.lastStepId ? { lastStepId: whole.lastStepId } : {})
  }
}

/**
 * Whether the stated count bears on this act at all: a consequential act,
 * other than a cart addition, bound to a change requirement that states
 * `times`. Everything else runs as it would with no count.
 */
export const agentCountsAct = (
  effect: ResolvedAgentEffect,
  requirement: AgentTaskRequirement | undefined
): requirement is AgentTaskRequirement & { times: number } =>
  requirement?.times !== undefined &&
  requirement.kind === "change" &&
  agentEffectIsConsequential(effect) &&
  effect.target.cartLabel !== true

/** Where an act names one item, or nowhere: its row, else its own page. */
const actItem = (
  effect: ResolvedAgentEffect,
  items: readonly string[],
  onPageOf?: (item: string) => boolean
): number => {
  const inRow = items.findIndex(
    (item) => agentRowRecords(effect.target, [item]).length > 0
  )
  if (inRow >= 0 || !onPageOf) return inRow
  return items.findIndex((item) => onPageOf(item))
}

/**
 * The requirement an act would take past its stated `times`, before policy
 * is asked, counting only this run's acts on the same control. Without
 * items, `times` such acts refuse the next. With items, an act whose row or
 * page names one is checked against the same-control acts naming that item
 * or naming none — a same-control act that names no item cannot be told
 * apart from one on it — and any act against the whole budget of `times`
 * per item. Undefined when the count does not bear on the act.
 */
export const agentExceedsExpectedCount = (
  effect: ResolvedAgentEffect,
  requirement: AgentTaskRequirement | undefined,
  steps: readonly AgentStepReadout[],
  namesItem: AgentReceiptItemMatcher = rowNamesItem,
  onPageOf?: (item: string) => boolean
): (AgentRequirementCount & { times: number; item?: string }) | undefined => {
  if (!agentCountsAct(effect, requirement)) return undefined
  const { times } = requirement
  const candidate = agentEffectControl(effect)
  const acts = countedActs(requirement, steps).filter((act) =>
    sameAct(act.control, candidate)
  )
  const items = requirement.items ?? []
  const refusal = (
    counted: readonly CountedAct[],
    item?: string
  ): AgentRequirementCount & { times: number; item?: string } => ({
    applied: counted.length,
    perItem: [],
    creditable: [],
    times,
    ...(counted.at(-1) ? { lastStepId: counted.at(-1)?.step.stepId } : {}),
    ...(item ? { item } : {})
  })
  if (acts.length >= times * Math.max(1, items.length)) return refusal(acts)
  const named = actItem(effect, items, onPageOf)
  if (named < 0) return undefined
  const item = items[named]
  const forItem = acts.filter(
    (act) =>
      namesItem(act.step, item, items) ||
      namesNoItem(act.step, items, namesItem)
  )
  return forItem.length >= times ? refusal(forItem, item) : undefined
}

/**
 * Whether the user's stated count still permits repeating this exact act,
 * so the same-control repeat guards must not refuse it or ask about it: a
 * count of two or more, not yet reached on this control, and every earlier
 * landed act on the same control bound to this requirement. A same-control
 * act bound elsewhere is a repeat the count says nothing about, and leaves
 * the guards as they are.
 */
export const agentCountPermitsRepeat = (
  effect: ResolvedAgentEffect,
  requirement: AgentTaskRequirement | undefined,
  steps: readonly AgentStepReadout[],
  namesItem?: AgentReceiptItemMatcher,
  onPageOf?: (item: string) => boolean
): boolean => {
  if (!agentCountsAct(effect, requirement) || requirement.times < 2)
    return false
  if (
    agentExceedsExpectedCount(effect, requirement, steps, namesItem, onPageOf)
  )
    return false
  const candidate = agentEffectControl(effect)
  return agentMergedEffectSteps(steps).every(({ step, weighty }) => {
    if (!weighty || agentEffectSettlement(step.status) === "not_applied")
      return true
    const control = agentReceiptControl(step)
    if (control && !agentSameControl(control, candidate)) return true
    return step.requirementId === requirement.id && step.cartAddition !== true
  })
}

/** Told to the model when an act would go past its outcome's stated count. */
export const agentExpectedCountRefusal = (
  requirementId: string,
  exceeded: NonNullable<ReturnType<typeof agentExceedsExpectedCount>>
): string => {
  const { times, item, lastStepId, applied } = exceeded
  return `${requirementId} asks for its act ${times} time${times === 1 ? "" : "s"}${item ? ` for "${item}"` : ""}, and this run's receipts already count ${applied} on this control${lastStepId ? ` (last: ${lastStepId})` : ""}. Doing it again would repeat it, so it was not attempted. If the earlier act did not take effect, say so with ask_user; otherwise complete and report what was done.`
}

/**
 * Told to the model when the receipts a stated count is read from could not
 * be read: the act may already have landed that many times, and a
 * consequential effect whose earlier execution is uncertain is never
 * replayed.
 */
export const agentExpectedCountUnreadable = (requirementId: string): string =>
  `${requirementId} states how many times its act happens, and this run's receipts could not be read to count them, so this act was not attempted. Read the page for whether it already happened; if you cannot tell, say so with ask_user.`
