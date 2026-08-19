/**
 * Registry of client tool calls a backend is waiting on.
 *
 * Contract: a bridge tool call arrives out of band (the backend posts to the proxy)
 * while the OpenAI-shaped stream that triggered it is still open. The call is
 * parked here, surfaced to the client as an OpenAI `tool_calls` delta, and resolved
 * by whichever later request carries a `tool` message with the same id. The id is
 * therefore the correlation key across two HTTP requests, and every parked call
 * needs a deadline: a client that never comes back would otherwise leave a backend turn blocked forever.
 */
import type { PendingToolCall, ProxyLogger } from "../types.js"

const DEFAULT_TIMEOUT_MS = 300_000

interface ParkedCall extends PendingToolCall {
  resolve: (output: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const createCallId = () =>
  `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export class PendingToolCalls {
  private readonly timeoutMs: number
  private readonly log: ProxyLogger
  private readonly calls = new Map<string, ParkedCall>()
  private readonly watchers = new Map<string, Set<(callId: string) => void>>()

  constructor({
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log
  }: { timeoutMs?: number; log?: ProxyLogger } = {}) {
    this.timeoutMs = timeoutMs
    this.log = log ?? (() => {})
  }

  get size(): number {
    return this.calls.size
  }

  /**
   * Park a call and return the promise the plugin request awaits. Resolving it
   * hands the client's tool output back to the backend; rejecting surfaces a tool
   * error to the model instead of hanging the turn.
   */
  register({
    turnId,
    tool,
    args
  }: {
    turnId: string
    tool: string
    args?: unknown
  }): { callId: string; promise: Promise<string> } {
    const callId = createCallId()
    let resolve!: (output: string) => void
    let reject!: (error: Error) => void
    const promise = new Promise<string>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })

    const timer = setTimeout(() => {
      this.fail(
        callId,
        `Client did not return a result for ${tool} within ${this.timeoutMs}ms`
      )
    }, this.timeoutMs)
    if (typeof timer.unref === "function") timer.unref()

    this.calls.set(callId, {
      callId,
      turnId,
      tool,
      args: (args ?? {}) as Record<string, unknown>,
      emitted: false,
      createdAt: Date.now(),
      resolve,
      reject,
      timer
    })
    this.log("Parked a client tool call", { turnId, tool, callId })

    for (const watcher of this.watchers.get(turnId) ?? []) watcher(callId)

    return { callId, promise }
  }

  get(callId: string): PendingToolCall | undefined {
    return this.calls.get(callId)
  }

  turnOf(callId: string): string | undefined {
    return this.calls.get(callId)?.turnId
  }

  /** Calls of a turn the client has not been told about yet. */
  claimUnemitted(turnId: string): PendingToolCall[] {
    const claimed: ParkedCall[] = []
    for (const call of this.calls.values()) {
      if (call.turnId !== turnId || call.emitted) continue
      call.emitted = true
      claimed.push(call)
    }
    return claimed.sort((left, right) => left.createdAt - right.createdAt)
  }

  hasPending(turnId: string): boolean {
    for (const call of this.calls.values()) {
      if (call.turnId === turnId) return true
    }
    return false
  }

  /**
   * Whether a turn has a call the client has not been told about yet.
   *
   * A resuming request still holds the calls it is about to release, so "has any
   * pending call" would read as a fresh interruption and suspend the turn again
   * before its tool results were delivered.
   */
  hasUnemitted(turnId: string): boolean {
    for (const call of this.calls.values()) {
      if (call.turnId === turnId && !call.emitted) return true
    }
    return false
  }

  resolve(callId: string, output: unknown): boolean {
    const call = this.calls.get(callId)
    if (!call) return false
    this.discard(call)
    call.resolve(typeof output === "string" ? output : String(output ?? ""))
    return true
  }

  /**
   * Resolve a call only when it belongs to `turnId`.
   *
   * The registry is process-wide, but a client's follow-up request can carry result
   * ids from more than one parked turn. Releasing by id alone would then hand a turn
   * the output that was produced for a different one, so ownership is checked here
   * rather than trusted from the request that resumed a turn.
   */
  resolveForTurn(
    turnId: string,
    callId: string,
    output: unknown
  ): "released" | "foreign" | "unknown" {
    const call = this.calls.get(callId)
    if (!call) return "unknown"
    if (call.turnId !== turnId) return "foreign"
    this.resolve(callId, output)
    return "released"
  }

  fail(callId: string, message: string): boolean {
    const call = this.calls.get(callId)
    if (!call) return false
    this.discard(call)
    call.reject(new Error(message))
    return true
  }

  failTurn(turnId: string, message: string): void {
    for (const call of this.calls.values()) {
      if (call.turnId === turnId) this.fail(call.callId, message)
    }
  }

  /** Observe registrations for one turn; returns the unsubscribe function. */
  watch(turnId: string, listener: (callId: string) => void): () => void {
    const listeners = this.watchers.get(turnId) ?? new Set()
    listeners.add(listener)
    this.watchers.set(turnId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.watchers.delete(turnId)
    }
  }

  private discard(call: ParkedCall): void {
    clearTimeout(call.timer)
    this.calls.delete(call.callId)
  }
}
