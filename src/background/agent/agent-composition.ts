import { isLegalAgentTransition } from "@ollama-client/agent-runtime"
import { FEATURE_FLAGS } from "@/lib/feature-flags"

export interface AgentComposition {
  canTransition: typeof isLegalAgentTransition
}

/**
 * The disabled release gate intentionally registers no listeners, ports,
 * permissions, or UI. Later PRs can assemble ports here without coupling the
 * agent domain to Chat's composition.
 */
export const createAgentComposition = (): AgentComposition | undefined => {
  if (!FEATURE_FLAGS.agentPreview) return undefined

  return { canTransition: isLegalAgentTransition }
}
