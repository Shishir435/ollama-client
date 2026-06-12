import {
  reformulateQuestion,
  retrieveContext,
  retrieveContextFromSources
} from "@/features/chat/rag"
import { classifyQuery } from "@/features/chat/rag/query-classifier"
import { STORAGE_KEYS } from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"
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
  ChatMessage,
  RagSource,
  RagSources,
  SelectedModelRef,
  UsedContextChunk
} from "@/types"

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
}

export interface BuildRagContextOptions {
  rawInput: string
  files?: ProcessedFile[]
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
  /** Model selection (used for query reformulation, not the final chat). */
  selectedModel: string
  selectedModelRef: SelectedModelRef | null
  customModel?: string
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
  files: ProcessedFile[] | undefined,
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

const buildFileFullTextFallback = (files: ProcessedFile[]) =>
  files
    .map(
      (file) =>
        `[File: ${file.metadata.fileName}]\n${file.text.slice(0, 10000)}${
          file.text.length > 10000 ? "\n... (truncated)" : ""
        }`
    )
    .join("\n\n---\n\n")

/**
 * Build a RAG-augmented user message body plus telemetry.
 *
 * This is the heaviest piece of `useChat.sendMessage`, factored out as a
 * pure async function so it can be reasoned about (and eventually tested)
 * in isolation. It performs zero React state mutation — callers thread
 * the result through their own stores.
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
    selectedModel,
    selectedModelRef,
    customModel,
    toast
  } = options

  const userContent = rawInput
  let contentWithRAG = userContent
  let tabContextLength = 0
  let ragContextLength = 0
  let tabContextTruncated = false
  const usedContextChunks: UsedContextChunk[] = []
  let ragSources: RagSources | null = null
  let pageContextAdded = false

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
      await provider.streamChat(
        {
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2
        },
        (chunk) => {
          if (chunk.delta) response += chunk.delta
        }
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

        // Page-only context (ephemeral, not persisted).
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
        }

        if (!groundedOnlyMode) {
          const fileIds = await resolveFileRagScope(files, activeKnowledgeSet)

          if (fileIds && fileIds.length > 0) {
            logger.verbose("RAG searching for context", "useChat", {
              scope: "Specific Files",
              suggestedTopK: queryClassification.suggestedTopK,
              suggestedMode: queryClassification.suggestedMode
            })

            const context = await retrieveContext(queryForRag, fileIds, {
              mode: queryClassification.suggestedMode,
              topK:
                retrievalOverrides?.topK ?? queryClassification.suggestedTopK,
              minSimilarity: retrievalOverrides?.minSimilarity,
              minRerankScore: retrievalOverrides?.minRerankScore,
              includeMemory: memoryEnabled,
              memoryTopK: 2
            })

            if (context.documents.length > 0) {
              logger.info("RAG found relevant chunks", "useChat", {
                chunkCount: context.documents.length
              })
              const clamped = clampContext(
                context.formattedContext,
                maxRagContextChars
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
          } else {
            logger.info(
              "Skipping file RAG: no scoped files selected",
              "useChat"
            )
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
    usedContextChunks
  }

  return {
    contentWithRAG,
    ragSources,
    promptContextStats,
    pageContextAdded
  }
}
