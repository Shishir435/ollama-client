import { knowledgeConfig } from "@/lib/config/knowledge-config"
import {
  cosineSimilarity,
  generateEmbedding,
  generateEmbeddingsBatch
} from "@/lib/embeddings/embedding-client"
import {
  getAllDocuments,
  type VectorDocument
} from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { getTextSplitter } from "@/lib/text-processing"
import type { Document } from "@/lib/text-processing/types"
import {
  type EnhancedSearchResult,
  formatEnhancedResults,
  retrieveContextEnhanced
} from "./rag-pipeline"

export interface RetrievedContext {
  documents: VectorDocument[]
  formattedContext: string
  sources: Array<{
    id: string | number
    title: string
    content: string
    score: number
    source?: string
    chunkIndex?: number
    page?: number
    fileId?: string
    type?: string
  }>
}

export interface RagSourceInput {
  id: string
  title: string
  content: string
}

const tokenizeQuery = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((term) => term.length > 2)

const scoreKeywordMatch = (text: string, terms: string[]): number => {
  if (terms.length === 0) return 0
  const lower = text.toLowerCase()
  let uniqueMatches = 0
  let totalMatches = 0

  for (const term of terms) {
    if (!term) continue
    let idx = lower.indexOf(term)
    if (idx === -1) continue
    uniqueMatches += 1
    while (idx !== -1) {
      totalMatches += 1
      idx = lower.indexOf(term, idx + term.length)
    }
  }

  return uniqueMatches * 2 + totalMatches
}

/**
 * Retrieves relevant context for a query from a knowledge base
 * Supports three modes:
 * - similarity: Hybrid search (keyword + semantic)
 * - similarity-rerank: Enhanced pipeline with re-ranking (RECOMMENDED)
 * - full: All documents
 */
export async function retrieveContext(
  query: string,
  fileId?: string | string[],
  options: {
    mode?: "similarity" | "similarity-rerank" | "full"
    topK?: number
    maxTokens?: number
    useReranking?: boolean
    minSimilarity?: number
    minRerankScore?: number
    includeMemory?: boolean
    memoryTopK?: number
  } = {}
): Promise<RetrievedContext> {
  const {
    mode = "similarity",
    topK,
    maxTokens,
    minSimilarity,
    minRerankScore,
    includeMemory,
    memoryTopK
  } = options

  let results: EnhancedSearchResult[] = []

  // ===== MODE: Full Context =====
  if (mode === "full") {
    // Retrieve all documents for this knowledge base
    const fileIds: (string | undefined)[] = Array.isArray(fileId)
      ? fileId
      : [fileId]

    for (const id of fileIds) {
      const result = await getAllDocuments({
        fileId: id,
        type: "file",
        maxTokens: maxTokens || (await knowledgeConfig.getMaxContextSize())
      })

      // Convert to EnhancedSearchResult format
      results.push(
        ...result.documents.map((doc) => ({
          document: doc,
          score: 1.0
        }))
      )

      // Simple token check (approximate, since formatEnhancedResults will also check)
      if (maxTokens && results.length * 100 > maxTokens) {
        // Rough safety break
        // Let formatEnhancedResults handle precise truncation
      }
    }
  }
  // ===== MODE: Enhanced Pipeline (Standard & Rerank) =====
  else {
    logger.info(`Using enhanced RAG pipeline`, "retrieveContext")

    results = await retrieveContextEnhanced(query, {
      topK: topK || (await knowledgeConfig.getRetrievalTopK()),
      fileId,
      diversityEnabled: true,
      minSimilarity:
        minSimilarity ?? (await knowledgeConfig.getMinSimilarity()),
      minRerankScore,
      includeMemory,
      memoryTopK
    })
  }

  // Fallback: if no results found and a specific file scope was provided, return full context
  if (results.length === 0 && fileId) {
    const fallbackIds = Array.isArray(fileId) ? fileId : [fileId]
    const maxContext = maxTokens || (await knowledgeConfig.getMaxContextSize())

    logger.info(
      "No RAG results found, falling back to full context",
      "retrieveContext",
      {
        fileIds: fallbackIds
      }
    )

    for (const id of fallbackIds) {
      const result = await getAllDocuments({
        fileId: id,
        type: "file",
        maxTokens: maxContext
      })

      results.push(
        ...result.documents.map((doc) => ({
          document: doc,
          score: 1.0
        }))
      )
    }
  }

  return formatEnhancedResults(
    results,
    maxTokens || (await knowledgeConfig.getMaxContextSize())
  )
}

/**
 * Retrieves context from in-memory sources (e.g., page content) without persistence.
 */
