import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "@/lib/thinking-parser"
import type { ChatMessage, ProviderReplayArtifact, ToolRun } from "@/types"

/**
 * A raw chunk received over the provider stream port. Deltas, thinking, tool
 * traces, the `rag_sources` side channel, and terminal done/error/aborted all
 * arrive as this shape; {@link reduceStreamEvent} folds them into turn state.
 */
export interface StreamMessage {
  type?: string
  seq?: number
  message?: {
    content?: string
    thinking?: string
    reasoning?: string
    reasoning_content?: string
  }
  payload?: {
    sources?: Array<{
      id: string | number
      title: string
      content: string
      score: number
      source?: string
      chunkIndex?: number
      fileId?: string
      type?: string
    }>
    query?: string
  }
  delta?: string
  thinkingDelta?: string
  replayArtifact?: ProviderReplayArtifact
  toolRuns?: ToolRun[]
  done?: boolean
  error?: {
    status: number
    message: string
    kind?: import("@/types/errors").AppErrorKind
    messageKey?: string
    userMessage?: string
    retryable?: boolean
    retryAfterMs?: number
    context?: string
    providerId?: string
    debug?: unknown
  }
  aborted?: boolean
  metrics?: Record<string, unknown>
}

/**
 * The complete, serializable state of one streaming turn. Everything the
 * listener used to hold in imperative closures (the accumulating assistant
 * message, the stateful thinking-tag parser, the last applied sequence, and
 * whether any chunk has landed) lives here so the transition is a pure
 * function and can be restored after an MV3 worker restart.
 */
export interface StreamReducerState {
  assistant: ChatMessage
  thinkingState: ThinkingParserState
  /** Highest applied per-turn sequence; chunks at or below it are dropped. */
  lastSeq: number
  /** True once the first non-dropped chunk has been applied this turn. */
  started: boolean
}

export type StreamTerminal =
  | { type: "success"; message: ChatMessage }
  | {
      type: "error"
      error: NonNullable<StreamMessage["error"]>
      /** Accumulated assistant message; the caller composes display copy. */
      partial: ChatMessage
    }

export interface StreamReduction {
  state: StreamReducerState
  /** Duplicate/out-of-order chunk that was ignored (no state change). */
  dropped: boolean
  /** First accepted chunk this turn — caller flips to the streaming state. */
  justStarted: boolean
  /** Visible tokens produced this event, in order (for onToken callbacks). */
  tokens: string[]
  /** The visible message changed and should be re-rendered. */
  changed: boolean
  /** Set once the stream reaches a terminal state. */
  terminal: StreamTerminal | null
}

export const makeStreamReducerState = (
  assistant: ChatMessage
): StreamReducerState => ({
  assistant,
  thinkingState: makeThinkingParserState(),
  lastSeq: -1,
  started: false
})

/**
 * English fallback shown when a stream ends with no visible answer and no
 * tool-backed reasoning to promote. Preexisting content string, not an i18n
 * fallback: it is a synthesized assistant message, not UI chrome.
 */
const THINKING_ONLY_FALLBACK =
  "I did not receive a final answer from the model. Please try again."

/**
 * Pure transition: fold one {@link StreamMessage} into the turn state and
 * report what the effectful caller should do (render, emit tokens, flip
 * streaming, finalize). Performs no I/O — no `setMessages`, no `toast`, no
 * i18n. The caller owns all of that; error display copy is composed from
 * {@link StreamTerminal} rather than here so this stays testable and
 * replayable.
 */
export const reduceStreamEvent = (
  state: StreamReducerState,
  msg: StreamMessage
): StreamReduction => {
  const dropped: StreamReduction = {
    state,
    dropped: true,
    justStarted: false,
    tokens: [],
    changed: false,
    terminal: null
  }

  let lastSeq = state.lastSeq
  if (typeof msg.seq === "number") {
    if (msg.seq <= lastSeq) return dropped
    lastSeq = msg.seq
  }

  const justStarted = !state.started
  let assistant = state.assistant

  // `rag_sources` side channel: fold retrieval metadata into metrics silently
  // (no visible change, no token), matching the legacy early-return.
  if (msg.type === "rag_sources" && msg.payload?.sources) {
    assistant = {
      ...assistant,
      metrics: {
        ...assistant.metrics,
        ragSources: msg.payload.sources,
        ragQuery: msg.payload.query
      }
    }
    return {
      state: { ...state, assistant, lastSeq, started: true },
      dropped: false,
      justStarted,
      tokens: [],
      changed: false,
      terminal: null
    }
  }

  const thinkingState = { ...state.thinkingState }
  const tokens: string[] = []
  let content = assistant.content
  let thinking = assistant.thinking
  let replayArtifact = assistant.replayArtifact
  let metrics = assistant.metrics
  let changed = false

  if (msg.toolRuns) {
    metrics = { ...metrics, toolRuns: msg.toolRuns }
    changed = true
  }

  if (msg.replayArtifact) {
    replayArtifact = msg.replayArtifact
    changed = true
  }

  const rawThinkingDelta =
    msg.message?.thinking ||
    msg.message?.reasoning ||
    msg.message?.reasoning_content
  const normalizedThinkingDelta = msg.thinkingDelta ?? rawThinkingDelta
  if (normalizedThinkingDelta) {
    thinking = `${thinking || ""}${normalizedThinkingDelta}`
    changed = true
  }

  const normalizedDelta = msg.delta ?? msg.message?.content
  if (normalizedDelta !== undefined) {
    const split = splitThinkingDelta(normalizedDelta, thinkingState)
    if (split.thinking) {
      thinking = `${thinking || ""}${split.thinking}`
      changed = true
    }
    if (split.visible) {
      tokens.push(split.visible)
      content = `${content}${split.visible}`
      changed = true
    }
  }

  assistant = { ...assistant, content, thinking, replayArtifact, metrics }

  const isTerminal = Boolean(msg.done || msg.error || msg.aborted)
  let terminal: StreamTerminal | null = null

  if (isTerminal) {
    if (msg.error) {
      terminal = { type: "error", error: msg.error, partial: assistant }
      assistant = { ...assistant, done: true }
    } else {
      const thinkingOnlyResponse =
        !assistant.content.trim() && Boolean(assistant.thinking?.trim())
      const toolBackedThinkingOnlyResponse =
        thinkingOnlyResponse && (assistant.metrics?.toolRuns?.length ?? 0) > 0
      const base = thinkingOnlyResponse
        ? {
            ...assistant,
            content: toolBackedThinkingOnlyResponse
              ? assistant.thinking?.trim() || ""
              : THINKING_ONLY_FALLBACK,
            metrics: {
              ...assistant.metrics,
              thinkingOnlyResponse: true
            }
          }
        : assistant
      const finalMessage: ChatMessage = {
        ...base,
        metrics: {
          ...base.metrics,
          ...(msg.metrics as ChatMessage["metrics"])
        },
        done: true
      }
      terminal = { type: "success", message: finalMessage }
      assistant = finalMessage
    }
  }

  return {
    state: { assistant, thinkingState, lastSeq, started: true },
    dropped: false,
    justStarted,
    tokens,
    changed,
    terminal
  }
}
