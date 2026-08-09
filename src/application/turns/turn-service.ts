import {
  type TurnGenerationInput as RuntimeTurnGenerationInput,
  type TurnGenerationOwner as RuntimeTurnGenerationOwner,
  type TurnRunStore as RuntimeTurnRunStore,
  TurnRuntime
} from "@ollama-client/chat-runtime/turn-runtime"
import type { TurnMode } from "@ollama-client/contracts/turns"
import type { BuildRagContextOptions } from "@/application/context/build-context"
import {
  type DurableContextOptions,
  parseDurableContextOptions
} from "@/application/context/context-contract"
import type {
  ContextBuildOutput,
  ContextService
} from "@/application/context/context-service"
import { toAppFailure } from "@/protocol/app-failure"
import type { ChatMessage } from "@/types"
import type { DurableTurnRun } from "./turn-contract"

export type TurnRunStore = RuntimeTurnRunStore<
  DurableContextOptions,
  ChatMessage
>

export type TurnGenerationInput = RuntimeTurnGenerationInput<
  DurableContextOptions,
  ChatMessage,
  ContextBuildOutput
>

export type TurnGenerationOwner = RuntimeTurnGenerationOwner<
  DurableContextOptions,
  ChatMessage,
  ContextBuildOutput
>

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
  private readonly runtime: TurnRuntime<
    DurableContextOptions,
    ChatMessage,
    BuildRagContextOptions,
    ContextBuildOutput
  >

  constructor(
    store: TurnRunStore,
    contextService: ContextService,
    generation: TurnGenerationOwner
  ) {
    this.runtime = new TurnRuntime(
      store,
      contextService,
      generation,
      {
        toFailure: (error) =>
          toAppFailure(error, {
            fallbackMessage: "Turn failed",
            context: "turn-run"
          })
      },
      { now: Date.now }
    )
  }

  async start(command: StartTurnCommand): Promise<void> {
    const {
      onActivityEvent: _onActivityEvent,
      toast: _toast,
      ...context
    } = command.contextOptions
    await this.runtime.start({
      id: command.id,
      sessionId: command.sessionId,
      mode: command.mode,
      model: command.model,
      providerId: command.providerId,
      persistedContext: parseDurableContextOptions(context),
      contextOptions: command.contextOptions,
      userMessage: command.userMessage,
      userMessageId: command.userMessageId,
      assistantMessageId: command.assistantMessageId,
      prepareContextOptions: command.prepareContextOptions,
      createdAt: command.createdAt
    })
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
    await this.runtime.resume({
      turn,
      contextOptions: baseOptions,
      prepareContextOptions
    })
  }
}
