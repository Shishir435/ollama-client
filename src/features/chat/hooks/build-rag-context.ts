import {
  reformulateQuestion,
  retrieveContext,
  retrieveContextFromSources
} from "@/features/chat/rag"
import { classifyQuery } from "@/features/chat/rag/query-classifier"
import {
  formatEnhancedResults,
  retrieveContextEnhanced
} from "@/features/chat/rag/rag-pipeline"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  DEFAULT_KNOWLEDGE_SET_ID,
  DEFAULT_RAG_PROMPT,
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds,
  type KnowledgeSetRecord
} from "@/lib/knowledge/knowledge-sets"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import type {
  ActivityEvent,
  ChatMessage,
  RagSource,
  RagSources,
  SelectedModelRef,
  UsedContextChunk
} from "@/types"

export type { RagSource, RagSources, UsedContextChunk }

/**
 * The minimal file shape context building needs: the scope id and the raw text
 * used for the full-text fallback. A full `ProcessedFile` satisfies this
 * structurally, and it is small enough to ship across the extension port when
 * context building runs in the background.
 */
export interface ContextFileInput {
  text: string
  metadata: { fileName: string; fileId?: string }
}

export interface PromptContextStats {
  promptInputLength: number
  promptAugmentedLength: number
  tabContextLength: number
  ragContextLength: number
  tabContextTruncated: boolean
  groundedOnlyMode: boolean
  insufficientContext: boolean
  usedContextChunks: UsedContextChunk[]
  activityEvents: ActivityEvent[]
}

export interface BuildRagContextOptions {
  rawInput: string
  files?: ContextFileInput[]
  /** Prior conversation messages (used for query classification and reformulation). */
  messages: ChatMessage[]
  /** Currently-selected tabs' built page context, if any. */
  hasTabContext: boolean
  contextText: string
  tabDocuments: Array<{ id: string; title: string; content: string }>
  /** Configuration. */
  memoryEnabled: boolean
  maxTabContextChars: number
  maxRagContextChars: number
  groundedOnlyMode: boolean
  /**
   * True when this turn offers the model its own retrieval tools
   * (`rag_search` / `file_search`). When set, the harness does NOT pre-inject
   * file or conversation-memory context — the model pulls it on demand, which
   * keeps the prompt clean and avoids retrieving the same store twice.
   * Explicitly-selected page/tab context is still injected (no tool covers the
   * live selection), and the current-turn attached-file full-text fallback
   * still runs so a just-uploaded file is available before it is indexed.
   */
  retrievalToolsActive?: boolean
  /** Model selection (used for query reformulation, not the final chat). */
  selectedModel: string
  selectedModelRef: SelectedModelRef | null
  customModel?: string
  onActivityEvent?: (events: ActivityEvent[]) => void
  /** Side-channel toast for user-facing warnings (e.g. RAG failure). */
  toast: (input: {
    variant?: "default" | "destructive"
    title: string
    description?: string
  }) => void
}

export interface BuildRagContextResult {
  /** User content with appended RAG / tab-context blocks. */
  contentWithRAG: string
  /** Sources to attach to the assistant message metrics, if any. */
  ragSources: RagSources | null
  /** Telemetry stats for the prompt — surfaced in message metrics. */
  promptContextStats: PromptContextStats
  /** True if a page-context block was added (suppresses the tab fallback). */
  pageContextAdded: boolean
}

