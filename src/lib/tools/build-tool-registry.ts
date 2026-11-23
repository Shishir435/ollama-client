import { createConnectorToolSource } from "@/lib/connectors/connector-tool-source"
import { createInternalToolSource } from "./internal/internal-tool-source"
import { ToolRegistry } from "./tool-registry"
import { createWebSearchToolSource } from "./web-search/web-search-tool-source"

let registry: ToolRegistry | null = null

/**
 * The process-wide tool registry, built lazily on first use. Internal tools are
 * registered first so a connector tool can never shadow one; every MCP
 * connector shares the one connector source.
 */
export const getToolRegistry = (): ToolRegistry => {
  if (!registry) {
    registry = new ToolRegistry()
    registry.register(createInternalToolSource())
    registry.register(createWebSearchToolSource())
    registry.register(createConnectorToolSource())
  }
  return registry
}
