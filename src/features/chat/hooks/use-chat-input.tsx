import { chatInputStore } from "@/features/chat/stores/chat-input-store"

export const useChatInput = () => {
  const input = chatInputStore((s) => s.input)
  const setInput = chatInputStore((s) => s.setInput)

  const safeSetInput = (value: string) => {
    setInput(value.trim())
  }

  return { input, setInput: safeSetInput }
}
