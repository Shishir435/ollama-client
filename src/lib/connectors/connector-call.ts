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
      `Could not connect to "${connector.name}", so "${tool.name}" did not run. ${describeFailure(error, connector)}`
    )
  }

  try {
    const output = await client.callTool(tool.name, args, ctx.signal)
    /** Server-written text, so it gets the same redaction as failures. */
    return {
      content: redactConnectorSecrets(output.text, connector),
      isError: output.isError,
      provenance: "web-untrusted"
    }
  } catch (error) {
    logConnectorFailure(connector, tool.name, error)
    if (error instanceof McpError && error.delivery === "no") {
      return untrusted(
        `"${tool.name}" on "${connector.name}" did not run. ${describeFailure(error, connector)}`
      )
    }
    return untrusted(
      `"${tool.name}" on "${connector.name}" may already have run: ${describeFailure(error, connector)} Do not call it again without checking its effect with the user.`
    )
  }
}

/**
 * A server's error text is passed on, but never a value only this extension
 * holds: a server that echoes the request back must not put the connector's
 * credential or endpoint into model context.
 */
export const redactConnectorSecrets = (
  text: string,
  connector: Pick<StoredConnector, "url" | "auth">
): string => {
  const secrets = [connector.auth.secret, connector.url].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  )
  return secrets.reduce(
    (redacted, secret) => redacted.split(secret).join("[redacted]"),
    text
  )
}

const describeFailure = (
  error: unknown,
  connector: Pick<StoredConnector, "url" | "auth">
): string => {
  if (error instanceof McpError) {
    return `${redactConnectorSecrets(error.message, connector)}.`
  }
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
