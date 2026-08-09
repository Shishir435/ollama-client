import type { TurnMode } from "@ollama-client/contracts/turns"
import type { BuildRagContextOptions } from "@/application/context/build-context"
import { parseDurableContextOptions } from "@/application/context/context-contract"
import type {
  ContextBuildOutput,
  ContextService
} from "@/application/context/context-service"
import { toAppFailure } from "@/protocol/app-failure"
import type { ChatMessage } from "@/types"
import type { DurableTurnRun, TurnSubmission } from "./turn-contract"

export interface TurnRunStore {
  create: (submission: TurnSubmission) => Promise<void>
  update: (
    id: string,
    updates: Omit<
      Partial<
        Pick<
          DurableTurnRun,
          | "status"
          | "contextReceipt"
          | "userMessageId"
          | "assistantMessageId"
          | "failure"
        >
      >,
      "failure"
    > & { failure?: DurableTurnRun["failure"] | null }
  ) => Promise<void>
}

export interface TurnGenerationInput {
  submission: TurnSubmission
  context: ContextBuildOutput
  userMessageId?: number
  assistantMessageId?: number
}

export interface TurnGenerationOwner {
  start: (input: TurnGenerationInput) => Promise<{
    outcome?: "completed" | "cancelled"
    userMessageId?: number
    assistantMessageId?: number
  }>
}

export interface StartTurnCommand {
  id: string
  sessionId: string
  mode: TurnMode
  model: string
  providerId?: string
  contextOptions: BuildRagContextOptions
  userMessage: ChatMessage
  userMessageId?: number
  assistantMessageId?: number
  prepareContextOptions?: (
    options: BuildRagContextOptions
  ) => Promise<BuildRagContextOptions>
  createdAt?: number
}

/**
 * Sole owner of submitted-turn lifecycle.
 *
 * Durable intent lands before context or provider work. From that point UI
 * closure can only hide progress; it cannot erase ownership of the turn.
 */
export class TurnService {
  constructor(
    private readonly store: TurnRunStore,
    private readonly contextService: ContextService,
    private readonly generation: TurnGenerationOwner
  ) {}

  async start(command: StartTurnCommand): Promise<void> {
    const {
      onActivityEvent: _onActivityEvent,
      toast: _toast,
      ...context
    } = command.contextOptions
    const submission: TurnSubmission = {
      id: command.id,
      sessionId: command.sessionId,
      mode: command.mode,
      model: command.model,
      providerId: command.providerId,
      request: {
        version: 1,
        context: parseDurableContextOptions(context),
        userMessage: command.userMessage
      },
      createdAt: command.createdAt ?? Date.now()
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
    turn: DurableTurnRun,
    prepareContextOptions?: (
      options: BuildRagContextOptions
    ) => Promise<BuildRagContextOptions>
  ): Promise<void> {
    const baseOptions: BuildRagContextOptions = {
      ...turn.request.context,
      toast: () => undefined
    }
    await this.run(
      turn,
      baseOptions,
      turn.userMessageId,
      turn.assistantMessageId,
      prepareContextOptions
    )
  }

  private async run(
    submission: TurnSubmission,
    contextOptions: BuildRagContextOptions,
    userMessageId?: number,
    assistantMessageId?: number,
    prepareContextOptions?: (
      options: BuildRagContextOptions
    ) => Promise<BuildRagContextOptions>
  ): Promise<void> {
    try {
      await this.store.update(submission.id, {
        status: "building-context",
        ...(userMessageId !== undefined ? { userMessageId } : {}),
        ...(assistantMessageId !== undefined ? { assistantMessageId } : {})
      })
      const preparedContextOptions = prepareContextOptions
        ? await prepareContextOptions(contextOptions)
        : contextOptions
      const context = await this.contextService.build({
        turnId: submission.id,
        mode: submission.mode,
        model: submission.model,
        providerId: submission.providerId,
        options: preparedContextOptions
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
        failure: toAppFailure(error, {
          fallbackMessage: "Turn failed",
          context: "turn-run"
        })
      })
      throw error
    }
  }
}
