import { isLegalAgentTransition } from "@ollama-client/agent-runtime"

import { startBrowserAgentNavigationObserver } from "@/lib/browser-agent/navigation-observer"
import { browser } from "@/lib/browser-api"
import {
  classifyAgentTabAccess,
  queryActiveTab
} from "@/lib/browser-tab-access"
import { FEATURE_FLAGS } from "@/lib/feature-flags"
import { hasAgentPerceptionPermission } from "@/lib/permissions"
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
export const createAgentComposition = async (): Promise<
  AgentComposition | undefined
> => {
  if (!FEATURE_FLAGS.agentPreview) return undefined

  const history = createAgentTabHistory()
  const service = createAgentRunService({ history })
  const stopPort = registerAgentPanelPort({
    service,
    resolveProvider: resolveAgentProviderDisclosure,
    resolveTab: async (tabId) => {
      try {
        const tab = await browser.tabs.get(tabId)
        return { title: tab.title ?? "", url: tab.url ?? "" }
      } catch {
        return undefined
      }
    },
    resolveCandidateTab: async () => {
      const tab = await queryActiveTab()
      if (!tab?.url || (await classifyAgentTabAccess(tab.url)) !== "ok") {
        return undefined
      }
      return { title: tab.title ?? "", url: tab.url }
    },
    watchTabs: (onChange) => {
      const onActivated = () => onChange()
      const onUpdated = (
        _tabId: number,
        changeInfo: { url?: string; status?: string }
      ) => {
        if (changeInfo.url || changeInfo.status === "complete") onChange()
      }
      browser.tabs.onActivated.addListener(onActivated)
      browser.tabs.onUpdated.addListener(onUpdated)
      return () => {
        browser.tabs.onActivated.removeListener(onActivated)
        browser.tabs.onUpdated.removeListener(onUpdated)
      }
    }
  })

  let observer:
    | ReturnType<typeof startBrowserAgentNavigationObserver>
    | undefined
  const startObserver = () => {
    observer ??= startBrowserAgentNavigationObserver((snapshot) => {
      history.record(snapshot.tabId, snapshot.url)
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
    }
  }
}
