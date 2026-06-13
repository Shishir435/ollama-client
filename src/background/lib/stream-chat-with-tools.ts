import { logger } from "@/lib/logger"
import type { ChatRequest, LLMProvider } from "@/lib/providers/types"
import type { ToolCall, ToolContext, ToolRegistry } from "@/lib/tools"
import type { ChatMessage, ChatStreamMessage, ToolRun } from "@/types"

interface StreamChatWithToolsOptions {
  provider: LLMProvider
  request: ChatRequest
  registry: ToolRegistry
  onChunk: (chunk: ChatStreamMessage) => void
  signal?: AbortSignal
  ctx: ToolContext
  /** Hard cap on tool round-trips before forcing a final answer. */
  maxIterations?: number
}

const DEFAULT_MAX_ITERATIONS = 5

// The reasoning-trace component translates known tool ids (rag_search, etc.);
// the raw name is the fallback label for any tool it doesn't special-case.
const labelForTool = (name: string): string => name

/**
 * Runs a chat turn that may call tools, provider-agnostically.
 *
 * Each iteration streams one provider turn. Visible content and thinking are
 * forwarded live to `onChunk`; the terminal `done` is suppressed until the model
 * stops requesting tools. When a turn emits tool calls, each is executed through
 * the registry, the assistant turn and `tool` results are appended to the
 * working history, and the provider is re-invoked. A running `toolRuns` trace is
 * streamed so the UI can show what ran. A failed tool yields an error result fed
 * back to the model — it never aborts the stream.
 *
 * The tool exchange is ephemeral: only the final answer (plus the `toolRuns`
 * trace) is persisted, mirroring how RAG context injection works today.
 */
export const streamChatWithTools = async ({
  provider,
  request,
  registry,
  onChunk,
  signal,
  ctx,
  maxIterations = DEFAULT_MAX_ITERATIONS
}: StreamChatWithToolsOptions): Promise<void> => {
  const workingMessages: ChatMessage[] = [...request.messages]
  const toolRuns: ToolRun[] = []

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      onChunk({ done: true, aborted: true })
      return
    }

    const pendingToolCalls: ToolCall[] = []
    let iterationContent = ""
    let finalMetrics: ChatStreamMessage["metrics"] | undefined
    let stopped = false

    await provider.streamChat(
      { ...request, messages: workingMessages },
      (chunk) => {
        if (chunk.toolCalls && chunk.toolCalls.length > 0) {
          pendingToolCalls.push(...chunk.toolCalls)
          return
        }
        // Hold the terminal `done` — only the final iteration finalizes the UI.
        if (chunk.done && !chunk.error && !chunk.aborted) {
          finalMetrics = chunk.metrics
          return
        }
        if (chunk.error || chunk.aborted) {
          stopped = true
          onChunk(chunk)
          return
        }
        if (typeof chunk.delta === "string") {
          iterationContent += chunk.delta
        }
        onChunk(chunk)
      },
      signal
    )

    if (stopped) return

    if (pendingToolCalls.length === 0) {
      onChunk({ done: true, metrics: finalMetrics, toolRuns })
      return
    }

    // Echo the assistant tool-call turn back to the provider.
    workingMessages.push({
      role: "assistant",
      content: iterationContent,
      toolCalls: pendingToolCalls
    })

    for (const call of pendingToolCalls) {
      const run: ToolRun = {
        toolId: call.name,
        label: labelForTool(call.name),
        status: "running",
        startedAt: Date.now()
      }
      toolRuns.push(run)
      onChunk({ toolRuns: [...toolRuns] })

      const result = await registry.call(call.name, call.arguments, ctx)

      run.status = result.isError ? "error" : "done"
      run.completedAt = Date.now()
      if (result.isError) run.error = result.content
      if (result.sources?.length) run.sources = result.sources
      onChunk({ toolRuns: [...toolRuns] })

      workingMessages.push({
        role: "tool",
        content: result.content,
        toolName: call.name,
        toolCallId: call.id
      })
    }
  }

  // Iteration cap hit: stop the loop and finalize with whatever we have.
  logger.warn("Tool loop hit max iterations", "streamChatWithTools", {
    maxIterations
  })
  onChunk({ done: true, toolRuns })
}
