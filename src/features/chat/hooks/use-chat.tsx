import { useEffect, useRef } from "react"

import { useLoadStream } from "@/context/load-stream-context"
import { STORAGE_KEYS } from "@/lib/constants"
import { db } from "@/lib/db"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { useChatInput } from "@/features/chat/context/chat-input-context"
import { useOllamaStream } from "@/features/chat/hooks/use-ollama-stream"
import { useChatSessions } from "@/features/sessions/context/chat-session-context"
import { useSelectedTabIds } from "@/features/tabs/context/selected-tab-ids-context"
import { useTabContentContext } from "@/features/tabs/context/tab-content-context"
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

  const {
    currentSessionId,
    sessions,
    updateMessages,
    renameSessionTitle,
    createSession,
    setCurrentSessionId
  } = useChatSessions()

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

  const ensureSessionId = async (): Promise<string | null> => {
    if (currentSessionId) return currentSessionId
    await createSession()
    const latest = await db.sessions.orderBy("createdAt").reverse().first()
    if (!latest) return null
    setCurrentSessionId(latest.id)
    return latest.id
  }

  const autoRenameSession = async (sessionId: string, content: string) => {
    const currentTitle = sessions.find((s) => s.id === sessionId)?.title
    if (currentTitle === "New Chat") {
      const firstLine = content.split("\n")[0].slice(0, 40)
      await renameSessionTitle(sessionId, firstLine)
    }
  }

  const sendMessage = async (customInput?: string, customModel?: string) => {
    let sessionId = await ensureSessionId()
    if (!sessionId) return

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
    await autoRenameSession(sessionId, rawInput)

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
