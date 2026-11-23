import { logger } from "@/lib/logger"
import type { ToolContext, ToolResult } from "@/lib/tools/types"
import type { ConnectorClientPool } from "./connector-clients"
import type { ConnectorToolEntry } from "./connector-tool-index"
import { McpError } from "./mcp/mcp-client"
import type { StoredConnector } from "./types"

const untrusted = (content: string): ToolResult => ({
  content,
  isError: true,
  provenance: "web-untrusted"
})

/**
 * Run one connector tool. Kept apart from the source so the MCP client loads
 * only when a connector tool is actually called.
 *
 * A call that fails after it may have reached the server is reported as
 * possibly done, never retried: a connector tool can send mail or edit files.
 */
export const callConnectorTool = async (
  entry: ConnectorToolEntry,
  args: Record<string, unknown>,
  ctx: ToolContext,
  clients: ConnectorClientPool
): Promise<ToolResult> => {
  const { connector, tool } = entry
  const client = clients.get(connector)

  try {
    await client.ensureInitialized(ctx.signal)
  } catch (error) {
    logConnectorFailure(connector, tool.name, error)
    return untrusted(
      `Could not connect to "${connector.name}", so "${tool.name}" did not run. ${describeFailure(error)}`
    )
  }

  try {
    const output = await client.callTool(tool.name, args, ctx.signal)
    return {
      content: output.text,
      isError: output.isError,
      provenance: "web-untrusted"
    }
  } catch (error) {
    logConnectorFailure(connector, tool.name, error)
    if (error instanceof McpError && error.delivery === "no") {
      return untrusted(
        `"${tool.name}" on "${connector.name}" did not run. ${describeFailure(error)}`
      )
    }
    return untrusted(
      `"${tool.name}" on "${connector.name}" may already have run: ${describeFailure(error)} Do not call it again without checking its effect with the user.`
    )
  }
}

const describeFailure = (error: unknown): string => {
  if (error instanceof McpError) return `${error.message}.`
  return "The connector failed unexpectedly."
}

/** Only the connector id, tool name and failure kind: no URL, no credential. */
const logConnectorFailure = (
  connector: StoredConnector,
  toolName: string,
  error: unknown
) => {
  logger.warn("Connector tool call failed", "ConnectorToolSource", {
    connectorId: connector.id,
    tool: toolName,
    kind: error instanceof McpError ? error.kind : "unexpected",
    status: error instanceof McpError ? error.status : undefined
  })
}
