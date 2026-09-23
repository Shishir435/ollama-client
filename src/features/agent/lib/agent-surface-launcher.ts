import { createContext, useContext } from "react"

/**
 * Switches the side panel to the Agent surface, when the shell offers one.
 *
 * A context rather than a prop: the card sits several layers inside the chat
 * timeline, and threading a callback through the list, the bubble and the
 * footer would make every one of them know about a surface they do not own.
 * Absent outside the side panel — an options page or a test — where the card
 * simply shows no button.
 */
export const AgentSurfaceLauncherContext = createContext<
  (() => void) | undefined
>(undefined)

export const useAgentSurfaceLauncher = () =>
  useContext(AgentSurfaceLauncherContext)
