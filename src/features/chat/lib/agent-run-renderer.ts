import { type ComponentType, createContext, useContext } from "react"

import type { ChatMessage } from "@/types"

/** Draws a message an Agent run reports into, in place of its text. */
export type AgentRunRenderer = ComponentType<{ msg: ChatMessage }>

/**
 * Supplied by the shell, never imported by chat.
 *
 * Chat does not depend on the Agent: the shell that mounts both hands the
 * renderer down, which is also what keeps it out of Firefox, where the shell
 * has no Agent to offer. Absent, a linked row reads as the plain answer its
 * terminal commit wrote.
 */
export const AgentRunRendererContext = createContext<
  AgentRunRenderer | undefined
>(undefined)

export const useAgentRunRenderer = () => useContext(AgentRunRendererContext)
