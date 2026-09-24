import { createContext, useContext } from "react"

/**
 * Gives the chat composer the caret, with `text` placed in it when given.
 *
 * The card sits in the chat timeline but belongs to the Agent feature, which
 * may not import chat — so every follow-up is a door the shell hands it. The
 * user still presses Send, and the model decides whether the browser is
 * needed. Absent, the card offers no follow-ups.
 */
export const AgentChatComposerContext = createContext<
  ((text?: string) => void) | undefined
>(undefined)

export const useAgentChatComposer = () => useContext(AgentChatComposerContext)
