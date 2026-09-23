import { createContext, useContext } from "react"

import type { AgentRunConnection } from "../hooks/use-agent-run"
import type { AgentTabPresentation } from "./presentation"

/**
 * The side panel's one supervision port, for whatever in the conversation
 * needs the live run.
 *
 * Held by the workspace for as long as the panel is open rather than by a
 * surface the user can leave: a run kept going while the user read or wrote
 * in chat, and a port that closed with the surface paused it for them.
 */
export interface AgentWorkspaceConnection {
  connection: AgentRunConnection
  /** The tab the live run drives, as the panel names it. */
  tab?: AgentTabPresentation
}

export const AgentConnectionContext = createContext<
  AgentWorkspaceConnection | undefined
>(undefined)

/**
 * The connection, when the run it holds is the one `runId` names. A card for
 * any other run reads that run's row instead.
 */
export const useAgentLiveRun = (
  runId: string | undefined
): AgentWorkspaceConnection | undefined => {
  const workspace = useContext(AgentConnectionContext)
  if (!workspace || !runId) return undefined
  return workspace.connection.snapshot.run?.id === runId ? workspace : undefined
}
