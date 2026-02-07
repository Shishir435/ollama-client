import { logger } from "@/lib/logger"

/**
 * Query classification for adaptive hybrid search weights
 * Classifies queries as code, API, or conceptual to optimize retrieval
 */

export type QueryType = "code" | "api" | "conceptual"

export interface QueryWeights {
  keywordWeight: number
  semanticWeight: number
}

/**
 * Classify query based on content patterns
 *
 * @param query - User query string
 * @returns Query type classification
 */
export function classifyQuery(query: string): QueryType {
  const lowerQuery = query.toLowerCase()

  // Code patterns: programming keywords and syntax
  const codeKeywords =
    /\b(function|class|const|let|var|return|async|await|import|export|interface|type|enum|implements|extends|constructor|void|null|undefined|typeof|instanceof)\b/
  const codeSymbols = /[{}()[\];=>]|::|->|\.{3}|\$\{/

  // API patterns: HTTP/REST/GraphQL keywords
  const apiKeywords =
    /\b(api|endpoint|http|https|get|post|put|delete|patch|request|response|rest|restful|graphql|mutation|query|subscription|fetch|axios|curl)\b/
  const apiPaths = /\/api\/|https?:\/\//

  // Check code patterns first (most specific)
  if (codeKeywords.test(lowerQuery) || codeSymbols.test(query)) {
    logger.verbose("Query classified as 'code'", "QueryClassifier", {
      query: query.substring(0, 50)
    })
    return "code"
  }

  // Check API patterns
  if (apiKeywords.test(lowerQuery) || apiPaths.test(query)) {
    logger.verbose("Query classified as 'api'", "QueryClassifier", {
      query: query.substring(0, 50)
    })
    return "api"
  }

  // Default to conceptual for general questions
  logger.verbose("Query classified as 'conceptual'", "QueryClassifier", {
    query: query.substring(0, 50)
  })
  return "conceptual"
}

/**
 * Get optimal weights for query type
 *
 * Code/API queries: Favor keyword search (80/20)
 * - Users searching for specific functions, APIs, syntax
 * - Exact matches more important than semantic similarity
 *
 * Conceptual queries: Favor semantic search (30/70)
 * - Users asking about concepts, explanations
 * - Meaning matters more than exact wording
 */
export function getWeightsForQueryType(queryType: QueryType): QueryWeights {
  switch (queryType) {
    case "code":
    case "api":
      // Keyword-heavy: optimize for exact matches
      return { keywordWeight: 0.8, semanticWeight: 0.2 }
    case "conceptual":
      // Semantic-heavy: optimize for meaning
      return { keywordWeight: 0.3, semanticWeight: 0.7 }
  }
}
