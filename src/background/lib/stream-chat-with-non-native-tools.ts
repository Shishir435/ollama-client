import {
  resolveToolLoopState,
  ToolLoopCoordinator
} from "@ollama-client/chat-runtime/tool-loop-runtime"
import { logger } from "@/lib/logger"
import type { ChatRequest, LLMProvider } from "@/lib/providers/types"
import type { DurableToolLoopState } from "@/lib/repositories/tool-loop-runs"
import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolRegistry,
  ToolResultProvenance
} from "@/lib/tools"
import { parseNonNativeToolCalls } from "@/lib/tools/non-native/non-native-tool-parser"
import {
  buildNonNativeToolPrompt,
  formatNonNativeToolResult,
  NON_NATIVE_TOOL_CALL_OPEN
} from "@/lib/tools/non-native/non-native-tool-protocol"
import type { ChatMessage, ChatStreamMessage } from "@/types"
import {
  isAuthorizationIndependentParallelCall,
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
  initialState?: DurableToolLoopState
  onCheckpoint?: (
    state: DurableToolLoopState,
    awaitingConfirmation: boolean
  ) => Promise<void>
}

const DEFAULT_MAX_ITERATIONS = 5
let streamSeq = 0
const TOOL_LIMIT_FALLBACK_MESSAGE =
  "I reached the tool-call limit while gathering context. Please try again with a narrower request."

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

    const safeUpto = Math.max(
      this.emitted,
      this.full.length - (NON_NATIVE_TOOL_CALL_OPEN.length - 1)
    )
    if (safeUpto > this.emitted) {
      this.emit(this.full.slice(this.emitted, safeUpto))
      this.emitted = safeUpto
    }
  }

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

type StreamCollectionState = {
  metrics?: ChatStreamMessage["metrics"]
  replayArtifact?: ChatStreamMessage["replayArtifact"]
  stopped: boolean
}

const isSuccessfulTerminalChunk = (chunk: ChatStreamMessage): boolean =>
  Boolean(chunk.done && !chunk.error && !chunk.aborted)

const isStoppedChunk = (chunk: ChatStreamMessage): boolean =>
  Boolean(chunk.error || chunk.aborted)

const collectNonNativeStreamChunk = (
  chunk: ChatStreamMessage,
  gate: ToolCallStreamGate,
  state: StreamCollectionState,
  onChunk: (chunk: ChatStreamMessage) => void
): void => {
  if (chunk.replayArtifact) state.replayArtifact = chunk.replayArtifact
  if (isSuccessfulTerminalChunk(chunk)) {
    if (chunk.metrics) state.metrics = chunk.metrics
    return
  }
  if (isStoppedChunk(chunk)) {
    state.stopped = true
    onChunk(chunk)
    return
  }
  if (typeof chunk.thinkingDelta === "string") {
    onChunk({ thinkingDelta: chunk.thinkingDelta })
  }
  if (typeof chunk.delta === "string") gate.push(chunk.delta)
}

export const streamChatWithNonNativeTools = async ({
  provider,
  request,
  tools,
  registry,
  onChunk,
  signal,
  ctx,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  toolResultMaxChars,
  initialState,
  onCheckpoint
}: StreamChatWithNonNativeToolsOptions): Promise<void> => {
  const state: DurableToolLoopState = resolveToolLoopState(
    initialState,
    () => ({
      iteration: 0,
      phase: "model",
      taintGeneration: 0,
      workingMessages: injectToolPrompt(
        request.messages,
        buildNonNativeToolPrompt(tools)
      ),
      toolRuns: []
    })
  )
  const coordinator = new ToolLoopCoordinator(state, onCheckpoint)
  const workingMessages = state.workingMessages
  const baseRequest: ChatRequest = { ...request, tools: undefined }
  const toolRuns = state.toolRuns
  const streamId = ++streamSeq

  if (initialState) onChunk({ toolRuns: [...toolRuns] })

  for (; state.iteration < maxIterations; ) {
    if (signal?.aborted) {
      onChunk({ done: true, aborted: true })
      return
    }

    if (state.phase === "model") {
      const gate = new ToolCallStreamGate((text) => onChunk({ delta: text }))
      const streamState: StreamCollectionState = { stopped: false }

      await provider.streamChat(
        { ...baseRequest, messages: workingMessages },
        (chunk) =>
          collectNonNativeStreamChunk(chunk, gate, streamState, onChunk),
        signal
      )

      if (streamState.stopped) return
      coordinator.setMetrics(streamState.metrics)

      const { toolCalls: parsedCalls } = parseNonNativeToolCalls(gate.text)
      const toolCalls = parsedCalls.map((call) => ({
        ...call,
        id: `s${streamId}_i${state.iteration}_${call.id}`
      }))

      if (toolCalls.length === 0) {
        gate.flushTail()
        onChunk({
          done: true,
          metrics: streamState.metrics,
          toolRuns: [...toolRuns],
          replayArtifact: streamState.replayArtifact
        })
        return
      }

      workingMessages.push({
        role: "assistant",
        content: gate.text,
        replayArtifact: streamState.replayArtifact
      })
      await coordinator.enterTools(toolCalls, "non-native")
    }

    const responseParts = state.nonNativeResponseParts ?? []

    const startToolRun = (item: PreparedToolCall) => {
      item.run = coordinator.reuseOrAddToolRun(item.run)
      onChunk({ toolRuns: [...toolRuns] })
    }

    const runAndFormat = async (
      item: PreparedToolCall
    ): Promise<{ content: string; provenance: ToolResultProvenance }> => {
      const { content, result } = await runPreparedToolCall(
        item,
        registry,
        ctx,
        signal,
        () => onChunk({ toolRuns: [...toolRuns] }),
        coordinator.hasCheckpointWriter
          ? () => coordinator.checkpoint(true)
          : undefined
      )
      onChunk({ toolRuns: [...toolRuns] })
      return {
        content: formatNonNativeToolResult(item.call.name, content),
        provenance: result.provenance ?? "trusted"
      }
    }

    const collect = (result: {
      content: string
      provenance: ToolResultProvenance
    }) => {
      responseParts.push(result.content)
    }

    const prepareAtCurrentGeneration = (
      call: ToolCall,
      taintGeneration: number
    ) =>
      prepareToolCall(registry, call, toolResultMaxChars, {
        ...ctx,
        taintGeneration
      })

    await coordinator.executePendingTools({
      prepare: prepareAtCurrentGeneration,
      canJoinParallelGroup: (call) =>
        isAuthorizationIndependentParallelCall(
          registry,
          call,
          toolResultMaxChars
        ),
      start: startToolRun,
      execute: runAndFormat,
      collect
    })

    await coordinator.completeToolPhase(() => {
      workingMessages.push({
        role: "user",
        content: responseParts.join("\n")
      })
    })
  }

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
  const synthesisState: StreamCollectionState = {
    metrics: state.lastMetrics,
    stopped: false
  }

  await provider.streamChat(
    { ...baseRequest, messages: workingMessages },
    (chunk) =>
      collectNonNativeStreamChunk(chunk, finalGate, synthesisState, onChunk),
    signal
  )

  if (synthesisState.stopped) return
  finalGate.flushTail()
  if (finalGate.text.trim().length === 0) {
    onChunk({ delta: TOOL_LIMIT_FALLBACK_MESSAGE })
  }
  onChunk({
    done: true,
    metrics: synthesisState.metrics,
    toolRuns: [...toolRuns],
    replayArtifact: synthesisState.replayArtifact
  })
}
