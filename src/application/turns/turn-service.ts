import type { BuildRagContextOptions } from "@/application/context/build-context"
import type {
  ContextBuildOutput,
  ContextService
} from "@/application/context/context-service"
import type { DurableTurnRun, TurnMode, TurnSubmission } from "./turn-contract"

export interface TurnRunStore {
  create: (submission: TurnSubmission) => Promise<void>
  update: (
    id: string,
    updates: Partial<
      Pick<
        DurableTurnRun,
        | "status"
        | "contextReceipt"
        | "userMessageId"
        | "assistantMessageId"
        | "failure"
      >
    >
  ) => Promise<void>
}

export interface TurnGenerationInput {
  submission: TurnSubmission
  context: ContextBuildOutput
}

export interface TurnGenerationOwner {
  start: (input: TurnGenerationInput) => Promise<{
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
    const submission: TurnSubmission = {
      id: command.id,
      sessionId: command.sessionId,
      mode: command.mode,
      model: command.model,
      providerId: command.providerId,
      request: command.contextOptions,
      createdAt: command.createdAt ?? Date.now()
    }

    await this.store.create(submission)

    try {
      await this.store.update(submission.id, { status: "building-context" })
      const context = await this.contextService.build({
        turnId: submission.id,
        mode: submission.mode,
        model: submission.model,
        providerId: submission.providerId,
        options: command.contextOptions
      })
      await this.store.update(submission.id, {
        status: "generating",
        contextReceipt: context.receipt
      })
      const messages = await this.generation.start({ submission, context })
      await this.store.update(submission.id, {
        status: "completed",
        ...messages
      })
    } catch (error) {
      await this.store.update(submission.id, {
        status: "failed",
        failure: error instanceof Error ? error.message : "Turn failed"
      })
      throw error
    }
  }
}
