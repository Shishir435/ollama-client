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
   * The browser-agent run a card's follow-up drafted this message for. It
   * travels with the next message sent and is dropped when the user empties
   * the box, so an unrelated message never carries it.
   */
  agentFollowUpRunId?: string
  draftFollowUp: (text: string, runId?: string) => void
  dropAgentFollowUp: () => void
  takeAgentFollowUpRunId: () => string | undefined
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
  agentFollowUpRunId: undefined,
  draftFollowUp: (text, runId) =>
    set({ input: text, agentFollowUpRunId: runId }),
  dropAgentFollowUp: () => set({ agentFollowUpRunId: undefined }),
  takeAgentFollowUpRunId: () => {
    const runId = get().agentFollowUpRunId
    set({ agentFollowUpRunId: undefined })
    return runId
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
