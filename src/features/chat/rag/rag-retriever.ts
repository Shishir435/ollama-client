import { knowledgeConfig } from "@/lib/config/knowledge-config"
import {
  getAllDocuments,
  similaritySearchWithScore,
  type VectorDocument
} from "@/lib/embeddings/vector-store"

export interface RetrievedContext {
  documents: VectorDocument[]
  formattedContext: string
  sources: Array<{
    title: string
    type: string
    chunkIndex?: number
    fileId?: string
  }>
}

/**
 * Retrieves relevant context for a query from a knowledge base
 * Supports two modes: similarity search (top-k) or full context
 */
export async function retrieveContext(
  query: string,
  fileId: string | string[],
  options: {
    mode?: "similarity" | "full"
    topK?: number
    maxTokens?: number
  } = {}
): Promise<RetrievedContext> {
  const { mode = "similarity", topK, maxTokens } = options

  let documents: VectorDocument[]
  let tokenCount = 0

  if (mode === "full") {
    // Retrieve all documents for this knowledge base
    // If multiple files, we need to fetch for each and combine
    const fileIds = Array.isArray(fileId) ? fileId : [fileId]
    documents = []

    for (const id of fileIds) {
      const result = await getAllDocuments({
        fileId: id,
        type: "file",
        maxTokens: maxTokens || (await knowledgeConfig.getMaxContextSize())
      })
      documents.push(...result.documents)
      tokenCount += result.tokenCount

      // Check if we exceeded max tokens
      if (maxTokens && tokenCount >= maxTokens) {
        break
      }
    }
  } else {
    // Similarity search for top-k most relevant chunks
    const k = topK || (await knowledgeConfig.getRetrievalTopK())
    const results = await similaritySearchWithScore(query, k, {
      fileId, // similaritySearchWithScore supports string | string[]
      type: "file"
    })
    documents = results.map((r) => r.document)
  }

  // Format context string
  const formattedContext = documents
    .map((doc, i) => {
      const source = doc.metadata.title || doc.metadata.source || "Unknown"
      return `[Document ${i + 1}] ${source}\n${doc.content}`
    })
    .join("\n\n---\n\n")

  // Extract source information
  const sources = documents.map((doc) => ({
    title: doc.metadata.title || doc.metadata.source || "Untitled",
    type: doc.metadata.type || "unknown",
    chunkIndex: doc.metadata.chunkIndex,
    fileId: doc.metadata.fileId
  }))

  console.log(
    `[RAG Retriever] Retrieved ${documents.length} chunks (${tokenCount || "unknown"} tokens approx)`
  )

  return {
    documents,
    formattedContext,
    sources
  }
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

  console.log(`[RAG Retriever] Reformulated question: "${reformulated}"`)

  return reformulated.trim()
}
