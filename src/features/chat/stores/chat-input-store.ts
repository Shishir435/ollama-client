import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { ChatInput } from "@/types"

export const chatInputStore = create<ChatInput>((set) => ({
  input: "",
  setInput: (text) => set({ input: text })
}))

export const useChatInput = () => {
  return chatInputStore(
    useShallow((s) => ({
      input: s.input,
      setInput: s.setInput
    }))
  )
}
