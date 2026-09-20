import type { AgentObservation, AgentRunState } from "@ollama-client/contracts"
import { agentStepSourceUrl } from "./history"
import type {
  AgentHistoryEntry,
  AgentInspectionFocus,
  AgentVerificationResult
} from "./ports"

/**
 * Whether this step is worth a picture.
 *
 * A capture is not free: it costs a JPEG encode, a masking pass over the
 * sensitive regions, and — by far the largest of the three — an image prefill
 * in the model's own window, priced at around 1,600 tokens whatever the page
 * looks like. Taking one on every step of a run that never looks at it is the
 * clearest waste in the loop, and on a hosted model it is paid for twice, in
 * latency and in tokens.
 *
 * What it buys is real, though, so this is a question about the step rather
 * than about the run. The cases below are the ones where the DOM observation
 * is known to be insufficient or is known to have just failed; everything else
 * decides from text, which is what the overwhelming majority of steps do
 * anyway.
 */
export type AgentVisionPolicy = "never" | "auto" | "always"

export interface AgentPictureContext {
  state: Pick<AgentRunState, "stepCount">
  observation: AgentObservation
  inspection?: AgentInspectionFocus
  previousVerification?: AgentVerificationResult
  /** What the run has already done, newest last, as the model reads it. */
  history?: readonly AgentHistoryEntry[]
}

/**
 * A page with almost nothing to act on but plenty to look at.
 *
 * A canvas application, a map, a video player and a rendered document all
 * present this way: the document holds few interactive controls and a lot of
 * room. Sparseness alone is not enough — a short confirmation dialog is also
 * sparse — so it is paired with a document taller than its viewport, which is
 * what separates "there is little here" from "there is little here that the
 * DOM can see".
 */
const looksSparse = (observation: AgentObservation): boolean => {
  if (observation.elements.length === 0) return true
  if (observation.elements.length > 4) return false
  const { documentHeight, viewportHeight } = observation.scroll
  return documentHeight > viewportHeight * 1.5
}

/**
 * The previous step did not land. Grounding that failed, an effect that could
 * not be confirmed and a page that answered something unexpected are exactly
 * the situations where a picture says what the element list could not — and
 * they are rare, so paying for one here is cheap in aggregate.
 */
const recovering = (
  previousVerification: AgentVerificationResult | undefined
): boolean =>
  previousVerification !== undefined &&
  previousVerification.outcome !== "confirmed"

/**
 * The run is looking at a page it has not seen a picture of.
 *
 * A navigation lands somewhere the element list may describe poorly — a map,
 * a viewer, a canvas application — and the rule above would skip it for
 * having more than four controls. The first step on a page is the same
 * argument as the first step of a run: it is the baseline the model reasons
 * against, and it is the only thing that makes `zoom` reachable, because that
 * command is offered only once a screenshot exists. Skipping it left a run
 * that had navigated to a rendered page with no way to ask to see it.
 *
 * One picture per page, not per step: the comparison is against the page the
 * last recorded step acted on, in the same shortened form the history carries,
 * so a query or a fragment changing underneath the run does not buy another.
 */
const arrivedSomewhereNew = (
  observation: AgentObservation,
  history: readonly AgentHistoryEntry[] | undefined
): boolean => {
  let previous: string | undefined
  for (const entry of history ?? []) {
    if (entry.url) previous = entry.url
  }
  /** No record is not evidence of a new page; the first step already gets one. */
  if (previous === undefined) return false
  return previous !== agentStepSourceUrl(observation.url)
}

export const agentPictureWarranted = (input: AgentPictureContext): boolean => {
  /** An explicit zoom is the model asking, and it names a region to magnify. */
  if (input.inspection?.zoom) return true
  /**
   * The first step always gets one. It is the baseline the model reasons
   * against, and it is also what makes `zoom` reachable at all — that command
   * is offered only once a screenshot exists, so a run that never took a
   * first one could never ask for a closer look.
   */
  if (input.state.stepCount === 0) return true
  if (recovering(input.previousVerification)) return true
  if (arrivedSomewhereNew(input.observation, input.history)) return true
  return looksSparse(input.observation)
}
