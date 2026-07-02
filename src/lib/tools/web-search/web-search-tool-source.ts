import type { ToolSource } from "../types"
import { getWebSearchActive, getWebSearchConfig } from "./config"
import { getWebSearchBackend } from "./registry"
import { runWebSearch, webSearchDefinition } from "./web-search-tool"

export const createWebSearchToolSource = (): ToolSource => ({
  id: "web-search",
  listTools: async () => {
    const config = await getWebSearchConfig()
    // Two gates: configured in settings (config.enabled) AND switched on for
    // this device's chats (the composer toggle).
    if (!config.enabled) return []
    if (!(await getWebSearchActive())) return []
    const backend = getWebSearchBackend(config.provider)
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
