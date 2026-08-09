import type { AppFailure } from "@ollama-client/contracts/app-failure"
import type {
  ContextReceipt,
  TurnMode,
  TurnStatus
} from "@ollama-client/contracts/turns"
import type { ContextBuildCommand } from "./context-runtime"

export interface PersistedTurnRequest<TContext, TMessage> {
  version: 1
  context: TContext
  userMessage: TMessage
}

export interface TurnSubmission<TContext, TMessage> {
  id: string
  sessionId: string
  mode: TurnMode
  model: string
  providerId?: string
  request: PersistedTurnRequest<TContext, TMessage>
  createdAt: number
}

export interface DurableTurnRun<TContext, TMessage>
  extends TurnSubmission<TContext, TMessage> {
  status: TurnStatus
  contextReceipt?: ContextReceipt
  userMessageId?: number
  assistantMessageId?: number
  failure?: AppFailure
  updatedAt: number
}

export type TurnRunUpdate = {
  status?: TurnStatus
  contextReceipt?: ContextReceipt
  userMessageId?: number
  assistantMessageId?: number
  failure?: AppFailure | null
}

export interface TurnRunStore<TContext, TMessage> {
  create: (submission: TurnSubmission<TContext, TMessage>) => Promise<void>
  update: (id: string, updates: TurnRunUpdate) => Promise<void>
}

export interface TurnContextOwner<TContextOptions, TContextOutput> {
  build: (
    command: ContextBuildCommand<TContextOptions>
  ) => Promise<TContextOutput & { receipt: ContextReceipt }>
}

export interface TurnGenerationInput<TContext, TMessage, TContextOutput> {
  submission: TurnSubmission<TContext, TMessage>
  context: TContextOutput & { receipt: ContextReceipt }
  userMessageId?: number
  assistantMessageId?: number
}

export interface TurnGenerationOwner<TContext, TMessage, TContextOutput> {
  start: (
    input: TurnGenerationInput<TContext, TMessage, TContextOutput>
  ) => Promise<{
    outcome?: "completed" | "cancelled"
    userMessageId?: number
    assistantMessageId?: number
  }>
}

export interface TurnFailureMapper {
  toFailure: (error: unknown) => AppFailure
}

export interface TurnClock {
  now: () => number
}

export interface StartTurnCommand<TContext, TMessage, TContextOptions> {
  id: string
  sessionId: string
  mode: TurnMode
  model: string
  providerId?: string
  persistedContext: TContext
  contextOptions: TContextOptions
  userMessage: TMessage
  userMessageId?: number
  assistantMessageId?: number
  prepareContextOptions?: (options: TContextOptions) => Promise<TContextOptions>
  createdAt?: number
}

export interface ResumeTurnCommand<TContext, TMessage, TContextOptions> {
  turn: DurableTurnRun<TContext, TMessage>
  contextOptions: TContextOptions
  prepareContextOptions?: (options: TContextOptions) => Promise<TContextOptions>
}

/**
 * Environment-independent owner of the durable turn lifecycle.
 *
 * Intent is persisted before context or generation work. Browser transport,
 * provider invocation, context construction, persistence, and failure mapping
 * enter only through ports supplied by the extension composition root.
 */
export class TurnRuntime<TContext, TMessage, TContextOptions, TContextOutput> {
  constructor(
    private readonly store: TurnRunStore<TContext, TMessage>,
    private readonly context: TurnContextOwner<TContextOptions, TContextOutput>,
    private readonly generation: TurnGenerationOwner<
      TContext,
      TMessage,
      TContextOutput
    >,
    private readonly failures: TurnFailureMapper,
    private readonly clock: TurnClock
  ) {}

  async start(
    command: StartTurnCommand<TContext, TMessage, TContextOptions>
  ): Promise<void> {
    const submission: TurnSubmission<TContext, TMessage> = {
      id: command.id,
      sessionId: command.sessionId,
      mode: command.mode,
      model: command.model,
      providerId: command.providerId,
      request: {
        version: 1,
        context: command.persistedContext,
        userMessage: command.userMessage
      },
      createdAt: command.createdAt ?? this.clock.now()
    }

    await this.store.create(submission)
    await this.run(
      submission,
      command.contextOptions,
      command.userMessageId,
      command.assistantMessageId,
      command.prepareContextOptions
    )
  }

  async resume(
    command: ResumeTurnCommand<TContext, TMessage, TContextOptions>
  ): Promise<void> {
    await this.run(
      command.turn,
      command.contextOptions,
      command.turn.userMessageId,
      command.turn.assistantMessageId,
      command.prepareContextOptions
    )
  }

  private async run(
    submission: TurnSubmission<TContext, TMessage>,
    contextOptions: TContextOptions,
    userMessageId?: number,
    assistantMessageId?: number,
    prepareContextOptions?: (
      options: TContextOptions
    ) => Promise<TContextOptions>
  ): Promise<void> {
    try {
      await this.store.update(submission.id, {
        status: "building-context",
        ...(userMessageId !== undefined ? { userMessageId } : {}),
        ...(assistantMessageId !== undefined ? { assistantMessageId } : {})
      })
      const preparedOptions = prepareContextOptions
        ? await prepareContextOptions(contextOptions)
        : contextOptions
      const context = await this.context.build({
        turnId: submission.id,
        mode: submission.mode,
        model: submission.model,
        providerId: submission.providerId,
        options: preparedOptions
      })
      await this.store.update(submission.id, {
        status: "generating",
        contextReceipt: context.receipt
      })
      const result = await this.generation.start({
        submission,
        context,
        userMessageId,
        assistantMessageId
      })
      await this.store.update(submission.id, {
        status: result.outcome === "cancelled" ? "cancelled" : "completed",
        ...(result.outcome === "cancelled" ? { failure: null } : {}),
        ...(result.userMessageId !== undefined
          ? { userMessageId: result.userMessageId }
          : {}),
        ...(result.assistantMessageId !== undefined
          ? { assistantMessageId: result.assistantMessageId }
          : {})
      })
    } catch (error) {
      await this.store.update(submission.id, {
        status: "failed",
        failure: this.failures.toFailure(error)
      })
      throw error
    }
  }
}
