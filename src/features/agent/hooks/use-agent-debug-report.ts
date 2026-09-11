import { useEffect } from "react"

import { AGENT_DEBUG_REPORT_ENABLED } from "@/lib/feature-flags"

/**
 * Puts the run-record dump on the panel's own console, in a development
 * build.
 *
 * It already lives on the background worker's global, which is the wrong
 * place to have put it alone: the worker's console is behind
 * chrome://extensions, it is a different console from the one the panel is
 * open in, and a worker that has slept since the run drops the binding until
 * something wakes it. The panel is the surface someone is already looking at
 * when a run goes wrong, so `__agentReport` answers there too — the same
 * function over the same tables, reached through the persistence RPC like
 * every other read the panel makes.
 */
export const useAgentDebugReport = (): void => {
  useEffect(() => {
    if (!AGENT_DEBUG_REPORT_ENABLED) return
    const scope = globalThis as typeof globalThis & {
      __agentReport?: (runId?: string) => Promise<string>
    }
    scope.__agentReport = async (runId?: string) => {
      const { buildAgentDebugReport } = await import(
        "@/background/agent/agent-debug-report"
      )
      const report = await buildAgentDebugReport(runId)
      return report
        ? JSON.stringify(report, null, 2)
        : JSON.stringify({ error: "No agent run found" })
    }
    return () => {
      scope.__agentReport = undefined
    }
  }, [])
}
