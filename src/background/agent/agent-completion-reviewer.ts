import type { AgentRunState } from "@ollama-client/contracts"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { resolveAgentProviderDisclosure } from "./agent-provider-disclosure"

export interface AgentReviewerModel {
  providerId: string
  modelId: string
}

/** Why a configured reviewer was not sent anything. Codes, never page text. */
export class AgentReviewerUnavailableError extends Error {
  readonly reason: "missing_provider" | "remote_not_acknowledged"

  constructor(reason: AgentReviewerUnavailableError["reason"]) {
    super(`The configured completion reviewer is unavailable: ${reason}`)
    this.name = "AgentReviewerUnavailableError"
    this.reason = reason
  }
}

/**
 * The model that reviews this run's completions.
 *
 * Unset, or set to the run's own model, it is the run's model: already
 * authorized, already shown every record a review carries. Any other model is
 * a new recipient of page-derived evidence, so it passes the gate a run's own
 * provider passes before a page reaches it — a remote endpoint needs the
 * remote-observation acknowledgement. Enabled and tool-calling are checked by
 * the port itself, on the same terms as a decision.
 *
 * A configured reviewer that fails the gate throws. Falling back to the run's
 * model instead would change who judges without the user knowing, and the
 * controller already treats an unavailable reviewer as no review.
 */
export const resolveAgentCompletionReviewer = async (
  state: Pick<AgentRunState, "providerId" | "modelId">,
  dependencies: {
    read?: typeof readSetting
    disclose?: typeof resolveAgentProviderDisclosure
  } = {}
): Promise<AgentReviewerModel> => {
  const read = dependencies.read ?? readSetting
  const disclose = dependencies.disclose ?? resolveAgentProviderDisclosure
  const own = { providerId: state.providerId, modelId: state.modelId }
  const configured = await read(SETTINGS.AGENT_COMPLETION_REVIEWER)
  if (
    !configured ||
    (configured.providerId === own.providerId &&
      configured.modelId === own.modelId)
  )
    return own
  const disclosure = await disclose(configured.providerId, configured.modelId)
  if (!disclosure) throw new AgentReviewerUnavailableError("missing_provider")
  if (
    disclosure.location === "remote" &&
    (await read(SETTINGS.AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED)) !== true
  )
    throw new AgentReviewerUnavailableError("remote_not_acknowledged")
  return {
    providerId: configured.providerId,
    modelId: configured.modelId
  }
}
