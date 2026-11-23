import type { ConnectorToolRisk } from "@ollama-client/contracts/connector-rpc"
import type { McpToolAnnotations, StoredConnectorTool } from "./types"

/**
 * The approval risk a connector tool gets before the user says otherwise.
 *
 * MCP annotations are hints from the server, not guarantees, so they can only
 * soften the default so far: a tool that says it is read-only still sends its
 * arguments to another process, and asks once per chat (`medium`). Everything
 * else — no annotations, writes, destructive or open-world tools — asks on
 * every call (`high`). `critical` and `low` are the user's call to make.
 */
export const suggestedConnectorRisk = (
  annotations: McpToolAnnotations | undefined
): ConnectorToolRisk => {
  if (annotations?.readOnlyHint === true && !annotations.destructiveHint) {
    return "medium"
  }
  return "high"
}

export const effectiveConnectorRisk = (
  tool: Pick<StoredConnectorTool, "annotations" | "riskOverride">
): ConnectorToolRisk =>
  tool.riskOverride ?? suggestedConnectorRisk(tool.annotations)

/**
 * Per MCP, `destructiveHint` defaults to true for a tool that is not
 * read-only, so an unannotated tool counts as destructive here.
 */
export const isDestructiveConnectorTool = (
  annotations: McpToolAnnotations | undefined
): boolean =>
  annotations?.readOnlyHint !== true && annotations?.destructiveHint !== false
