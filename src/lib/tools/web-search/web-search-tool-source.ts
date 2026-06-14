import type { ToolSource } from "../types"
import { getWebSearchConfig } from "./config"
import { getWebSearchBackend } from "./registry"
import { runWebSearch, webSearchDefinition } from "./web-search-tool"

export const createWebSearchToolSource = (): ToolSource => ({
  id: "web-search",
  listTools: async () => {
    const config = await getWebSearchConfig()
    const backend = config.enabled
      ? getWebSearchBackend(config.provider)
      : undefined
    if (!backend) return []
    if (!backend.validateConfig(config).ok) return []
    return [webSearchDefinition]
  },
  callTool: async (name, args, ctx) => {
    if (name !== webSearchDefinition.name) {
      return { content: `Unknown web tool: ${name}`, isError: true }
    }
    return runWebSearch(args, ctx)
  }
})
