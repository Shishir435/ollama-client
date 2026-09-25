import { agentStepSourceUrl } from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import { MAX_AGENT_OBSERVATIONS } from "@ollama-client/contracts"
import type {
  AgentGetRunRequest,
  AgentGetRunResult,
  AgentRunCard
} from "@ollama-client/contracts/agent-rpc"
import {
  type DurableAgentStep,
  getAgentRun,
  listAgentSteps
} from "@/lib/repositories/agent-runs"
import { toAgentStepRecords } from "./agent-step-records"

/**
 * Project a run onto what its chat card shows.
 *
 * The outcome travels as counts: the requirement ids are the judge's
 * vocabulary, and a card says "3 of 4 done", not which ids those were.
 */
export const toAgentRunCard = (
  state: AgentRunState,
  receipts: readonly DurableAgentStep[] = []
): AgentRunCard => {
  const records = toAgentStepRecords(receipts).slice(-MAX_AGENT_OBSERVATIONS)
  const pages = new Set(
    records.flatMap((step) => {
      const page = step.sourceUrl && agentStepSourceUrl(step.sourceUrl)
      return page ? [page] : []
    })
  )
  return {
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
    ...(records.length > 0
      ? {
          steps: records.map(
            ({ telemetry: _telemetry, sourceUrl: _sourceUrl, ...step }) => step
          ),
          pages: pages.size
        }
      : {}),
    updatedAt: state.updatedAt
  }
}

/**
 * A row that no longer decodes answers the same as a missing one: the card
 * falls back to the message text either way, and telling the page which of
 * the two it was would only give it a branch with nothing different to do.
 */
export const getAgentRunCard = async (
  request: AgentGetRunRequest
): Promise<AgentGetRunResult> => {
  const run = await getAgentRun(request.runId)
  if (!run?.state) return {}
  /**
   * The steps are the card's detail, not its substance: a receipt that no
   * longer reads costs the list, never the card.
   */
  const steps = await listAgentSteps(request.runId).catch(() => [])
  return { run: toAgentRunCard(run.state, steps) }
}
