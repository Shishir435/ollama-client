import type { ChatMessage } from "@/types"

const CONSEQUENTIAL_RISKS = new Set(["high", "critical"])
/** A call still waiting on approval, or never started, had no effect yet. */
const NOT_EXECUTED = new Set(["pending", "awaiting-confirmation"])

/**
 * Whether the failed turn already ran a tool that changes something outside
 * the conversation. Retrying re-asks the model, which may call it again and
 * repeat the effect, and a call that errored may still have landed — so only a
 * call that provably never started is discounted.
 */
export const hasConsequentialToolEffects = (message: ChatMessage): boolean =>
  (message.metrics?.toolRuns ?? []).some(
    (run) =>
      run.risk !== undefined &&
      CONSEQUENTIAL_RISKS.has(run.risk) &&
      !NOT_EXECUTED.has(run.status)
  )
