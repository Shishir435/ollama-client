import { AgentGroundingError, agentGroundingMessage } from "./affordance"

/**
 * The page moved on between the observation and the resolution: a new
 * document, a new generation, or a snapshot the reference store no longer
 * recognizes. The decision was sound when it was made.
 */
export class AgentStaleObservationError extends Error {
  constructor(message = "The observed page is no longer the page in hand") {
    super(message)
    this.name = "AgentStaleObservationError"
  }
}

/**
 * The page, tab or destination is one the run may not read — an excluded
 * site, a privileged URL, a tab that closed. Also not the model's doing.
 */
export class AgentUnreadablePageError extends Error {
  constructor(message = "The page this command needs is not readable") {
    super(message)
    this.name = "AgentUnreadablePageError"
  }
}

export type AgentResolutionFailureCode =
  | "invalid_decision"
  | "stale_snapshot"
  | "unsupported_page"
  | "verification_failed"

/**
 * Why a command never reached the page, in the run's own vocabulary.
 *
 * The distinction is the whole point: a refused command is the model's
 * mistake and the model can be told about it, while a page that went stale or
 * became unreadable is nobody's mistake and says nothing about the decision.
 * Reporting them alike made every diagnostic read as a bad model. Anything
 * unrecognized keeps the pre-existing code, so a new resolver failure is
 * never quietly re-labelled as one of these.
 */
export const agentResolutionFailure = (
  error: unknown
): { code: AgentResolutionFailureCode; message: string } => {
  if (error instanceof AgentGroundingError) {
    return { code: "invalid_decision", message: agentGroundingMessage(error) }
  }
  if (error instanceof AgentStaleObservationError) {
    return {
      code: "stale_snapshot",
      message: "The page changed before the command could be prepared."
    }
  }
  if (error instanceof AgentUnreadablePageError) {
    return {
      code: "unsupported_page",
      message: "The page this command needs is no longer readable."
    }
  }
  return {
    code: "verification_failed",
    message: "The proposed page effect could not be resolved safely."
  }
}
