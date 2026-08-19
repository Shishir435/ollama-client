/**
 * Minimal declarations for `@opencode-ai/plugin`.
 *
 * Why declare instead of depend: this module is provided by the OpenCode runtime that
 * loads the plugin, not by this package — OpenCode resolves it from its own install.
 * Depending on it would pin a second copy of OpenCode's plugin API to whatever version
 * npm resolved, and it would still not be the one doing the loading.
 */
declare module "@opencode-ai/plugin" {
  export interface ToolExecuteContext {
    sessionID: string
    messageID: string
    agent: string
    directory: string
    worktree: string
    abort: AbortSignal
  }

  /** The Zod instance OpenCode exposes for building argument schemas. */
  export interface ToolSchema {
    string: () => ZodLike
    number: () => ZodLike
    boolean: () => ZodLike
    any: () => ZodLike
    enum: (values: string[]) => ZodLike
    array: (item: ZodLike) => ZodLike
    object: (shape: Record<string, ZodLike>) => ZodLike
    record: (key: ZodLike, value: ZodLike) => ZodLike
  }

  export interface ZodLike {
    optional: () => ZodLike
    describe: (description: string) => ZodLike
  }

  export interface ToolDefinitionInput {
    description: string
    args: Record<string, ZodLike>
    execute: (
      args: Record<string, unknown>,
      context: ToolExecuteContext
    ) => Promise<string>
  }

  export interface ToolFactory {
    (input: ToolDefinitionInput): ToolDefinitionInput
    schema: ToolSchema
  }

  export const tool: ToolFactory
}
