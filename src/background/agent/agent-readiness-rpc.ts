import type {
  AgentGetReadinessRequest,
  AgentGetReadinessResult
} from "@ollama-client/contracts/agent-rpc"
import { isQualifiedAgentModel } from "@/application/agent/agent-model-qualification"
import { resolveAgentProviderDisclosure } from "./agent-provider-disclosure"

/**
 * The selected model's agent readiness, for the composer to show before any
 * task is started. Read through the same disclosure a start is admitted by,
 * so the line cannot call a model ready that a start would refuse.
 */
export const getAgentReadiness = async (
  { providerId, modelId }: AgentGetReadinessRequest,
  signal?: AbortSignal,
  dependencies: {
    disclose?: typeof resolveAgentProviderDisclosure
  } = {}
): Promise<AgentGetReadinessResult> => {
  const disclose = dependencies.disclose ?? resolveAgentProviderDisclosure
  /** A query: it records nothing it learns, and stops when the caller does. */
  const disclosure = await disclose(
    providerId,
    modelId,
    {},
    { readOnly: true, ...(signal ? { signal } : {}) }
  )
  signal?.throwIfAborted()
  return {
    ...(disclosure?.readiness ? { readiness: disclosure.readiness } : {}),
    qualified: isQualifiedAgentModel(modelId)
  }
}
