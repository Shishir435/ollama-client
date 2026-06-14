import { createInternalToolSource } from "./internal/internal-tool-source"
import { ToolRegistry } from "./tool-registry"
import { createWebSearchToolSource } from "./web-search/web-search-tool-source"

let registry: ToolRegistry | null = null

/**
 * The process-wide tool registry, built lazily on first use. Internal tools are
 * registered now; future MCP servers register here too — one line per source,
 * with no change anywhere downstream.
 */
export const getToolRegistry = (): ToolRegistry => {
  if (!registry) {
    registry = new ToolRegistry()
    registry.register(createInternalToolSource())
    registry.register(createWebSearchToolSource())
    // Future: registry.register(createMcpToolSource(serverConfig))
  }
  return registry
}
