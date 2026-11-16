import type {
  AgentAnswer,
  AgentConsequentialEffect,
  AgentOptionHold,
  AgentPlanRecord,
  AgentRunState,
  AgentTaskConstraint,
  AgentTaskPlan,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { MAX_AGENT_PLAN_AMENDMENTS } from "@ollama-client/contracts"
import type { AgentStatePatch } from "./ports"
import {
  type AgentConsequentialSource,
  agentConsequentialEffects,
  agentForbidsEffect
} from "./prior-effects"
import { agentRowRecords } from "./row-context"
import {
  agentMonetaryConstraint,
  agentPriceLimitHolds
} from "./transaction-terms"

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
  /** A read's ordering and freshness obligations are part of what it owes. */
  left.freshness === right.freshness &&
  left.beforeChanges === right.beforeChanges &&
  JSON.stringify(left.requires ?? []) ===
    JSON.stringify(right.requires ?? []) &&
  JSON.stringify(left.check) === JSON.stringify(right.check) &&
  JSON.stringify(left.items ?? []) === JSON.stringify(right.items ?? []) &&
  left.times === right.times

const sameSet = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean =>
  JSON.stringify([...(left ?? [])].sort()) ===
  JSON.stringify([...(right ?? [])].sort())

/**
 * Which classes are the planner's own (`inferred`) and which requirements a
 * constraint was narrowed for decide what a held check may lift: an answer
 * that makes a class the user's changes the constraint, even in the same
 * words, and must be saved as an amendment.
 */
const sameConstraint = (
  left: AgentTaskConstraint,
  right: AgentTaskConstraint
): boolean =>
  left.text === right.text &&
  left.kind === right.kind &&
  sameSet(left.forbids, right.forbids) &&
  sameSet(left.inferred, right.inferred) &&
  sameSet(left.narrowedFor, right.narrowedFor) &&
  JSON.stringify(left.about) === JSON.stringify(right.about)

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
  if (record.pending?.conflict)
    return agentConfirmedConflictPatch(state, answer, answeredAt, now)
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
  // Only the user's confirmed removal can release a retained dependency.
  for (const [index, requirement] of requirements.entries()) {
    if (!requirement.requires?.some((id) => whole.has(id))) continue
    const requires = requirement.requires.filter((id) => !whole.has(id))
    const { requires: _requires, ...rest } = requirement
    requirements[index] = { ...rest, ...(requires.length ? { requires } : {}) }
  }
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
 * The user's answer to a conflict question, applied: a constraint kept
 * refusing the act a change requirement asks for, and only "allow" changes
 * it. The planner's own classes that refused the act are dropped; a class
 * the rule read from the user's words is never dropped, and its constraint
 * is narrowed to other records instead, so the requested record's own act
 * is let through only where the runtime proves the record. Anything but
 * "allow" keeps the constraint as it was and is read by the planner like
 * any other answer.
 */
const agentConfirmedConflictPatch = (
  state: Pick<AgentRunState, "plan" | "constraints">,
  answer: string,
  answeredAt: number,
  now: number
): AgentStatePatch => {
  const record = state.plan as AgentPlanRecord
  const pending = record.pending
  const { pending: _pending, ...rest } = record
  const allowed = ALLOW.test(confirmationWords(answer))
  const constraintId = pending?.removals[0]?.id
  const constraint = state.constraints?.find(
    (entry) => entry.id === constraintId
  )
  if (!allowed || !pending?.conflict || !constraint) return { plan: rest }
  const blocked = pending.conflict.effects
  const dropped = (constraint.inferred ?? []).filter((effect) =>
    blocked.some(
      (refused) =>
        refused === effect ||
        (refused === "potential_commit" &&
          (effect === "submission" || effect === "payment"))
    )
  )
  const forbids = (constraint.forbids ?? []).filter(
    (effect) => !dropped.includes(effect)
  )
  const inferred = (constraint.inferred ?? []).filter(
    (effect) => !dropped.includes(effect)
  )
  const userWorded = forbids.filter(
    (effect) =>
      !inferred.includes(effect) &&
      blocked.some(
        (refused) =>
          refused === effect ||
          (refused === "potential_commit" &&
            (effect === "submission" || effect === "payment"))
      )
  )
  const {
    forbids: _forbids,
    inferred: _inferred,
    about: _about,
    narrowedFor: _narrowedFor,
    ...base
  } = constraint
  const narrowedFor = [
    ...new Set([
      ...(constraint.narrowedFor ?? []),
      ...(userWorded.length > 0 ? [pending.conflict.requirementId] : [])
    ])
  ]
  const narrowed: AgentTaskConstraint = {
    ...base,
    ...(forbids.length ? { forbids } : {}),
    ...(inferred.length ? { inferred } : {}),
    ...(narrowedFor.length > 0
      ? { about: { type: "other_records" as const }, narrowedFor }
      : constraint.about
        ? { about: constraint.about }
        : {})
  }
  const version = record.version + 1
  return {
    constraints: (state.constraints ?? []).map((entry) =>
      entry.id === constraint.id ? narrowed : entry
    ),
    plan: {
      ...rest,
      reconciledThrough: answeredAt,
      version,
      amendments: [
        ...(record.amendments ?? []),
        {
          version,
          answeredAt,
          added: [],
          removed: [],
          narrowed: [constraint.id],
          at: now
        }
      ].slice(-MAX_AGENT_PLAN_AMENDMENTS)
    }
  }
}

/**
 * What the guard reads off the current observation for a constraint's
 * `about` check. Supplied by the controller, which holds the observation;
 * absent, no check can pass and nothing is lifted.
 */
export interface AgentConstraintObservation {
  /** Whether the one control the hold names holds its stated state. */
  option?: (hold: AgentOptionHold) => AgentOptionHoldState
  /** Whether the page the control sits on is this record's own page. */
  pageOfRecord?: (record: string) => boolean
}

/**
 * `absent` covers a control that is missing, ambiguous or unreadable: none
 * of them is a hold, and none of them is proof that the state is wrong.
 */
export type AgentOptionHoldState = "holds" | "differs" | "absent"

const HOLD_CHECKS = new Set(["field", "checked", "selected"])

/**
 * The control state a constraint is checked by: its own option hold, or,
 * when it states no target at all, the check of the one sibling change
 * requirement planned from the very same quoted words. "Don't add travel
 * insurance" planned as both an exclusion and an unticked Travel insurance
 * box is one instruction; the comparison is string equality of two plan
 * fields, never a reading of either.
 */
export const agentConstraintHold = (
  constraint: AgentTaskConstraint,
  plan: readonly AgentTaskRequirement[] | undefined
): AgentOptionHold | undefined => {
  if (constraint.about?.type === "option") return constraint.about.hold
  if (constraint.about !== undefined || constraint.source === undefined)
    return undefined
  const siblings = (plan ?? []).filter(
    (requirement) =>
      requirement.kind === "change" &&
      requirement.source === constraint.source &&
      requirement.check !== undefined &&
      HOLD_CHECKS.has(requirement.check.type)
  )
  if (siblings.length !== 1) return undefined
  const check = siblings[0].check
  /** A record-scoped or frame-scoped check is not one control on any page. */
  if (!check || ("record" in check && check.record)) return undefined
  if ("frameId" in check && check.frameId !== undefined) return undefined
  if (check.type === "checked")
    return { type: "checked", name: check.name, checked: check.checked }
  if (check.type === "field" || check.type === "selected")
    return { type: check.type, name: check.name, value: check.value }
  return undefined
}

/**
 * Whether the step's control is proven to act on its own requirement's
 * record: its row names exactly one of them and no other planned record,
 * or, for a control in no row, the page is exactly one of their own pages.
 */
const ownRecordProven = (
  target: { rowContext?: string } | undefined,
  records: readonly string[],
  plan: readonly AgentTaskRequirement[] | undefined,
  observed: AgentConstraintObservation | undefined
): boolean => {
  if (records.length === 0) return false
  const others = [
    ...new Set((plan ?? []).flatMap(agentRequirementRecords))
  ].filter((record) => !records.includes(record))
  if (target?.rowContext)
    return (
      agentRowRecords(target, records).length === 1 &&
      agentRowRecords(target, others).length === 0
    )
  const pageOf = observed?.pageOfRecord
  if (!pageOf) return false
  return (
    records.filter((record) => pageOf(record)).length === 1 &&
    !others.some((record) => pageOf(record))
  )
}

/**
 * Whether a constraint's `about` check passed for this step, on what the
 * runtime observed. `effect` and `answer` name no check, so they never pass.
 */
export const agentConstraintHeld = (
  constraint: AgentTaskConstraint,
  step: {
    target?: { rowContext?: string }
    records: readonly string[]
    plan?: readonly AgentTaskRequirement[]
    observed?: AgentConstraintObservation
  }
): boolean => {
  if (constraint.about?.type === "other_records")
    return ownRecordProven(step.target, step.records, step.plan, step.observed)
  const hold = agentConstraintHold(constraint, step.plan)
  return hold !== undefined && step.observed?.option?.(hold) === "holds"
}

/**
 * The classes a constraint still forbids for a step. Only the planner's own
 * classes may be lifted, and only when the step's check held; a class read
 * from the user's own words stays, unless the user's "allow" narrowed the
 * constraint for this step's own requirement and its record is proven.
 */
export const agentBindingClasses = (
  constraint: AgentTaskConstraint,
  held: boolean,
  requirementId?: string
): AgentConsequentialEffect[] | undefined => {
  if (!held || !constraint.forbids) return constraint.forbids
  const liftable =
    requirementId !== undefined &&
    constraint.narrowedFor?.includes(requirementId)
      ? constraint.forbids
      : constraint.inferred
  const binding = constraint.forbids.filter(
    (effect) => !liftable?.includes(effect)
  )
  return binding.length ? binding : undefined
}

/**
 * The ids of the constraints whose check passed for this step: the receipt
 * records them, so completion can settle a constraint every act held.
 */
export const agentHeldConstraints = (
  constraints: readonly AgentTaskConstraint[] | undefined,
  step: Parameters<typeof agentConstraintHeld>[1]
): string[] =>
  (constraints ?? []).flatMap((constraint) =>
    constraint.about !== undefined || agentConstraintHold(constraint, step.plan)
      ? agentConstraintHeld(constraint, step)
        ? [constraint.id]
        : []
      : []
  )

/**
 * An option constraint whose control is on the page in the wrong state when
 * a commit is about to happen: "Book flight" while Travel insurance is
 * ticked. Refused, naming the control and the state it needs, which the
 * model can put right. A control that is absent or ambiguous is not
 * checked here; it simply proves nothing.
 */
export const agentOptionHoldBroken = (
  effect: AgentConsequentialSource,
  constraints: readonly AgentTaskConstraint[] | undefined,
  observed: AgentConstraintObservation | undefined
): { constraint: AgentTaskConstraint; hold: AgentOptionHold } | undefined => {
  const classes = agentConsequentialEffects(effect).filter(
    (effect) => effect !== "save"
  )
  if (classes.length === 0 || !observed?.option) return undefined
  for (const constraint of constraints ?? []) {
    if (constraint.about?.type !== "option") continue
    if (observed.option(constraint.about.hold) === "differs")
      return { constraint, hold: constraint.about.hold }
  }
  return undefined
}

/** Told to the model when an option constraint's control is in the wrong state. */
export const agentOptionHoldRefusal = (
  broken: NonNullable<ReturnType<typeof agentOptionHoldBroken>>
): string => {
  const { constraint, hold } = broken
  const state =
    hold.type === "checked"
      ? hold.checked
        ? "checked"
        : "unchecked"
      : `set to "${hold.value}"`
  return `This commit would happen while "${hold.name}" is not ${state}, which ${constraint.id} ("${constraint.text}") needs. It was not attempted. Put "${hold.name}" ${state} first, then commit; do not commit with it in the other state.`
}

/**
 * The constraints a resolved effect would break, by the effect classes the
 * user's own words ruled out. Read from the effect the resolver grounded,
 * never from the command's wording, so a "Save" button that posts the form
 * is the submission it is.
 */
export const agentForbiddingConstraints = (
  effect: AgentConsequentialSource & {
    target?: Pick<
      import("./ports").ResolvedAgentTarget,
      "rowContext" | "cartLabel" | "offerScope" | "accessibleName"
    >
  },
  constraints: readonly AgentTaskConstraint[] | undefined,
  /**
   * The records the step's own requirement names. A scope bound is proven
   * for a step whose control sits in a row naming exactly one of them.
   */
  records: readonly string[] = [],
  /** The step's own requirement, which may be the purchase a cart serves. */
  requirement?: AgentTaskRequirement,
  /** The whole plan, read for the purchase when the step names no requirement. */
  plan?: readonly AgentTaskRequirement[],
  /** The record the runtime's comparison selected; see `agentPriceLimitHolds`. */
  selected?: string,
  /** What a constraint's `about` check reads; absent, nothing is lifted. */
  observed?: AgentConstraintObservation
): {
  constraint: AgentTaskConstraint
  effects: AgentConsequentialEffect[]
  /**
   * Whether a forbidden class refused it, rather than only a bound the step
   * could not prove: the conflict a question can settle.
   */
  byClass: boolean
}[] => {
  if (!constraints?.length) return []
  const classes = agentConsequentialEffects(effect)
  if (classes.length === 0) return []
  /**
   * Adding to a cart for a requirement that asks to buy is that purchase's
   * own first step: "buy the kettle, go only as far as payment, don't pay"
   * was refused at Add to cart six times. It never pays or places anything,
   * so only a limit naming possible commits outright still forbids it, and
   * no scope bound waits on a row for it. Without such a requirement — "don't
   * buy anything" on a run that reads — it stays the possible commit it is.
   */
  const purchaseCart =
    effect.target?.cartLabel === true &&
    agentCartServesPurchase(requirement, plan)
  const withinScope = agentRowRecords(effect.target, records).length === 1
  return constraints.flatMap((constraint) => {
    /**
     * A scope limit ("keep every other invoice") is proven only by the row
     * the control sits in naming the one record the step's requirement is
     * about — what the runtime read off the page, not what the model says it
     * is clicking. Without that it stays unproven, and an amount limit on a
     * payment needs current control-bound offer terms. A model's assertion cannot
     * authorize irreversible work within either.
     */
    /**
     * An exclusion that names no effect class says what to leave alone, not
     * what not to do: "keep every other invoice" came back from the planner
     * as `exclude` as often as `scope`, and as `exclude` it bound nothing —
     * a run told to delete Invoice B deleted Invoice B-2 under it. On a step
     * about a record it needs the same proof a scope does.
     */
    const leavesOthers =
      constraint.kind === "exclude" &&
      !constraint.forbids?.length &&
      records.length > 0
    /**
     * Only a step bound to a change the user asked for may have a class
     * lifted: a read, or no requirement at all, needs no consequential act.
     */
    const held =
      requirement?.kind === "change" &&
      agentConstraintHeld(constraint, {
        target: effect.target,
        records,
        plan,
        observed
      })
    const binding = agentBindingClasses(constraint, held, requirement?.id)
    /**
     * A bound on other records is also proven for a control in no row when
     * the page is its own record's page; that is a runtime reading too. An
     * option hold never proves it: a wrong `about` on a "leave the rest
     * alone" exclusion must not let a rowless act on another record through.
     */
    const proven =
      withinScope || ownRecordProven(effect.target, records, plan, observed)
    const unprovenBound =
      ((constraint.kind === "scope" || leavesOthers) && !proven) ||
      (constraint.kind === "limit" &&
        (classes.includes("payment") ||
          (agentMonetaryConstraint(constraint) &&
            classes.some(
              (effect) =>
                effect === "potential_commit" || effect === "submission"
            ))) &&
        !agentPriceLimitHolds(constraint, effect.target, requirement, selected))
    /**
     * A save is only ever recorded to catch its own repeat; it was a routine
     * click before it had a class, and a bound it has no record identity for
     * must not start refusing it now.
     */
    const cartCommit = (effect: AgentConsequentialEffect): boolean =>
      purchaseCart && effect === "potential_commit"
    const forbidden = (effect: AgentConsequentialEffect): boolean =>
      cartCommit(effect)
        ? binding?.includes("potential_commit") === true
        : agentForbidsEffect(binding, effect)
    const effects = classes.filter((effect) =>
      cartCommit(effect)
        ? forbidden(effect)
        : (unprovenBound && effect !== "save") || forbidden(effect)
    )
    return effects.length > 0
      ? [{ constraint, effects, byClass: effects.some(forbidden) }]
      : []
  })
}

/** A change that asks to buy, order or fill a cart, in the user's words. */
const BUYING_WORDS =
  /\b(?:buy|buys|buying|purchase|purchases|purchasing|checkout|check out)\b|^\s*order(?:s|ing)?\s+(?!(?:note|notes|history|status|details|number|form|page|summary)\b)\S+|\border(?:s|ing)?\s+(?:the|a|an|my|some|\d+)\s+\S+|\b(?:add|fill|put|load)\b(?:\s+\S+){0,5}?\s+(?:to|into|in|with)?\s*(?:the\s+|my\s+)?(?:cart|basket|bag|trolley|order)\b/i

/**
 * Whether a cart addition is a purchase's own first step. A step that names
 * its requirement answers by that requirement; one that names none, or one
 * the plan does not hold, is read against the plan, since the model leaving
 * a tag off does not turn the cart it fills into a payment.
 */
export const agentCartServesPurchase = (
  requirement: AgentTaskRequirement | undefined,
  plan: readonly AgentTaskRequirement[] | undefined
): boolean =>
  requirement !== undefined
    ? agentAsksToBuy(requirement)
    : (plan ?? []).some(agentAsksToBuy)

export const agentAsksToBuy = (
  requirement: AgentTaskRequirement | undefined
): boolean =>
  requirement?.kind === "change" &&
  (BUYING_WORDS.test(requirement.text) ||
    (requirement.source !== undefined && BUYING_WORDS.test(requirement.source)))

/**
 * Told to the model when a constraint refuses a command. Nothing
 * page-written. It names the step's requirement, so two refusals of the
 * same constraints against the same requirement read back from the receipts
 * as the same text: the second becomes a question instead.
 */
export const agentConstraintRefusal = (
  broken: ReturnType<typeof agentForbiddingConstraints>,
  requirementId?: string
): string =>
  `This step${requirementId ? ` for ${requirementId}` : ""} would be a ${[...new Set(broken.flatMap((entry) => entry.effects))].join(" and ")}, whose user constraint cannot be safely established (${broken
    .map((entry) => `${entry.constraint.id}: "${entry.constraint.text}"`)
    .join(
      "; "
    )}). It was not attempted. Choose a different step, complete with what is done, or ask_user.${broken.some(({ constraint }) => agentMonetaryConstraint(constraint)) ? " A monetary cap needs current offer terms bound to this control, in the same unit and with the requested quantity. Do not retry the same control without changed evidence; ask_user or take_over if the terms cannot be established." : ""}`

/**
 * The records a requirement is about: its items, and the record its check
 * names. Empty when it names none, which proves nothing about any row.
 */
export const agentRequirementRecords = (
  requirement: AgentTaskRequirement | undefined
): string[] => {
  if (!requirement) return []
  const check = requirement.check
  const record = check && "record" in check ? check.record : undefined
  return [
    ...new Set([...(requirement.items ?? []), ...(record ? [record] : [])])
  ]
}

/**
 * A step bound to one record whose control sits in another record's row.
 * The row is the page's own text around the control; the other record is
 * one the plan itself names, so a row merely failing to repeat the record's
 * exact wording is never refused — only a row naming a different planned
 * record and not this one. That is the "Mark paid" on Invoice A's row for a
 * step about Invoice B.
 */
export const agentWrongRowRecord = (
  target: { rowContext?: string } | undefined,
  requirement: AgentTaskRequirement | undefined,
  requirements: readonly AgentTaskRequirement[] | undefined
): string | undefined => {
  const own = agentRequirementRecords(requirement)
  if (!own.length || !target?.rowContext) return undefined
  if (agentRowRecords(target, own).length) return undefined
  const others = (requirements ?? [])
    .flatMap(agentRequirementRecords)
    .filter((record) => !own.includes(record))
  return agentRowRecords(target, others)[0]
}

/**
 * A "leave the rest alone" constraint a step would break by acting in a row
 * that names none of its own records. The row is the page's text around the
 * control, so it is the record the control belongs to whatever the model
 * believes it is clicking: a run told to mark Record 2 and Record 5 paid and
 * keep every other record clicked Record 4's "Mark Paid" seven times, because
 * no other requirement named Record 4 and the button's label carries no
 * effect class for an exclusion to forbid.
 */
export const agentRowOutsideScope = (
  target: { rowContext?: string } | undefined,
  requirement: AgentTaskRequirement | undefined,
  constraints: readonly AgentTaskConstraint[] | undefined
): AgentTaskConstraint | undefined => {
  const own = agentRequirementRecords(requirement)
  if (!own.length || !target?.rowContext) return undefined
  if (agentRowRecords(target, own).length) return undefined
  return constraints?.find(
    (constraint) =>
      constraint.kind === "scope" ||
      (constraint.kind === "exclude" && !constraint.forbids?.length)
  )
}
