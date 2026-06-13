import type { ToolContext, ToolResult, ToolSource } from "../types"
import { ragSearchDefinition, runRagSearch } from "./rag-search-tool"

type InternalTool = {
  definition: typeof ragSearchDefinition
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

/**
 * Built-in tools that run inside the extension. Add a tool by appending to this
 * list — the registry, adapters, loop, and trace UI need no change. The roadmap
 * tools `current_tab`, `selected_text`, and `file_search` slot in here once
 * their browser-context plumbing lands.
 */
const INTERNAL_TOOLS: InternalTool[] = [
  { definition: ragSearchDefinition, run: runRagSearch }
]

/**
 * The internal {@link ToolSource}. This is the first source; each future MCP
 * server registers as a sibling source with the same interface.
 */
export const createInternalToolSource = (): ToolSource => {
  const byName = new Map(
    INTERNAL_TOOLS.map((tool) => [tool.definition.name, tool])
  )
  return {
    id: "internal",
    listTools: () => INTERNAL_TOOLS.map((tool) => tool.definition),
    callTool: async (name, args, ctx) => {
      const tool = byName.get(name)
      if (!tool) {
        return { content: `Unknown internal tool: ${name}`, isError: true }
      }
      return tool.run(args, ctx)
    }
  }
}
