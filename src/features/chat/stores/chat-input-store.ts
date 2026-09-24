import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { ChatInput } from "@/types"

interface ComposerState extends ChatInput {
  promptLibraryOpen: boolean
  focused: boolean
  pendingChatSend?: string
  /**
   * Bumped to ask the composer for the caret. A counter rather than a flag,
   * so two requests in a row are two requests — something outside the input
   * (a run's card offering to ask about it) has no ref to focus through.
   */
  focusRequest: number
  requestFocus: () => void
  /**
   * The browser-agent run a card's Continue or Retry drafted a message for,
   * with the exact text drafted and the chat it was drafted in. It rides on
   * the next message only if that message is still the drafted text, sent to
   * the same chat: a draft edited into another request, or sent elsewhere,
   * is a new request and follows nothing.
   */
  agentFollowUp?: { runId: string; text: string; sessionId?: string }
  draftFollowUp: (text: string, runId?: string, sessionId?: string) => void
  dropAgentFollowUp: () => void
  /** Spends the follow-up, returning its run only for the drafted message. */
  takeAgentFollowUpRunId: (
    sentText: string,
    sessionId: string
  ) => string | undefined
  setPromptLibraryOpen: (open: boolean) => void
  setFocused: (focused: boolean) => void
  queueChatSend: (input: string) => void
  clearPendingChatSend: () => void
}

export const chatInputStore = create<ComposerState>((set, get) => ({
  input: "",
  setInput: (text) => set({ input: text }),
  appendInput: (text) => set((state) => ({ input: state.input + text })),
  promptLibraryOpen: false,
  focused: false,
  pendingChatSend: undefined,
  focusRequest: 0,
  requestFocus: () =>
    set((state) => ({ focusRequest: state.focusRequest + 1 })),
  agentFollowUp: undefined,
  draftFollowUp: (text, runId, sessionId) =>
    set({
      input: text,
      agentFollowUp: runId
        ? { runId, text, ...(sessionId ? { sessionId } : {}) }
        : undefined
    }),
  dropAgentFollowUp: () => set({ agentFollowUp: undefined }),
  takeAgentFollowUpRunId: (sentText, sessionId) => {
    const followUp = get().agentFollowUp
    set({ agentFollowUp: undefined })
    if (!followUp || followUp.text.trim() !== sentText.trim()) return undefined
    if (followUp.sessionId && followUp.sessionId !== sessionId) return undefined
    return followUp.runId
  },
  setPromptLibraryOpen: (promptLibraryOpen) => set({ promptLibraryOpen }),
  setFocused: (focused) => set({ focused }),
  queueChatSend: (pendingChatSend) => set({ pendingChatSend }),
  clearPendingChatSend: () => set({ pendingChatSend: undefined })
}))

export const useChatInput = () => {
  return chatInputStore(
    useShallow((s) => ({
      input: s.input,
      setInput: s.setInput,
      appendInput: s.appendInput
    }))
  )
}

export const useComposerUi = () =>
  chatInputStore(
    useShallow((state) => ({
      promptLibraryOpen: state.promptLibraryOpen,
      focused: state.focused,
      focusRequest: state.focusRequest,
      setPromptLibraryOpen: state.setPromptLibraryOpen,
      setFocused: state.setFocused
    }))
  )

export const usePendingChatSend = () =>
  chatInputStore(
    useShallow((state) => ({
      pendingChatSend: state.pendingChatSend,
      queueChatSend: state.queueChatSend,
      clearPendingChatSend: state.clearPendingChatSend
    }))
  )
