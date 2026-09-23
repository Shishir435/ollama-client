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

/**
 * Gives the chat composer the caret, when the shell offers one.
 *
 * The card sits in the chat timeline but belongs to the Agent feature, which
 * may not import chat — so asking about a run is a door the shell hands it,
 * like the one to the Agent surface. Absent, the card offers no Ask.
 */
export const AgentChatComposerContext = createContext<(() => void) | undefined>(
  undefined
)

export const useAgentChatComposer = () => useContext(AgentChatComposerContext)
