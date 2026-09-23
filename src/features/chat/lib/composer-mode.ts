import type { ReactNode } from "react"
import { createContext, useContext } from "react"

/**
 * A second thing the chat composer can send, lent by the shell.
 *
 * The composer is chat's, and chat may not import the Agent. So the Agent's
 * way of using the box — a goal instead of a message, a Start instead of a
 * Send, its consent and readiness above the field — arrives as this value
 * from the side panel, which is the one place allowed to know both. Absent,
 * or inactive, the composer is exactly the chat composer: nothing here runs
 * on the path that sends a message.
 */
export interface ChatComposerAlternateMode {
  active: boolean
  /** The field's accessible name while active. */
  inputLabel: string
  placeholder: string
  /** The send control's name while active. */
  submitLabel: string
  /** Shown above the box while active. */
  preflight?: ReactNode
  canSubmit: (text: string) => boolean
  /** Receives the trimmed text; the composer clears the box after. */
  submit: (text: string) => void
  /**
   * Text to place in the box once — a follow-up's goal, say. A new `token`
   * is a new request, so the same sentence can be placed twice.
   */
  prefill?: { text: string; token: number }
}

export const ChatComposerModeContext = createContext<
  ChatComposerAlternateMode | undefined
>(undefined)

export const useChatComposerMode = () => useContext(ChatComposerModeContext)
