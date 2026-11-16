import type { AgentTaskRequirement } from "@ollama-client/contracts"
import type { AgentStepReadout, ResolvedAgentEffect } from "./ports"
import {
  agentEffectIsConsequential,
  agentEffectSettlement,
  agentMergedEffectSteps
} from "./prior-effects"
import { agentRowRecords } from "./row-context"

/**
 * How many acts a requirement that states `times` has had, counted from the
 * run's own receipts: one per step bound to its id whose consequential
 * effect may have landed. Approved, executing, executed, verified and
 * uncertain all count, because a second attempt at an effect nobody could
 * rule out is the duplicate this exists to stop; a step refused, failed or
 * verified negative never reached the page and does not.
 *
 * Two receipts are not acts of their own: a cart addition, which buys
 * nothing, and the accept of a confirmation dialog whose opener was the
 * counted act just before it, which is the second half of that act. The
 * opener's dialog id is held in memory only, so the pairing is by order.
 */
export interface AgentRequirementCount {
  /** Every counted act, whichever item it named. */
  applied: number
  /** Counted acts naming each item, by position; empty without items. */
  perItem: number[]
  /** The newest counted step, named to the model in a refusal. */
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

const isDialogAccept = (step: Pick<AgentStepReadout, "command">): boolean =>
  step.command?.type === "handle_dialog" && step.command.accept

const counts = (
  step: AgentStepReadout,
  weighty: boolean,
  requirement: AgentTaskRequirement
): boolean =>
  weighty &&
  step.requirementId === requirement.id &&
  step.cartAddition !== true &&
  agentEffectSettlement(step.status) !== "not_applied"

export const agentRequirementCount = (
  requirement: AgentTaskRequirement,
  steps: readonly AgentStepReadout[],
  namesItem: AgentReceiptItemMatcher = rowNamesItem
): AgentRequirementCount => {
  const items = requirement.items ?? []
  const firstSeen = new Map<string, number>()
  for (const step of steps)
    firstSeen.set(
      step.stepId,
      Math.min(firstSeen.get(step.stepId) ?? Infinity, step.sequence)
    )
  const ordered = agentMergedEffectSteps(steps).sort(
    (a, b) =>
      (firstSeen.get(a.step.stepId) ?? 0) - (firstSeen.get(b.step.stepId) ?? 0)
  )
  const result: AgentRequirementCount = {
    applied: 0,
    perItem: items.map(() => 0)
  }
  let previousCounted = false
  for (const { step, weighty } of ordered) {
    const landed = agentEffectSettlement(step.status) !== "not_applied"
    /** A read between an opener and its dialog does not separate them. */
    if (!landed || (step.mutating === false && !weighty)) continue
    const counted: boolean =
      counts(step, weighty, requirement) &&
      !(isDialogAccept(step) && previousCounted)
    previousCounted = counted
    if (!counted) continue
    result.applied += 1
    result.lastStepId = step.stepId
    items.forEach((item, index) => {
      if (namesItem(step, item, items)) result.perItem[index] += 1
    })
  }
  return result
}

/**
 * The requirement an act would take past its stated `times`, before policy
 * is asked: with items, the item the control's row names, or the whole
 * budget of `times` per item when it names none. A dialog accept right after
 * the counted act it confirms, and a cart addition, are never refused here.
 * Undefined when the requirement states no count, which is today's run.
 */
export const agentExceedsExpectedCount = (
  effect: ResolvedAgentEffect,
  requirement: AgentTaskRequirement | undefined,
  steps: readonly AgentStepReadout[],
  namesItem?: AgentReceiptItemMatcher
): (AgentRequirementCount & { times: number; item?: string }) | undefined => {
  const times = requirement?.times
  if (!requirement || times === undefined || requirement.kind !== "change")
    return undefined
  if (!agentEffectIsConsequential(effect) || effect.target.cartLabel === true)
    return undefined
  const counted = agentRequirementCount(requirement, steps, namesItem)
  if (effect.command.type === "handle_dialog" && effect.command.accept) {
    const ordered = agentMergedEffectSteps(steps)
      .map(({ step, weighty }) => ({ step, weighty }))
      .filter(
        ({ step, weighty }) =>
          agentEffectSettlement(step.status) !== "not_applied" &&
          (step.mutating !== false || weighty)
      )
      .sort((a, b) => a.step.sequence - b.step.sequence)
    const last = ordered.at(-1)
    if (
      last &&
      counts(last.step, last.weighty, requirement) &&
      !isDialogAccept(last.step)
    )
      return undefined
  }
  const items = requirement.items ?? []
  if (items.length === 0)
    return counted.applied >= times ? { ...counted, times } : undefined
  if (counted.applied >= times * items.length) return { ...counted, times }
  const named = items.findIndex(
    (item) => agentRowRecords(effect.target, [item]).length > 0
  )
  if (named >= 0 && counted.perItem[named] >= times)
    return { ...counted, times, item: items[named] }
  return undefined
}

/** Told to the model when an act would go past its outcome's stated count. */
export const agentExpectedCountRefusal = (
  requirementId: string,
  exceeded: NonNullable<ReturnType<typeof agentExceedsExpectedCount>>
): string => {
  const { times, item, lastStepId } = exceeded
  return `${requirementId} asks for its act ${times} time${times === 1 ? "" : "s"}${item ? ` for "${item}"` : ""}, and this run's receipts already count ${item ? `${times} or more for it` : exceeded.applied}${lastStepId ? ` (last: ${lastStepId})` : ""}. Doing it again would repeat it, so it was not attempted. If the earlier act did not take effect, say so with ask_user; otherwise complete and report what was done.`
}