const clampContext = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, maxChars)}\n\n[Context truncated due to length]`,
    truncated: true
  }
}

const mergeRagSources = (
  current: RagSources | null,
  sources: RagSource[],
  query: string
): RagSources => ({
  sources: [...(current?.sources || []), ...sources],
  query
})

const addUsedContextChunks = (
  usedContextChunks: UsedContextChunk[],
  sources: RagSource[],
  sourceFor: (source: RagSource) => UsedContextChunk["source"]
) => {
  sources.forEach((source) => {
    usedContextChunks.push({
      id: source.id,
      title: source.title,
      excerpt: source.content.slice(0, 220),
      score: source.score,
      sectionPath: source.source || source.type,
      source: sourceFor(source),
      chunkIndex: source.chunkIndex
    })
  })
}

const resolveFileRagScope = async (
  files: ContextFileInput[] | undefined,
  activeKnowledgeSet: KnowledgeSetRecord | undefined
) => {
  const explicitFileIds =
    files && files.length > 0
      ? (files.map((file) => file.metadata.fileId).filter(Boolean) as string[])
      : undefined

  if (explicitFileIds) return explicitFileIds

  const hasExplicitKnowledgeSet =
    !!activeKnowledgeSet?.id &&
    activeKnowledgeSet.id !== DEFAULT_KNOWLEDGE_SET_ID

  if (!hasExplicitKnowledgeSet) return undefined

  const setFileIds = await getKnowledgeSetFileIds(activeKnowledgeSet.id)
  return setFileIds.length > 0 ? setFileIds : undefined
}

const buildTabFallbackContext = (contextText: string, maxChars: number) => {
  const clampedFallback = clampContext(contextText, maxChars)
  const chunk: UsedContextChunk = {
    id: "tab-fallback",
    title: "Selected tab context",
    excerpt: clampedFallback.text.slice(0, 220),
    score: 0.5,
    sectionPath: "fallback-full-context",
    source: "tab"
  }

  return { clampedFallback, chunk }
}

const buildFileFullTextFallback = (files: ContextFileInput[]) =>
  files
    .map(
      (file) =>
        `[File: ${file.metadata.fileName}]\n${file.text.slice(0, 10000)}${
          file.text.length > 10000 ? "\n... (truncated)" : ""
        }`
    )
    .join("\n\n---\n\n")

const REFORMULATION_TIMEOUT_MS = 8000
const PREVIEW_LIMIT = 180

const preview = (value: string, limit = PREVIEW_LIMIT) =>
  value.length > limit ? `${value.slice(0, limit)}...` : value

const withTimeoutSignal = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Build a RAG-augmented user message body plus telemetry.
 *
 * This is the heaviest piece of `useChat.sendMessage`, factored out as a
 * pure async function so it can be reasoned about (and eventually tested)
 * in isolation. It performs no direct React state mutation — callers may
 * observe activity events through `onActivityEvent` and thread them into UI.
 *
 * The augmentation pipeline:
 *   1. Classify the query intent.
 *   2. If RAG is on and the query benefits: optionally reformulate the
 *      query using recent history + the active knowledge set prompt.
 *   3. Retrieve page-context (tab documents) and chunk-level context
 *      (vector store + reranker), clamp each to its char budget, append.
 *   4. Track which chunks were used for the assistant message metrics.
 */
export const buildRagContext = async (
  options: BuildRagContextOptions
): Promise<BuildRagContextResult> => {
  const {
    rawInput,
    files,
    messages,
    hasTabContext,
    tabDocuments,
    memoryEnabled,
    maxTabContextChars,
    maxRagContextChars,
    groundedOnlyMode,
    retrievalToolsActive,
    selectedModel,
    selectedModelRef,
    customModel,
    onActivityEvent,
    toast
  } = options

  const userContent = rawInput
  let contentWithRAG = userContent
  let tabContextLength = 0
  let ragContextLength = 0
  let tabContextTruncated = false

  // Stored file context and conversation-memory context share ONE budget: the
  // configured RAG cap is the ceiling for their combined length, not a per-step
  // limit. Otherwise a turn with both could inject nearly twice the budget and
  // crowd out recent messages / the answer. `<= 0` means unlimited.
  const ragBudget =
    maxRagContextChars > 0 ? maxRagContextChars : Number.POSITIVE_INFINITY
  const remainingRagBudget = () => Math.max(0, ragBudget - ragContextLength)
  const usedContextChunks: UsedContextChunk[] = []
  const activityEvents: ActivityEvent[] = []
  let ragSources: RagSources | null = null
  let pageContextAdded = false

  const upsertActivityEvent = (event: ActivityEvent) => {
    const index = activityEvents.findIndex((item) => item.id === event.id)
    if (index >= 0) activityEvents[index] = event
    else activityEvents.push(event)
    onActivityEvent?.([...activityEvents])
  }

  const startActivityEvent = (
    id: string,
    kind: ActivityEvent["kind"],
    label: string,
    inputPreview?: string
  ): ActivityEvent => {
    const event: ActivityEvent = {
      id,
      kind,
      label,
      status: "running",
      startedAt: Date.now(),
      inputPreview
    }
    upsertActivityEvent(event)
    return event
  }

  const finishActivityEvent = (
    event: ActivityEvent,
    updates: Partial<ActivityEvent> = {}
  ) => {
    upsertActivityEvent({
      ...event,
      ...updates,
      status: updates.status ?? "done",
      finishedAt: Date.now()
    })
  }

  const useRag =
    (await plasmoGlobalStorage.get<boolean>(STORAGE_KEYS.EMBEDDINGS.USE_RAG)) ??
    true

  let ragInstruction = DEFAULT_RAG_PROMPT
  let ragInstructionAdded = false

  const invokeModelOnce = async (prompt: string): Promise<string> => {
    try {
      const modelId = customModel || selectedModelRef?.modelId || selectedModel
      if (!modelId) return ""

      const provider = await ProviderFactory.getProviderForModel(
        modelId,
        selectedModelRef?.providerId
      )
      let response = ""
      await withTimeoutSignal(
        (signal) =>
          provider.streamChat(
            {
              model: modelId,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.2,
              num_predict: 64,
              stop: ["\n"],
              think: false
            },
            (chunk) => {
              if (chunk.delta) response += chunk.delta
            },
            signal
          ),
        REFORMULATION_TIMEOUT_MS
      )
      return response.trim()
    } catch (err) {
      logger.warn("Failed to reformulate question", "useChat", { error: err })
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

  let queryForRag = rawInput || "summary"

  if (useRag) {
    try {
      const recentHistory = messages
        .filter((m) => m.role !== "system")
        .slice(-5)
        .map((m) => ({ role: m.role, content: m.content })) as Array<{
        role: "user" | "assistant"
        content: string
      }>

      const queryClassification = classifyQuery(rawInput || "", recentHistory)

      logger.verbose("Query classified", "useChat", {
        intent: queryClassification.intent,
        confidence: queryClassification.confidence,
        shouldUseRAG: queryClassification.shouldUseRAG
      })

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
          const rewriteEvent = startActivityEvent(
            "query-rewrite",
            "query_rewrite",
            "Rewriting query",
            preview(rawInput || "summary")
          )
          const reformulated = await reformulateQuestion(
            rawInput || "summary",
            recentHistory,
            invokeModelOnce,
            activeKnowledgeSet.questionPrompt
          )
          finishActivityEvent(rewriteEvent, {
            outputPreview: preview(reformulated || rawInput || "summary")
          })
          if (reformulated) {
            queryForRag = reformulated
            logger.info("Reformulated query for RAG", "useChat", {
              queryForRag
            })
          }
        }

        // Page-only context (ephemeral, not persisted).
        if (hasTabContext) {
          const pageEvent = startActivityEvent(
            "page-context",
            "reading_page",
            "Reading selected page context",
            preview(queryForRag)
          )
          const pageContext = await retrieveContextFromSources(
            queryForRag,
            tabDocuments,
            {
              topK: Math.min(
                queryClassification.suggestedTopK,
                retrievalOverrides?.topK ?? queryClassification.suggestedTopK,
                4
              ),
              maxTokens: maxTabContextChars,
              minSimilarity: retrievalOverrides?.minSimilarity
            }
          )

          if (pageContext.documents.length > 0) {
            const clamped = clampContext(
              pageContext.formattedContext,
              maxTabContextChars
            )
            contentWithRAG = appendRagContext(contentWithRAG, clamped.text)
            tabContextLength += clamped.text.length
            tabContextTruncated = tabContextTruncated || clamped.truncated
            ragSources = mergeRagSources(
              ragSources,
              pageContext.sources,
              rawInput || "summary"
            )
            addUsedContextChunks(
              usedContextChunks,
              pageContext.sources,
              () => "tab"
            )
            pageContextAdded = true
          }
          finishActivityEvent(pageEvent, {
            resultCount: pageContext.documents.length,
            sourceTitles: pageContext.sources
              .slice(0, 3)
              .map((source) => source.title),
            outputPreview:
              pageContext.documents.length > 0
                ? preview(pageContext.formattedContext)
                : "No matching page chunks"
          })
        }

        // Skip pre-injecting stored file/memory context when the model has its
        // own retrieval tools this turn — it pulls on demand instead, so the
        // prompt stays clean and the same store isn't retrieved twice.
        if (!groundedOnlyMode && !retrievalToolsActive) {
          const fileIds = await resolveFileRagScope(files, activeKnowledgeSet)

          if (fileIds && fileIds.length > 0) {
            const searchEvent = startActivityEvent(
              "file-search",
              "searching_files",
              "Searching files",
              preview(queryForRag)
            )
            logger.verbose("RAG searching for context", "useChat", {
              scope: "Specific Files",
              suggestedTopK: queryClassification.suggestedTopK,
              suggestedMode: queryClassification.suggestedMode
            })

            // Memory is retrieved by its own standalone step below (independent
            // of file scope), so file retrieval must not also fold memory in or
            // it would be injected twice.
            const context = await retrieveContext(queryForRag, fileIds, {
              mode: queryClassification.suggestedMode,
              topK:
                retrievalOverrides?.topK ?? queryClassification.suggestedTopK,
              minSimilarity: retrievalOverrides?.minSimilarity,
              minRerankScore: retrievalOverrides?.minRerankScore,
              includeMemory: false
            })

            if (context.documents.length > 0) {
              logger.info("RAG found relevant chunks", "useChat", {
                chunkCount: context.documents.length
              })
              const clamped = clampContext(
                context.formattedContext,
                remainingRagBudget()
              )
              ragSources = mergeRagSources(
                ragSources,
                context.sources,
                queryForRag
              )
              addUsedContextChunks(
                usedContextChunks,
                context.sources,
                (source) => source.source
              )
              contentWithRAG = appendRagContext(contentWithRAG, clamped.text)
              ragContextLength += clamped.text.length
            }
            finishActivityEvent(searchEvent, {
              resultCount: context.documents.length,
              sourceTitles: context.sources
                .slice(0, 3)
                .map((source) => source.title),
              outputPreview:
                context.documents.length > 0
                  ? preview(context.formattedContext)
                  : "No matching file chunks"
            })
          } else {
            logger.info(
              "Skipping file RAG: no scoped files selected",
              "useChat"
            )
          }

          // Conversation-memory recall, independent of file scope. This is the
          // path that answers "based on our past conversation …": it runs
          // whenever memory is enabled, with or without selected files.
          if (memoryEnabled) {
            const memoryEvent = startActivityEvent(
              "memory-recall",
              "searching_memory",
              "Searching memory",
              preview(queryForRag)
            )
            const memoryResults = await retrieveContextEnhanced(queryForRag, {
              type: "chat",
              topK: 4
            })
            // Memory shares the RAG budget with file context above; only append
            // what fits in the remainder so the two together stay within cap.
            const memoryBudget = remainingRagBudget()
            if (memoryResults.length > 0 && memoryBudget > 0) {
              const { formattedContext, sources } =
                formatEnhancedResults(memoryResults)
              const clamped = clampContext(formattedContext, memoryBudget)
              contentWithRAG = appendRagContext(contentWithRAG, clamped.text)
              ragContextLength += clamped.text.length
              ragSources = mergeRagSources(ragSources, sources, queryForRag)
              addUsedContextChunks(usedContextChunks, sources, () => "memory")
            }
            finishActivityEvent(memoryEvent, {
              resultCount: memoryResults.length,
              sourceTitles: memoryResults
                .slice(0, 3)
                .map((result) =>
                  result.isMemory
                    ? "Previous conversation"
                    : result.document.metadata.title || "Memory"
                ),
              outputPreview:
                memoryResults.length > 0
                  ? "Recalled past conversation context"
                  : "No matching memory"
            })
          }
        }
      }
    } catch (e) {
      logger.error("RAG error", "useChat", { error: e })
      upsertActivityEvent({
        id: "rag-error",
        kind: "searching_memory",
        label: "Searching context",
        status: "error",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        error: e instanceof Error ? e.message : "Context search failed"
      })
      toast({
        variant: "destructive",
        title: "RAG Warning",
        description:
          "Failed to retrieve context from files. Continuing without RAG."
      })
    }
  }

  // Tab fallback: full extracted page text when RAG didn't add page context.
  if (!pageContextAdded && hasTabContext) {
    const { clampedFallback, chunk } = buildTabFallbackContext(
      options.contextText,
      maxTabContextChars
    )
    contentWithRAG = contentWithRAG
      ? `${contentWithRAG}\n\n---\n\n${clampedFallback.text}`
      : clampedFallback.text
    tabContextLength += clampedFallback.text.length
    tabContextTruncated = tabContextTruncated || clampedFallback.truncated
    usedContextChunks.push(chunk)
  }

  // File full-text fallback: only when specific files attached and RAG added nothing.
  if (contentWithRAG === userContent && files && files.length > 0) {
    const fullTextContext = buildFileFullTextFallback(files)
    contentWithRAG = `${contentWithRAG}\n\n---\n\n${fullTextContext}`
  }

  const promptContextStats: PromptContextStats = {
    promptInputLength: userContent.length,
    promptAugmentedLength: contentWithRAG.length,
    tabContextLength,
    ragContextLength,
    tabContextTruncated,
    groundedOnlyMode,
    insufficientContext: false,
    usedContextChunks,
    activityEvents
  }

  return {
    contentWithRAG,
    ragSources,
    promptContextStats,
    pageContextAdded
  }
}
