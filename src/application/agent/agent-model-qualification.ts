/**
 * Models with a recorded qualification pass: task-qualified, not merely able
 * to call tools.
 *
 * Entries are added only from a passing qualification report, the release
 * gate in `tools/agent-live-benchmark`, for the exact model id that report
 * names. Nothing else qualifies a model: a provider's catalog, a probe or a
 * user override says it can call tools, never that it can finish tasks.
 */
export const QUALIFIED_AGENT_MODELS: readonly string[] = []

/** Whether `modelId` has a recorded qualification pass. */
export const isQualifiedAgentModel = (
  modelId: string,
  qualified: readonly string[] = QUALIFIED_AGENT_MODELS
): boolean => qualified.includes(modelId)
