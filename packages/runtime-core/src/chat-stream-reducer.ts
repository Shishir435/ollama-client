import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { CHAT_STREAM_EVENT_TYPES } from "@ollama-client/contracts/streams"
import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "./thinking-stream"

/** Metrics fields the reducer reads or writes; callers may carry more fields. */
export interface StreamAssistantMetrics {
  toolRuns?: unknown[]
  ragQuery?: string
  ragSources?: unknown[]
  eval_count?: number
  thinkingOnlyResponse?: boolean
  emptyResponse?: boolean
}

/** Message fields required by the deterministic streaming reducer. */
export interface StreamAssistantMessage {
  content: string
  thinking?: string
  images?: Array<{ imageId?: string }>
  replayArtifact?: unknown
  done?: boolean
  metrics?: StreamAssistantMetrics
}

/**
 * A raw chunk received from the background turn owner. Deltas, thinking, tool
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
  generatedImages?: Array<{ imageId?: string }>
  replayArtifact?: unknown
  toolRuns?: unknown[]
  done?: boolean
  error?: AppFailure & { debug?: unknown }
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
export interface StreamReducerState<
  TMessage extends StreamAssistantMessage = StreamAssistantMessage
> {
  assistant: TMessage
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

export type StreamTerminal<
  TMessage extends StreamAssistantMessage = StreamAssistantMessage
> =
  | {
      type: "success"
      message: TMessage
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
      partial: TMessage
    }

export interface StreamReduction<
  TMessage extends StreamAssistantMessage = StreamAssistantMessage
> {
  state: StreamReducerState<TMessage>
  /** Duplicate/out-of-order chunk that was ignored (no state change). */
  dropped: boolean
  /** First accepted chunk this turn — caller flips to the streaming state. */
  justStarted: boolean
  /** Visible tokens produced this event, in order (for onToken callbacks). */
  tokens: string[]
  /** The visible message changed and should be re-rendered. */
  changed: boolean
  /** Set once the stream reaches a terminal state. */
  terminal: StreamTerminal<TMessage> | null
}

export const makeStreamReducerState = <TMessage extends StreamAssistantMessage>(
  assistant: TMessage
): StreamReducerState<TMessage> => ({
  assistant,
  thinkingState: makeThinkingParserState(),
  lastSeq: -1,
  started: false
})

const makeDroppedReduction = <TMessage extends StreamAssistantMessage>(
  state: StreamReducerState<TMessage>
): StreamReduction<TMessage> => ({
  state,
  dropped: true,
  justStarted: false,
  tokens: [],
  changed: false,
  terminal: null
})

const getNextSequence = (
  current: number,
  incoming: number | undefined
): number | null => {
  if (typeof incoming !== "number") return current
  return incoming <= current ? null : incoming
}

const reduceRagSources = <TMessage extends StreamAssistantMessage>(
  state: StreamReducerState<TMessage>,
  msg: StreamMessage,
  lastSeq: number,
  justStarted: boolean
): StreamReduction<TMessage> | null => {
  if (
    msg.type !== CHAT_STREAM_EVENT_TYPES.RAG_SOURCES ||
    !msg.payload?.sources
  ) {
    return null
  }

  const assistant = {
    ...state.assistant,
    metrics: {
      ...state.assistant.metrics,
      ragSources: msg.payload.sources,
      ragQuery: msg.payload.query
    }
  } as TMessage

  return {
    state: { ...state, assistant, lastSeq, started: true },
    dropped: false,
    justStarted,
    tokens: [],
    changed: false,
    terminal: null
  }
}

const mergeGeneratedImages = (
  current: StreamAssistantMessage["images"],
  incoming: NonNullable<StreamMessage["generatedImages"]>
): StreamAssistantMessage["images"] => {
  const merged = [...(current ?? [])]
  const seen = new Set(merged.map((image) => image.imageId).filter(Boolean))
  for (const image of incoming) {
    if (image.imageId && seen.has(image.imageId)) continue
    merged.push(image)
    if (image.imageId) seen.add(image.imageId)
  }
  return merged
}

interface AppliedPayload<TMessage extends StreamAssistantMessage> {
  assistant: TMessage
  thinkingState: ThinkingParserState
  tokens: string[]
  changed: boolean
}

const applyStreamPayload = <TMessage extends StreamAssistantMessage>(
  assistant: TMessage,
  msg: StreamMessage,
  initialThinkingState: ThinkingParserState
): AppliedPayload<TMessage> => {
  const thinkingState = { ...initialThinkingState }
  const tokens: string[] = []
  let content = assistant.content
  let thinking = assistant.thinking
  let images = assistant.images
  let replayArtifact = assistant.replayArtifact
  let metrics = assistant.metrics
  let changed = false

  if (msg.generatedImages?.length) {
    images = mergeGeneratedImages(images, msg.generatedImages)
    changed = true
  }
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

  return {
    assistant: {
      ...assistant,
      content,
      thinking,
      images,
      replayArtifact,
      metrics
    } as TMessage,
    thinkingState,
    tokens,
    changed
  }
}

