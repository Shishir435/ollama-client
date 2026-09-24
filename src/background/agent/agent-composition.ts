import { isLegalAgentTransition } from "@ollama-client/agent-runtime"

import { startBrowserAgentNavigationObserver } from "@/lib/browser-agent/navigation-observer"
import { browser } from "@/lib/browser-api"
import { AGENT_DEBUG_REPORT_ENABLED, FEATURE_FLAGS } from "@/lib/feature-flags"
import { registerAgentAttentionBadge } from "./agent-attention-badge"
import { createAgentBrowserSessionManager } from "./agent-browser-session-manager"
import { setAgentForgetStopper } from "./agent-forget-rpc"
import { registerAgentPanelPort } from "./agent-panel-port"
import { resolveAgentProviderDisclosure } from "./agent-provider-disclosure"
import type { AgentRunService } from "./agent-run-service"
import { createAgentRunService } from "./agent-run-service"
import type { AgentTabHistory } from "./agent-tab-history"
import { createAgentTabHistory } from "./agent-tab-history"

export interface AgentComposition {
  canTransition: typeof isLegalAgentTransition
  service: AgentRunService
  history: AgentTabHistory
  dispose(): void
}

/**
 * Assembles the Agent background: one run service, the panel transport, and
 * the navigation record back/forward is planned against.
 *
 * `webNavigation` is an install-time permission on Chromium, so the
 * navigation observer attaches with the composition rather than waiting on a
 * grant the panel used to request from the first Start.
 */
export const createAgentComposition = async (
  ready: Promise<void> = Promise.resolve()
): Promise<AgentComposition | undefined> => {
  if (!FEATURE_FLAGS.agentPreview) return undefined

  /**
   * The direct build constant, not the frozen-object property: a property
   * read is not foldable, so the store bundle kept the dump and the page text
   * it reads. Verified by grepping a real production background bundle.
   */
  if (AGENT_DEBUG_REPORT_ENABLED) {
    const { installAgentDebugReport } = await import("./agent-debug-report")
    installAgentDebugReport()
  }

  const history = createAgentTabHistory()
  const browserSessions = createAgentBrowserSessionManager()
  const service = createAgentRunService({ history, browserSessions })
  const stopPort = registerAgentPanelPort({
    ready,
    service,
    resolveProvider: resolveAgentProviderDisclosure,
    browserCapabilities: () => browserSessions.capabilities,
    resolveTab: async (tabId) => {
      try {
        const tab = await browser.tabs.get(tabId)
        return { title: tab.title ?? "", url: tab.url ?? "" }
      } catch {
        return undefined
      }
    }
  })

  /*
   * A chat, or a branch of one, was deleted. The request arrives through the
   * RPC server, which authorizes the sender; what it needs done — stopping a
   * run, detaching its browser session — is this service's.
   */
  setAgentForgetStopper((runId) => service.stop(runId))

  const stopBadge = registerAgentAttentionBadge({
    service,
    action: browser.action
  })

  const observer = startBrowserAgentNavigationObserver((snapshot) => {
    /*
     * Back and forward are planned against the tab's own history, which a
     * child frame's navigation does not enter.
     */
    if (snapshot.frameId === 0) history.record(snapshot.tabId, snapshot.url)
  })

  return {
    canTransition: isLegalAgentTransition,
    service,
    history,
    dispose() {
      stopPort()
      stopBadge()
      setAgentForgetStopper(undefined)
      observer.stop()
      void browserSessions.dispose()
    }
  }
}
