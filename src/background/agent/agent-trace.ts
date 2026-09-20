import { logger } from "@/lib/logger"

/**
 * Opt in for this worker lifetime from its DevTools console:
 * globalThis.__OLLAMA_CLIENT_AGENT_TRACE__ = true
 * Only structural metadata belongs here; never page text, arguments or URLs.
 */
export const traceAgentRun = (
  runId: string,
  phase: string,
  metadata: Record<string, string | number | boolean | undefined> = {}
): void => {
  const scope = globalThis as typeof globalThis & {
    __OLLAMA_CLIENT_AGENT_TRACE__?: boolean
  }
  if (scope.__OLLAMA_CLIENT_AGENT_TRACE__ !== true) return
  logger.info("Agent run trace", "Agent", { runId, phase, ...metadata })
}
