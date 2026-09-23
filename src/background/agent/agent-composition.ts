import { isLegalAgentTransition } from "@ollama-client/agent-runtime"

import { classifyRuntimeSender } from "@ollama-client/runtime-core/runtime-sender"

import { startBrowserAgentNavigationObserver } from "@/lib/browser-agent/navigation-observer"
import { browser } from "@/lib/browser-api"
import { AGENT_DEBUG_REPORT_ENABLED, FEATURE_FLAGS } from "@/lib/feature-flags"
import { logger } from "@/lib/logger"
import { hasAgentPerceptionPermission } from "@/lib/permissions"
import { createAgentBrowserSessionManager } from "./agent-browser-session-manager"
import {
  AgentForgetChatRowsSchema,
  applyAgentForgetChatRows
} from "./agent-chat-reconcile"
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
   * A chat, or a branch of one, was deleted. Read as an event rather than
   * served as a request: the conversation is submitting intent, and what it
   * needs done — stopping a run, detaching its browser session, settling its
   * rows — is durable work this layer owns.
   *
   * Sender-checked here rather than by the message router, which does not see
   * this listener: a page-controlled script must not be able to stop a run.
   */
  const extensionUrlPrefix = browser.runtime.getURL("")
  const onForgetChatRows = (raw: unknown, sender: unknown) => {
    if (
      classifyRuntimeSender(
        (sender ?? {}) as Parameters<typeof classifyRuntimeSender>[0],
        browser.runtime.id,
        extensionUrlPrefix
      ) !== "extension-page"
    ) {
      return
    }
    const event = AgentForgetChatRowsSchema.safeParse(raw)
    if (!event.success) return
    /*
     * Returned, not detached. The polyfill answers the sender when this
     * promise settles, and the sender is a delete that waits for the answer
     * before taking the rows away — detaching it made that wait resolve on
     * delivery, which is the one thing it was not supposed to mean.
     */
    return applyAgentForgetChatRows(event.data, (runId) =>
      service.stop(runId)
    ).catch((error: unknown) => {
      logger.warn("Agent rows outlived their chat", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    })
  }
  browser.runtime.onMessage.addListener(onForgetChatRows)

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
      browser.runtime.onMessage.removeListener(onForgetChatRows)
      browser.permissions.onAdded.removeListener(onPermissionAdded)
      observer?.stop()
      void browserSessions.dispose()
    }
  }
}
