/**
 * Reads one OpenCode assistant turn, either from the server's event stream or by
 * polling its messages.
 *
 * Why both: the event stream is the low-latency path but it can start late, stall
 * mid-turn, or drop entirely, and OpenCode records the same output on the message
 * itself. Polling is therefore kept as the reconciliation path rather than a
 * fallback of last resort — every terminal decision is confirmed against the stored
 * message.
 *
 * Lifecycle: both readers can end early with `suspended`, which is how a client tool
 * call interrupts a turn. Suspension is not completion: the OpenCode turn stays
 * alive, waiting for the tool result to come back through the bridge.
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { ProxyLogger, RetryAsync } from "../../types.js"
import { sleep } from "../../util.js"

const DEFAULT_POLL_INTERVAL_MS = 500
const HEARTBEAT_MS = 10_000

export const TERMINAL_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content-filter",
  "content_filter",
  "error",
  "cancelled",
  "canceled"
])

const IGNORED_DEBUG_EVENT_TYPES = new Set([
  "server.connected",
  "server.heartbeat",
  "session.created",
  "session.updated",
  "session.diff",
  "session.status",
  "session.next.agent.switched",
  "session.next.model.switched",
  "plugin.added",
  "reference.updated",
  "integration.updated",
  "catalog.updated"
])

interface MessagePart {
  id?: string
  partID?: string
  type?: string
  text?: string
  tool?: string
  name?: string
  hash?: string
  files?: unknown[]
  messageID?: string
  status?: string
  state?: { status?: string; error?: string; output?: string }
}

export interface MessageFailure {
  name?: string
  message?: string
  data?: { message?: string }
}

interface MessageInfo {
  role?: string
  finish?: string
  time?: { completed?: number }
  error?: MessageFailure | null
}

interface MessageEntry {
  info?: MessageInfo
  parts?: MessagePart[]
}

interface StreamEvent {
  type?: string
  properties?: {
    part?: MessagePart & { sessionID?: string }
    sessionID?: string
    partID?: string
    delta?: string
    info?: { sessionID?: string; finish?: string }
  }
}

export interface PatchPayload {
  hash: string | null
  files: unknown[]
  diffs: unknown[]
}

export interface ToolErrorSummary {
  tool: string
  error?: string
}

export interface TurnOutcome {
  content: string
  reasoning: string
  finish?: string | null
  error?: MessageFailure | null
  toolErrors?: ToolErrorSummary[]
  noData?: boolean
  idleTimeout?: boolean
  suspended?: boolean
  receivedDelta?: boolean
}

/** Split an OpenCode message's parts into the fields a client turn needs. */
export const extractFromParts = (
  parts: unknown
): { content: string; reasoning: string; toolErrors: ToolErrorSummary[] } => {
  if (!Array.isArray(parts)) {
    return { content: "", reasoning: "", toolErrors: [] }
  }
  const list = parts as MessagePart[]

  return {
    content: list
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(""),
    reasoning: list
      .filter((part) => part.type === "reasoning")
      .map((part) => part.text ?? "")
      .join(""),
    toolErrors: list
      .filter(
        (part) =>
          part.type === "tool" &&
          (part.state?.status === "error" || part.state?.status === "failed")
      )
      .map((part) => ({
        tool: part.tool || part.name || "unknown",
        error: part.state?.error || part.state?.output
      }))
  }
}

