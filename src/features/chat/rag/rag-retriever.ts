import { knowledgeConfig } from "@/lib/config/knowledge-config"
import {
  getAllDocuments,
  type VectorDocument
} from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
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
  } = {}
): Promise<RetrievedContext> {
  const { mode = "similarity", topK, maxTokens } = options

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
      minSimilarity: await knowledgeConfig.getMinSimilarity()
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
 * Reformulates a follow-up question to be standalone
 * Uses LLM to understand conversation context and create standalone query
 */
export async function reformulateQuestion(
  question: string,
  chatHistory: Array<{ role: "user" | "assistant"; content: string }>,
  modelInvokeFn: (prompt: string) => Promise<string>
): Promise<string> {
  // Get question prompt template
  const questionPromptTemplate = await knowledgeConfig.getQuestionPrompt()

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
