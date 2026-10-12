import { isTerminalAgentStatus } from "@ollama-client/agent-runtime"
import { type ReactNode, useEffect, useRef } from "react"

import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { useAgentDebugReport } from "./hooks/use-agent-debug-report"
import { useAgentRun } from "./hooks/use-agent-run"
import { AgentConnectionContext } from "./lib/agent-connection"

/**
 * The Agent inside the chat workspace: one supervision port for the life of
 * the panel.
 *
 * There is no mode to switch into and nothing to start from here. A run is
 * started by the chat model calling `browser_task` from an ordinary turn, and
 * reports into that turn's own row, where its card carries the approvals,
 * questions and controls. What the panel still owns is the port those use:
 * it lives as long as the panel does, so chatting while a run works never
 * pauses it, and closing the last panel does.
 */
export const AgentWorkspace = ({ children }: { children: ReactNode }) => {
  const connection = useAgentRun()
  useAgentDebugReport(connection.debugReport)
  const { snapshot } = connection
  const shownRunId = snapshot.run?.id

  /**
   * The background links a run to its turn's row in the commit that admits
   * it, so the row on screen does not know it has a run. The chat is re-read
   * the moment a run it has not shown appears, or the card carrying the run's
   * approvals would stay hidden until something else reloaded it.
   */
  const reloadedForRun = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!shownRunId || reloadedForRun.current === shownRunId) return
    reloadedForRun.current = shownRunId
    const { currentSessionId: sessionId, loadSessionMessages } =
      chatSessionStore.getState()
    if (sessionId) void loadSessionMessages(sessionId)
  }, [shownRunId])

  /** Only a run in progress has a tab worth naming on its card. */
  const tab =
    snapshot.run && !isTerminalAgentStatus(snapshot.run.status)
      ? snapshot.tab
      : undefined

  return (
    <AgentConnectionContext.Provider
      value={{ connection, ...(tab ? { tab } : {}) }}>
      {children}
    </AgentConnectionContext.Provider>
  )
}
