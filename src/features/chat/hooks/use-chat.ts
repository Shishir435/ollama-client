import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useRef } from "react"
import { useOllamaStream } from "@/features/chat/hooks/use-ollama-stream"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { STORAGE_KEYS } from "@/lib/constants"
import { db } from "@/lib/db"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChatMessage } from "@/types"

export const useChat = () => {
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.OLLAMA.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )

  const { input, setInput } = useChatInput()
  const { selectedTabIds } = useSelectedTabs()
  const { builtContent: contextText } = useTabContent()
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
  }, [])

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
    const sessionId = await ensureSessionId()
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