export async function retrieveContextFromSources(
  query: string,
  sources: RagSourceInput[],
  options: {
    topK?: number
    maxTokens?: number
    minSimilarity?: number
  } = {}
): Promise<RetrievedContext> {
  if (sources.length === 0) {
    return { documents: [], formattedContext: "", sources: [] }
  }

  const timestamp = Date.now()
  const documents: Document[] = sources.map((source) => ({
    pageContent: source.content,
    metadata: {
      fileId: source.id,
      source: source.title,
      title: source.title,
      type: "webpage",
      timestamp
    }
  }))

  const splitter = await getTextSplitter()
  const chunks = await splitter.splitDocuments(documents)
  const texts = chunks.map((chunk) => chunk.pageContent)

  const queryEmbedding = await generateEmbedding(query)
  if ("error" in queryEmbedding) {
    logger.warn(
      "Failed to generate query embedding for in-memory sources, using keyword fallback",
      "retrieveContextFromSources",
      {
        error: queryEmbedding.error
      }
    )
    return buildKeywordFallbackContext(query, chunks, options, timestamp)
  }

  const embeddings = await generateEmbeddingsBatch(texts)

  const results: EnhancedSearchResult[] = []
  const allCandidates: EnhancedSearchResult[] = []
  const minSimilarity =
    options.minSimilarity ?? (await knowledgeConfig.getMinSimilarity())

  for (let i = 0; i < embeddings.length; i++) {
    const emb = embeddings[i]
    if ("error" in emb || !emb.embedding) continue

    const similarity = cosineSimilarity(queryEmbedding.embedding, emb.embedding)
    const chunk = chunks[i]
    const metadata = chunk.metadata || {}
    const document: VectorDocument = {
      content: chunk.pageContent,
      embedding: emb.embedding,
      metadata: {
        source: metadata.source || "Page",
        title: metadata.title || metadata.source || "Page",
        type: "webpage",
        timestamp: metadata.timestamp || timestamp,
        fileId: metadata.fileId,
        chunkIndex: metadata.chunkIndex,
        totalChunks: metadata.totalChunks
      }
    }

    const candidate: EnhancedSearchResult = {
      document,
      score: similarity
    }

    allCandidates.push(candidate)
    if (similarity >= minSimilarity) {
      results.push(candidate)
    }
  }

  if (results.length === 0 && allCandidates.length > 0) {
    logger.info(
      "No in-memory sources exceeded similarity threshold, using top candidates",
      "retrieveContextFromSources",
      { minSimilarity }
    )
    results.push(...allCandidates)
  }

  if (results.length === 0) {
    logger.warn(
      "No valid embeddings for in-memory sources, using keyword fallback",
      "retrieveContextFromSources"
    )
    return buildKeywordFallbackContext(query, chunks, options, timestamp)
  }

  const topK = options.topK || (await knowledgeConfig.getRetrievalTopK())
  const trimmed = results.sort((a, b) => b.score - a.score).slice(0, topK)

  return formatEnhancedResults(
    trimmed,
    options.maxTokens || (await knowledgeConfig.getMaxContextSize())
  )
}

const buildKeywordFallbackContext = async (
  query: string,
  chunks: Document[],
  options: {
    topK?: number
    maxTokens?: number
    minSimilarity?: number
  },
  timestamp: number
): Promise<RetrievedContext> => {
  const terms = tokenizeQuery(query)
  const scored = chunks.map((chunk) => ({
    chunk,
    score: scoreKeywordMatch(chunk.pageContent, terms)
  }))

  scored.sort((a, b) => b.score - a.score)
  const topK = options.topK || (await knowledgeConfig.getRetrievalTopK())
  const fallback = scored.slice(0, topK)

  const maxScore = fallback.reduce(
    (max, item) => (item.score > max ? item.score : max),
    0
  )

  const results: EnhancedSearchResult[] = fallback.map((item) => {
    const metadata = item.chunk.metadata || {}
    return {
      document: {
        content: item.chunk.pageContent,
        embedding: [],
        metadata: {
          source: metadata.source || "Page",
          title: metadata.title || metadata.source || "Page",
          type: "webpage",
          timestamp: metadata.timestamp || timestamp,
          fileId: metadata.fileId,
          chunkIndex: metadata.chunkIndex,
          totalChunks: metadata.totalChunks
        }
      } as VectorDocument,
      score: maxScore > 0 ? item.score / maxScore : 0.1
    }
  })

  return formatEnhancedResults(
    results,
    options.maxTokens || (await knowledgeConfig.getMaxContextSize())
  )
}

/**
 * Reformulates a follow-up question to be standalone
 * Uses LLM to understand conversation context and create standalone query
 */
export async function reformulateQuestion(
  question: string,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  modelInvokeFn: (prompt: string) => Promise<string>,
  questionPromptOverride?: string
): Promise<string> {
  // Get question prompt template
  const questionPromptTemplate =
    questionPromptOverride || (await knowledgeConfig.getQuestionPrompt())

  // Format chat history
  const formattedHistory = chatHistory
    .map((msg) => {
      const role = msg.role === "user" ? "Human" : "Assistant"
      return `${role}: ${msg.content}`
    })
    .join("\n")

  // Build prompt for question reformulation
  const prompt = questionPromptTemplate
    .replace("{chat_history}", formattedHistory)
    .replace("{question}", question)

  // Get reformulated question from LLM
  const reformulated = await modelInvokeFn(prompt)

  if (!reformulated) {
    logger.warn(
      "[RAG Retriever] Failed to reformulate question",
      "RAGRetriever"
    )
    return question
  }

  logger.info(
    `[RAG Retriever] Reformulated question: "${reformulated}"`,
    "RAGRetriever"
  )

  return reformulated.trim()
}
