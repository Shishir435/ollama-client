import { logger } from "@/lib/logger"
import type { ChatRequest, LLMProvider } from "@/lib/providers/types"
import type { ToolCall, ToolContext, ToolRegistry } from "@/lib/tools"
import type { ChatMessage, ChatStreamMessage, ToolRun } from "@/types"
import {
  buildImageMessage,
  type PreparedToolCall,
  prepareToolCall,
  runPreparedToolCall
} from "./tool-execution"

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

const TOOL_LIMIT_FALLBACK_MESSAGE =
  "I reached the tool-call limit while gathering context. Please try again with a narrower request."

interface ExecutedToolCall {
  /** The `tool`-role reply fed back for this call. */
  toolMessage: ChatMessage
  /** A follow-up `user` message carrying any images the tool returned. */
  imageMessage?: ChatMessage
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
  toolResultMaxChars
}: StreamChatWithToolsOptions): Promise<void> => {
  const workingMessages: ChatMessage[] = [...request.messages]
  const toolRuns: ToolRun[] = []
  let lastFinalMetrics: ChatStreamMessage["metrics"] | undefined

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
    if (finalMetrics) lastFinalMetrics = finalMetrics

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

    const startToolRun = (prepared: PreparedToolCall) => {
      toolRuns.push(prepared.run)
      onChunk({ toolRuns: [...toolRuns] })
    }

    const executeToolCall = async (
      prepared: PreparedToolCall
    ): Promise<ExecutedToolCall> => {
      const { result, content } = await runPreparedToolCall(
        prepared,
        registry,
        ctx,
        signal,
        () => onChunk({ toolRuns: [...toolRuns] })
      )
      onChunk({ toolRuns: [...toolRuns] })

      return {
        toolMessage: {
          role: "tool",
          content,
          toolName: prepared.call.name,
          toolCallId: prepared.call.id
        },
        imageMessage: buildImageMessage(prepared.call, result)
      }
    }

    const preparedCalls = await Promise.all(
      pendingToolCalls.map((call) =>
        prepareToolCall(registry, call, toolResultMaxChars, ctx)
      )
    )
    const toolResultMessages: ChatMessage[] = []
    // `tool`-role messages can't carry images on Ollama / OpenAI-compatible
    // providers, so image-bearing tool results become follow-up user messages.
    // They are appended AFTER all tool results so each assistant tool-call turn's
    // `tool` replies stay consecutive (strict endpoints reject an interleaved
    // user message between them).
    const imageMessages: ChatMessage[] = []

    const collect = (executed: ExecutedToolCall) => {
      toolResultMessages.push(executed.toolMessage)
      if (executed.imageMessage) imageMessages.push(executed.imageMessage)
    }

    for (let index = 0; index < preparedCalls.length; ) {
      const prepared = preparedCalls[index]
      if (prepared.policy.parallelizable) {
        // Run consecutive safe tools together, but keep group boundaries so a
        // non-parallel tool (for example a live browser tab read) still gates
        // the calls after it.
        const parallelGroup: PreparedToolCall[] = []
        while (
          index < preparedCalls.length &&
          preparedCalls[index].policy.parallelizable
        ) {
          parallelGroup.push(preparedCalls[index])
          index++
        }

        for (const item of parallelGroup) startToolRun(item)
        const groupResults = await Promise.all(
          parallelGroup.map(executeToolCall)
        )
        // `Promise.all` preserves input order, so tool result messages are
        // appended in the same order the model requested them.
        for (const executed of groupResults) collect(executed)
        continue
      }

      startToolRun(prepared)
      collect(await executeToolCall(prepared))
      index++
    }

    workingMessages.push(...toolResultMessages, ...imageMessages)
  }

  // Iteration cap hit: make one final, tool-disabled synthesis pass over the
  // accumulated tool results so the user gets an answer, not an empty bubble.
  logger.warn("Tool loop hit max iterations", "streamChatWithTools", {
    maxIterations
  })
  if (signal?.aborted) {
    onChunk({ done: true, aborted: true })
    return
  }

  let synthesisMetrics = lastFinalMetrics
  let synthesisStopped = false
  let emittedSynthesisText = false

  // Keep the `tools` array but forbid new calls via `tool_choice: "none"`.
  // Dropping `tools` entirely would 400 on strict OpenAI-compatible endpoints
  // that reject tool-call history without a `tools` field, erroring the
  // synthesis pass and leaving the user an empty bubble.
  await provider.streamChat(
    { ...request, messages: workingMessages, tool_choice: "none" },
    (chunk) => {
      if (chunk.toolCalls && chunk.toolCalls.length > 0) return
      if (chunk.done && !chunk.error && !chunk.aborted) {
        if (chunk.metrics) synthesisMetrics = chunk.metrics
        return
      }
      if (chunk.error || chunk.aborted) {
        synthesisStopped = true
        onChunk(chunk)
        return
      }
      if (chunk.delta?.trim() || chunk.thinkingDelta?.trim()) {
        emittedSynthesisText = true
      }
      onChunk(chunk)
    },
    signal
  )

  if (synthesisStopped) return
  if (!emittedSynthesisText) {
    onChunk({ delta: TOOL_LIMIT_FALLBACK_MESSAGE })
  }
  onChunk({ done: true, metrics: synthesisMetrics, toolRuns })
}
