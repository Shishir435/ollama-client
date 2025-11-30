import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useRef } from "react"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useOllamaStream } from "@/features/chat/hooks/use-ollama-stream"
import { retrieveContext } from "@/features/chat/rag"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { STORAGE_KEYS } from "@/lib/constants"
import { db } from "@/lib/db"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChatMessage, FileAttachment } from "@/types"

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

  const { embedMessages } = useAutoEmbedMessages()

  const { startStream, stopStream } = useOllamaStream({
    setMessages: async (newMessages) => {
      if (currentSessionId) {
        await updateMessages(currentSessionId, newMessages)
        // Only embed when streaming is complete (don't embed during streaming)
        // Auto-embed messages in background (don't await to avoid blocking)
        embedMessages(newMessages, currentSessionId, isStreaming).catch(
          (err) => {
            console.error("Failed to embed messages:", err)
          }
        )
      }
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

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[]
  ) => {
    const sessionId = await ensureSessionId()
    if (!sessionId) return

    const rawInput = customInput?.trim() ?? input.trim()

    // Allow sending message with just files (no text input)
    if (!rawInput && (!files || files.length === 0)) return

    const includeContext =
      !customInput && selectedTabIds.length > 0 && contextText?.trim()

    // Build content with file attachments
    let contentWithContext = rawInput || ""

    if (includeContext) {
      contentWithContext = contentWithContext
        ? `${contentWithContext}\n\n---\n\n${contextText}`
        : contextText
    }

    // RAG & Context Injection
    let fileContext = ""

    const useRag =
      (await plasmoGlobalStorage.get<boolean>(
        STORAGE_KEYS.EMBEDDINGS.USE_RAG
      )) ?? true

    if (useRag) {
      try {
        // Determine scope: specific files or global
        const fileIds =
          files && files.length > 0
            ? (files.map((f) => f.metadata.fileId).filter(Boolean) as string[])
            : undefined // undefined means search all files

        console.log(
          `RAG Enabled: Searching for context (Scope: ${
            fileIds ? "Specific Files" : "Global"
          })`
        )

        const context = await retrieveContext(rawInput || "summary", fileIds, {
          mode: "similarity",
          topK: 5
        })

        if (context.documents.length > 0) {
          console.log(`RAG: Found ${context.documents.length} relevant chunks`)
          fileContext = context.formattedContext
        }
      } catch (e) {
        console.error("RAG Error:", e)
      }
    }

    // Fallback to full text ONLY if specific files attached AND no RAG context found
    if (!fileContext && files && files.length > 0) {
      fileContext = files
        .map(
          (file) =>
            `[File: ${file.metadata.fileName}]\n${file.text.slice(0, 10000)}${
              file.text.length > 10000 ? "\n... (truncated)" : ""
            }`
        )
        .join("\n\n---\n\n")
    }

    if (fileContext) {
      contentWithContext = contentWithContext
        ? `${contentWithContext}\n\n---\n\n${fileContext}`
        : fileContext
    }

    // Create file attachments metadata
    const attachments: FileAttachment[] | undefined =
      files && files.length > 0
        ? files.map((file) => ({
            fileId:
              file.metadata.fileId || `file-${Date.now()}-${Math.random()}`,
            fileName: file.metadata.fileName,
            fileType: file.metadata.fileType,
            fileSize: file.metadata.fileSize,
            textPreview: file.text.slice(0, 200),
            processedAt: file.metadata.processedAt
          }))
        : undefined

    const userMessage: ChatMessage = {
      role: "user",
      content: contentWithContext,
      attachments
    }

    const newMessages = [...messages, userMessage]

    // Save updated messages
    await updateMessages(currentSessionId, newMessages)

    // Auto-embed user message (always complete, not streaming)
    embedMessages(newMessages, currentSessionId, false).catch((err) => {
      console.error("Failed to embed messages:", err)
    })

    // Rename session title if it's still "New Chat"
    const titleContent = rawInput || files?.[0]?.metadata.fileName || ""
    await autoRenameSession(sessionId, titleContent)

    if (!customInput) setInput("")
    startStream({
      model: customModel || selectedModel,
      messages: newMessages,
      sessionId: currentSessionId
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
