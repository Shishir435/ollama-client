import { logger } from "@/lib/logger"
import type {
  RegisteredTool,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSource
} from "./types"

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Aggregates tool {@link ToolSource}s and routes calls to the owning source.
 *
 * The registry is the single seam every provider adapter and the tool loop talk
 * to; they never reference a concrete source. Adding MCP later means registering
 * one more source — no change to the adapters, the loop, or the UI.
 *
 * Names are flat and must be unique across all sources. On a collision the first
 * registered source wins and the duplicate is dropped with a warning, so a
 * misbehaving source can never shadow a built-in tool.
 */
export class ToolRegistry {
  private readonly sources: ToolSource[] = []
  private route: Map<string, RegisteredTool> | null = null

  register(source: ToolSource): void {
    this.sources.push(source)
    this.route = null
  }

  /** Resolve every source's tools into a deduped, validated definition list. */
  async listDefinitions(): Promise<ToolDefinition[]> {
    const route = new Map<string, RegisteredTool>()
    for (const source of this.sources) {
      let tools: ToolDefinition[]
      try {
        tools = await source.listTools()
      } catch (error) {
        logger.warn("Tool source failed to list tools", "ToolRegistry", {
          sourceId: source.id,
          error
        })
        continue
      }
      for (const definition of tools) {
        if (!TOOL_NAME_PATTERN.test(definition.name)) {
          logger.warn("Skipping tool with invalid name", "ToolRegistry", {
            sourceId: source.id,
            name: definition.name
          })
          continue
        }
        if (route.has(definition.name)) {
          logger.warn("Skipping duplicate tool name", "ToolRegistry", {
            sourceId: source.id,
            name: definition.name
          })
          continue
        }
        route.set(definition.name, { definition, sourceId: source.id })
      }
    }
    this.route = route
    return [...route.values()].map((entry) => entry.definition)
  }

  /**
   * Execute a tool by name. A tool that throws, is unknown, or comes from a
   * crashed source resolves to an error {@link ToolResult} — it never throws —
   * so a bad tool degrades to a visible error in the trace instead of killing
   * the chat stream.
   */
  async call(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    if (!this.route) await this.listDefinitions()
    const entry = this.route?.get(name)
    if (!entry) {
      return { content: `Unknown tool: ${name}`, isError: true }
    }
    const source = this.sources.find((s) => s.id === entry.sourceId)
    if (!source) {
      return { content: `Tool source unavailable: ${name}`, isError: true }
    }
    try {
      return await source.callTool(name, args, ctx)
    } catch (error) {
      logger.error("Tool execution failed", "ToolRegistry", { name, error })
      const message = error instanceof Error ? error.message : String(error)
      return { content: `Tool "${name}" failed: ${message}`, isError: true }
    }
  }

  async getDefinition(name: string): Promise<ToolDefinition | undefined> {
    if (!this.route) await this.listDefinitions()
    return this.route?.get(name)?.definition
  }
}

export type { ToolCall, ToolContext, ToolDefinition, ToolResult, ToolSource }
