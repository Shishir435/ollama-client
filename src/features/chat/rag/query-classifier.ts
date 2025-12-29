/**
 * Query Classification for Adaptive RAG Retrieval
 *
 * Classifies user queries to determine appropriate retrieval strategy
 * Uses heuristic pattern matching (no LLM required)
 */

export type QueryIntent =
  | "factual" // "What is X?" - Precise answers
  | "exploratory" // "Tell me about X" - Broader context
  | "procedural" // "How do I X?" - Step-by-step
  | "comparison" // "X vs Y" - Multi-document
  | "summarization" // "Summarize X" - Full context
  | "conversational" // Follow-ups, casual

export interface ClassifiedQuery {
  intent: QueryIntent
  confidence: number // 0-1
  entities: string[]
  shouldUseRAG: boolean
  suggestedTopK: number
  suggestedMode: "similarity" | "full"
}

/**
 * Extract potential entities (nouns, technical terms) from query
 */
function extractEntities(query: string): string[] {
  // Simple entity extraction: capitalize words, technical terms
  const words = query.split(/\s+/)
  const entities: string[] = []

  for (const word of words) {
    // Capitalized words (likely proper nouns)
    if (/^[A-Z][a-z]+/.test(word)) {
      entities.push(word)
    }
    // Technical patterns (camelCase, PascalCase, snake_case)
    if (/[a-z][A-Z]|_/.test(word)) {
      entities.push(word)
    }
    // Acronyms (2+ uppercase letters)
    if (/^[A-Z]{2,}$/.test(word)) {
      entities.push(word)
    }
  }

  return [...new Set(entities)] // Deduplicate
}

/**
 * Classify query intent based on heuristic patterns
 *
 * @param query - User query text
 * @param chatHistory - Recent chat messages for context (optional)
 * @returns Classification with intent, confidence, and retrieval params
 */
export function classifyQuery(
  query: string,
  chatHistory?: Array<{ role: string; content: string }>
): ClassifiedQuery {
  const lower = query.toLowerCase().trim()
  const entities = extractEntities(query)

  // Pattern-based classification
  const patterns = {
    factual: /^(what|who|when|where|which|define|explain)\s/i,
    procedural: /^(how|can\s+i|steps?\s+to|guide|tutorial)\s/i,
    comparison: /\s+(vs\.?|versus|compared?\s+to|difference\s+between)\s+/i,
    summarization: /^(summarize|summary|overview|tl;?dr)\s/i
  }

  // Check each pattern
  for (const [intent, pattern] of Object.entries(patterns) as Array<
    [QueryIntent, RegExp]
  >) {
    if (pattern.test(lower)) {
      const topK = intent === "comparison" ? 10 : intent === "factual" ? 3 : 5

      return {
        intent,
        confidence: 0.8,
        entities,
        shouldUseRAG: true,
        suggestedTopK: topK,
        suggestedMode: intent === "summarization" ? "full" : "similarity"
      }
    }
  }

  // Conversational detection
  const isConversational =
    query.length < 30 &&
    !query.includes("?") &&
    /\b(it|this|that|they|them)\b/i.test(lower)

  if (isConversational) {
    // Check if there's recent context
    const hasRecentContext = chatHistory && chatHistory.length > 0

    return {
      intent: "conversational",
      confidence: 0.6,
      entities,
      shouldUseRAG: hasRecentContext, // Only use RAG if there's context
      suggestedTopK: 3,
      suggestedMode: "similarity"
    }
  }

  // Default: exploratory
  return {
    intent: "exploratory",
    confidence: 0.5,
    entities,
    shouldUseRAG: true,
    suggestedTopK: 5,
    suggestedMode: "similarity"
  }
}

/**
 * Batch classify multiple queries
 */
export function classifyQueriesBatch(
  queries: string[],
  chatHistory?: Array<{ role: string; content: string }>
): ClassifiedQuery[] {
  return queries.map((q) => classifyQuery(q, chatHistory))
}

/**
 * Get human-readable description of query intent
 */
export function getIntentDescription(intent: QueryIntent): string {
  const descriptions: Record<QueryIntent, string> = {
    factual: "Looking for specific facts or definitions",
    exploratory: "Exploring a topic broadly",
    procedural: "Seeking step-by-step instructions",
    comparison: "Comparing multiple options",
    summarization: "Requesting a summary",
    conversational: "Casual follow-up question"
  }
  return descriptions[intent]
}
