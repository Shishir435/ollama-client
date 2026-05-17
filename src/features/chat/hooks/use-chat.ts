import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useRef } from "react"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChatStream } from "@/features/chat/hooks/use-chat-stream"
import {
  reformulateQuestion,
  retrieveContext,
  retrieveContextFromSources
} from "@/features/chat/rag"
import { classifyQuery } from "@/features/chat/rag/query-classifier"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_MAX_RAG_CONTEXT_CHARS,
  DEFAULT_MAX_TAB_CONTEXT_CHARS,
  STORAGE_KEYS
} from "@/lib/constants"
import { db } from "@/lib/db"
import type { ProcessedFile } from "@/lib/file-processors/types"
import {
  DEFAULT_KNOWLEDGE_SET_ID,
  DEFAULT_RAG_PROMPT,
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds
} from "@/lib/knowledge/knowledge-sets"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import type { ChatMessage, FileAttachment, SelectedModelRef } from "@/types"

export const useChat = () => {
  const DEBUG_THINKING_STREAM = process.env.NODE_ENV === "development" && false
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    ""
  )
  const [selectedModelRef] = useStorage<SelectedModelRef | null>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [selectionConflictModel] = useStorage<string | null>(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL,
      instance: plasmoGlobalStorage
    },
    null
  )
  const [memoryEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )
  const [maxTabContextChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_TAB_CONTEXT_CHARS
  )
  const [maxRagContextChars] = useStorage<number>(
    {
      key: STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_RAG_CONTEXT_CHARS
  )
  const [groundedOnlyMode] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
      instance: plasmoGlobalStorage
    },
    false
  )
  const { toast } = useToast()

  const { input, setInput } = useChatInput()
  const { selectedTabIds } = useSelectedTabs()
  const { builtContent: contextText, documents: tabDocuments } = useTabContent()
  const { isLoading, setIsLoading, isStreaming, setIsStreaming } =
    useLoadStream()

  const {
    currentSessionId,
    sessions,
    addMessage,
    updateMessage,
    renameSessionTitle,
    createSession,
    setCurrentSessionId,
    hasMoreMessages,
    loadMoreMessages
  } = useChatSessions()

  const scrollRef = useRef<HTMLDivElement>(null)

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const messages = currentSession?.messages ?? []

  const { embedMessages } = useAutoEmbedMessages()

  const currentStreamingMessageId = useRef<number | null>(null)
  const ragSourcesRef = useRef<{
    sources: Array<{
      id: string | number
      title: string
      content: string
      score: number
      source?: string
      chunkIndex?: number
      fileId?: string
      type?: string
    }>
    query: string
  } | null>(null)
  const dbUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const thinkingLogRef = useRef<Map<number, number>>(new Map())
  const promptContextStatsRef = useRef<{
    promptInputLength: number
    promptAugmentedLength: number
    tabContextLength: number
    ragContextLength: number
    tabContextTruncated: boolean
    groundedOnlyMode: boolean
    insufficientContext: boolean
    usedContextChunks: Array<{
      id: string | number
      title: string
      excerpt: string
      score: number
      sectionPath?: string
      source?: string
      chunkIndex?: number
    }>
  } | null>(null)

  const debouncedDbUpdate = (
    id: number,
    content: string,
    thinking?: string
  ) => {
    if (dbUpdateTimeoutRef.current) {
      clearTimeout(dbUpdateTimeoutRef.current)
    }
    dbUpdateTimeoutRef.current = setTimeout(() => {
      updateMessage(id, { content, thinking }, false) // false = write to DB
    }, 1000) // 1 second debounce
  }

  const { startStream, stopStream } = useChatStream({
    setMessages: async (newMessages) => {
      // Logic to update UI state immediately (skip DB)
      if (currentStreamingMessageId.current && newMessages.length > 0) {
        const streamedMsg =
          newMessages.find((m) => m.id === currentStreamingMessageId.current) ||
          newMessages[newMessages.length - 1]
        if (!streamedMsg) return
        if (DEBUG_THINKING_STREAM && streamedMsg.thinking) {
          const id = currentStreamingMessageId.current
          const nextLen = streamedMsg.thinking?.length || 0
          const prevLen = thinkingLogRef.current.get(id) ?? 0
          if (nextLen !== prevLen) {
            console.log("[ThinkingStore] len", nextLen, {
              id,
              tail: streamedMsg.thinking?.slice(-120)
            })
            thinkingLogRef.current.set(id, nextLen)
          }
        }
        // Update local state ONLY (fast)
        updateMessage(
          currentStreamingMessageId.current,
          {
            content: streamedMsg.content,
            thinking: streamedMsg.thinking,
            metrics: streamedMsg.metrics,
            done: streamedMsg.done
          },
          true // true = skip DB
        )

        // Debounce DB update
        if (!streamedMsg.done) {
          debouncedDbUpdate(
            currentStreamingMessageId.current,
            streamedMsg.content,
            streamedMsg.thinking
          )
        } else {
          // Final update should flush DB immediately
          if (dbUpdateTimeoutRef.current)
            clearTimeout(dbUpdateTimeoutRef.current)
          updateMessage(
            currentStreamingMessageId.current,
            {
              content: streamedMsg.content,
              thinking: streamedMsg.thinking,
              metrics: streamedMsg.metrics,
              done: true
            },
            false
          )
          // Also embed if needed
          if (currentSessionId) {
            embedMessages(newMessages, currentSessionId, false).catch((err) => {
              logger.error("Failed to embed messages", "useChat", {
                error: err
              })
            })
          }
        }
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

  const generateResponse = async (
    customModel?: string,
    sessionIdParam?: string,
    contextMessages?: ChatMessage[]
  ) => {
    const sessionId = sessionIdParam || currentSessionId
    if (!sessionId) return

    const modelForRequest =
      customModel || selectedModelRef?.modelId || selectedModel
    if (!modelForRequest) return

    // 1. Add Assistant Shell
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      model: modelForRequest,
      metrics: ragSourcesRef.current
        ? {
            ragSources: ragSourcesRef.current.sources,
            ragQuery: ragSourcesRef.current.query,
            ...(promptContextStatsRef.current || {})
          }
        : promptContextStatsRef.current || undefined
    }
    // Clear sources after using
    ragSourcesRef.current = null
    promptContextStatsRef.current = null

    const assistantId = await addMessage(sessionId, assistantMessage)
    currentStreamingMessageId.current = assistantId

    /*
     * 2. Prepare updated messages for stream context
     * If contextMessages is provided (e.g. from fork), use it.
     * Otherwise fallback to current messages (might be stale if we assume addMessage updated it immediately? No, hook state is stale)
     * Actually, startStream takes `messages` (history) + `generatedMessage`
     * So if contextMessages is passed, it should NOT include the assistant placeholder yet (startStream handles that).
     */
    const history = contextMessages || messages

    startStream({
      model: modelForRequest,
      providerId: selectedModelRef?.providerId,
      messages: history,
      sessionId: sessionId,
      generatedMessage: { ...assistantMessage, id: assistantId }
    })
  }

  const sendMessage = async (
    customInput?: string,
    customModel?: string,
    files?: ProcessedFile[]
  ) => {
    const sessionId = await ensureSessionId()
    if (!sessionId) return

    const rawInput = customInput?.trim() ?? input.trim()

    if (selectionConflictModel) {
      toast({
        variant: "destructive",
        title: "Model provider selection required",
        description: `Select a provider for "${selectionConflictModel}" in the model menu before sending a message.`
      })
      return
    }

    // Allow sending message with just files (no text input)
    if (!rawInput && (!files || files.length === 0)) return

    const includeContext =
      !customInput && selectedTabIds.length > 0 && contextText?.trim()

    // Build initial user message content (without RAG context yet)
    const userContent = rawInput || ""
    const hasTabContext = includeContext && tabDocuments.length > 0

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

    // ✅ 1. Display user message IMMEDIATELY (instant feedback)
    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      attachments
    }
    await addMessage(sessionId, userMessage)

    // Clear input immediately for better UX
    if (!customInput) setInput("")

    // Rename session title if it's still "New Chat"
    const titleContent = rawInput || files?.[0]?.metadata.fileName || ""
    await autoRenameSession(sessionId, titleContent)

    // 🔄 2. Calculate RAG context asynchronously (in background)
    let contentWithRAG = userContent
    let tabContextLength = 0
    let ragContextLength = 0
    let tabContextTruncated = false
    const usedContextChunks: Array<{
      id: string | number
      title: string
      excerpt: string
      score: number
      sectionPath?: string
      source?: string
      chunkIndex?: number
    }> = []

    const clampContext = (value: string, maxChars: number) => {
      if (value.length <= maxChars) {
        return { text: value, truncated: false }
      }
      return {
        text: `${value.slice(0, maxChars)}\n\n[Context truncated due to length]`,
        truncated: true
      }
    }

    const useRag =
      (await plasmoGlobalStorage.get<boolean>(
        STORAGE_KEYS.EMBEDDINGS.USE_RAG
      )) ?? true

    let ragInstruction = DEFAULT_RAG_PROMPT
    let ragInstructionAdded = false
    const invokeModelOnce = async (prompt: string): Promise<string> => {
      try {
        const modelId =
          customModel || selectedModelRef?.modelId || selectedModel
        if (!modelId) return ""

        const provider = await ProviderFactory.getProviderForModel(
          modelId,
          selectedModelRef?.providerId
        )
        let response = ""
        await provider.streamChat(
          {
            model: modelId,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2
          },
          (chunk) => {
            if (chunk.delta) {
              response += chunk.delta
            }
          }
        )
        return response.trim()
      } catch (err) {
        logger.warn("Failed to reformulate question", "useChat", {
          error: err
        })
        return ""
      }
    }
    const appendRagContext = (current: string, context: string) => {
      const block =
        !ragInstructionAdded && ragInstruction
          ? `${ragInstruction}\n\n${context}`
          : context
      ragInstructionAdded = true
      return current ? `${current}\n\n---\n\n${block}` : block
    }

    let pageContextAdded = false

    let queryForRag = rawInput || "summary"

    if (useRag) {
      try {
        // Get recent chat history for context
        const recentHistory = messages
          .filter((m) => m.role !== "system")
          .slice(-5)
          .map((m) => ({
            role: m.role,
            content: m.content
          })) as Array<{ role: "user" | "assistant"; content: string }>

        const queryClassification = classifyQuery(rawInput || "", recentHistory)

        logger.verbose("Query classified", "useChat", {
          intent: queryClassification.intent,
          confidence: queryClassification.confidence,
          shouldUseRAG: queryClassification.shouldUseRAG
        })

        // Skip RAG for casual conversational queries
        if (!queryClassification.shouldUseRAG) {
          logger.info("Skipping RAG for conversational query", "useChat")
        } else {
          const activeKnowledgeSet = await getActiveKnowledgeSet()
          if (activeKnowledgeSet?.ragPrompt?.trim()) {
            ragInstruction = activeKnowledgeSet.ragPrompt.trim()
          }

          const retrievalOverrides = activeKnowledgeSet?.retrieval

          if (
            activeKnowledgeSet?.questionPrompt?.trim() &&
            recentHistory.length >= 2
          ) {
            const reformulated = await reformulateQuestion(
              rawInput || "summary",
              recentHistory,
              invokeModelOnce,
              activeKnowledgeSet.questionPrompt
            )
            if (reformulated) {
              queryForRag = reformulated
              logger.info("Reformulated query for RAG", "useChat", {
                queryForRag
              })
            }
          }

          // Page-only context (ephemeral, not persisted)
          if (hasTabContext) {
            const pageContext = await retrieveContextFromSources(
              queryForRag,
              tabDocuments,
              {
                topK: Math.min(
                  queryClassification.suggestedTopK,
                  retrievalOverrides?.topK ?? queryClassification.suggestedTopK,
                  4
                ),
                minSimilarity: retrievalOverrides?.minSimilarity
              }
            )

            if (pageContext.documents.length > 0) {
              const clampedPageContext = clampContext(
                pageContext.formattedContext,
                maxTabContextChars
              )
              contentWithRAG = appendRagContext(
                contentWithRAG,
                clampedPageContext.text
              )
              tabContextLength += clampedPageContext.text.length
              tabContextTruncated =
                tabContextTruncated || clampedPageContext.truncated
              ragSourcesRef.current = {
                sources: [
                  ...(ragSourcesRef.current?.sources || []),
                  ...pageContext.sources
                ],
                query: rawInput || "summary"
              }
              pageContext.sources.forEach((source) => {
                usedContextChunks.push({
                  id: source.id,
                  title: source.title,
                  excerpt: source.content.slice(0, 220),
                  score: source.score,
                  sectionPath: source.source || source.type,
                  source: source.source,
                  chunkIndex: source.chunkIndex
                })
              })
              pageContextAdded = true
            }
          }

          if (!groundedOnlyMode) {
            // Determine scope: specific files or global
            let fileIds =
              files && files.length > 0
                ? (files
                    .map((f) => f.metadata.fileId)
                    .filter(Boolean) as string[])
                : undefined

            if (!fileIds && activeKnowledgeSet?.id) {
              const setFileIds = await getKnowledgeSetFileIds(
                activeKnowledgeSet.id
              )
              if (setFileIds.length > 0) {
                fileIds = setFileIds
              }
            }

            if (
              fileIds &&
              activeKnowledgeSet?.id === DEFAULT_KNOWLEDGE_SET_ID &&
              fileIds.length === 0
            ) {
              fileIds = undefined
            }

            logger.verbose("RAG searching for context", "useChat", {
              scope: fileIds ? "Specific Files" : "Global",
              suggestedTopK: queryClassification.suggestedTopK,
              suggestedMode: queryClassification.suggestedMode
            })

            // Retrieve RAG context (include memory if enabled)
            const context = await retrieveContext(queryForRag, fileIds, {
              mode: queryClassification.suggestedMode,
              topK:
                retrievalOverrides?.topK ?? queryClassification.suggestedTopK,
              useReranking: true,
              minSimilarity: retrievalOverrides?.minSimilarity,
              minRerankScore: retrievalOverrides?.minRerankScore,
              includeMemory: memoryEnabled,
              memoryTopK: 2
            })

            if (context.documents.length > 0) {
              logger.info("RAG found relevant chunks", "useChat", {
                chunkCount: context.documents.length
              })
              const fileContext = context.formattedContext
              const clampedRagContext = clampContext(
                fileContext,
                maxRagContextChars
              )
              // Store sources for display in "i" button
              ragSourcesRef.current = {
                sources: [
                  ...(ragSourcesRef.current?.sources || []),
                  ...context.sources
                ],
                query: queryForRag
              }
              context.sources.forEach((source) => {
                usedContextChunks.push({
                  id: source.id,
                  title: source.title,
                  excerpt: source.content.slice(0, 220),
                  score: source.score,
                  sectionPath: source.source || source.type,
                  source: source.source,
                  chunkIndex: source.chunkIndex
                })
              })
              // Append RAG context to user message for LLM
              contentWithRAG = appendRagContext(
                contentWithRAG,
                clampedRagContext.text
              )
              ragContextLength += clampedRagContext.text.length
            }
          }
        }
      } catch (e) {
        logger.error("RAG error", "useChat", { error: e })
        toast({
          variant: "destructive",
          title: "RAG Warning",
          description:
            "Failed to retrieve context from files. Continuing without RAG."
        })
      }
    }

    if (!pageContextAdded && includeContext && contextText?.trim()) {
      const clampedFallbackContext = clampContext(
        contextText,
        maxTabContextChars
      )
      contentWithRAG = contentWithRAG
        ? `${contentWithRAG}\n\n---\n\n${clampedFallbackContext.text}`
        : clampedFallbackContext.text
      tabContextLength += clampedFallbackContext.text.length
      tabContextTruncated =
        tabContextTruncated || clampedFallbackContext.truncated
      usedContextChunks.push({
        id: "tab-fallback",
        title: "Selected tab context",
        excerpt: clampedFallbackContext.text.slice(0, 220),
        score: 0.5,
        sectionPath: "fallback-full-context"
      })
    }

    // Fallback to full text ONLY if specific files attached AND no RAG context found
    if (contentWithRAG === userContent && files && files.length > 0) {
      const fallbackFiles = files
      const fullTextContext = fallbackFiles
        .map(
          (file) =>
            `[File: ${file.metadata.fileName}]\n${file.text.slice(0, 10000)}${
              file.text.length > 10000 ? "\n... (truncated)" : ""
            }`
        )
        .join("\n\n---\n\n")
      contentWithRAG = `${contentWithRAG}\n\n---\n\n${fullTextContext}`
    }

    const hasRelevantPageContext = tabContextLength > 0
    if (groundedOnlyMode) {
      const strictGroundingInstruction =
        'You must answer only from the supplied selected-page context. If context is insufficient, respond with: "Insufficient page context."'
      contentWithRAG = `${strictGroundingInstruction}\n\n${contentWithRAG}`
    }

    if (groundedOnlyMode && !hasRelevantPageContext) {
      await addMessage(sessionId, {
        role: "assistant",
        content:
          "Insufficient page context. Select at least one tab with relevant extracted content and try again.",
        done: true,
        model: customModel || selectedModelRef?.modelId || selectedModel,
        metrics: {
          groundedOnlyMode: true,
          insufficientContext: true,
          promptInputLength: userContent.length,
          promptAugmentedLength: contentWithRAG.length,
          tabContextLength,
          ragContextLength,
          tabContextTruncated,
          usedContextChunks
        }
      })
      return
    }

    // 3. Send to LLM with RAG-enhanced context
    // Create a new messages array with the RAG-enhanced user message
    const messagesForLLM = [
      ...messages,
      { ...userMessage, content: contentWithRAG }
    ]

    promptContextStatsRef.current = {
      promptInputLength: userContent.length,
      promptAugmentedLength: contentWithRAG.length,
      tabContextLength,
      ragContextLength,
      tabContextTruncated,
      groundedOnlyMode,
      insufficientContext: false,
      usedContextChunks
    }

    logger.info("Prompt context stats", "useChat", {
      sessionId,
      promptInputLength: userContent.length,
      promptAugmentedLength: contentWithRAG.length,
      tabContextLength,
      ragContextLength,
      tabContextTruncated,
      groundedOnlyMode,
      usedContextChunkCount: usedContextChunks.length
    })

    if (tabContextTruncated) {
      toast({
        title: "Context trimmed",
        description:
          "Extracted tab context exceeded your limit and was trimmed before sending."
      })
    }

    await generateResponse(customModel, sessionId, messagesForLLM)
  }

  return {
    messages,
    isLoading,
    isStreaming,
    sendMessage,
    generateResponse,
    stopGeneration: stopStream,
    scrollRef,
    hasMore: hasMoreMessages,
    onLoadMore: loadMoreMessages
  }
}
