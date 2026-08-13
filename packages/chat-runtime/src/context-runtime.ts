import type { ContextReceipt, TurnMode } from "@ollama-client/contracts/turns"

export interface ContextClock {
  now: () => number
}

export interface ContextEvidenceSource {
  id: string | number
  title: string
  titleKey?: string
  excerpt: string
  score: number
  sectionPath?: string
  source?: string
  chunkIndex?: number
}

export interface ContextPromptStats {
  promptInputLength: number
  promptAugmentedLength: number
  tabContextLength: number
  ragContextLength: number
  tabContextTruncated: boolean
  groundedOnlyMode: boolean
  insufficientContext: boolean
  usedContextChunks: ContextEvidenceSource[]
}

export interface ContextResultEvidence {
  promptContextStats: ContextPromptStats
}

export interface ContextBuildCommand<TOptions> {
  turnId: string
  mode: TurnMode
  model: string
  providerId?: string
  options: TOptions
}

export interface ContextBuildOutput<TResult> {
  result: TResult
  receipt: ContextReceipt
}

export interface ContextBuilder<TOptions, TResult> {
  build: (options: TOptions) => Promise<TResult>
}

const normalizeSource = (
  source: string | undefined
): "file" | "memory" | "tab" | "unknown" =>
  source === "file" || source === "memory" || source === "tab"
    ? source
    : "unknown"

/** Project a completed context build into bounded, durable turn evidence. */
export const createContextReceipt = <TOptions extends { rawInput: string }>(
  command: ContextBuildCommand<TOptions>,
  stats: ContextPromptStats,
  createdAt: number
): ContextReceipt => ({
  version: 1,
  turnId: command.turnId,
  mode: command.mode,
  createdAt,
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
  sources: stats.usedContextChunks.map((source) => ({
    ...source,
    source: normalizeSource(source.source)
  }))
})

/**
 * Couples environment-owned context construction with its durable evidence.
 *
 * The builder performs provider, retrieval, storage, and browser work through
 * the extension adapter. This runtime owns only the environment-independent
 * command, clock, and receipt projection used by durable turns.
 */
export class ContextRuntime<
  TOptions extends { rawInput: string },
  TResult extends ContextResultEvidence
> {
  constructor(
    private readonly builder: ContextBuilder<TOptions, TResult>,
    private readonly clock: ContextClock
  ) {}

  async build(
    command: ContextBuildCommand<TOptions>
  ): Promise<ContextBuildOutput<TResult>> {
    const result = await this.builder.build(command.options)
    const stats = result.promptContextStats

    return {
      result,
      receipt: createContextReceipt(command, stats, this.clock.now())
    }
  }
}
