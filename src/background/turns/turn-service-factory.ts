import type { BuildRagContextOptions } from "@/application/context/build-context"
import { ContextService } from "@/application/context/context-service"
import type { TurnSubmission } from "@/application/turns/turn-contract"
import { TurnService } from "@/application/turns/turn-service"
import { resolveRetrievalToolsActive } from "@/background/handlers/handle-build-context"
import { setAbortController } from "@/background/lib/abort-controller-registry"
import { makeGenerationOwner } from "@/background/turns/turn-generation"
import { AGENT_PREVIEW_COMPILED } from "@/lib/feature-flags"
import { getMessagesByIds } from "@/lib/repositories/chat-history"
import { createTurnRun, updateTurnRun } from "@/lib/repositories/turn-runs"
import type { ChatMessage } from "@/types"

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
  const signal = contextAbortSignal(submission.id)
  const context = submission.request.context
  const model =
    context.customModel ||
    context.selectedModelRef?.modelId ||
    context.selectedModel
  const retrievalToolsActive = await resolveRetrievalToolsActive(
    model,
    submission.providerId,
    context.rawInput,
    signal
  )
  return {
    ...options,
    messages: AGENT_PREVIEW_COMPILED
      ? await withDurableAgentHandoffs(options.messages)
      : options.messages,
    retrievalToolsActive,
    signal
  }
}

/**
 * The handoffs of this branch's agent rows, as the database holds them.
 *
 * Read here rather than taken from the request: a run that settled while the
 * chat stayed open wrote its handoff after the page last loaded the row, so
 * the page's copy has none, and the follow-up the user is typing is the one
 * that most needs it. The row is also the only writer's output — whatever the
 * request carried is replaced, not merged. A chat with no agent rows issues
 * no query at all.
 */
export const withDurableAgentHandoffs = async (
  messages: ChatMessage[]
): Promise<ChatMessage[]> => {
  const ids = messages.flatMap((message) =>
    message.agentRunId && typeof message.id === "number" ? [message.id] : []
  )
  if (ids.length === 0) return messages
  const stored = new Map(
    (await getMessagesByIds(ids)).map((row) => [row.id, row.agentHandoff])
  )
  return messages.map((message) => {
    if (!message.agentRunId || typeof message.id !== "number") return message
    const { agentHandoff: _fromRequest, ...rest } = message
    const handoff = stored.get(message.id)
    return handoff ? { ...rest, agentHandoff: handoff } : rest
  })
}

/**
 * The signal a stop reaches this turn's context build through.
 *
 * Registered under the turn id, which is the key the stop path already aborts
 * for generation, so the same "stop" the user pressed covers both phases.
 * Until now nothing was registered under that key while context was building:
 * the abort found no controller, and the build ran to completion against a
 * possibly-metered embedding endpoint before the next status transition
 * refused generation. The entry is replaced by generation's own controller
 * when it starts, so nothing accumulates per turn.
 */
const contextAbortSignal = (turnId: string): AbortSignal => {
  const controller = new AbortController()
  setAbortController(turnId, controller)
  return controller.signal
}
