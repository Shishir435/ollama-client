import type { ContextFileInput } from "@ollama-client/contracts/context"
import type { TurnToast } from "@ollama-client/contracts/turns"
import {
  ACTIVITY_LABELS,
  ACTIVITY_TEXTS
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
import { isAbortError } from "@/lib/error-utils"
import {
  DEFAULT_KNOWLEDGE_SET_ID,
  DEFAULT_RAG_PROMPT,
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds,
  type KnowledgeSetRecord
} from "@/lib/knowledge/knowledge-sets"
import { logger } from "@/lib/logger"
import {
  getStoredModelConfig,
  resolveModelConfig
} from "@/lib/model-config-utils"
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
import { ContextAssembly, type PromptContextStats } from "./context-assembly"
import type { DurableContextOptions } from "./context-contract"
import { createContextPlan } from "./context-plan"

/**
 * The minimal file shape context building needs: the scope id and the raw text
 * used for the full-text fallback. A full `ProcessedFile` satisfies this
 * structurally, and it is small enough to ship across the extension port when
 * context building runs in the background.
 */
export type { ContextFileInput } from "@ollama-client/contracts/context"
export type { PromptContextStats } from "./context-assembly"
export type { RagSource, RagSources, UsedContextChunk }

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
  /**
   * Cancellation for this build.
   *
   * Runtime-only and never persisted: the durable turn request is written
   * before the build starts, and the background attaches the signal in its
   * `prepareContextOptions` pass, which runs after that write. A stop reaches
   * the query reformulation, retrieval and embedding fetches through it — the
   * turn's status transitions alone only stopped work at stage boundaries.
   */
  signal?: AbortSignal
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

const REFORMULATION_TIMEOUT_MS = 8000
const REFORMULATION_HISTORY_MAX_CHARS = 8000
const PREVIEW_LIMIT = 180

const preview = (value: string, limit = PREVIEW_LIMIT) =>
  value.length > limit ? `${value.slice(0, limit)}...` : value

class ReformulationTimeoutError extends Error {
  override name = "ReformulationTimeoutError"
}

const boundedReformulationHistory = (
  messages: BuildRagContextOptions["messages"]
): Array<{ role: "user" | "assistant"; content: string }> => {
  const recent = messages
    .filter((message) => message.role !== "system")
    .slice(-5)
  const bounded: Array<{ role: "user" | "assistant"; content: string }> = []
  let remaining = REFORMULATION_HISTORY_MAX_CHARS

  for (let index = recent.length - 1; index >= 0 && remaining > 0; index--) {
    const message = recent[index]
    if (message.role !== "user" && message.role !== "assistant") continue
    const content = message.content.slice(-remaining)
    bounded.push({ role: message.role, content })
    remaining -= content.length
  }

  return bounded.reverse()
}

/**
 * Runs `fn` under a timeout that the caller's cancellation can also trigger.
 */
const withTimeoutSignal = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<T> => {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onParentAbort = () => controller.abort(parentSignal?.reason)
  parentSignal?.throwIfAborted()
  parentSignal?.addEventListener("abort", onParentAbort, { once: true })
  try {
    return await fn(controller.signal)
  } catch (error) {
    if (timedOut && !parentSignal?.aborted && isAbortError(error)) {
      throw new ReformulationTimeoutError(
        `Query reformulation exceeded ${timeoutMs}ms`
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    parentSignal?.removeEventListener("abort", onParentAbort)
  }
}

const createModelInvoker =
  (options: BuildRagContextOptions) =>
  async (prompt: string): Promise<string> => {
    try {
      const modelId =
        options.customModel ||
        options.selectedModelRef?.modelId ||
        options.selectedModel
      if (!modelId) return ""

      const provider = await ProviderFactory.getProviderForModel(
        modelId,
        options.selectedModelRef?.providerId
      )
      assertProviderEnabled(provider, modelId)
      const modelConfigMap = await readSetting(SETTINGS.MODEL_CONFIGS)
      const modelParams = resolveModelConfig(
        getStoredModelConfig(
          modelConfigMap,
          modelId,
          options.selectedModelRef?.providerId
        )
      )
      let response = ""
      await withTimeoutSignal(
        (requestSignal) =>
          provider.streamChat(
            {
              model: modelId,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.2,
              num_predict: 64,
              stop: ["\n"],
              think: false,
              num_ctx: modelParams.num_ctx,
              num_thread: modelParams.num_thread,
              num_gpu: modelParams.num_gpu,
              num_batch: modelParams.num_batch,
              keep_alive: modelParams.keep_alive
            },
            (chunk) => {
              if (chunk.delta) response += chunk.delta
            },
            requestSignal
          ),
        REFORMULATION_TIMEOUT_MS,
        options.signal
      )
      return response.trim()
    } catch (error) {
      if (error instanceof ReformulationTimeoutError) {
        logger.info(
          "Query reformulation timed out; using the original query",
          "useChat",
          { timeoutMs: REFORMULATION_TIMEOUT_MS }
        )
        return ""
      }
      if (isAbortError(error)) throw error
      logger.warn("Failed to reformulate question", "useChat", { error })
      return ""
    }
  }

type QueryClassification = ReturnType<typeof classifyQuery>

type ModelInvoker = ReturnType<typeof createModelInvoker>

const maybeRewriteQuery = async ({
  rawInput,
  recentHistory,
  activeKnowledgeSet,
  assembly,
  initialQuery,
  invokeModel
}: {
  rawInput: string
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>
  activeKnowledgeSet?: KnowledgeSetRecord
  assembly: ContextAssembly
  initialQuery: string
  invokeModel: ModelInvoker
}): Promise<string> => {
  const questionPrompt = activeKnowledgeSet?.questionPrompt?.trim()
  if (!questionPrompt || recentHistory.length < 2) return initialQuery

  const rewriteEvent = assembly.startActivity(
    "query-rewrite",
    "query_rewrite",
    ACTIVITY_LABELS.rewritingQuery,
    preview(rawInput || "summary")
  )
  const reformulated = await reformulateQuestion(
    rawInput || "summary",
    recentHistory,
    invokeModel,
    questionPrompt
  )
  assembly.finishActivity(rewriteEvent, {
    outputPreview: preview(reformulated || rawInput || "summary")
  })
  if (!reformulated) return initialQuery

  logger.info("Reformulated query for RAG", "useChat", {
    queryForRag: reformulated
  })
  return reformulated
}

const appendPageRetrieval = async ({
  options,
  queryForRag,
  classification,
  retrievalOverrides,
  assembly
}: {
  options: BuildRagContextOptions
  queryForRag: string
  classification: QueryClassification
  retrievalOverrides?: KnowledgeSetRecord["retrieval"]
  assembly: ContextAssembly
}): Promise<void> => {
  if (!options.hasTabContext) return

  const pageEvent = assembly.startActivity(
    "page-context",
    "reading_page",
    ACTIVITY_LABELS.readingPageContext,
    preview(queryForRag)
  )
  const pageContext = await retrieveContextFromSources(
    queryForRag,
    options.tabDocuments,
    {
      topK: Math.min(
        classification.suggestedTopK,
        retrievalOverrides?.topK ?? classification.suggestedTopK,
        4
      ),
      maxTokens: options.maxTabContextChars,
      minSimilarity: retrievalOverrides?.minSimilarity,
      ...(options.signal ? { signal: options.signal } : {})
    }
  )

  if (pageContext.documents.length > 0) {
    assembly.appendPageContext(
      pageContext.formattedContext,
      pageContext.sources,
      options.rawInput || "summary",
      options.maxTabContextChars
    )
  }
  assembly.finishActivity(pageEvent, {
    resultCount: pageContext.documents.length,
    sourceTitles: pageContext.sources.slice(0, 3).map((source) => source.title),
    outputPreview:
      pageContext.documents.length > 0
        ? preview(pageContext.formattedContext)
        : {
            text: ACTIVITY_TEXTS.noMatchingPageChunks.text,
            textKey: ACTIVITY_TEXTS.noMatchingPageChunks.key
          }
  })
}

const appendFileRetrieval = async ({
  options,
  queryForRag,
  classification,
  activeKnowledgeSet,
  assembly
}: {
  options: BuildRagContextOptions
  queryForRag: string
  classification: QueryClassification
  activeKnowledgeSet?: KnowledgeSetRecord
  assembly: ContextAssembly
}): Promise<void> => {
  const fileIds = await resolveFileRagScope(options.files, activeKnowledgeSet)
  if (!fileIds || fileIds.length === 0) {
    logger.info("Skipping file RAG: no scoped files selected", "useChat")
    return
  }

  const retrievalOverrides = activeKnowledgeSet?.retrieval
  const searchEvent = assembly.startActivity(
    "file-search",
    "searching_files",
    ACTIVITY_LABELS.searchingFiles,
    preview(queryForRag)
  )
  logger.verbose("RAG searching for context", "useChat", {
    scope: "Specific Files",
    suggestedTopK: classification.suggestedTopK,
    suggestedMode: classification.suggestedMode
  })

  const context = await retrieveContext(queryForRag, fileIds, {
    mode: classification.suggestedMode,
    topK: retrievalOverrides?.topK ?? classification.suggestedTopK,
    minSimilarity: retrievalOverrides?.minSimilarity,
    minRerankScore: retrievalOverrides?.minRerankScore,
    includeMemory: false,
    ...(options.signal ? { signal: options.signal } : {})
  })

  if (context.documents.length > 0) {
    logger.info("RAG found relevant chunks", "useChat", {
      chunkCount: context.documents.length
    })
    assembly.appendStoredContext(
      context.formattedContext,
      context.sources,
      queryForRag,
      (source) => source.source
    )
  }
  assembly.finishActivity(searchEvent, {
    resultCount: context.documents.length,
    sourceTitles: context.sources.slice(0, 3).map((source) => source.title),
    outputPreview:
      context.documents.length > 0
        ? preview(context.formattedContext)
        : {
            text: ACTIVITY_TEXTS.noMatchingFileChunks.text,
            textKey: ACTIVITY_TEXTS.noMatchingFileChunks.key
          }
  })
}

const memorySourceTitle = (
  result: Awaited<ReturnType<typeof retrieveContextEnhanced>>[number]
) =>
  result.isMemory
    ? {
        text: ACTIVITY_TEXTS.previousConversation.text,
        textKey: ACTIVITY_TEXTS.previousConversation.key
      }
    : result.document.metadata.title || {
        text: ACTIVITY_TEXTS.memory.text,
        textKey: ACTIVITY_TEXTS.memory.key
      }

const appendMemoryRetrieval = async ({
  options,
  queryForRag,
  assembly
}: {
  options: BuildRagContextOptions
  queryForRag: string
  assembly: ContextAssembly
}): Promise<void> => {
  if (!options.memoryEnabled) return

  const memoryEvent = assembly.startActivity(
    "memory-recall",
    "searching_memory",
    ACTIVITY_LABELS.searchingMemory,
    preview(queryForRag)
  )
  const memoryResults = await retrieveContextEnhanced(queryForRag, {
    type: "chat",
    topK: 4,
    ...(options.signal ? { signal: options.signal } : {})
  })
  if (memoryResults.length > 0 && assembly.remainingRagBudget > 0) {
    const { formattedContext, sources } = formatEnhancedResults(memoryResults)
    assembly.appendStoredContext(
      formattedContext,
      sources,
      queryForRag,
      () => "memory"
    )
  }
  assembly.finishActivity(memoryEvent, {
    resultCount: memoryResults.length,
    sourceTitles: memoryResults.slice(0, 3).map(memorySourceTitle),
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

const runRagPipeline = async (
  options: BuildRagContextOptions,
  assembly: ContextAssembly,
  initialQuery: string
): Promise<void> => {
  const recentHistory = boundedReformulationHistory(options.messages)
  const classification = classifyQuery(options.rawInput || "", recentHistory)
  logger.verbose("Query classified", "useChat", {
    intent: classification.intent,
    confidence: classification.confidence,
    shouldUseRAG: classification.shouldUseRAG
  })
  if (!classification.shouldUseRAG) {
    logger.info("Skipping RAG for conversational query", "useChat")
    return
  }

  const activeKnowledgeSet = await getActiveKnowledgeSet()
  const ragPrompt = activeKnowledgeSet?.ragPrompt?.trim()
  if (ragPrompt) assembly.setRagInstruction(ragPrompt)

  const queryForRag = await maybeRewriteQuery({
    rawInput: options.rawInput,
    recentHistory,
    activeKnowledgeSet,
    assembly,
    initialQuery,
    invokeModel: createModelInvoker(options)
  })
  await appendPageRetrieval({
    options,
    queryForRag,
    classification,
    retrievalOverrides: activeKnowledgeSet?.retrieval,
    assembly
  })
  if (
    !createContextPlan({
      rawInput: options.rawInput,
      maxRagContextChars: options.maxRagContextChars,
      groundedOnlyMode: options.groundedOnlyMode,
      retrievalToolsActive: options.retrievalToolsActive
    }).injectStoredContext
  ) {
    return
  }
  await appendFileRetrieval({
    options,
    queryForRag,
    classification,
    activeKnowledgeSet,
    assembly
  })
  await appendMemoryRetrieval({ options, queryForRag, assembly })
}

/** Build a RAG-augmented user message body plus telemetry. */
export const buildRagContext = async (
  options: BuildRagContextOptions
): Promise<BuildRagContextResult> => {
  const plan = createContextPlan({
    rawInput: options.rawInput,
    maxRagContextChars: options.maxRagContextChars,
    groundedOnlyMode: options.groundedOnlyMode,
    retrievalToolsActive: options.retrievalToolsActive
  })
  const assembly = new ContextAssembly(
    plan,
    options.groundedOnlyMode,
    options.onActivityEvent,
    DEFAULT_RAG_PROMPT
  )

  options.signal?.throwIfAborted()
  const useRag = await readSetting(SETTINGS.USE_RAG)
  if (useRag) {
    try {
      await runRagPipeline(options, assembly, plan.initialRetrievalQuery)
    } catch (error) {
      if (isAbortError(error)) throw error
      logger.error("RAG error", "useChat", { error })
      assembly.recordError(error)
      options.toast?.({
        variant: "destructive",
        titleKey: "chat.errors.context_retrieval_warning_title",
        descriptionKey: "chat.errors.context_retrieval_warning_description"
      })
    }
  }

  if (options.hasTabContext) {
    assembly.appendTabFallback(options.contextText, options.maxTabContextChars)
  }
  assembly.appendFileFallback(options.files)
  return assembly.finish()
}
