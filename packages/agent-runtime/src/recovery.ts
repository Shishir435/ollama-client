import {
  type AgentRecoveryState,
  type AgentRecoveryStrategy,
  type AgentRecoveryTrigger,
  MAX_AGENT_RECOVERY_ATTEMPTS
} from "@ollama-client/contracts"

import type { AgentEffectSettlement } from "./prior-effects"

/**
 * Which strategies answer which trigger, cheapest and least presumptuous
 * first. A strategy that cannot help with a trigger is not listed for it:
 * waiting does not fix a command the resolver refused, and nothing but a new
 * look at the page can settle an effect nobody could verify.
 *
 * `unresolved_effect` is evidence-only on purpose. It reads the page again
 * and asks the verifier again; it never chooses a new route, because a route
 * chosen while an effect may have landed is how the effect lands twice.
 */
const STRATEGY_ORDER: Record<
  AgentRecoveryTrigger,
  readonly AgentRecoveryStrategy[]
> = {
  no_progress: [
    "targeted_read",
    "wait_for_condition",
    "request_vision",
    "alternate_route",
    "revise_approach"
  ],
  refused_commands: ["fresh_observation", "targeted_read", "alternate_route"],
  refused_completion: ["targeted_read"],
  stale_snapshot: ["fresh_observation", "wait_for_condition"],
  unresolved_effect: ["fresh_observation"]
}

/**
 * What the next decision is told to do, as this build words it. Templates
 * only, never page text, so it is safe in a prompt and identical for every
 * run that reaches the same strategy.
 *
 * Each one restates that the goal, requirements and constraints are
 * unchanged: a run told to revise its approach is the one most tempted to
 * revise the task into something it can finish.
 */
export const AGENT_RECOVERY_GUIDANCE: Record<AgentRecoveryStrategy, string> = {
  fresh_observation:
    "The page was read again. References from earlier observations are void; ground every command in this observation only.",
  targeted_read:
    "Before acting again, read the part of the page the task depends on: use find, inspect or extract_text for the control or content you need, then act on what that read shows.",
  wait_for_condition:
    "The page may still be loading or changing. Use wait with the condition you expect to become true, then look again before acting.",
  request_vision:
    "The text view has not been enough. Use look to see the page, and act on what is actually visible, such as an overlay covering the control.",
  alternate_route:
    "The route taken so far is not working. Do not repeat the steps that failed; reach the same outcome another way that this page offers, such as a different link, menu, search, or going back.",
  revise_approach:
    "Reconsider how to accomplish the task from the current page. The task, its requirements and its constraints are unchanged; a new approach must still deliver every requirement and respect every constraint."
}

/** Told to the model when a recovering run reaches for an effect it already applied. */
export const AGENT_RECOVERY_REPEAT_FEEDBACK: Record<
  Exclude<AgentEffectSettlement, "not_applied">,
  string
> = {
  confirmed:
    "This run already did this and it was confirmed. It is not done twice. Choose a different step, complete if the goal is met, or ask_user.",
  unknown:
    "This run already attempted this and it is not known whether it took effect. It is not attempted again. Read the page for evidence of the result, complete if the goal is met, or ask_user."
}

export interface AgentRecoveryStart {
  trigger: AgentRecoveryTrigger
  now: number
  /** Whether the run may picture this page at all; `request_vision` is skipped when it may not. */
  visionAvailable: boolean
  evidenceStep?: number
}

export type AgentRecoveryPlan =
  | {
      type: "recover"
      recovery: AgentRecoveryState
      strategy: AgentRecoveryStrategy
    }
  | {
      type: "exhausted"
      /** Strategies the run spent, all episodes together. */
      attempts: number
      tried: readonly AgentRecoveryStrategy[]
    }

/**
 * The next strategy for a run that has stopped making headway, or the
 * finding that it has none left.
 *
 * An episode keeps its tried list across triggers: a run that stopped
 * progressing and then had its commands refused is still in the same trouble,
 * and starting the list over would offer it the strategy that already failed.
 * The run-wide `attempts` count never goes down, here or anywhere else.
 */
export const planAgentRecovery = (
  current: AgentRecoveryState | undefined,
  start: AgentRecoveryStart
): AgentRecoveryPlan => {
  const attempts = current?.attempts ?? 0
  const tried = current?.active?.tried ?? []
  const exhausted = { type: "exhausted" as const, attempts, tried }
  if (attempts >= MAX_AGENT_RECOVERY_ATTEMPTS) return exhausted
  const strategy = STRATEGY_ORDER[start.trigger].find(
    (candidate) =>
      !tried.includes(candidate) &&
      (candidate !== "request_vision" || start.visionAvailable)
  )
  if (!strategy) return exhausted
  return {
    type: "recover",
    strategy,
    recovery: {
      attempts: attempts + 1,
      active: {
        trigger: start.trigger,
        strategy,
        tried: [...tried, strategy],
        startedAt: current?.active?.startedAt ?? start.now,
        ...(start.evidenceStep !== undefined
          ? { evidenceStep: start.evidenceStep }
          : {})
      }
    }
  }
}

/** The same accounting with the episode closed; the spent count stays. */
export const settledAgentRecovery = (
  current: AgentRecoveryState | undefined
): AgentRecoveryState | undefined =>
  current?.active ? { attempts: current.attempts } : current
