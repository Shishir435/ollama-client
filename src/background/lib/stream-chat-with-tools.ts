import { DEFAULT_MAX_TOOL_RESULT_CHARS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChatRequest, LLMProvider } from "@/lib/providers/types"
import type {
  ToolCall,
  ToolContext,
  ToolRegistry,
  ToolResult
} from "@/lib/tools"
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
  /** Per-result character cap; results above this are trimmed (transparency). */
  toolResultMaxChars?: number
}

const DEFAULT_MAX_ITERATIONS = 5

// Generous per-tool ceiling — laptop-local embedding/extraction can be slow, but
// a tool must never hang the whole chat. On timeout the loop continues with an
// error result instead of blocking forever.
const TOOL_TIMEOUT_MS = 60_000

// The reasoning-trace component translates known tool ids (rag_search, etc.);
// the raw name is the fallback label for any tool it doesn't special-case.
const labelForTool = (name: string): string => name

/** Race a tool call against a timeout so a hung tool can't stall the stream. */
const callWithTimeout = (
  run: Promise<ToolResult>,
  name: string
): Promise<ToolResult> =>
  Promise.race([
    run,
    new Promise<ToolResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            content: `Tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s.`,
            isError: true
          }),
        TOOL_TIMEOUT_MS
      )
    )
  ])

/** Trim a tool result to the char cap, appending a model-visible note. */
const trimToolResult = (
  content: string,
  maxChars: number
): { content: string; truncated: boolean } => {
  if (content.length <= maxChars) return { content, truncated: false }
  const note = `\n\n[Tool result trimmed to ${maxChars} characters to keep responses fast. The user can change this limit in Settings → Context.]`
  return { content: content.slice(0, maxChars) + note, truncated: true }
}

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
  maxIterations = DEFAULT_MAX_ITERATIONS,
  toolResultMaxChars = DEFAULT_MAX_TOOL_RESULT_CHARS
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
        // Keep the metrics-bearing done; providers also emit a trailing bare
        // `{ done: true }` (no metrics) at stream end, which must not clobber it.
        if (chunk.done && !chunk.error && !chunk.aborted) {
          if (chunk.metrics) finalMetrics = chunk.metrics
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
        startedAt: Date.now(),
        args:
          call.arguments && Object.keys(call.arguments).length > 0
            ? call.arguments
            : undefined
      }
      toolRuns.push(run)
      onChunk({ toolRuns: [...toolRuns] })

      const result = await callWithTimeout(
        registry.call(call.name, call.arguments, ctx),
        call.name
      )

      // Budget the result so a large page/transcript/RAG dump doesn't balloon
      // the next prompt; the trim is surfaced to the user via the trace.
      const { content: trimmedContent, truncated } = trimToolResult(
        result.content,
        toolResultMaxChars
      )

      run.status = result.isError ? "error" : "done"
      run.completedAt = Date.now()
      if (result.isError) run.error = result.content
      else run.resultPreview = result.content.slice(0, 240)
      if (result.sources?.length) run.sources = result.sources
      if (truncated) run.truncated = true
      onChunk({ toolRuns: [...toolRuns] })

      workingMessages.push({
        role: "tool",
        content: trimmedContent,
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
