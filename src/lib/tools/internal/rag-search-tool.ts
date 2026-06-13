import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/**
 * `rag_search` — let a tool-capable model search the user's local knowledge base
 * and past-conversation memory on demand, instead of relying only on the
 * automatic context injected before the turn. Reuses the existing RAG pipeline,
 * so it runs entirely locally and surfaces the same sources in the trace.
 */
export const ragSearchDefinition: ToolDefinition = {
  name: "rag_search",
  description:
    "Search the user's saved documents and past conversation memory for passages relevant to a query. Use this when answering may depend on previously stored knowledge that is not already in the conversation.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to look for, phrased as a search query."
      }
    },
    required: ["query"]
  }
}

export const runRagSearch = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const query = typeof args.query === "string" ? args.query.trim() : ""
  if (!query) {
    return {
      content: "rag_search requires a non-empty 'query'.",
      isError: true
    }
  }

  // Dynamic import keeps the RAG pipeline out of the background entry bundle
  // until a tool call actually needs it (mirrors handleChatWithModel).
  const { retrieveContextEnhanced, formatEnhancedResults } = await import(
    "@/features/chat/rag/rag-pipeline"
  )

  const results = await retrieveContextEnhanced(query, { type: "chat" })
  if (results.length === 0) {
    return { content: `No relevant context found for "${query}".` }
  }

  const { formattedContext, sources } = formatEnhancedResults(results)
  return {
    content: formattedContext,
    sources: sources.map((source) => ({
      title: source.title,
      excerpt:
        typeof source.content === "string"
          ? source.content.slice(0, 200)
          : undefined
    }))
  }
}
