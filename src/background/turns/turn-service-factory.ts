import type { BuildRagContextOptions } from "@/application/context/build-context"
import { ContextService } from "@/application/context/context-service"
import type { TurnSubmission } from "@/application/turns/turn-contract"
import { TurnService } from "@/application/turns/turn-service"
import { resolveRetrievalToolsActive } from "@/background/handlers/handle-build-context"
import { makeGenerationOwner } from "@/background/turns/turn-generation"
import { createTurnRun, updateTurnRun } from "@/lib/repositories/turn-runs"

/**
 * Bind the environment-independent turn runtime to this extension's adapters.
 *
 * Kept apart from the composition entry so the recovery coordinator can build a
 * service without importing the module that re-exports it — the cycle that a
 * single hub file made unavoidable.
 */
export const createTurnService = (): TurnService =>
  new TurnService(
    { create: createTurnRun, update: updateTurnRun },
    new ContextService(),
    makeGenerationOwner()
  )

/**
 * Decide whether retrieval tools are live for this turn's model.
 *
 * Resolved per attempt rather than persisted with the submission: a resumed
 * turn should honor the tool support the model has now, not the answer cached
 * when it was first submitted.
 */
export const withRetrievalToolState = async (
  submission: TurnSubmission,
  options: BuildRagContextOptions
): Promise<BuildRagContextOptions> => {
  const context = submission.request.context
  const model =
    context.customModel ||
    context.selectedModelRef?.modelId ||
    context.selectedModel
  const retrievalToolsActive = await resolveRetrievalToolsActive(
    model,
    submission.providerId,
    context.rawInput
  )
  return { ...options, retrievalToolsActive }
}
