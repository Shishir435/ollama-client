export type ToolResultProvenance = "trusted" | "web-untrusted"

export interface ToolCallLike {
  id: string
}

export interface ToolRunLike {
  callId?: string
  status: string
  completedAt?: number
  error?: string
}

export interface ToolLoopState<
  TMessage,
  TToolRun extends ToolRunLike,
  TToolCall extends ToolCallLike,
  TMetrics
> {
  iteration: number
  phase: "model" | "tools"
  taintGeneration?: number
  workingMessages: TMessage[]
  toolRuns: TToolRun[]
  pendingToolCalls?: TToolCall[]
  nextToolIndex?: number
  toolResultMessages?: TMessage[]
  imageMessages?: TMessage[]
  nonNativeResponseParts?: string[]
  lastMetrics?: TMetrics
  emptyModelRetries?: number
}

export type ToolLoopCheckpointWriter<TState> = (
  state: TState,
  awaitingConfirmation: boolean
) => Promise<void>

export interface PreparedToolCallLike<TCall extends ToolCallLike> {
  call: TCall
  policy: { parallelizable: boolean }
  authorizationSensitive: boolean
}

export interface ToolExecutionResult {
  provenance: ToolResultProvenance
}

export interface ToolPhasePorts<
  TCall extends ToolCallLike,
  TPrepared extends PreparedToolCallLike<TCall>,
  TResult extends ToolExecutionResult
> {
  prepare: (call: TCall, taintGeneration: number) => Promise<TPrepared>
  canJoinParallelGroup: (call: TCall) => Promise<boolean>
  start: (prepared: TPrepared) => void
  execute: (prepared: TPrepared) => Promise<TResult>
  collect: (result: TResult) => void
}

export const resolveToolLoopState = <TState>(
  initialState: TState | undefined,
  createState: () => TState
): TState => initialState ?? createState()

/**
 * Shared durable lifecycle for native and prompt-based tool loops.
 *
 * Provider streaming, tool preparation/execution, approval policy, result
 * formatting, and persistence remain injected adapters. This coordinator owns
 * restart cursors, ordered parallel batches, taint advancement, and checkpoint
 * boundaries so both wire modes recover identically.
 */
export class ToolLoopCoordinator<
  TMessage,
  TToolRun extends ToolRunLike,
  TToolCall extends ToolCallLike,
  TMetrics
> {
  constructor(
    readonly state: ToolLoopState<TMessage, TToolRun, TToolCall, TMetrics>,
    private readonly writer?: ToolLoopCheckpointWriter<
      ToolLoopState<TMessage, TToolRun, TToolCall, TMetrics>
    >
  ) {}

  get hasCheckpointWriter(): boolean {
    return this.writer !== undefined
  }

  setMetrics(metrics: TMetrics | undefined): void {
    if (metrics !== undefined) this.state.lastMetrics = metrics
  }

  async checkpoint(awaitingConfirmation = false): Promise<void> {
    await this.writer?.(this.state, awaitingConfirmation)
  }

  async enterTools(
    calls: TToolCall[],
    mode: "native" | "non-native"
  ): Promise<void> {
    this.state.phase = "tools"
    this.state.pendingToolCalls = calls
    this.state.nextToolIndex = 0
    if (mode === "native") {
      this.state.toolResultMessages = []
      this.state.imageMessages = []
      this.state.nonNativeResponseParts = undefined
    } else {
      this.state.nonNativeResponseParts = []
      this.state.toolResultMessages = undefined
      this.state.imageMessages = undefined
    }
    await this.checkpoint()
  }

  reuseOrAddToolRun(next: TToolRun): TToolRun {
    const existing = this.state.toolRuns.find(
      (run) => run.callId === next.callId
    )
    if (!existing) {
      this.state.toolRuns.push(next)
      return next
    }
    existing.status = "running"
    existing.completedAt = undefined
    existing.error = undefined
    return existing
  }

  recordProvenance(provenance: ToolResultProvenance): void {
    if (provenance === "web-untrusted") {
      this.state.taintGeneration = (this.state.taintGeneration ?? 0) + 1
    }
  }

  async executePendingTools<
    TPrepared extends PreparedToolCallLike<TToolCall>,
    TResult extends ToolExecutionResult
  >(ports: ToolPhasePorts<TToolCall, TPrepared, TResult>): Promise<void> {
    const calls = this.state.pendingToolCalls ?? []
    for (let index = this.state.nextToolIndex ?? 0; index < calls.length; ) {
      const prepared = await ports.prepare(
        calls[index],
        this.state.taintGeneration ?? 0
      )
      if (prepared.policy.parallelizable && !prepared.authorizationSensitive) {
        const group: TPrepared[] = [prepared]
        index++
        while (index < calls.length) {
          if (!(await ports.canJoinParallelGroup(calls[index]))) break
          group.push(
            await ports.prepare(calls[index], this.state.taintGeneration ?? 0)
          )
          index++
        }
        for (const item of group) ports.start(item)
        const results = await Promise.all(group.map(ports.execute))
        for (const result of results) {
          this.recordProvenance(result.provenance)
          ports.collect(result)
        }
      } else {
        ports.start(prepared)
        const result = await ports.execute(prepared)
        this.recordProvenance(result.provenance)
        ports.collect(result)
        index++
      }
      this.state.nextToolIndex = index
      await this.checkpoint()
    }
  }

  async completeToolPhase(appendResults: () => void): Promise<void> {
    appendResults()
    this.state.iteration += 1
    this.state.phase = "model"
    this.state.pendingToolCalls = undefined
    this.state.nextToolIndex = undefined
    this.state.toolResultMessages = undefined
    this.state.imageMessages = undefined
    this.state.nonNativeResponseParts = undefined
    await this.checkpoint()
  }
}
