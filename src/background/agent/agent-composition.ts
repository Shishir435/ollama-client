import { isLegalAgentTransition } from "@ollama-client/agent-runtime"

import { startBrowserAgentNavigationObserver } from "@/lib/browser-agent/navigation-observer"
import { browser } from "@/lib/browser-api"
import { FEATURE_FLAGS } from "@/lib/feature-flags"
import { hasAgentPerceptionPermission } from "@/lib/permissions"
import { createAgentBrowserSessionManager } from "./agent-browser-session-manager"
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
 * The navigation observer needs `webNavigation`, which is optional and granted
 * from the panel, so it is attached only once the permission is in hand — a
 * missing grant leaves the run service refusing to start rather than reading
 * an API that is not there.
 */
export const createAgentComposition = async (
  ready: Promise<void> = Promise.resolve()
): Promise<AgentComposition | undefined> => {
  if (!FEATURE_FLAGS.agentPreview) return undefined

  if (FEATURE_FLAGS.agentDebugReport) {
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

  let observer:
    | ReturnType<typeof startBrowserAgentNavigationObserver>
    | undefined
  const startObserver = () => {
    observer ??= startBrowserAgentNavigationObserver((snapshot) => {
      /*
       * Back and forward are planned against the tab's own history, which a
       * child frame's navigation does not enter.
       */
      if (snapshot.frameId === 0) history.record(snapshot.tabId, snapshot.url)
    })
  }
  if (await hasAgentPerceptionPermission()) startObserver()

  /*
   * The grant usually arrives mid-session, from the panel's first Start.
   * Without this the run that triggered the prompt would drive a browser
   * whose navigation nobody is watching until the next worker start.
   */
  const onPermissionAdded = () => {
    void hasAgentPerceptionPermission().then((granted) => {
      if (granted) startObserver()
    })
  }
  browser.permissions.onAdded.addListener(onPermissionAdded)

  return {
    canTransition: isLegalAgentTransition,
    service,
    history,
    dispose() {
      stopPort()
      browser.permissions.onAdded.removeListener(onPermissionAdded)
      observer?.stop()
      void browserSessions.dispose()
    }
  }
}
