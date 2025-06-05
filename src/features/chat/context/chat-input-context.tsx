import { createContext, useContext, useState, type ReactNode } from "react"

interface ChatInputContextType {
  input: string
  setInput: (value: string) => void
}

const ChatInputContext = createContext<ChatInputContextType | null>(null)

export const ChatInputProvider = ({ children }: { children: ReactNode }) => {
  const [input, setInput] = useState("")

  return (
    <ChatInputContext.Provider value={{ input, setInput }}>
      {children}
    </ChatInputContext.Provider>
  )
}

export const useChatInput = () => {
  const context = useContext(ChatInputContext)
  if (!context) {
    throw new Error("useChatInput must be used within a ChatInputProvider")
  }
  return context
}
