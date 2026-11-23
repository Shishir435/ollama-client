import { INTERNAL_TOOL_NAMES } from "./internal/internal-tool-source"
import { webSearchDefinition } from "./web-search/web-search-tool"

/** Every built-in tool name, offered right now or not; other sources avoid them. */
export const BUILT_IN_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...INTERNAL_TOOL_NAMES,
  webSearchDefinition.name
])
