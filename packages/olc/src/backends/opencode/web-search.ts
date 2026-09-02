/** Per-turn mapping from the public `web_search` function to OpenCode tools. */
import { splitWebSearchIntent } from "../../core/openai-wire.js"

const OPENCODE_SEARCH_TOOLS = new Set(["websearch", "webfetch"])

export interface OpencodeWebSearchRoute {
  native: boolean
  bridgeTools: unknown
  allowedNativeTools: string[]
}

/**
 * Prefer OpenCode's hosted search when it is actually present in the discovered
 * tool inventory. Otherwise preserve the client function so the extension can
 * execute SearXNG, Brave, Tavily, or another configured implementation.
 *
 * Search tools are always removed from the operator allowlist when the request did
 * not opt in. `webfetch` is additionally opt-in at the operator layer because it
 * can retrieve arbitrary URLs; native search alone does not silently enable it.
 */
export const routeOpencodeWebSearch = ({
  tools,
  discoveredIds,
  operatorAllowedTools
}: {
  tools: unknown
  discoveredIds: string[]
  operatorAllowedTools: string[]
}): OpencodeWebSearchRoute => {
  const intent = splitWebSearchIntent(tools)
  const native =
    intent.requested &&
    intent.source !== "client" &&
    discoveredIds.includes("websearch")
  const allowedNativeTools = operatorAllowedTools.filter(
    (id) => !OPENCODE_SEARCH_TOOLS.has(id)
  )

  if (native) {
    allowedNativeTools.push("websearch")
    if (
      operatorAllowedTools.includes("webfetch") &&
      discoveredIds.includes("webfetch")
    ) {
      allowedNativeTools.push("webfetch")
    }
  }

  return {
    native,
    bridgeTools:
      native || (intent.requested && intent.source === "native")
        ? intent.clientTools
        : tools,
    allowedNativeTools
  }
}
