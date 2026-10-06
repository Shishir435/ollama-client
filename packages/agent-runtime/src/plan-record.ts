import type {
  AgentAnswer,
  AgentConsequentialEffect,
  AgentPlanRecord,
  AgentRunState,
  AgentTaskConstraint,
  AgentTaskPlan,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { MAX_AGENT_PLAN_AMENDMENTS } from "@ollama-client/contracts"

import type { AgentStatePatch, ResolvedAgentEffect } from "./ports"
import { agentConsequentialEffects } from "./prior-effects"

const idNumber = (id: string, prefix: "r" | "c"): number => {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(id)
  return match ? Number(match[1]) : 0
}

const highest = (
  entries: readonly { id: string }[],
  prefix: "r" | "c"
): number => Math.max(0, ...entries.map((entry) => idNumber(entry.id, prefix)))

/** The newest user answer's time, or undefined when the user has said nothing. */
export const agentNewestAnswerAt = (
  answers: readonly AgentAnswer[] | undefined
): number | undefined =>
  answers?.length
    ? Math.max(...answers.map((answer) => answer.answeredAt))
    : undefined

/**
 * The patch that fixes a run's first plan. A provisional capacity-removal
 * plan leaves the goal and answers outstanding and carries a confirmation
 * question; a complete initial plan reconciles every answer given so far.
 */
export const agentInitialPlanPatch = (
  state: Pick<AgentRunState, "answers"> & Partial<Pick<AgentRunState, "id">>,
  plan: AgentTaskPlan,
  now = 0
): AgentStatePatch => {
  const patch: AgentStatePatch = {
    requirements: plan.requirements,
    ...(plan.constraints?.length ? { constraints: plan.constraints } : {}),
    plan: {
      version: 1,
      issued: {
        requirements: highest(plan.requirements, "r"),
        constraints: highest(plan.constraints ?? [], "c")
      },
      ...(plan.provisional
        ? {}
        : { reconciledThrough: agentNewestAnswerAt(state.answers) ?? 0 })
    }
  }
  return plan.proposedRemovals?.length
    ? {
        ...patch,
        ...agentAmendedPlanPatch(
          { ...patch, id: state.id ?? "initial" },
          plan,
          agentNewestAnswerAt(state.answers) ?? 0,
          now
        )
      }
    : patch
}

/** Whether the user has said something the plan has not been checked against. */
export const agentPlanNeedsReconciling = (
  state: Pick<AgentRunState, "plan" | "requirements">,
  answers: readonly AgentAnswer[] | undefined
): number | undefined => {
  if (!state.plan || !state.requirements?.length) return undefined
  const newest = agentNewestAnswerAt(answers)
  if (newest === undefined) return undefined
  return newest > (state.plan.reconciledThrough ?? -1) ? newest : undefined
}

const sameRequirement = (
  left: AgentTaskRequirement,
  right: AgentTaskRequirement
): boolean =>
  left.text === right.text &&
  left.kind === right.kind &&
  JSON.stringify(left.check) === JSON.stringify(right.check) &&
  JSON.stringify(left.items ?? []) === JSON.stringify(right.items ?? [])

const sameConstraint = (
  left: AgentTaskConstraint,
  right: AgentTaskConstraint
): boolean =>
  left.text === right.text &&
  left.kind === right.kind &&
  JSON.stringify([...(left.forbids ?? [])].sort()) ===
    JSON.stringify([...(right.forbids ?? [])].sort())

/**
 * A plan the user's answer may have amended, folded into the run.
 *
 * A new version is written only when something changed: an answer like "the
 * work account" usually amends nothing, and a version per answer would make
 * the version say nothing. Either way the answer is marked reconciled, so it
 * is not sent to the planner a second time. Ids are never renumbered — a kept
 * entry keeps its id, a new one takes the next number, and a removed one's
 * number is never issued again — because receipts already bound to an id
 * must keep meaning the outcome they were bound to.
 */
export const agentAmendedPlanPatch = (
  state: Pick<AgentRunState, "id" | "plan" | "requirements" | "constraints">,
  plan: AgentTaskPlan,
  answeredAt: number,
  now: number
): AgentStatePatch => {
  const patch = amendedPlanChanges(state, plan, answeredAt, now)
  /**
   * Removals ride along as a question, never as a change: the plan keeps
   * every entry, and the user's answer to this question — and no other —
   * decides whether any of it goes.
   */
  if (!plan.proposedRemovals?.length || !patch.plan) return patch
  /**
   * Lifting a prohibition is asked on its own. Other removals proposed with
   * it are let go — a dropped removal keeps work, which the planner may
   * propose again — rather than folded into a yes that means two things.
   */
  const constraints = plan.constraints ?? state.constraints ?? []
  const lifts = plan.proposedRemovals.filter(
    (removal) =>
      !removal.item &&
      constraints.some(
        (constraint) =>
          constraint.id === removal.id && constraint.forbids?.length
      )
  )
  return {
    ...patch,
    plan: {
      ...patch.plan,
      pending: {
        questionId: `${state.id}:removal:${now}`,
        ...(plan.provisional ? { provisional: true as const } : {}),
        ...(lifts.length > 0
          ? { removals: lifts, lift: true as const }
          : { removals: plan.proposedRemovals })
      }
    }
  }
}

const amendedPlanChanges = (
  state: Pick<AgentRunState, "plan" | "requirements" | "constraints">,
  plan: AgentTaskPlan,
  answeredAt: number,
  now: number
): AgentStatePatch => {
  const record = state.plan as AgentPlanRecord
  /**
   * A provisional amendment applies the limits it found and leaves the
   * answer outstanding: the planner still has to read it for outcomes.
   */
  const through = plan.provisional ? record.reconciledThrough : answeredAt
  const reconciledThrough =
    through === undefined ? {} : { reconciledThrough: through }
  const reconciled = { plan: { ...record, ...reconciledThrough } }
  if (!plan.requirements.length) return reconciled
  const before = [
    ...(state.requirements ?? []).map((entry) => entry.id),
    ...(state.constraints ?? []).map((entry) => entry.id)
  ]
  const constraints = plan.constraints ?? []
  const after = [
    ...plan.requirements.map((entry) => entry.id),
    ...constraints.map((entry) => entry.id)
  ]
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  const changed =
    added.length > 0 ||
    removed.length > 0 ||
    plan.requirements.some((requirement) => {
      const prior = state.requirements?.find(
        (entry) => entry.id === requirement.id
      )
      return prior !== undefined && !sameRequirement(prior, requirement)
    }) ||
    constraints.some((constraint) => {
      const prior = state.constraints?.find(
        (entry) => entry.id === constraint.id
      )
      return prior !== undefined && !sameConstraint(prior, constraint)
    })
  if (!changed) return reconciled
  const version = record.version + 1
  const priorSince = new Map(
    [...(state.requirements ?? []), ...(state.constraints ?? [])].map(
      (entry) => [entry.id, entry.since] as const
    )
  )
  /** A kept entry keeps the version it was introduced in, however reworded. */
  const stamp = <T extends { id: string; since?: number }>(entry: T): T => {
    if (added.includes(entry.id)) return { ...entry, since: version }
    const since = priorSince.get(entry.id)
    if (since === undefined) {
      const { since: _dropped, ...rest } = entry
      return rest as T
    }
    return { ...entry, since }
  }
  return {
    requirements: plan.requirements.map(stamp),
    constraints: constraints.map(stamp),
    plan: {
      version,
      issued: {
        requirements: Math.max(
          record.issued.requirements,
          highest(plan.requirements, "r")
        ),
        constraints: Math.max(
          record.issued.constraints,
          highest(constraints, "c")
        )
      },
      ...reconciledThrough,
      amendments: [
        ...(record.amendments ?? []),
        { version, answeredAt, added, removed, at: now }
      ].slice(-MAX_AGENT_PLAN_AMENDMENTS)
    }
  }
}

const YES =
  /^(?:yes|y|yeah|yep|yup|ok|okay|sure|confirm|confirmed|correct|right|go ahead|do it|please do|remove it|remove them|drop it|drop them|ja|sí|oui|हाँ|sì|はい|да|是)(?: please)?$/
/** The one word that lifts a prohibition: what it allows, said outright. */
const ALLOW =
  /^(?:allow|allow it|allow them|yes allow|yes allow it|yes allow them)$/

const NO =
  /^(?:no|n|nope|nah|keep it|keep them|cancel|dont|do not|leave it|leave them|nein|non|नहीं|いいえ|нет|否)(?: please)?$/

/** An answer, reduced to the words a yes or no is written in. */
const confirmationWords = (text: string): string =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()

/**
 * The user's answer to a removal question, applied.
 *
 * Only a plain yes removes anything; a plain no keeps everything. Anything
 * else also keeps everything — a sentence is not a yes — and is left
 * unreconciled, so the planner reads it like any other answer. A removal
 * applied on a reading of an answer is how work the user asked for went
 * missing; one applied on a yes to a question naming it cannot.
 */
export const agentConfirmedRemovalPatch = (
  state: Pick<AgentRunState, "plan" | "requirements" | "constraints">,
  answer: string,
  answeredAt: number,
  now: number
): AgentStatePatch => {
  const record = state.plan as AgentPlanRecord
  const removals = record.pending?.removals ?? []
  const { pending: _pending, ...rest } = record
  const words = confirmationWords(answer)
  const confirmed = record.pending?.lift ? ALLOW.test(words) : YES.test(words)
  const plain = confirmed || NO.test(words) || YES.test(words)
  const settled = {
    ...rest,
    ...(plain && !record.pending?.provisional
      ? { reconciledThrough: answeredAt }
      : {})
  }
  if (!confirmed || removals.length === 0) return { plan: settled }
  const whole = new Set(
    removals.filter((removal) => !removal.item).map((removal) => removal.id)
  )
  const itemsOf = (id: string) =>
    new Set(
      removals
        .filter((removal) => removal.id === id && removal.item)
        .map((removal) => removal.item as string)
    )
  const removedItems: { id: string; item: string }[] = []
  const requirements = (state.requirements ?? []).flatMap((requirement) => {
    if (whole.has(requirement.id)) return []
    const gone = itemsOf(requirement.id)
    if (gone.size === 0 || !requirement.items) return [requirement]
    const items = requirement.items.filter((item) => !gone.has(item))
    for (const item of requirement.items)
      if (gone.has(item)) removedItems.push({ id: requirement.id, item })
    /** An outcome over no items asks for nothing, so it goes with them. */
    if (items.length === 0) {
      whole.add(requirement.id)
      return []
    }
    return [{ ...requirement, items }]
  })
  const constraints = (state.constraints ?? []).filter(
    (constraint) => !whole.has(constraint.id)
  )
  /** Nothing may remove the last outcome: that is a stop, not a plan. */
  if (requirements.length === 0) return { plan: settled }
  const version = record.version + 1
  return {
    requirements,
    constraints,
    plan: {
      ...settled,
      version,
      amendments: [
        ...(record.amendments ?? []),
        {
          version,
          answeredAt,
          added: [],
          removed: [...whole],
          ...(removedItems.length > 0 ? { removedItems } : {}),
          at: now
        }
      ].slice(-MAX_AGENT_PLAN_AMENDMENTS)
    }
  }
}

/**
 * The constraints a resolved effect would break, by the effect classes the
 * user's own words ruled out. Read from the effect the resolver grounded,
 * never from the command's wording, so a "Save" button that posts the form
 * is the submission it is.
 */
export const agentForbiddingConstraints = (
  effect: Pick<ResolvedAgentEffect, "semanticEffects">,
  constraints: readonly AgentTaskConstraint[] | undefined
): {
  constraint: AgentTaskConstraint
  effects: AgentConsequentialEffect[]
}[] => {
  if (!constraints?.length) return []
  const classes = agentConsequentialEffects(effect)
  if (classes.length === 0) return []
  return constraints.flatMap((constraint) => {
    const effects = classes.filter((effect) =>
      constraint.forbids?.includes(effect)
    )
    return effects.length > 0 ? [{ constraint, effects }] : []
  })
}

/** Told to the model when a constraint refuses a command. Nothing page-written. */
export const agentConstraintRefusal = (
  broken: ReturnType<typeof agentForbiddingConstraints>
): string =>
  `This step would be a ${[...new Set(broken.flatMap((entry) => entry.effects))].join(" and ")}, which the user ruled out (${broken
    .map((entry) => `${entry.constraint.id}: "${entry.constraint.text}"`)
    .join(
      "; "
    )}). It was not attempted. Choose a different step, complete with what is done, or ask_user.`
