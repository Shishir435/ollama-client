import type { ToolContext, ToolDefinition, ToolResult } from "../types"

/**
 * `file_search` — search the user's uploaded/indexed documents (the RAG `file`
 * corpus), as opposed to past conversation memory (`rag_search`). Reuses the
 * local RAG pipeline scoped to `type: "file"`.
 */
export const fileSearchDefinition: ToolDefinition = {
  name: "file_search",
  description:
    "Search the user's uploaded and indexed documents for passages relevant to a query. Use for questions about the user's files or documents, rather than past conversations.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to look for in the documents, as a search query."
      }
    },
    required: ["query"]
  }
}

export const runFileSearch = async (
  args: Record<string, unknown>,
  _ctx: ToolContext
): Promise<ToolResult> => {
  const query = typeof args.query === "string" ? args.query.trim() : ""
  if (!query) {
    return {
      content: "file_search requires a non-empty 'query'.",
      isError: true
    }
  }

  const { retrieveContextEnhanced, formatEnhancedResults } = await import(
    "@/features/chat/rag/rag-pipeline"
  )

  const results = await retrieveContextEnhanced(query, { type: "file" })
  if (results.length === 0) {
    return { content: `No matching documents found for "${query}".` }
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
