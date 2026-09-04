import { isLegalAgentTransition } from "@ollama-client/agent-runtime"

import { startBrowserAgentNavigationObserver } from "@/lib/browser-agent/navigation-observer"
import { browser } from "@/lib/browser-api"
import { FEATURE_FLAGS } from "@/lib/feature-flags"
import { hasAgentPerceptionPermission } from "@/lib/permissions"
import { registerAgentPanelPort } from "./agent-panel-port"
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
 * The navigation observer needs `webNavigation`, which is optional and granted
 * from the panel, so it is attached only once the permission is in hand — a
 * missing grant leaves the run service refusing to start rather than reading
 * an API that is not there. Provider disclosure is not resolved here: the
 * panel owns the model selection it discloses.
 */
export const createAgentComposition = async (): Promise<
  AgentComposition | undefined
> => {
  if (!FEATURE_FLAGS.agentPreview) return undefined

  const history = createAgentTabHistory()
  const service = createAgentRunService({ history })
  const stopPort = registerAgentPanelPort({
    service,
    resolveTab: async (tabId) => {
      try {
        const tab = await browser.tabs.get(tabId)
        return { title: tab.title ?? "", url: tab.url ?? "" }
      } catch {
        return undefined
      }
    }
  })

  const observer = (await hasAgentPerceptionPermission())
    ? startBrowserAgentNavigationObserver((snapshot) => {
        history.record(snapshot.tabId, snapshot.url)
      })
    : undefined

  return {
    canTransition: isLegalAgentTransition,
    service,
    history,
    dispose() {
      stopPort()
      observer?.stop()
    }
  }
}
