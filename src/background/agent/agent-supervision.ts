import type {
  AgentApprovalDecision,
  AgentApprovalPort,
  AgentCancellationSignal,
  AgentTakeoverDecision,
  AgentTakeoverPort
} from "@ollama-client/agent-runtime"
import type {
  AgentApprovalRequest,
  AgentTakeoverRequest
} from "@ollama-client/contracts"

export type AgentPendingSupervision =
  | { kind: "approval"; request: AgentApprovalRequest }
  | { kind: "takeover"; request: AgentTakeoverRequest }

/**
 * Parks the controller's approval and takeover waits until a person answers.
 *
 * Every answer names the request it answers. A click that arrives after the
 * run moved on — a stale panel, a second window, a request the run abandoned
 * when it was stopped — resolves nothing, because authorization belongs to one
 * step and cannot be inherited by the step that replaced it.
 */
export interface AgentSupervision {
  approval: AgentApprovalPort
  takeover: AgentTakeoverPort
  pending(runId: string): AgentPendingSupervision | undefined
  answerApproval(input: {
    runId: string
    requestId: string
    decision: AgentApprovalDecision
  }): boolean
  answerTakeover(input: {
    runId: string
    requestId: string
    decision: AgentTakeoverDecision
  }): boolean
  abandon(runId: string): void
  subscribe(listener: (runId: string) => void): () => void
}

interface ParkedRequest {
  pending: AgentPendingSupervision
  settle(value: never): void
  fail(error: Error): void
}

export const createAgentSupervision = (): AgentSupervision => {
  const parked = new Map<string, ParkedRequest>()
  const listeners = new Set<(runId: string) => void>()

  const announce = (runId: string) => {
    for (const listener of [...listeners]) listener(runId)
  }

  const park = <T>(
    pending: AgentPendingSupervision,
    signal: AgentCancellationSignal
  ): Promise<T> => {
    const runId = pending.request.runId
    if (parked.has(runId)) {
      return Promise.reject(
        new Error("Agent run already awaits a supervision answer")
      )
    }
    return new Promise<T>((resolve, reject) => {
      const clear = () => {
        if (parked.get(runId)?.pending === pending) parked.delete(runId)
      }
      const entry: ParkedRequest = {
        pending,
        settle: ((value: T) => {
          clear()
          signal.removeEventListener?.("abort", onAbort)
          resolve(value)
          announce(runId)
        }) as ParkedRequest["settle"],
        fail: (error) => {
          clear()
          signal.removeEventListener?.("abort", onAbort)
          reject(error)
          announce(runId)
        }
      }
      const onAbort = () => entry.fail(new Error("Agent run was cancelled"))

      if (signal.aborted) {
        reject(new Error("Agent run was cancelled"))
        return
      }
      parked.set(runId, entry)
      signal.addEventListener?.("abort", onAbort, { once: true })
      announce(runId)
    })
  }

  const answer = (
    runId: string,
    requestId: string,
    kind: AgentPendingSupervision["kind"],
    decision: unknown
  ): boolean => {
    const entry = parked.get(runId)
    if (
      !entry ||
      entry.pending.kind !== kind ||
      entry.pending.request.id !== requestId
    ) {
      return false
    }
    entry.settle(decision as never)
    return true
  }

  return {
    approval: {
      request: (input, signal) =>
        park<AgentApprovalDecision>(
          { kind: "approval", request: input },
          signal
        )
    },
    takeover: {
      request: (input, signal) =>
        park<AgentTakeoverDecision>(
          { kind: "takeover", request: input },
          signal
        )
    },
    pending: (runId) => parked.get(runId)?.pending,
    answerApproval: ({ runId, requestId, decision }) =>
      answer(runId, requestId, "approval", decision),
    answerTakeover: ({ runId, requestId, decision }) =>
      answer(runId, requestId, "takeover", decision),
    abandon(runId) {
      parked.get(runId)?.fail(new Error("Agent supervision was abandoned"))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
