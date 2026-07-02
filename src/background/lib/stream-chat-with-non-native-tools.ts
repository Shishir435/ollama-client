import { logger } from "@/lib/logger"
import type { ChatRequest, LLMProvider } from "@/lib/providers/types"
import type { ToolContext, ToolDefinition, ToolRegistry } from "@/lib/tools"
import { parseNonNativeToolCalls } from "@/lib/tools/non-native/non-native-tool-parser"
import {
  buildNonNativeToolPrompt,
  formatNonNativeToolResult,
  NON_NATIVE_TOOL_CALL_OPEN
} from "@/lib/tools/non-native/non-native-tool-protocol"
import type { ChatMessage, ChatStreamMessage, ToolRun } from "@/types"
import {
  type PreparedToolCall,
  prepareToolCall,
  runPreparedToolCall
} from "./tool-execution"

interface StreamChatWithNonNativeToolsOptions {
  provider: LLMProvider
  request: ChatRequest
  /** Tools to describe in the prompt; must be non-empty to be worthwhile. */
  tools: ToolDefinition[]
  registry: ToolRegistry
  onChunk: (chunk: ChatStreamMessage) => void
  signal?: AbortSignal
  ctx: ToolContext
  maxIterations?: number
  toolResultMaxChars?: number
}

const DEFAULT_MAX_ITERATIONS = 5

const TOOL_LIMIT_FALLBACK_MESSAGE =
  "I reached the tool-call limit while gathering context. Please try again with a narrower request."

/** Append the tool protocol to the system message (or prepend one). */
const injectToolPrompt = (
  messages: ChatMessage[],
  toolPrompt: string
): ChatMessage[] => {
  if (!toolPrompt) return [...messages]
  const copy = [...messages]
  const systemIndex = copy.findIndex((m) => m.role === "system")
  if (systemIndex >= 0) {
    copy[systemIndex] = {
      ...copy[systemIndex],
      content: `${copy[systemIndex].content}\n\n${toolPrompt}`
    }
  } else {
    copy.unshift({ role: "system", content: toolPrompt })
  }
  return copy
}

/**
 * Streams model output while withholding non-native `<tool_call>` syntax from the
 * user. Text is forwarded live until an opening tag appears; from that point the
 * remainder of the turn is captured silently (it is tool-call markup, not an
 * answer). A short tail is held back each delta so an opening tag split across
 * chunk boundaries is still detected before any of it is shown.
 */
class ToolCallStreamGate {
  private full = ""
  private emitted = 0
  private capturing = false

  constructor(private readonly emit: (text: string) => void) {}

  push(delta: string): void {
    this.full += delta
    if (this.capturing) return

    const openIndex = this.full.indexOf(NON_NATIVE_TOOL_CALL_OPEN)
    if (openIndex !== -1) {
      if (openIndex > this.emitted) {
        this.emit(this.full.slice(this.emitted, openIndex))
      }
      this.emitted = openIndex
      this.capturing = true
      return
    }

    // Hold back a tail that could be the start of a split "<tool_call>".
    const safeUpto = Math.max(
      this.emitted,
      this.full.length - (NON_NATIVE_TOOL_CALL_OPEN.length - 1)
    )
    if (safeUpto > this.emitted) {
      this.emit(this.full.slice(this.emitted, safeUpto))
      this.emitted = safeUpto
    }
  }

  /** Flush any held-back tail when the turn produced no tool call. */
  flushTail(): void {
    if (!this.capturing && this.full.length > this.emitted) {
      this.emit(this.full.slice(this.emitted))
      this.emitted = this.full.length
    }
  }

  get text(): string {
    return this.full
  }
}

/**
 * Prompt-based tool loop for models without native tool-calling.
 *
 * Mirrors `streamChatWithTools` but drives tools through the system prompt: it
 * describes the tools, streams a plain-text turn (hiding `<tool_call>` markup),
 * parses any calls out of the turn, executes them through the same registry and
 * runtime policy, feeds results back as a `<tool_response>` user turn, and loops
 * until the model answers without calling tools. The `toolRuns` trace and result
 * `sources` are emitted exactly like the native path, so the reasoning-trace and
 * Sources surfaces work unchanged.
 *
 * Limitations vs native: images returned by tools are dropped (the text protocol
 * can't carry them), and a tool-calling turn is not streamed live to the user
 * (only its non-tool prose prefix is).
 */