const getEmptyReason = <TMessage extends StreamAssistantMessage>(
  assistant: TMessage,
  aborted: boolean | undefined
): {
  emptyReason?: StreamEmptyReason
  thinkingOnlyResponse: boolean
  toolBackedThinkingOnlyResponse: boolean
} => {
  const hasThinking = Boolean(assistant.thinking?.trim())
  const hasToolRuns = (assistant.metrics?.toolRuns?.length ?? 0) > 0
  const hasImages = (assistant.images?.length ?? 0) > 0
  const thinkingOnlyResponse =
    !assistant.content.trim() && !hasImages && hasThinking
  const toolBackedThinkingOnlyResponse = thinkingOnlyResponse && hasToolRuns

  if (thinkingOnlyResponse && !toolBackedThinkingOnlyResponse) {
    return {
      emptyReason: "thinking-only",
      thinkingOnlyResponse,
      toolBackedThinkingOnlyResponse
    }
  }
  if (
    !assistant.content.trim() &&
    !hasThinking &&
    !hasToolRuns &&
    !hasImages &&
    !aborted
  ) {
    return {
      emptyReason: "no-output",
      thinkingOnlyResponse,
      toolBackedThinkingOnlyResponse
    }
  }
  return { thinkingOnlyResponse, toolBackedThinkingOnlyResponse }
}

const buildSuccessfulTerminal = <TMessage extends StreamAssistantMessage>(
  assistant: TMessage,
  msg: StreamMessage
): { assistant: TMessage; terminal: StreamTerminal<TMessage> } => {
  const {
    emptyReason,
    thinkingOnlyResponse,
    toolBackedThinkingOnlyResponse
  } = getEmptyReason(assistant, msg.aborted)

  let base: StreamAssistantMessage = assistant
  if (thinkingOnlyResponse) {
    base = {
      ...assistant,
      ...(toolBackedThinkingOnlyResponse
        ? { content: assistant.thinking?.trim() || "" }
        : {}),
      metrics: {
        ...assistant.metrics,
        thinkingOnlyResponse: true
      }
    }
  } else if (emptyReason === "no-output") {
    base = {
      ...assistant,
      metrics: { ...assistant.metrics, emptyResponse: true }
    }
  }

  const finalMessage = {
    ...base,
    metrics: {
      ...base.metrics,
      ...msg.metrics
    },
    done: true
  } as TMessage

  return {
    assistant: finalMessage,
    terminal: {
      type: "success",
      message: finalMessage,
      ...(emptyReason ? { emptyReason } : {})
    }
  }
}

const applyTerminal = <TMessage extends StreamAssistantMessage>(
  assistant: TMessage,
  msg: StreamMessage
): { assistant: TMessage; terminal: StreamTerminal<TMessage> | null } => {
  if (!msg.done && !msg.error && !msg.aborted) {
    return { assistant, terminal: null }
  }
  if (msg.error) {
    return {
      assistant: { ...assistant, done: true } as TMessage,
      terminal: { type: "error", error: msg.error, partial: assistant }
    }
  }
  return buildSuccessfulTerminal(assistant, msg)
}

/**
 * Pure transition: fold one {@link StreamMessage} into the turn state and
 * report what the effectful caller should do (render, emit tokens, flip
 * streaming, finalize). Performs no I/O — no `setMessages`, no `toast`, no
 * i18n. The caller owns all of that; error display copy is composed from
 * {@link StreamTerminal} rather than here so this stays testable and
 * replayable.
 */
export const reduceStreamEvent = <TMessage extends StreamAssistantMessage>(
  state: StreamReducerState<TMessage>,
  msg: StreamMessage
): StreamReduction<TMessage> => {
  const lastSeq = getNextSequence(state.lastSeq, msg.seq)
  if (lastSeq === null) return makeDroppedReduction(state)

  const justStarted = !state.started
  const ragReduction = reduceRagSources(state, msg, lastSeq, justStarted)
  if (ragReduction) return ragReduction

  const applied = applyStreamPayload(state.assistant, msg, state.thinkingState)
  const terminalResult = applyTerminal(applied.assistant, msg)

  return {
    state: {
      assistant: terminalResult.assistant,
      thinkingState: applied.thinkingState,
      lastSeq,
      started: true
    },
    dropped: false,
    justStarted,
    tokens: applied.tokens,
    changed: applied.changed,
    terminal: terminalResult.terminal
  }
}
