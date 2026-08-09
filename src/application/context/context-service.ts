import {
  ContextRuntime,
  type ContextBuildCommand as RuntimeContextBuildCommand,
  type ContextBuildOutput as RuntimeContextBuildOutput
} from "@ollama-client/chat-runtime/context-runtime"
import {
  type BuildRagContextOptions,
  type BuildRagContextResult,
  buildRagContext
} from "./build-context"

export type ContextBuildCommand =
  RuntimeContextBuildCommand<BuildRagContextOptions>

export type ContextBuildOutput =
  RuntimeContextBuildOutput<BuildRagContextResult>

/**
 * Extension adapter for environment-owned prompt augmentation.
 * ContextRuntime pairs the result with durable attribution before returning.
 */
export class ContextService {
  private readonly runtime = new ContextRuntime(
    { build: buildRagContext },
    { now: Date.now }
  )

  async build(command: ContextBuildCommand): Promise<ContextBuildOutput> {
    return this.runtime.build(command)
  }
}
