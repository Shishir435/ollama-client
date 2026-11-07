import {
  agentStepSourceUrl,
  isTerminalAgentStatus
} from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import {
  agentRequirementTier,
  MAX_AGENT_OBSERVATION_CEILING
} from "@ollama-client/contracts"
import type {
  AgentGetRunRequest,
  AgentGetRunResult,
  AgentRunCard
} from "@ollama-client/contracts/agent-rpc"
import { browser } from "@/lib/browser-api"
import {
  type DurableAgentStep,
  getAgentRun,
  listAgentSteps
} from "@/lib/repositories/agent-runs"
import { normalizeGrantOrigin } from "@/lib/tools/approval/approval-policy"
import { toAgentStepRecords } from "./agent-step-records"

/** A requirement's grade once the run settled, when its judge graded. */
const cardTier = (
  state: AgentRunState,
  id: string
): { tier?: ReturnType<typeof agentRequirementTier> & string } => {
  if (!state.outcome || !isTerminalAgentStatus(state.status)) return {}
  const tier = agentRequirementTier(state.outcome, id)
  return tier ? { tier } : {}
}

/**
 * Project a run onto what its chat card shows.
 *
 * The outcome travels as counts for the summary line, and the contract
 * beside it lists each outcome with its grade: "3 of 4 done" says how much,
 * and only the list says which of the three were checked.
 */
export const toAgentRunCard = (
  state: AgentRunState,
  receipts: readonly DurableAgentStep[] = []
): AgentRunCard => {
  const records = toAgentStepRecords(receipts).slice(
    -MAX_AGENT_OBSERVATION_CEILING
  )
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
            total: state.outcome.met.length + state.outcome.unmet.length,
            ...(state.outcome.visual?.length
              ? { visual: state.outcome.visual.length }
              : {})
          }
        }
      : {}),
    ...(state.requirements?.length
      ? {
          contract: {
            requirements: state.requirements.map((requirement) => ({
              id: requirement.id,
              text: requirement.text,
              ...cardTier(state, requirement.id),
              ...(requirement.origin ? { origin: requirement.origin } : {})
            })),
            constraints: (state.constraints ?? []).map((constraint) => ({
              id: constraint.id,
              text: constraint.text,
              ...(constraint.origin ? { origin: constraint.origin } : {})
            }))
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
  request: AgentGetRunRequest,
  lookupTab: (tabId: number) => Promise<{ url?: string } | undefined> = (
    tabId
  ) => browser.tabs.get(tabId)
): Promise<AgentGetRunResult> => {
  const run = await getAgentRun(request.runId)
  if (!run?.state) return {}
  /**
   * The steps are the card's detail, not its substance: a receipt that no
   * longer reads costs the list, never the card.
   */
  const steps = await listAgentSteps(request.runId).catch(() => [])
  const tabId = await openRunTab(run.state, lookupTab)
  return {
    run: {
      ...toAgentRunCard(run.state, steps),
      ...(tabId !== undefined
        ? { tabId, tabOrigins: run.state.allowedOrigins }
        : {})
    }
  }
}

/**
 * The run's tab, while it is still open on a site the run was allowed on.
 * A tab id is the browser's session counter, reused after a restart, so an
 * old card must not bring an unrelated page forward.
 */
const openRunTab = async (
  state: AgentRunState,
  lookupTab: (tabId: number) => Promise<{ url?: string } | undefined>
): Promise<number | undefined> => {
  try {
    const tab = await lookupTab(state.controlledTabId)
    const origin = normalizeGrantOrigin(tab?.url)
    return origin && state.allowedOrigins.includes(origin)
      ? state.controlledTabId
      : undefined
  } catch {
    return undefined
  }
}