export const createTurnReader = ({
  client,
  log = () => {},
  retryAsync,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: {
  client: OpencodeClient
  log?: ProxyLogger
  retryAsync: RetryAsync
  pollIntervalMs?: number
}) => {
  const getSessionDiffs = async (
    sessionId: string,
    messageID?: string
  ): Promise<unknown[]> => {
    const response = await retryAsync(
      () =>
        client.session.diff({
          path: { id: sessionId },
          query: messageID ? { messageID } : undefined
        }),
      { label: `session.diff(${sessionId})` }
    )
    const diffs = (response as { data?: unknown })?.data ?? response
    return Array.isArray(diffs) ? diffs : []
  }

  const announcePatch = async (
    sessionId: string,
    part: MessagePart,
    seen: Set<string>,
    onPatch?: (payload: PatchPayload) => void | Promise<void>
  ) => {
    const hash = part.hash || part.id
    if (!hash || seen.has(hash) || typeof onPatch !== "function") return
    seen.add(hash)
    try {
      const diffs = await getSessionDiffs(sessionId, part.messageID)
      await onPatch({
        hash: part.hash ?? null,
        files: Array.isArray(part.files) ? part.files : [],
        diffs
      })
    } catch (error) {
      log("Patch diff fetch failed", {
        sessionId,
        message: (error as Error).message
      })
    }
  }

  /**
   * Open the server event feed for one turn.
   *
   * Returns once the subscription exists, with `done` settling when the turn does.
   * The two stages are separate because a caller that has to release a parked tool
   * result must know the feed is live first — releasing it earlier would let the
   * continuation arrive before anything was listening.
   *
   * `done` resolves with `noData` when nothing arrives before `firstDeltaTimeoutMs`,
   * `idleTimeout` when the feed goes quiet mid-turn, and `suspended` when the turn
   * parks on a client tool call. Each of those hands the decision back to the caller
   * instead of guessing whether the turn is really over.
   */
  const openEventStream = async (
    sessionId: string,
    {
      timeoutMs,
      firstDeltaTimeoutMs,
      idleTimeoutMs,
      onDelta,
      onPatch,
      suspendPromise
    }: {
      timeoutMs: number
      firstDeltaTimeoutMs?: number
      idleTimeoutMs?: number
      onDelta?: (text: string, isReasoning: boolean) => void
      onPatch?: (payload: PatchPayload) => void | Promise<void>
      suspendPromise?: Promise<void>
    }
  ): Promise<{ done: Promise<TurnOutcome>; controller: AbortController }> => {
    const controller = new AbortController()
    const subscription = await client.event.subscribe({
      signal: controller.signal
    })
    const stream = (
      subscription as unknown as { stream: AsyncIterable<unknown> }
    ).stream

    let finished = false
    let content = ""
    let reasoning = ""
    let receivedDelta = false
    let deltaChars = 0
    const startedAt = Date.now()

    const done = new Promise<TurnOutcome>((resolve, reject) => {
      const settle = (value: TurnOutcome) => {
        if (finished) return
        finished = true
        controller.abort()
        resolve(value)
      }

      const timeoutId = setTimeout(() => {
        if (finished) return
        finished = true
        controller.abort()
        reject(new Error(`Request timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      const firstDeltaTimer = firstDeltaTimeoutMs
        ? setTimeout(() => {
            if (receivedDelta) return
            log("No event data received", {
              sessionId,
              ms: Date.now() - startedAt
            })
            settle({ content: "", reasoning: "", noData: true })
          }, firstDeltaTimeoutMs)
        : null

      let idleTimer: NodeJS.Timeout | null = null
      const clearTimers = () => {
        clearTimeout(timeoutId)
        if (firstDeltaTimer) clearTimeout(firstDeltaTimer)
        if (idleTimer) clearTimeout(idleTimer)
      }
      const scheduleIdleTimer = () => {
        if (!idleTimeoutMs) return
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          log("Event idle timeout", {
            sessionId,
            ms: Date.now() - startedAt,
            deltaChars
          })
          settle({ content, reasoning, idleTimeout: true, receivedDelta })
        }, idleTimeoutMs)
      }

      if (suspendPromise) {
        void suspendPromise.then(() => {
          if (finished) return
          log("Turn suspended on a client tool call", {
            sessionId,
            ms: Date.now() - startedAt
          })
          clearTimers()
          settle({ content, reasoning, suspended: true })
        })
      }

      const consume = async () => {
        const partTypeById = new Map<string, string>()
        const seenPatchHashes = new Set<string>()

        for await (const raw of stream) {
          const event = raw as StreamEvent
          const properties = event.properties
          const isPartUpdated =
            event.type === "message.part.updated" &&
            properties?.part?.sessionID === sessionId
          const isPartDelta =
            event.type === "message.part.delta" &&
            properties?.sessionID === sessionId

          if (isPartUpdated || isPartDelta) {
            const part = isPartUpdated ? properties?.part : undefined
            const partId = isPartUpdated
              ? part?.id || part?.partID
              : properties?.partID
            if (isPartUpdated && partId && part?.type) {
              partTypeById.set(partId, part.type)
            }

            if (part && part.type === "patch") {
              await announcePatch(sessionId, part, seenPatchHashes, onPatch)
            } else if (
              part &&
              part.type !== "text" &&
              part.type !== "reasoning"
            ) {
              log("Non-text part activity", {
                sessionId,
                ms: Date.now() - startedAt,
                partType: part.type,
                toolName: part.tool || part.name,
                state: part.state?.status || part.status
              })
            }

            const delta = properties?.delta
            if (delta) {
              const knownType = isPartUpdated
                ? part?.type
                : partId
                  ? partTypeById.get(partId)
                  : undefined
              receivedDelta = true
              if (firstDeltaTimer) clearTimeout(firstDeltaTimer)
              scheduleIdleTimer()
              deltaChars += delta.length

              if (knownType === "reasoning") {
                reasoning += delta
                if (onDelta) onDelta(delta, true)
              } else if (knownType === "text") {
                content += delta
                if (onDelta) onDelta(delta, false)
              } else {
                log("Unclassified part delta (not streamed)", {
                  sessionId,
                  partId,
                  deltaLen: delta.length
                })
              }
            }
          } else if (
            event.type &&
            event.type !== "message.part.updated" &&
            event.type !== "message.updated" &&
            !IGNORED_DEBUG_EVENT_TYPES.has(event.type) &&
            !properties?.sessionID &&
            !properties?.part?.sessionID
          ) {
            log("Unhandled event type", { sessionId, eventType: event.type })
          }

          const info = properties?.info
          if (
            event.type === "message.updated" &&
            info?.sessionID === sessionId &&
            info.finish &&
            TERMINAL_FINISH_REASONS.has(info.finish)
          ) {
            log("Event stream completed", {
              sessionId,
              ms: Date.now() - startedAt,
              deltaChars,
              finish: info.finish
            })
            clearTimers()
            settle({ content, reasoning, finish: info.finish })
            break
          }
        }
      }

      consume().catch((error: unknown) => {
        if (finished) {
          log("Background event listener ended", {
            sessionId,
            error: (error as Error).message
          })
          return
        }
        finished = true
        clearTimers()
        reject(error)
      })
    })

    return { done, controller }
  }

  /**
   * Poll a session's messages until its assistant turn settles.
   *
   * `requireFinalOrContent` distinguishes "give me whatever exists" from "wait for
   * the turn to finish", which matters because a partially written message looks
   * identical to a finished one until its finish reason lands.
   */
  const pollForAssistantResponse = async (
    sessionId: string,
    {
      timeoutMs,
      intervalMs = pollIntervalMs,
      requireFinalOrContent = false,
      onProgress,
      onPatch,
      isSuspended
    }: {
      timeoutMs: number
      intervalMs?: number
      requireFinalOrContent?: boolean
      onProgress?: (content: string, reasoning: string) => void
      onPatch?: (payload: PatchPayload) => void | Promise<void>
      isSuspended?: () => boolean
    }
  ): Promise<TurnOutcome> => {
    let progressContentLen = 0
    let progressReasoningLen = 0
    const seenPatchHashes = new Set<string>()
    const startedAt = Date.now()
    let lastHeartbeatAt = startedAt

    while (Date.now() - startedAt < timeoutMs) {
      if (typeof isSuspended === "function" && isSuspended()) {
        return { content: "", reasoning: "", toolErrors: [], suspended: true }
      }

      const response = await retryAsync(
        () => client.session.messages({ path: { id: sessionId } }),
        { label: `session.messages(${sessionId})` }
      )
      const payload = (response as { data?: unknown })?.data ?? response
      const messages: MessageEntry[] = Array.isArray(payload) ? payload : []

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const entry = messages[index] as MessageEntry
        const info = entry?.info
        if (info?.role !== "assistant") continue

        const { content, reasoning, toolErrors } = extractFromParts(
          entry?.parts
        )
        const error = info?.error ?? null
        const isTerminalFinish = Boolean(
          info.finish && TERMINAL_FINISH_REASONS.has(info.finish)
        )
        const isDone = Boolean(
          isTerminalFinish || info.time?.completed || error
        )

        if (onProgress) {
          const newContent =
            content.length > progressContentLen
              ? content.slice(progressContentLen)
              : ""
          const newReasoning =
            reasoning.length > progressReasoningLen
              ? reasoning.slice(progressReasoningLen)
              : ""
          if (newContent || newReasoning) {
            progressContentLen = content.length
            progressReasoningLen = reasoning.length
            onProgress(newContent, newReasoning)
          }
        }

        if (onPatch) {
          for (const part of (entry?.parts ?? []).filter(
            (candidate) => candidate.type === "patch"
          )) {
            await announcePatch(sessionId, part, seenPatchHashes, onPatch)
          }
        }

        const shouldReturn = requireFinalOrContent
          ? isDone
          : Boolean(isDone || content || reasoning)
        if (shouldReturn) {
          if (error) console.error("[Proxy] OpenCode assistant error:", error)
          log("Polling completed", {
            sessionId,
            ms: Date.now() - startedAt,
            isDone,
            finish: info?.finish ?? null,
            contentLen: content.length,
            reasoningLen: reasoning.length
          })
          return {
            content,
            reasoning,
            error,
            toolErrors,
            finish: info?.finish ?? null
          }
        }

        if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
          lastHeartbeatAt = Date.now()
          log("Polling heartbeat", {
            sessionId,
            ms: Date.now() - startedAt,
            contentLen: content.length,
            reasoningLen: reasoning.length
          })
        }
        break
      }

      await sleep(intervalMs)
    }

    log("Polling timeout", { sessionId, ms: Date.now() - startedAt })
    throw new Error(`Request timeout after ${timeoutMs}ms`)
  }

  const pollForAssistantResponseWithRetries = async (
    sessionId: string,
    options: Parameters<typeof pollForAssistantResponse>[1],
    retries = 0
  ): Promise<TurnOutcome> => {
    let attempt = 0
    while (true) {
      attempt += 1
      try {
        return await pollForAssistantResponse(sessionId, options)
      } catch (error) {
        const message = (error as Error).message
        const isTimeout = /Request timeout after \d+ms/.test(message)
        if (!isTimeout || attempt > retries) throw error
        console.warn(
          `[Proxy][Retry] Session ${sessionId} did not finish within ${options.timeoutMs}ms (attempt ${attempt}/${retries + 1}). Retrying...`
        )
      }
    }
  }

  return {
    openEventStream,
    extractFromParts,
    getSessionDiffs,
    pollForAssistantResponse,
    pollForAssistantResponseWithRetries
  }
}

export type TurnReader = ReturnType<typeof createTurnReader>
export { DEFAULT_POLL_INTERVAL_MS }
