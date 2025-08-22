import { create } from "zustand"

interface ChatInput {
  input: string
  setInput: (value: string) => void
}

export const chatInputStore = create<ChatInput>((set) => ({
  input: "",
  setInput: (text) => set({ input: text })
}))
