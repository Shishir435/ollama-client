/**
 * `/v1/chat/completions`, including the tool round trip that lets the calling client
 * execute its own tools inside a backend turn.
 *
 * Lifecycle of a tool-using turn:
 *
 *   1. A request arrives with an OpenAI `tools` array. The backend is asked to start
 *      a turn with them, however that runtime exposes tools to its model.
 *   2. The model calls one. The backend hands the call to `callClientTool`, which
 *      parks it here and interrupts the stream with an OpenAI `tool_calls` delta and
 *      a `tool_calls` finish reason. The backend turn stays alive, blocked on the
 *      parked call.
 *   3. The client executes the tool and sends its next request, whose trailing `tool`
 *      messages carry the same ids. That request resumes the same turn: the parked
 *      call is released and streaming continues where it stopped.
 *
 * Why the round trip: a browser extension cannot host a server, so the client's next
 * request is the only channel a tool result can arrive through. Correlating on the
 * tool-call id keeps the client a plain OpenAI-compatible caller with no knowledge of
 * this proxy or of which backend is behind it.
 */
import type { ServerResponse } from "node:http"
import type {
  AgentBackend,
  BackendTurn,
  TurnResult,
  TurnStreamHandlers
} from "../backends/types.js"
import type {
  ChatCompletionRequest,
  PendingToolCall,
  ProxyConfig,
  ProxyLogger,
  ToolResultMessage
} from "../types.js"
import { isRecord, sleep } from "../util.js"
import { type Router, sendJson, startEventStream } from "./http.js"
import {
  contentChunk,
  extractTrailingToolResults,
  finishChunk,
  patchChunk,
  reasoningChunk,
  roleChunk,
  toolCallsChunk,
  toToolCallPayload
} from "./openai-wire.js"
import type { PendingToolCalls } from "./pending-tool-calls.js"
import type { RequestQueue } from "./queue.js"

