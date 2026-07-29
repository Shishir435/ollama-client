import type { BuildRagContextOptions } from "@/application/context/build-context"
import { parseDurableContextOptions } from "@/application/context/context-contract"
import type {
  ContextBuildOutput,
  ContextService
} from "@/application/context/context-service"
import type {
  ContextReceipt,
  DurableTurnRun,
  TurnMode,
  TurnSubmission
} from "./turn-contract"

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
    > & { failure?: string | null }
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
    private readonly contextService?: ContextService,
    private readonly generation?: TurnGenerationOwner
  ) {}

  submit(submission: TurnSubmission): Promise<void> {
    return this.store.create(submission)
  }

  markBuildingContext(id: string, userMessageId?: number): Promise<void> {
    return this.store.update(id, {
      status: "building-context",
      ...(userMessageId !== undefined ? { userMessageId } : {})
    })
  }

  markGenerating(id: string, contextReceipt: ContextReceipt): Promise<void> {
    return this.store.update(id, { status: "generating", contextReceipt })
  }

  attachAssistantMessage(
    id: string,
    assistantMessageId: number
  ): Promise<void> {
    return this.store.update(id, { assistantMessageId })
  }

  complete(
    id: string,
    messageIds?: { userMessageId?: number; assistantMessageId?: number }
  ): Promise<void> {
    return this.store.update(id, { status: "completed", ...messageIds })
  }

  fail(id: string, failure: string): Promise<void> {
    return this.store.update(id, { status: "failed", failure })
  }

  cancel(id: string): Promise<void> {
    return this.store.update(id, { status: "cancelled", failure: null })
  }

  async start(command: StartTurnCommand): Promise<void> {
    if (!this.contextService || !this.generation) {
      throw new Error("TurnService orchestration dependencies are unavailable")
    }
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
        context: parseDurableContextOptions(context)
      },
      createdAt: command.createdAt ?? Date.now()
    }

    await this.submit(submission)

    try {
      await this.markBuildingContext(submission.id)
      const context = await this.contextService.build({
        turnId: submission.id,
        mode: submission.mode,
        model: submission.model,
        providerId: submission.providerId,
        options: command.contextOptions
      })
      await this.markGenerating(submission.id, context.receipt)
      const messages = await this.generation.start({ submission, context })
      await this.complete(submission.id, messages)
    } catch (error) {
      await this.fail(
        submission.id,
        error instanceof Error ? error.message : "Turn failed"
      )
      throw error
    }
  }
}
