import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { ChatInput } from "@/types"

interface ComposerState extends ChatInput {
  promptLibraryOpen: boolean
  focused: boolean
  setPromptLibraryOpen: (open: boolean) => void
  setFocused: (focused: boolean) => void
}

export const chatInputStore = create<ComposerState>((set) => ({
  input: "",
  setInput: (text) => set({ input: text }),
  appendInput: (text) => set((state) => ({ input: state.input + text })),
  promptLibraryOpen: false,
  focused: false,
  setPromptLibraryOpen: (promptLibraryOpen) => set({ promptLibraryOpen }),
  setFocused: (focused) => set({ focused })
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
      setPromptLibraryOpen: state.setPromptLibraryOpen,
      setFocused: state.setFocused
    }))
  )