const createRequestId = () =>
  `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

interface SuspensionSignal {
  promise: Promise<void>
  trigger: () => void
  readonly settled: boolean
}

const createSuspensionSignal = (): SuspensionSignal => {
  let settled = false
  let trigger: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    trigger = () => {
      if (settled) return
      settled = true
      resolve()
    }
  })
  return {
    promise,
    trigger: () => trigger(),
    get settled() {
      return settled
    }
  }
}

/** Text shown when a turn ends without an answer, so the client is never blank. */
export const buildFallbackAnswerText = (finish?: string | null): string =>
  finish && finish !== "stop"
    ? `[Proxy Notice] The response ended early (finish: ${finish}) before a final answer was produced.`
    : "[Proxy Notice] The model finished this turn without producing a final answer."

/**
 * Send whatever of the final message the stream did not already carry. A backend
 * reports the settled message in full, but it repeats what was streamed, so only the
 * unsent tail is forwarded.
 */
export const unsentTail = (stored: string, streamed: string): string => {
  if (stored.startsWith(streamed)) return stored.slice(streamed.length)
  // The settled message diverges from what was streamed. Re-sending it would
  // duplicate the visible answer, so prefer what the client already has.
  return streamed ? "" : stored
}

interface TurnEmitter {
  readonly streamMode: boolean
  start: () => void
  delta: (text: string, isReasoning: boolean) => void
  auxiliary: (payload: unknown) => void
  toolCalls: (calls: PendingToolCall[]) => void
  finish: (reason: string) => void
  readonly content: string
  readonly reasoning: string
}

const createStreamEmitter = (
  response: ServerResponse,
  id: string,
  model: string
): TurnEmitter => {
  let streamedContent = ""
  let streamedReasoning = ""
  const write = (payload: unknown) => {
    if (response.writableEnded) return
    response.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  return {
    streamMode: true,
    start() {
      startEventStream(response)
      response.write(": connected\n\n")
      write(roleChunk(id, model))
    },
    delta(text, isReasoning) {
      if (!text) return
      if (isReasoning) {
        streamedReasoning += text
        write(reasoningChunk(id, model, text))
        return
      }
      streamedContent += text
      write(contentChunk(id, model, text))
    },
    auxiliary(payload) {
      if (!payload) return
      write(patchChunk(id, model, [payload]))
    },
    toolCalls(calls) {
      write(toolCallsChunk(id, model, calls))
    },
    finish(reason) {
      write(finishChunk(id, model, reason))
      if (!response.writableEnded) {
        response.write("data: [DONE]\n\n")
        response.end()
      }
    },
    get content() {
      return streamedContent
    },
    get reasoning() {
      return streamedReasoning
    }
  }
}

const createBufferEmitter = (
  response: ServerResponse,
  id: string,
  model: string
): TurnEmitter => {
  let content = ""
  let reasoning = ""
  const envelope = (
    message: Record<string, unknown>,
    finishReason: string
  ) => ({
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  })

  return {
    streamMode: false,
    start() {},
    delta(text, isReasoning) {
      if (!text) return
      if (isReasoning) reasoning += text
      else content += text
    },
    auxiliary() {},
    toolCalls(calls) {
      sendJson(
        response,
        200,
        envelope(
          {
            role: "assistant",
            content: content || null,
            reasoning_content: reasoning || null,
            tool_calls: calls.map((call, index) =>
              toToolCallPayload(call, index)
            )
          },
          "tool_calls"
        )
      )
    },
    finish() {
      sendJson(
        response,
        200,
        envelope(
          {
            role: "assistant",
            content,
            reasoning_content: reasoning || null
          },
          "stop"
        )
      )
    },
    get content() {
      return content
    },
    get reasoning() {
      return reasoning
    }
  }
}

export const registerChatRoutes = (
  router: Router,
  {
    backend,
    config,
    log,
    pending,
    lock
  }: {
    backend: AgentBackend
    config: ProxyConfig
    log: ProxyLogger
    pending: PendingToolCalls
    lock: RequestQueue
  }
) => {
  /** Turns parked on a client tool result, with the deadline that discards them. */
  const parkedTurns = new Map<string, NodeJS.Timeout>()

  const clearParked = (turnId: string) => {
    const timer = parkedTurns.get(turnId)
    if (timer) clearTimeout(timer)
    parkedTurns.delete(turnId)
  }

  const discardTurn = async (turn: BackendTurn, { abort = false } = {}) => {
    clearParked(turn.id)
    if (abort) await turn.abort()
    await turn.dispose()
  }

  const parkTurn = (turn: BackendTurn) => {
    clearParked(turn.id)
    const timer = setTimeout(() => {
      log("Discarding a turn whose tool results never came back", {
        turnId: turn.id
      })
      pending.failTurn(
        turn.id,
        "The client abandoned this turn before returning a tool result"
      )
      void discardTurn(turn, { abort: true })
    }, config.SUSPENDED_TURN_TTL_MS)
    if (typeof timer.unref === "function") timer.unref()
    parkedTurns.set(turn.id, timer)
  }

  const releaseResults = (
    turn: BackendTurn,
    results: ToolResultMessage[],
    requestId?: string
  ) => {
    for (const result of results) {
      const released = pending.resolve(result.toolCallId, result.content)
      log("Released a parked tool result", {
        requestId,
        turnId: turn.id,
        callId: result.toolCallId,
        released
      })
    }
  }

  /**
   * Hand the client the tool calls the backend is waiting on and close this leg of
   * the exchange. The turn is left alive and parked; whichever request carries the
   * results resumes it.
   */
  const handOffToolCalls = async ({
    turn,
    emitter,
    requestId
  }: {
    turn: BackendTurn
    emitter: TurnEmitter
    requestId: string
  }): Promise<boolean> => {
    // Concurrent calls arrive a few milliseconds apart; a short wait lets them go to
    // the client in one `tool_calls` array instead of one per leg.
    if (config.BRIDGE_BATCH_MS > 0) await sleep(config.BRIDGE_BATCH_MS)
    const calls = pending.claimUnemitted(turn.id)
    if (calls.length === 0) {
      log("Suspension with no unannounced tool calls", {
        requestId,
        turnId: turn.id
      })
      return false
    }

    parkTurn(turn)
    log("Handing tool calls to the client", {
      requestId,
      turnId: turn.id,
      calls: calls.map((call) => `${call.tool}#${call.callId}`)
    })
    emitter.toolCalls(calls)
    if (emitter.streamMode) emitter.finish("tool_calls")
    return true
  }

  const runChatRequest = async ({
    body,
    response,
    requestId,
    resumeTurn
  }: {
    body: ChatCompletionRequest
    response: ServerResponse
    requestId: string
    resumeTurn?: BackendTurn
  }): Promise<void> => {
    const { messages, model: requestedModel, stream, tools } = body
    const streamMode = Boolean(stream)
    const toolResults = extractTrailingToolResults(messages)
    let settled = false
    let suspended = false
    let turn = resumeTurn

    if (!Array.isArray(messages) || messages.length === 0) {
      sendJson(response, 400, {
        error: { message: "messages array is required", type: "BadRequest" }
      })
      return
    }

    const target = await backend.resolveModel(requestedModel)
    if ("error" in target) {
      sendJson(response, 400, {
        error: { message: target.error, type: "BadRequest" }
      })
      return
    }
    const activeModel = `${target.providerId}/${target.modelId}`

    const emitter = streamMode
      ? createStreamEmitter(response, `chatcmpl-${Date.now()}`, activeModel)
      : createBufferEmitter(response, `chatcmpl-${Date.now()}`, activeModel)

    response.on("close", () => {
      if (settled || suspended || !turn) return
      log("Client closed the connection before the turn finished", {
        requestId,
        turnId: turn.id
      })
      pending.failTurn(turn.id, "The client closed the connection")
      void discardTurn(turn, { abort: true })
    })

    try {
      if (!turn) {
        await backend.ensureReady()
        turn = await backend.startTurn({
          requestId,
          model: target,
          messages,
          tools
        })
      } else {
        clearParked(turn.id)
        log("Resuming a parked turn", {
          requestId,
          turnId: turn.id,
          activeModel,
          toolResults: toolResults.length
        })
      }

      emitter.start()

      const handlers: TurnStreamHandlers = {
        onText: (text) => emitter.delta(text, false),
        onReasoning: (text) => emitter.delta(text, true),
        onAuxiliary: (payload) => emitter.auxiliary(payload)
      }

      let pendingResults = resumeTurn === turn ? toolResults : []
      let outcome: TurnResult
      while (true) {
        const suspension = createSuspensionSignal()
        const unwatch = pending.watch(turn.id, () => suspension.trigger())
        if (pending.hasUnemitted(turn.id)) suspension.trigger()

        const signals = {
          suspended: suspension.promise,
          hasUnannouncedToolCalls: () =>
            pending.hasUnemitted((turn as BackendTurn).id)
        }

        const results = pendingResults
        pendingResults = []

        try {
          outcome =
            results.length > 0
              ? await turn.resume(results, handlers, {
                  ...signals,
                  releaseToolResults: () =>
                    releaseResults(turn as BackendTurn, results)
                })
              : await turn.run(handlers, signals)
        } finally {
          unwatch()
        }

        if (outcome.status !== "suspended") break

        // A backend can report suspension before the call is registered, or for a
        // call the client was already told about. Only a real hand-off ends this
        // leg; anything else means the turn is still ours to drive.
        suspended = true
        settled = true
        const handedOff = await handOffToolCalls({ turn, emitter, requestId })
        if (handedOff) return
        suspended = false
        settled = false
      }

      settled = true
      if (outcome.status === "failed") {
        if (emitter.streamMode) {
          emitter.delta(
            `[Proxy Error] ${outcome.error.type}: ${outcome.error.message}`,
            false
          )
          emitter.finish("stop")
        } else {
          sendJson(response, 502, { error: outcome.error })
        }
        await discardTurn(turn)
        return
      }

      const tailReasoning = unsentTail(outcome.reasoning, emitter.reasoning)
      if (tailReasoning) emitter.delta(tailReasoning, true)
      const tailContent = unsentTail(outcome.content, emitter.content)
      if (tailContent) {
        emitter.delta(tailContent, false)
      } else if (!emitter.content && !outcome.content) {
        emitter.delta(buildFallbackAnswerText(outcome.finish), false)
      }

      emitter.finish("stop")
      await discardTurn(turn)
    } catch (error) {
      const message = (error as Error).message
      console.error("[Proxy] Chat completion failed:", message)
      log("Request failed", {
        requestId,
        turnId: turn?.id,
        activeModel,
        streamMode,
        message
      })
      settled = true
      if (turn) {
        pending.failTurn(turn.id, `The turn failed: ${message}`)
        await discardTurn(turn, { abort: true })
      }

      if (emitter.streamMode && response.headersSent) {
        emitter.delta(`[Proxy Error] ${message}`, false)
        emitter.finish("stop")
        return
      }
      sendJson(response, /Request timeout/.test(message) ? 504 : 500, {
        error: { message, type: "ProxyError" }
      })
    }
  }

  router.post("/v1/chat/completions", async (request, response) => {
    const requestId = createRequestId()
    const body = (
      isRecord(request.body) ? request.body : {}
    ) as ChatCompletionRequest
    const toolResults = extractTrailingToolResults(body.messages)
    const resumeTurn = toolResults
      .map((result) => pending.turnOf(result.toolCallId))
      .map((turnId) => (turnId ? backend.findTurn(turnId) : undefined))
      .find((candidate): candidate is BackendTurn => candidate !== undefined)

    log("POST /v1/chat/completions", {
      requestId,
      model: body.model,
      stream: Boolean(body.stream),
      messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
      resumes: resumeTurn?.id ?? null
    })

    await lock(
      () => runChatRequest({ body, response, requestId, resumeTurn }),
      config.REQUEST_TIMEOUT_MS + 60_000,
      `chat-completions:${requestId}`
    ).catch((error: unknown) => {
      const message = (error as Error).message
      console.error("[Proxy] Request handler error:", message)
      if (!response.headersSent) {
        sendJson(response, 500, { error: { message, type: "ProxyError" } })
      } else if (!response.writableEnded) {
        response.end()
      }
    })
  })

  return {
    shutdown: async () => {
      for (const turnId of parkedTurns.keys()) {
        pending.failTurn(turnId, "The proxy is shutting down")
        clearParked(turnId)
      }
    }
  }
}

export type ChatRoutes = ReturnType<typeof registerChatRoutes>
