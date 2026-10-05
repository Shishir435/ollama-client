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
 * The patch that fixes a run's first plan. Every answer the user had given by
 * then went into it, so they are all reconciled.
 */
export const agentInitialPlanPatch = (
  state: Pick<AgentRunState, "answers">,
  plan: AgentTaskPlan
): AgentStatePatch => ({
  requirements: plan.requirements,
  ...(plan.constraints?.length ? { constraints: plan.constraints } : {}),
  plan: {
    version: 1,
    issued: {
      requirements: highest(plan.requirements, "r"),
      constraints: highest(plan.constraints ?? [], "c")
    },
    reconciledThrough: agentNewestAnswerAt(state.answers) ?? 0
  }
})

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
  state: Pick<AgentRunState, "plan" | "requirements" | "constraints">,
  plan: AgentTaskPlan,
  answeredAt: number,
  now: number
): AgentStatePatch => {
  const record = state.plan as AgentPlanRecord
  const reconciled = { plan: { ...record, reconciledThrough: answeredAt } }
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
      reconciledThrough: answeredAt,
      amendments: [
        ...(record.amendments ?? []),
        { version, answeredAt, added, removed, at: now }
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
