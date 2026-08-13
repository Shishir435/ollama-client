/** Inputs that determine context policy before any environment work begins. */
export interface ContextPlanInput {
  rawInput: string
  maxRagContextChars: number
  groundedOnlyMode: boolean
  retrievalToolsActive?: boolean
}

/**
 * Deterministic context policy shared by the retrieval steps in a build.
 *
 * Keeping this separate from the orchestrator makes the prompt budget and the
 * pre-injection decision explicit without moving provider, storage, or browser
 * work out of the application layer.
 */
export interface ContextPlan {
  userContent: string
  initialRetrievalQuery: string
  ragBudget: number
  injectStoredContext: boolean
}

/** Build the immutable policy used throughout one context-construction run. */
export const createContextPlan = (input: ContextPlanInput): ContextPlan => ({
  userContent: input.rawInput,
  initialRetrievalQuery: input.rawInput || "summary",
  ragBudget:
    input.maxRagContextChars > 0
      ? input.maxRagContextChars
      : Number.POSITIVE_INFINITY,
  injectStoredContext: !input.groundedOnlyMode && !input.retrievalToolsActive
})

/** Return the unspent shared file-and-memory context budget. */
export const remainingRagBudget = (
  plan: ContextPlan,
  consumed: number
): number => Math.max(0, plan.ragBudget - consumed)
