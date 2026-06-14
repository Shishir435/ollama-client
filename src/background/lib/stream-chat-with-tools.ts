import { logger } from "@/lib/logger"
import type { ChatRequest, LLMProvider } from "@/lib/providers/types"
import type {
  ToolCall,
  ToolContext,
  ToolRegistry,
  ToolResult,
  ToolRuntimePolicy
} from "@/lib/tools"
import { resolveToolRuntimePolicy } from "@/lib/tools"
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

// The reasoning-trace component translates known tool ids (rag_search, etc.);
// the raw name is the fallback label for any tool it doesn't special-case.
const labelForTool = (name: string): string => name

/** Race a tool call against a timeout so a hung tool can't stall the stream. */
const callWithTimeout = (
  run: Promise<ToolResult>,
  name: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ToolResult> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined

  const timeoutPromise = new Promise<ToolResult>((resolve) => {
    timeoutId = setTimeout(
      () =>
        resolve({
          content: `Tool "${name}" timed out after ${timeoutMs / 1000}s.`,
          isError: true
        }),
      timeoutMs
    )
  })

  const abortPromise = new Promise<ToolResult>((resolve) => {
    abortHandler = () =>
      resolve({
        content: `Tool "${name}" was stopped by the user.`,
        isError: true
      })
    if (signal?.aborted) abortHandler()
    else signal?.addEventListener("abort", abortHandler, { once: true })
  })

  return Promise.race([run, timeoutPromise, abortPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
    if (abortHandler) signal?.removeEventListener("abort", abortHandler)
  })
}

/** Trim a tool result to the char cap, appending a model-visible note. */
const trimToolResult = (
  content: string,
  maxChars: number
): { content: string; truncated: boolean } => {
  if (content.length <= maxChars) return { content, truncated: false }
  const note = `\n\n[Tool result trimmed to ${maxChars} characters to keep responses fast. The user can change this limit in Settings → Context.]`
  return { content: content.slice(0, maxChars) + note, truncated: true }
}

const TOOL_LIMIT_FALLBACK_MESSAGE =
  "I reached the tool-call limit while gathering context. Please try again with a narrower request."

interface PreparedToolCall {
  call: ToolCall
  run: ToolRun
  policy: ToolRuntimePolicy
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

    const prepareToolCall = async (
      call: ToolCall
    ): Promise<PreparedToolCall> => {
      const definition = await registry.getDefinition(call.name)
      const policy = resolveToolRuntimePolicy(
        definition,
        toolResultMaxChars !== undefined
          ? { maxResultChars: toolResultMaxChars }
          : undefined
      )
      return {
        call,
        policy,
        run: {
          toolId: call.name,
          label: labelForTool(call.name),
          displayNameKey: definition?.displayNameKey,
          iconKey: definition?.iconKey,
          category: definition?.category,
          risk: definition?.risk,
          status: "running",
          startedAt: Date.now(),
          args:
            call.arguments && Object.keys(call.arguments).length > 0
              ? call.arguments
              : undefined
        }
      }
    }

    const startToolRun = (prepared: PreparedToolCall) => {
      toolRuns.push(prepared.run)
      onChunk({ toolRuns: [...toolRuns] })
    }

    const executeToolCall = async (
      prepared: PreparedToolCall
    ): Promise<ChatMessage> => {
      const { call, policy, run } = prepared
      const result = policy.enabled
        ? await callWithTimeout(
            registry.call(call.name, call.arguments, ctx),
            call.name,
            policy.timeoutMs,
            signal
          )
        : {
            content: `Tool "${call.name}" is disabled.`,
            isError: true
          }

      // Budget the result so a large page/transcript/RAG dump doesn't balloon
      // the next prompt; the trim is surfaced to the user via the trace.
      const { content: trimmedContent, truncated } = trimToolResult(
        result.content,
        policy.maxResultChars
      )

      run.status = result.isError ? "error" : "done"
      run.completedAt = Date.now()
      if (result.isError) run.error = result.content
      else run.resultPreview = result.content.slice(0, 240)
      if (result.sources?.length) run.sources = result.sources
      if (truncated) run.truncated = true
      onChunk({ toolRuns: [...toolRuns] })

      return {
        role: "tool",
        content: trimmedContent,
        toolName: call.name,
        toolCallId: call.id
      }
    }

    const preparedCalls = await Promise.all(
      pendingToolCalls.map(prepareToolCall)
    )
    const toolResultMessages: ChatMessage[] = []

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
        toolResultMessages.push(...groupResults)
        continue
      }

      startToolRun(prepared)
      toolResultMessages.push(await executeToolCall(prepared))
      index++
    }

    workingMessages.push(...toolResultMessages)
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
