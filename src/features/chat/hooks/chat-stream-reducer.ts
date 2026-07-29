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
    providerName?: string
    model?: string
    baseUrl?: string
    code?: import("@/types/errors").AppErrorCode
    phase?: import("@/types/errors").AppErrorPhase
    incidentId?: string
    durationMs?: number
    recoveryAction?: import("@/types/errors").AppErrorRecoveryAction
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

/**
 * Why a finished turn has no answer to show.
 *
 * - `thinking-only`: the model reasoned but never emitted a visible answer, and
 *   no tool run made that reasoning worth promoting to content.
 * - `no-output`: the stream completed without content, thinking, or tool runs.
 *   Servers do this on a stopped/unloaded model or an exhausted context, and
 *   report it as a clean success, so the turn used to finalize as an empty
 *   bubble with nothing to read and no retry.
 */
export type StreamEmptyReason = "thinking-only" | "no-output"

export type StreamTerminal =
  | {
      type: "success"
      message: ChatMessage
      /**
       * Set when the finished turn has no answer. The message's `content` is
       * empty in that case: the copy is the caller's, because it is UI text
       * that must be localized and this module holds no i18n.
       */
      emptyReason?: StreamEmptyReason
    }
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
      const hasThinking = Boolean(assistant.thinking?.trim())
      const hasToolRuns = (assistant.metrics?.toolRuns?.length ?? 0) > 0
      const thinkingOnlyResponse = !assistant.content.trim() && hasThinking
      // A tool-backed turn's reasoning is the answer often enough to show it,
      // and this is content promotion rather than copy, so it stays here.
      const toolBackedThinkingOnlyResponse = thinkingOnlyResponse && hasToolRuns
      const emptyReason: StreamEmptyReason | undefined =
        thinkingOnlyResponse && !toolBackedThinkingOnlyResponse
          ? "thinking-only"
          : // A stop the user asked for is not a server that answered nothing:
            // it finalizes through the abort path, which owns its own copy.
            !assistant.content.trim() &&
              !hasThinking &&
              !hasToolRuns &&
              !msg.aborted
            ? "no-output"
            : undefined
      const base = thinkingOnlyResponse
        ? {
            ...assistant,
            ...(toolBackedThinkingOnlyResponse
              ? { content: assistant.thinking?.trim() || "" }
              : {}),
            metrics: {
              ...assistant.metrics,
              thinkingOnlyResponse: true
            }
          }
        : emptyReason === "no-output"
          ? {
              ...assistant,
              metrics: { ...assistant.metrics, emptyResponse: true }
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
      terminal = {
        type: "success",
        message: finalMessage,
        ...(emptyReason ? { emptyReason } : {})
      }
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
