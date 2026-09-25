import type { AgentStepRecord } from "@ollama-client/contracts"
import type { DurableAgentStep } from "@/lib/repositories/agent-runs"

/**
 * One receipt per step, merged rather than replaced.
 *
 * A step is appended once per lifecycle change, so a run's receipts
 * outnumber its actions several times over. The panel collapses them to
 * render, history and the completion judge collapse them to reason, and
 * every one of those happens after the array has already had to fit in a
 * snapshot — which a long run's receipts did not, taking the whole panel
 * down with them. Collapsing here bounds the array by the step ceiling
 * itself rather than by a number somebody remembered to raise.
 *
 * What a later receipt does not repeat, an earlier one keeps: the model's
 * `finding` is written once, on the receipt for the decision that made it,
 * and taking the last receipt wholesale dropped it — along with the target
 * and the page it happened on — from the one surface a person reads. This
 * is the rule `latestByStep` already applies in `history.ts`; two copies of
 * it are two places for the panel and the model to disagree about what a
 * step did.
 */
export const latestReceiptPerStep = <
  T extends {
    stepId: string
    sequence: number
    at: number
    command?: unknown
    target?: unknown
    sourceUrl?: unknown
    finding?: unknown
    thinking?: unknown
    verification?: unknown
  }
>(
  steps: readonly T[]
): (T & { startedAt: number })[] => {
  const latest = new Map<string, T & { startedAt: number }>()
  for (const step of [...steps].sort(
    (first, second) => first.sequence - second.sequence
  )) {
    const held = latest.get(step.stepId)
    latest.set(
      step.stepId,
      held
        ? {
            ...held,
            ...step,
            command: step.command ?? held.command,
            target: step.target ?? held.target,
            sourceUrl: step.sourceUrl ?? held.sourceUrl,
            finding: step.finding ?? held.finding,
            thinking: step.thinking ?? held.thinking,
            verification: step.verification ?? held.verification,
            startedAt: held.startedAt
          }
        : { ...step, startedAt: step.at }
    )
  }
  return [...latest.values()].sort(
    (first, second) => first.sequence - second.sequence
  )
}

/**
 * The durable steps as a supervisor reads them: one per step, with when it
 * started, and nothing a receipt keeps for the runtime alone.
 */
export const toAgentStepRecords = (
  steps: readonly DurableAgentStep[]
): AgentStepRecord[] =>
  latestReceiptPerStep(steps).map((step) => ({
    runId: step.runId,
    stepId: step.stepId,
    sequence: step.sequence,
    status: step.status,
    at: step.at,
    startedAt: step.startedAt,
    command: step.command,
    risk: step.risk,
    verification: step.verification,
    target: step.target,
    sourceUrl: step.sourceUrl,
    finding: step.finding,
    thinking: step.thinking,
    telemetry: step.telemetry
  }))
