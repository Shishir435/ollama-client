import type {
  ContextReceipt,
  TurnMode
} from "@/application/turns/turn-contract"
import {
  type BuildRagContextOptions,
  type BuildRagContextResult,
  buildRagContext
} from "./build-context"

export interface ContextBuildCommand {
  turnId: string
  mode: TurnMode
  model: string
  providerId?: string
  options: BuildRagContextOptions
}

export interface ContextBuildOutput {
  result: BuildRagContextResult
  receipt: ContextReceipt
}

/**
 * Sole application owner of prompt augmentation and its durable attribution.
 * Prompt and receipt are produced together so presentation never reconstructs
 * sources from a later, mutated prompt.
 */
export class ContextService {
  async build(command: ContextBuildCommand): Promise<ContextBuildOutput> {
    const result = await buildRagContext(command.options)
    const stats = result.promptContextStats

    return {
      result,
      receipt: {
        version: 1,
        turnId: command.turnId,
        mode: command.mode,
        createdAt: Date.now(),
        query: command.options.rawInput,
        model: {
          id: command.model,
          ...(command.providerId ? { providerId: command.providerId } : {})
        },
        prompt: {
          inputLength: stats.promptInputLength,
          augmentedLength: stats.promptAugmentedLength,
          tabContextLength: stats.tabContextLength,
          ragContextLength: stats.ragContextLength,
          tabContextTruncated: stats.tabContextTruncated,
          groundedOnlyMode: stats.groundedOnlyMode,
          insufficientContext: stats.insufficientContext
        },
        sources: stats.usedContextChunks.map((chunk) => ({
          ...chunk,
          source:
            chunk.source === "file" ||
            chunk.source === "memory" ||
            chunk.source === "tab"
              ? chunk.source
              : "unknown"
        }))
      }
    }
  }
}
