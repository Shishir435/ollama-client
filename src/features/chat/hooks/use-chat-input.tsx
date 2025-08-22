import { chatInputStore } from "@/features/chat/stores/chat-input-store"

export const useChatInput = () => {
  const input = chatInputStore((s) => s.input)
  const setInput = chatInputStore((s) => s.setInput)
  return { input, setInput }
}
