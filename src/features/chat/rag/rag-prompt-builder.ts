import { knowledgeConfig } from "@/lib/config/knowledge-config"
import type { RetrievedContext } from "./rag-retriever"

/**
 * Builds RAG system prompt with context injection
 */
export async function buildRAGPrompt(
  question: string,
  context: RetrievedContext
): Promise<string> {
  const systemPromptTemplate = await knowledgeConfig.getSystemPrompt()

  const prompt = systemPromptTemplate
    .replace("{context}", context.formattedContext)
    .replace("{question}", question)

  return prompt
}

/**
 * Builds a message array for RAG chat
 * Combines system prompt with conversation history
 */
export function buildRAGMessages(
  ragPrompt: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
  }> = []

  // Add RAG prompt as system message
  messages.push({
    role: "system",
    content: ragPrompt
  })

  // Add conversation history if provided
  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory)
  }

  return messages
}

/**
 * Formats sources for display in the UI
 */
export function formatSources(sources: RetrievedContext["sources"]): Array<{
  name: string
  type: string
  mode: string
  url?: string
}> {
  return sources.map((source) => ({
    name: source.title,
    type: source.type,
    mode: "rag",
    url: source.fileId ? `#file:${source.fileId}` : undefined
  }))
}
