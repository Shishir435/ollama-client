import type { AgentRunState } from "@ollama-client/contracts"
import type {
  AgentGetRunRequest,
  AgentGetRunResult,
  AgentRunCard
} from "@ollama-client/contracts/agent-rpc"

import { getAgentRun } from "@/lib/repositories/agent-runs"

/**
 * Project a run onto what its chat card shows.
 *
 * The outcome travels as counts: the requirement ids are the judge's
 * vocabulary, and a card says "3 of 4 done", not which ids those were.
 */
export const toAgentRunCard = (state: AgentRunState): AgentRunCard => ({
  id: state.id,
  goal: state.goal,
  status: state.status,
  ...(state.pauseReason ? { pauseReason: state.pauseReason } : {}),
  stepCount: state.stepCount,
  ...(state.result ? { result: state.result } : {}),
  ...(state.error
    ? {
        error: {
          code: state.error.code,
          ...(state.error.messageKey
            ? { messageKey: state.error.messageKey }
            : {})
        }
      }
    : {}),
  ...(state.outcome
    ? {
        outcome: {
          met: state.outcome.met.length,
          total: state.outcome.met.length + state.outcome.unmet.length
        }
      }
    : {}),
  updatedAt: state.updatedAt
})

/**
 * A row that no longer decodes answers the same as a missing one: the card
 * falls back to the message text either way, and telling the page which of
 * the two it was would only give it a branch with nothing different to do.
 */
export const getAgentRunCard = async (
  request: AgentGetRunRequest
): Promise<AgentGetRunResult> => {
  const run = await getAgentRun(request.runId)
  return run?.state ? { run: toAgentRunCard(run.state) } : {}
}