export const streamChatWithNonNativeTools = async ({
  provider,
  request,
  tools,
  registry,
  onChunk,
  signal,
  ctx,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  toolResultMaxChars
}: StreamChatWithNonNativeToolsOptions): Promise<void> => {
  const workingMessages = injectToolPrompt(
    request.messages,
    buildNonNativeToolPrompt(tools)
  )
  // Never forward a `tools` array to the provider on this path — the model
  // doesn't support native calls and some endpoints 400 on an unusable field.
  const baseRequest: ChatRequest = { ...request, tools: undefined }
  const toolRuns: ToolRun[] = []
  let lastMetrics: ChatStreamMessage["metrics"] | undefined

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      onChunk({ done: true, aborted: true })
      return
    }

    const gate = new ToolCallStreamGate((text) => onChunk({ delta: text }))
    let metrics: ChatStreamMessage["metrics"] | undefined
    let stopped = false

    await provider.streamChat(
      { ...baseRequest, messages: workingMessages },
      (chunk) => {
        if (chunk.done && !chunk.error && !chunk.aborted) {
          if (chunk.metrics) metrics = chunk.metrics
          return
        }
        if (chunk.error || chunk.aborted) {
          stopped = true
          onChunk(chunk)
          return
        }
        if (typeof chunk.thinkingDelta === "string") {
          onChunk({ thinkingDelta: chunk.thinkingDelta })
        }
        if (typeof chunk.delta === "string") {
          gate.push(chunk.delta)
        }
      },
      signal
    )

    if (stopped) return
    if (metrics) lastMetrics = metrics

    const { toolCalls } = parseNonNativeToolCalls(gate.text)

    if (toolCalls.length === 0) {
      gate.flushTail()
      onChunk({ done: true, metrics, toolRuns: [...toolRuns] })
      return
    }

    // Echo the raw assistant turn (with the tool-call markup) so the model sees
    // its own request when reasoning over the results next turn.
    workingMessages.push({ role: "assistant", content: gate.text })

    const prepared = await Promise.all(
      toolCalls.map((call) =>
        prepareToolCall(registry, call, toolResultMaxChars)
      )
    )
    const responseParts: string[] = []

    const runAndFormat = async (item: PreparedToolCall): Promise<string> => {
      const { content } = await runPreparedToolCall(
        item,
        registry,
        ctx,
        signal,
        () => onChunk({ toolRuns: [...toolRuns] })
      )
      onChunk({ toolRuns: [...toolRuns] })
      return formatNonNativeToolResult(item.call.name, content)
    }

    for (let index = 0; index < prepared.length; ) {
      const item = prepared[index]
      if (item.policy.parallelizable) {
        const group: PreparedToolCall[] = []
        while (
          index < prepared.length &&
          prepared[index].policy.parallelizable
        ) {
          group.push(prepared[index])
          index++
        }
        for (const g of group) {
          toolRuns.push(g.run)
        }
        onChunk({ toolRuns: [...toolRuns] })
        const groupResults = await Promise.all(group.map(runAndFormat))
        responseParts.push(...groupResults)
        continue
      }
      toolRuns.push(item.run)
      onChunk({ toolRuns: [...toolRuns] })
      responseParts.push(await runAndFormat(item))
      index++
    }

    workingMessages.push({
      role: "user",
      content: responseParts.join("\n")
    })
  }

  // Iteration cap: one final plain pass so the user gets an answer.
  logger.warn(
    "Non-native tool loop hit max iterations",
    "streamChatWithNonNativeTools",
    { maxIterations }
  )
  if (signal?.aborted) {
    onChunk({ done: true, aborted: true })
    return
  }

  const finalGate = new ToolCallStreamGate((text) => onChunk({ delta: text }))
  let synthesisMetrics = lastMetrics
  let synthesisStopped = false

  await provider.streamChat(
    { ...baseRequest, messages: workingMessages },
    (chunk) => {
      if (chunk.done && !chunk.error && !chunk.aborted) {
        if (chunk.metrics) synthesisMetrics = chunk.metrics
        return
      }
      if (chunk.error || chunk.aborted) {
        synthesisStopped = true
        onChunk(chunk)
        return
      }
      if (typeof chunk.thinkingDelta === "string") {
        onChunk({ thinkingDelta: chunk.thinkingDelta })
      }
      if (typeof chunk.delta === "string") {
        finalGate.push(chunk.delta)
      }
    },
    signal
  )

  if (synthesisStopped) return
  finalGate.flushTail()
  if (finalGate.text.trim().length === 0) {
    onChunk({ delta: TOOL_LIMIT_FALLBACK_MESSAGE })
  }
  onChunk({ done: true, metrics: synthesisMetrics, toolRuns: [...toolRuns] })
}
