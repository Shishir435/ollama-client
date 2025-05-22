import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constant"
import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

export type Role = "user" | "assistant"

export interface ChatMessage {
  role: Role
  content: string
}

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel] = useStorage<string>(
    STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
    ""
  )

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = () => {
    if (!input.trim()) return

    const userMessage: ChatMessage = { role: "user", content: input }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    const port = chrome.runtime.connect({
      name: MESSAGE_KEYS.OLLAMA.STREAM_RESPONSE
    })

    let assistantMessage: ChatMessage = { role: "assistant", content: "" }
    setMessages([...newMessages, assistantMessage])

    port.onMessage.addListener((msg) => {
      if (msg.delta !== undefined) {
        assistantMessage = {
          ...assistantMessage,
          content: assistantMessage.content + msg.delta
        }
        setMessages([...newMessages, { ...assistantMessage }])
      }

      if (msg.done || msg.error) {
        setIsLoading(false)
        if (msg.error) {
          setMessages([
            ...newMessages,
            { role: "assistant", content: `❌ Error: ${msg.error}` }
          ])
        }
        port.disconnect()
      }
    })

    port.postMessage({
      type: MESSAGE_KEYS.OLLAMA.CHAT_WITH_MODEL,
      payload: {
        model: selectedModel,
        messages: newMessages
      }
    })
  }

  return {
    input,
    setInput,
    messages,
    isLoading,
    sendMessage,
    scrollRef
  }
}
