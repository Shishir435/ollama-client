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
  dependencies: {
    disclose?: typeof resolveAgentProviderDisclosure
  } = {}
): Promise<AgentGetReadinessResult> => {
  const disclose = dependencies.disclose ?? resolveAgentProviderDisclosure
  const disclosure = await disclose(providerId, modelId)
  return {
    ...(disclosure?.readiness ? { readiness: disclosure.readiness } : {}),
    qualified: isQualifiedAgentModel(modelId)
  }
}
