import { useEffect, useRef } from "react"

import { useOllamaStream } from "@/hooks/use-ollama-stream"
import { useChatInput } from "@/context/chat-input-context"
import { useChatSessions } from "@/context/chat-session-context"
import { useLoadStream } from "@/context/load-stream-context"
import { useSelectedTabIds } from "@/context/selected-tab-ids-context"
import { useTabContentContext } from "@/context/tab-content-context"
import { STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChatMessage } from "@/types"

import { useStorage } from "@plasmohq/storage/hook"

export const useChat = () => {
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )

  const { input, setInput } = useChatInput()
  const { selectedTabIds } = useSelectedTabIds()
  const contextText = useTabContentContext()
  const { isLoading, setIsLoading, isStreaming, setIsStreaming } =
    useLoadStream()

  const { currentSessionId, sessions, updateMessages, renameSessionTitle } =
    useChatSessions()

  const scrollRef = useRef<HTMLDivElement>(null)

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const messages = currentSession?.messages ?? []

  const { startStream, stopStream } = useOllamaStream({
    setMessages: (newMessages) => {
      if (currentSessionId) updateMessages(currentSessionId, newMessages)
    },
    setIsLoading,
    setIsStreaming
  })

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async (customInput?: string, customModel?: string) => {
    if (!currentSessionId) return

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

    // Save updated messages
    await updateMessages(currentSessionId, newMessages)

    // Rename session title if it's still "New Chat"
    const currentTitle = sessions.find((s) => s.id === currentSessionId)?.title
    if (currentTitle === "New Chat") {
      const firstLine = rawInput.split("\n")[0].slice(0, 40)
      await renameSessionTitle(currentSessionId, firstLine)
    }

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
