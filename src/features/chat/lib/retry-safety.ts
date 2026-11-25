import { READ_ONLY_TOOL_NAMES } from "@/lib/tools/read-only-tool-names"
import type { ChatMessage } from "@/types"

/** A call still waiting on approval, or never started, had no effect yet. */
const NOT_EXECUTED = new Set(["pending", "awaiting-confirmation"])

/**
 * Whether the failed turn already ran a tool that may have changed something
 * outside the conversation. Retrying re-asks the model, which may call it
 * again and repeat the effect, and a call that errored may still have landed —
 * so only a call that provably never started (still waiting, or declined at
 * the approval prompt) is discounted. Only tools known to be read-only are
 * exempt; an unknown tool or one with no declared risk counts as having an
 * effect.
 */
export const hasConsequentialToolEffects = (message: ChatMessage): boolean =>
  (message.metrics?.toolRuns ?? []).some(
    (run) =>
      !NOT_EXECUTED.has(run.status) &&
      run.declined !== true &&
      !READ_ONLY_TOOL_NAMES.has(run.toolId)
  )
