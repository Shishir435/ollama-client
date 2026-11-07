import {
  currentRetrievalPolicy,
  retrievalToolAllowed
} from "@/application/context/retrieval-policy"
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
  displayNameKey: "chat.reasoning.trace.documents",
  category: "files",
  iconKey: "file-stack",
  risk: "low",
  resultProvenance: "web-untrusted",
  cacheable: false,
  requires: ["storage"],
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
  ctx: ToolContext
): Promise<ToolResult> => {
  const policy = await currentRetrievalPolicy(ctx.retrievalPolicy, ctx.signal)
  if (!retrievalToolAllowed("file_search", policy))
    return {
      content: "File search has no allowed files for this turn.",
      isError: true
    }
  const query = typeof args.query === "string" ? args.query.trim() : ""
  if (!query) {
    return {
      content: "file_search requires a non-empty 'query'.",
      isError: true
    }
  }

  const { retrieveContextEnhanced, formatEnhancedResults } =
    await import("@/application/context/rag/rag-pipeline")

  ctx.signal?.throwIfAborted()
  const results = await retrieveContextEnhanced(query, {
    type: "file",
    fileId: policy!.fileIds,
    includeMemory: false,
    signal: ctx.signal
  })
  ctx.signal?.throwIfAborted()
  const current = await currentRetrievalPolicy(policy, ctx.signal)
  if (
    !retrievalToolAllowed("file_search", current) ||
    results.some(
      (result) =>
        !current!.fileIds.includes(result.document.metadata.fileId ?? "")
    )
  )
    return {
      content: "File scope changed during retrieval. Please retry.",
      isError: true
    }
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
