import { type ComponentType, createContext, useContext } from "react"

/** Draws a line above the composer about the browser agent. */
export type AgentComposerNotice = ComponentType

/**
 * Supplied by the shell, never imported by chat, for the same reason as the
 * run renderer: chat does not depend on the Agent, and on Firefox the shell
 * has no Agent to offer. Absent, the composer shows no agent line.
 */
export const AgentComposerNoticeContext = createContext<
  AgentComposerNotice | undefined
>(undefined)

export const useAgentComposerNotice = () =>
  useContext(AgentComposerNoticeContext)
