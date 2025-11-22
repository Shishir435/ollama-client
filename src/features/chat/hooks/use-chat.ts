import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useRef } from "react"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useOllamaStream } from "@/features/chat/hooks/use-ollama-stream"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { STORAGE_KEYS } from "@/lib/constants"
import { db } from "@/lib/db"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import { searchSimilarVectors } from "@/lib/embeddings/vector-store"
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

    // Add file content to message
    if (files && files.length > 0) {
      // Check if RAG is enabled
      const useRag =
        (await plasmoGlobalStorage.get<boolean>(
          STORAGE_KEYS.EMBEDDINGS.USE_RAG
        )) ?? true

      let fileContext = ""

      if (useRag) {
        try {
          console.log("RAG Enabled: Searching for relevant context...")
          // Generate embedding for the user query
          const embeddingResult = await generateEmbedding(rawInput || "summary")

          if ("embedding" in embeddingResult) {
            // Search for relevant chunks across all attached files
            const fileIds = files
              .map((f) => f.metadata.fileId)
              .filter(Boolean) as string[]

            const searchResults = await searchSimilarVectors(
              embeddingResult.embedding,
              {
                fileId: fileIds,
                limit: 5, // Top 5 chunks
                minSimilarity: 0.3 // Lower threshold to ensure we get something
              }
            )

            if (searchResults.length > 0) {
              console.log(
                `RAG: Found ${searchResults.length} relevant chunks from ${fileIds.length} files`
              )
              fileContext = searchResults
                .map(
                  (result) =>
                    `[Context from ${result.document.metadata.title || "file"}]\n${result.document.content}`
                )
                .join("\n\n---\n\n")
            } else {
              console.log(
                "RAG: No relevant chunks found, falling back to full text"
              )
            }
          }
        } catch (e) {
          console.error("RAG Error:", e)
        }
      }

      // Fallback to full text if RAG disabled or no results found
      if (!fileContext) {
        fileContext = files
          .map(
            (file) =>
              `[File: ${file.metadata.fileName}]\n${file.text.slice(0, 10000)}${file.text.length > 10000 ? "\n... (truncated)" : ""}`
          )
          .join("\n\n---\n\n")
      }

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
