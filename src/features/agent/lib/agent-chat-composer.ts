import { createContext, useContext } from "react"

/**
 * Gives the chat composer the caret, when the shell offers one.
 *
 * The card sits in the chat timeline but belongs to the Agent feature, which
 * may not import chat — so asking about a run is a door the shell hands it.
 * Absent, the card offers no Ask.
 */
export const AgentChatComposerContext = createContext<(() => void) | undefined>(
  undefined
)

export const useAgentChatComposer = () => useContext(AgentChatComposerContext)
