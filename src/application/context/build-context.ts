import type { ContextFileInput } from "@ollama-client/contracts/context"
import type { TurnToast } from "@ollama-client/contracts/turns"
import {
  ACTIVITY_LABELS,
  ACTIVITY_TEXTS,
  type ActivityLabel,
  CONTEXT_CHUNK_LABELS
} from "@/application/context/activity-labels"
import {
  reformulateQuestion,
  retrieveContext,
  retrieveContextFromSources
} from "@/application/context/rag"
import { classifyQuery } from "@/application/context/rag/query-classifier"
import {
  formatEnhancedResults,
  retrieveContextEnhanced
} from "@/application/context/rag/rag-pipeline"
import {
  DEFAULT_KNOWLEDGE_SET_ID,
  DEFAULT_RAG_PROMPT,
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds,
  type KnowledgeSetRecord
} from "@/lib/knowledge/knowledge-sets"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import { assertProviderEnabled } from "@/lib/providers/provider-policy"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import type {
  ActivityEvent,
  RagSource,
  RagSources,
  UsedContextChunk
} from "@/types"
import type { DurableContextOptions } from "./context-contract"
import { createContextPlan, remainingRagBudget } from "./context-plan"

/**
 * The minimal file shape context building needs: the scope id and the raw text
 * used for the full-text fallback. A full `ProcessedFile` satisfies this
 * structurally, and it is small enough to ship across the extension port when
 * context building runs in the background.
 */
export type { ContextFileInput } from "@ollama-client/contracts/context"
export type { RagSource, RagSources, UsedContextChunk }

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

export interface BuildRagContextOptions extends DurableContextOptions {
  /**
   * True when this turn offers the model its own retrieval tools
   * (`rag_search` / `file_search`). When set, the harness does NOT pre-inject
   * file or conversation-memory context — the model pulls it on demand, which
   * keeps the prompt clean and avoids retrieving the same store twice.
   * Explicitly-selected page/tab context is still injected (no tool covers the
   * live selection), and the current-turn attached-file full-text fallback
   * still runs so a just-uploaded file is available before it is indexed.
   */
  onActivityEvent?: (events: ActivityEvent[]) => void
  /**
   * Side-channel toast for user-facing warnings (e.g. RAG failure). Context
   * building runs in the background, which has no `t`, so the warning names its
   * copy by key and the extension page resolves it.
   */
  toast?: (input: TurnToast) => void
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
    title: CONTEXT_CHUNK_LABELS.selectedTabContext.text,
    titleKey: CONTEXT_CHUNK_LABELS.selectedTabContext.key,
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

  const plan = createContextPlan({
    rawInput,
    maxRagContextChars,
    groundedOnlyMode,
    retrievalToolsActive
  })
  const userContent = plan.userContent
  let contentWithRAG = userContent
  let tabContextLength = 0
  let ragContextLength = 0
  let tabContextTruncated = false

  // Stored file context and conversation-memory context share ONE budget: the
  // configured RAG cap is the ceiling for their combined length, not a per-step
  // limit. Otherwise a turn with both could inject nearly twice the budget and
  // crowd out recent messages / the answer. `<= 0` means unlimited.
  const getRemainingRagBudget = () => remainingRagBudget(plan, ragContextLength)
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
    label: ActivityLabel,
    inputPreview?: string
  ): ActivityEvent => {
    const event: ActivityEvent = {
      id,
      kind,
      label: label.text,
      labelKey: label.key,
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

  const useRag = await readSetting(SETTINGS.USE_RAG)

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
      assertProviderEnabled(provider, modelId)
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

  let queryForRag = plan.initialRetrievalQuery

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
            ACTIVITY_LABELS.rewritingQuery,
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
            ACTIVITY_LABELS.readingPageContext,
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
                : {
                    text: ACTIVITY_TEXTS.noMatchingPageChunks.text,
                    textKey: ACTIVITY_TEXTS.noMatchingPageChunks.key
                  }
          })
        }

        // Skip pre-injecting stored file/memory context when the model has its
        // own retrieval tools this turn — it pulls on demand instead, so the
        // prompt stays clean and the same store isn't retrieved twice.
        if (plan.injectStoredContext) {
          const fileIds = await resolveFileRagScope(files, activeKnowledgeSet)

          if (fileIds && fileIds.length > 0) {
            const searchEvent = startActivityEvent(
              "file-search",
              "searching_files",
              ACTIVITY_LABELS.searchingFiles,
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
                getRemainingRagBudget()
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
                  : {
                      text: ACTIVITY_TEXTS.noMatchingFileChunks.text,
                      textKey: ACTIVITY_TEXTS.noMatchingFileChunks.key
                    }
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
              ACTIVITY_LABELS.searchingMemory,
              preview(queryForRag)
            )
            const memoryResults = await retrieveContextEnhanced(queryForRag, {
              type: "chat",
              topK: 4
            })
            // Memory shares the RAG budget with file context above; only append
            // what fits in the remainder so the two together stay within cap.
            const memoryBudget = getRemainingRagBudget()
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
              sourceTitles: memoryResults.slice(0, 3).map((result) =>
                result.isMemory
                  ? {
                      text: ACTIVITY_TEXTS.previousConversation.text,
                      textKey: ACTIVITY_TEXTS.previousConversation.key
                    }
                  : result.document.metadata.title || {
                      text: ACTIVITY_TEXTS.memory.text,
                      textKey: ACTIVITY_TEXTS.memory.key
                    }
              ),
              outputPreview:
                memoryResults.length > 0
                  ? {
                      text: ACTIVITY_TEXTS.recalledPastConversation.text,
                      textKey: ACTIVITY_TEXTS.recalledPastConversation.key
                    }
                  : {
                      text: ACTIVITY_TEXTS.noMatchingMemory.text,
                      textKey: ACTIVITY_TEXTS.noMatchingMemory.key
                    }
            })
          }
        }
      }
    } catch (e) {
      logger.error("RAG error", "useChat", { error: e })
      upsertActivityEvent({
        id: "rag-error",
        kind: "searching_memory",
        label: ACTIVITY_LABELS.searchingContext.text,
        labelKey: ACTIVITY_LABELS.searchingContext.key,
        status: "error",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        error: e instanceof Error ? e.message : "Context search failed"
      })
      toast?.({
        variant: "destructive",
        titleKey: "chat.errors.context_retrieval_warning_title",
        descriptionKey: "chat.errors.context_retrieval_warning_description"
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

  const insufficientContext = groundedOnlyMode && tabContextLength === 0
  if (groundedOnlyMode && !insufficientContext) {
    const strictGroundingInstruction =
      'You must answer only from the supplied selected-page context. If context is insufficient, respond with: "Insufficient page context."'
    contentWithRAG = `${strictGroundingInstruction}\n\n${contentWithRAG}`
  }

  const promptContextStats: PromptContextStats = {
    promptInputLength: userContent.length,
    promptAugmentedLength: contentWithRAG.length,
    tabContextLength,
    ragContextLength,
    tabContextTruncated,
    groundedOnlyMode,
    insufficientContext,
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
