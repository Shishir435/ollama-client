import { useEffect, useRef, useState } from "react"

import { useOllamaStream } from "@/hooks/use-ollama-stream"
import { useChatInput } from "@/context/chat-input-context"
import { useLoadStream } from "@/context/load-stream-context"
import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { useTabContentContext } from "@/context/tab-content-context"
import { STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

export type Role = "user" | "assistant"

export interface ChatMessage {
  role: Role
  content: string
  done?: boolean
  model?: string
}

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel] = useStorage<string>(
    { key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL, instance: plasmoGlobalStorage },
    ""
  )

  const { input, setInput } = useChatInput()
  const { selectedTabIds } = useSelectedTabIds()
  const contextText = useTabContentContext()
  const { isLoading, setIsLoading, isStreaming, setIsStreaming } =
    useLoadStream()

  const scrollRef = useRef<HTMLDivElement>(null)
  const { startStream, stopStream } = useOllamaStream({
    setMessages,
    setIsLoading,
    setIsStreaming
  })

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = (customInput?: string, customModel?: string) => {
    const rawInput = customInput?.trim() ?? input.trim()
    if (!rawInput) return

    const includeContext =
      !customInput && selectedTabIds.length > 0 && contextText?.trim()
    const contentWithContext = includeContext
      ? `${rawInput}\n\n---\n\n${contextText}`
      : rawInput

    const userMessage: ChatMessage = {
      role: "user",
      content: contentWithContext
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    if (!customInput) setInput("")
    setIsLoading(true)
    setIsStreaming(false)

    startStream({
      model: customModel || selectedModel,
      messages: newMessages
    })
  }

  return {
    messages,
    isLoading,
    isStreaming,
    sendMessage,
    stopGeneration: stopStream,
    scrollRef
  }
}
